/**
 * PDF Standard Security Handler: decrypts password-protected files (R2–R6, RC4 /
 * AES-128 / AES-256) so they can be edited, and encrypts output with AES-256 (R6).
 */
import {
  PDFArray,
  PDFBool,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectStreamParser,
  PDFParser,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFObject
} from 'pdf-lib'
import {
  aesDecrypt,
  aesDecryptNoPad,
  aesEncrypt,
  aesEncryptNoPad,
  bytesEqual,
  concat,
  md5,
  randomBytes,
  rc4,
  sha
} from './crypto'

export interface Permissions {
  print: boolean
  modify: boolean
  copy: boolean
  annotate: boolean
  fillForms: boolean
  assemble: boolean
}

export interface Protection {
  /** Password required to open the document ('' = opens without a password). */
  userPassword: string
  /** Password that unlocks all permissions. */
  ownerPassword: string
  permissions: Permissions
}

export const ALL_PERMISSIONS: Permissions = {
  print: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  assemble: true
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Неверный пароль')
  }
}

export class UnsupportedEncryptionError extends Error {}

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6,
  0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
])

// Permission bits (1-based bit numbers from ISO 32000, table 22).
const BIT = { print: 3, modify: 4, copy: 5, annotate: 6, fillForms: 9, extract: 10, assemble: 11, printHigh: 12 }

export function permissionsToP(p: Permissions): number {
  let v = 0xfffff0c0 // reserved bits 7-8 and 13-32 set
  const set = (bit: number): void => {
    v |= 1 << (bit - 1)
  }
  if (p.print) {
    set(BIT.print)
    set(BIT.printHigh)
  }
  if (p.modify) set(BIT.modify)
  if (p.copy) {
    set(BIT.copy)
    set(BIT.extract)
  }
  if (p.annotate) set(BIT.annotate)
  if (p.fillForms) set(BIT.fillForms)
  if (p.assemble) set(BIT.assemble)
  return v | 0
}

export function pToPermissions(P: number): Permissions {
  const has = (bit: number): boolean => (P & (1 << (bit - 1))) !== 0
  return {
    print: has(BIT.print),
    modify: has(BIT.modify),
    copy: has(BIT.copy),
    annotate: has(BIT.annotate),
    fillForms: has(BIT.fillForms) || has(BIT.annotate),
    assemble: has(BIT.assemble) || has(BIT.modify)
  }
}

export function isRestricted(p: Permissions): boolean {
  return Object.values(p).some((v) => !v)
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s).subarray(0, 127)
/** R2–R4 passwords are single-byte strings (same convention as pdf.js). */
const latin1 = (s: string): Uint8Array => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0) & 0xff))

function padPassword(pw: Uint8Array): Uint8Array {
  const out = new Uint8Array(32)
  const n = Math.min(32, pw.length)
  out.set(pw.subarray(0, n))
  out.set(PAD.subarray(0, 32 - n), n)
  return out
}

function le32(n: number): Uint8Array {
  return Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])
}

function stringBytes(o: PDFObject | undefined): Uint8Array {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.asBytes()
  return new Uint8Array(0)
}

function toHex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

interface EncryptInfo {
  V: number
  R: number
  lengthBytes: number
  O: Uint8Array
  U: Uint8Array
  OE: Uint8Array
  UE: Uint8Array
  P: number
  id0: Uint8Array
  encryptMetadata: boolean
  stm: 'none' | 'rc4' | 'aes128' | 'aes256'
  str: 'none' | 'rc4' | 'aes128' | 'aes256'
}

function cryptMethod(dict: PDFDict, name: 'StmF' | 'StrF', V: number): EncryptInfo['stm'] {
  if (V < 4) return 'rc4'
  const filterName = dict.lookup(PDFName.of(name))
  const fname = filterName instanceof PDFName ? filterName.decodeText() : 'Identity'
  if (fname === 'Identity') return 'none'
  const cf = dict.lookup(PDFName.of('CF'))
  const f = cf instanceof PDFDict ? cf.lookup(PDFName.of(fname)) : undefined
  const cfm = f instanceof PDFDict ? f.lookup(PDFName.of('CFM')) : undefined
  const m = cfm instanceof PDFName ? cfm.decodeText() : 'None'
  if (m === 'V2') return 'rc4'
  if (m === 'AESV2') return 'aes128'
  if (m === 'AESV3') return 'aes256'
  return 'none'
}

function readEncrypt(context: PDFContext): EncryptInfo {
  const enc = context.lookup(context.trailerInfo.Encrypt)
  if (!(enc instanceof PDFDict)) throw new UnsupportedEncryptionError('Нет словаря шифрования')
  const filter = enc.lookup(PDFName.of('Filter'))
  if (!(filter instanceof PDFName) || filter.decodeText() !== 'Standard') {
    throw new UnsupportedEncryptionError('Шифрование сертификатом не поддерживается')
  }
  const num = (k: string, d: number): number => {
    const v = enc.lookup(PDFName.of(k))
    return v instanceof PDFNumber ? v.asNumber() : d
  }
  const V = num('V', 0)
  const R = num('R', 2)
  let lengthBits = num('Length', 40)
  if (V >= 4) {
    const cf = enc.lookup(PDFName.of('CF'))
    const std = cf instanceof PDFDict ? cf.lookup(PDFName.of('StdCF')) : undefined
    const l = std instanceof PDFDict ? std.lookup(PDFName.of('Length')) : undefined
    if (l instanceof PDFNumber) lengthBits = l.asNumber() <= 32 ? l.asNumber() * 8 : l.asNumber()
    if (V === 4 && lengthBits < 128) lengthBits = 128
  }
  const idArr = context.lookup(context.trailerInfo.ID)
  const id0 = idArr instanceof PDFArray ? stringBytes(idArr.lookup(0)) : new Uint8Array(0)
  const em = enc.lookup(PDFName.of('EncryptMetadata'))
  return {
    V,
    R,
    lengthBytes: R === 2 ? 5 : Math.max(5, Math.min(16, lengthBits / 8)),
    O: stringBytes(enc.lookup(PDFName.of('O'))),
    U: stringBytes(enc.lookup(PDFName.of('U'))),
    OE: stringBytes(enc.lookup(PDFName.of('OE'))),
    UE: stringBytes(enc.lookup(PDFName.of('UE'))),
    P: num('P', -1) | 0,
    id0,
    encryptMetadata: !(em instanceof PDFBool) || em.asBoolean(),
    stm: cryptMethod(enc, 'StmF', V),
    str: cryptMethod(enc, 'StrF', V)
  }
}

/** Algorithm 2: file key from a (padded) user password, R2–R4. */
function legacyKey(info: EncryptInfo, paddedUser: Uint8Array): Uint8Array {
  const parts = [paddedUser, info.O.subarray(0, 32), le32(info.P), info.id0]
  if (info.R >= 4 && !info.encryptMetadata) parts.push(Uint8Array.from([0xff, 0xff, 0xff, 0xff]))
  let key = md5(concat(...parts))
  const n = info.lengthBytes
  if (info.R >= 3) for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n))
  return key.slice(0, n)
}

/** Algorithms 4/5: the /U value for a file key. */
function legacyU(info: EncryptInfo, key: Uint8Array): Uint8Array {
  if (info.R === 2) return rc4(key, PAD)
  let x = rc4(key, md5(concat(PAD, info.id0)))
  for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x)
  return x
}

function ownerRc4Key(info: EncryptInfo, owner: Uint8Array): Uint8Array {
  let h = md5(padPassword(owner))
  if (info.R >= 3) for (let i = 0; i < 50; i++) h = md5(h)
  return h.slice(0, info.lengthBytes)
}

/** Algorithm 2.B (R6) or plain SHA-256 (R5). */
async function hash2B(R: number, pw: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await sha(256, concat(pw, salt, udata))
  if (R === 5) return k
  let e: Uint8Array = new Uint8Array(0)
  let i = 0
  while (i < 64 || e[e.length - 1] > i - 32) {
    const block = concat(pw, k, udata)
    const k1 = new Uint8Array(block.length * 64)
    for (let j = 0; j < 64; j++) k1.set(block, j * block.length)
    e = await aesEncryptNoPad(k.subarray(0, 16), k.subarray(16, 32), k1)
    let sum = 0
    for (let j = 0; j < 16; j++) sum += e[j]
    const mod = sum % 3
    k = await sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e)
    i++
  }
  return k.subarray(0, 32)
}

interface KeyResult {
  key: Uint8Array
  /** True when the password matched the owner password. */
  owner: boolean
  /** Recovered user password (R2–R4 when opened with the owner password). */
  userPassword: string | null
}

async function deriveKey(info: EncryptInfo, password: string): Promise<KeyResult | null> {
  if (info.R >= 5) {
    const pw = utf8(password)
    const U = info.U
    const O = info.O
    if (bytesEqual(await hash2B(info.R, pw, U.subarray(32, 40), new Uint8Array(0)), U, 32)) {
      const ik = await hash2B(info.R, pw, U.subarray(40, 48), new Uint8Array(0))
      return { key: await aesDecryptNoPad(ik, new Uint8Array(16), info.UE.subarray(0, 32)), owner: false, userPassword: password }
    }
    if (bytesEqual(await hash2B(info.R, pw, O.subarray(32, 40), U.subarray(0, 48)), O, 32)) {
      const ik = await hash2B(info.R, pw, O.subarray(40, 48), U.subarray(0, 48))
      return { key: await aesDecryptNoPad(ik, new Uint8Array(16), info.OE.subarray(0, 32)), owner: true, userPassword: null }
    }
    return null
  }
  const pw = latin1(password)
  const tryUser = (padded: Uint8Array): Uint8Array | null => {
    const key = legacyKey(info, padded)
    const u = legacyU(info, key)
    return bytesEqual(u, info.U, info.R === 2 ? 32 : 16) ? key : null
  }
  const asUser = tryUser(padPassword(pw))
  if (asUser) return { key: asUser, owner: false, userPassword: password }
  // Algorithm 7: the owner password decrypts /O into the padded user password.
  const ok = ownerRc4Key(info, pw)
  let user = info.O.subarray(0, 32)
  if (info.R === 2) user = rc4(ok, user)
  else for (let i = 19; i >= 0; i--) user = rc4(ok.map((b) => b ^ i), user)
  const asOwner = tryUser(user)
  if (!asOwner) return null
  // Strip the padding to get the user password back.
  let end = 0
  while (end < 32 && !bytesEqual(user.subarray(end, 32), PAD.subarray(0, 32 - end), 32 - end)) end++
  return { key: asOwner, owner: true, userPassword: String.fromCharCode(...user.subarray(0, end)) }
}

// ---------------------------------------------------------------------------
// Object-level crypt
// ---------------------------------------------------------------------------

type Crypt = (data: Uint8Array, ref: PDFRef, kind: 'str' | 'stm') => Promise<Uint8Array>

function legacyObjectKey(key: Uint8Array, ref: PDFRef, aes: boolean): Uint8Array {
  const n = ref.objectNumber
  const g = ref.generationNumber
  const parts: Uint8Array[] = [key, Uint8Array.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, g & 0xff, (g >> 8) & 0xff])]
  if (aes) parts.push(Uint8Array.from([0x73, 0x41, 0x6c, 0x54]))
  return md5(concat(...parts)).slice(0, Math.min(16, key.length + 5))
}

function decryptor(info: EncryptInfo, key: Uint8Array): Crypt {
  return async (data, ref, kind) => {
    const method = kind === 'str' ? info.str : info.stm
    if (method === 'none') return data
    if (method === 'aes256') return aesDecrypt(key, data)
    const ok = legacyObjectKey(key, ref, method === 'aes128')
    return method === 'rc4' ? rc4(ok, data) : aesDecrypt(ok, data)
  }
}

async function transformValue(obj: PDFObject, ref: PDFRef, crypt: Crypt): Promise<PDFObject> {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return PDFHexString.of(toHex(await crypt(obj.asBytes(), ref, 'str')))
  }
  if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) obj.set(k, await transformValue(v, ref, crypt))
    return obj
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) obj.set(i, await transformValue(obj.get(i), ref, crypt))
    return obj
  }
  return obj
}

function isType(dict: PDFDict, type: string): boolean {
  const t = dict.lookup(PDFName.of('Type'))
  return t instanceof PDFName && t.decodeText() === type
}

async function transformContext(
  context: PDFContext,
  crypt: Crypt,
  skip: (ref: PDFRef, obj: PDFObject) => boolean
): Promise<void> {
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (skip(ref, obj)) continue
    if (obj instanceof PDFRawStream) {
      await transformValue(obj.dict, ref, crypt)
      if (isType(obj.dict, 'XRef')) continue
      const data = await crypt(obj.contents, ref, 'stm')
      context.assign(ref, PDFRawStream.of(obj.dict, data))
    } else {
      await transformValue(obj, ref, crypt)
    }
  }
}

// ---------------------------------------------------------------------------
// pdf-lib hook: object streams are encrypted as a whole, so their parsing is
// deferred until the key is known.
// ---------------------------------------------------------------------------

type DeferContext = PDFContext & { __psDefer?: { ref: PDFRef; stream: PDFRawStream }[]; __psLastRef?: PDFRef }

const originalForStream = PDFObjectStreamParser.forStream
let hooked = false
function installHook(): void {
  if (hooked) return
  hooked = true
  const proto = PDFParser.prototype as unknown as { parseIndirectObjectHeader: (...a: unknown[]) => PDFRef }
  const header = proto.parseIndirectObjectHeader
  proto.parseIndirectObjectHeader = function (this: { context: DeferContext }, ...a: unknown[]) {
    const ref = header.apply(this, a)
    this.context.__psLastRef = ref
    return ref
  }
  ;(PDFObjectStreamParser as unknown as { forStream: unknown }).forStream = (raw: PDFRawStream, tick?: () => boolean) => {
    const ctx = raw.dict.context as DeferContext
    if (ctx.__psDefer && ctx.__psLastRef) {
      ctx.__psDefer.push({ ref: ctx.__psLastRef, stream: raw })
      return { parseIntoContext: async () => undefined }
    }
    return originalForStream.call(PDFObjectStreamParser, raw, tick)
  }
}

async function parseDeferred(bytes: Uint8Array): Promise<{ context: DeferContext; deferred: { ref: PDFRef; stream: PDFRawStream }[] }> {
  installHook()
  const parser = PDFParser.forBytesWithOptions(bytes)
  const context = (parser as unknown as { context: DeferContext }).context
  const deferred: { ref: PDFRef; stream: PDFRawStream }[] = []
  context.__psDefer = deferred
  await parser.parseDocument()
  delete context.__psDefer
  return { context, deferred }
}

function makeDocument(context: PDFContext): PDFDocument {
  const Ctor = PDFDocument as unknown as new (c: PDFContext, ignoreEncryption: boolean, updateMetadata: boolean) => PDFDocument
  return new Ctor(context, true, false)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DecryptResult {
  bytes: Uint8Array
  protection: Protection
  /** Opened with the user password while permissions are restricted. */
  restricted: boolean
}

/** Quick check without decrypting. */
export async function isEncryptedPdf(bytes: Uint8Array): Promise<boolean> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    return doc.isEncrypted
  } catch {
    return false
  }
}

/**
 * Decrypts a standard-security PDF. Throws WrongPasswordError when the password
 * matches neither the user nor the owner password.
 */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<DecryptResult> {
  const { context, deferred } = await parseDeferred(bytes)
  const encRef = context.trailerInfo.Encrypt
  const info = readEncrypt(context)
  if (![2, 3, 4, 5, 6].includes(info.R)) throw new UnsupportedEncryptionError(`Ревизия шифрования R${info.R} не поддерживается`)
  const res = await deriveKey(info, password)
  if (!res) throw new WrongPasswordError()
  const crypt = decryptor(info, res.key)
  const encObj = context.lookup(encRef)

  await transformContext(context, crypt, (ref, obj) => {
    if (encRef instanceof PDFRef && ref === encRef) return true
    if (obj === encObj) return true
    if (!info.encryptMetadata && obj instanceof PDFRawStream && isType(obj.dict, 'Metadata')) return true
    return false
  })

  for (const d of deferred) {
    const plain = await crypt(d.stream.contents, d.ref, 'stm')
    const stream = PDFRawStream.of(d.stream.dict, plain)
    await originalForStream.call(PDFObjectStreamParser, stream).parseIntoContext()
  }

  context.trailerInfo.Encrypt = undefined
  if (encRef instanceof PDFRef) context.delete(encRef)

  const doc = makeDocument(context)
  const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false })
  const permissions = pToPermissions(info.P)
  return {
    bytes: out,
    protection: {
      userPassword: res.owner ? (res.userPassword ?? '') : password,
      ownerPassword: res.owner ? password : '',
      permissions
    },
    restricted: !res.owner && isRestricted(permissions)
  }
}

/** Encrypts a PDF with AES-256 (revision 6). */
export async function encryptPdf(bytes: Uint8Array, protection: Protection): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const context = doc.context
  const fileKey = randomBytes(32)
  const user = utf8(protection.userPassword)
  const owner = utf8(protection.ownerPassword || protection.userPassword || toHex(randomBytes(16)))

  const uvs = randomBytes(8)
  const uks = randomBytes(8)
  const U = concat(await hash2B(6, user, uvs, new Uint8Array(0)), uvs, uks)
  const UE = await aesEncryptNoPad(await hash2B(6, user, uks, new Uint8Array(0)), new Uint8Array(16), fileKey)
  const ovs = randomBytes(8)
  const oks = randomBytes(8)
  const O = concat(await hash2B(6, owner, ovs, U), ovs, oks)
  const OE = await aesEncryptNoPad(await hash2B(6, owner, oks, U), new Uint8Array(16), fileKey)
  const P = permissionsToP(protection.permissions)
  const perms = concat(le32(P), [0xff, 0xff, 0xff, 0xff], [0x54, 0x61, 0x64, 0x62], randomBytes(4))
  const Perms = await aesEncryptNoPad(fileKey, new Uint8Array(16), perms)

  const crypt: Crypt = async (data) => {
    const iv = randomBytes(16)
    return concat(iv, await aesEncrypt(fileKey, iv, data))
  }
  await transformContext(context, crypt, (_ref, obj) => obj instanceof PDFRawStream && isType(obj.dict, 'XRef'))

  const encDict = context.obj({
    Filter: 'Standard',
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF',
    StrF: 'StdCF',
    O: PDFHexString.of(toHex(O)),
    U: PDFHexString.of(toHex(U)),
    OE: PDFHexString.of(toHex(OE)),
    UE: PDFHexString.of(toHex(UE)),
    Perms: PDFHexString.of(toHex(Perms)),
    P,
    EncryptMetadata: true
  } as never)
  context.trailerInfo.Encrypt = context.register(encDict)
  const id = PDFHexString.of(toHex(randomBytes(16)))
  context.trailerInfo.ID = context.obj([id, id])
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

/** Exposed for unit tests only. */
export const __internals = { legacyKey, legacyU, ownerRc4Key, legacyObjectKey, padPassword }
export type { EncryptInfo }
