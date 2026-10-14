import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib'
import { aesEncrypt, concat, md5, rc4 } from '../../src/renderer/src/lib/pdf/crypto'
import {
  __internals,
  decryptPdf,
  encryptPdf,
  isEncryptedPdf,
  permissionsToP,
  pToPermissions,
  WrongPasswordError,
  ALL_PERMISSIONS,
  type EncryptInfo
} from '../../src/renderer/src/lib/pdf/security'

const fixture = (n: string): Uint8Array => new Uint8Array(readFileSync(join(__dirname, 'fixtures', n)))
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const latin = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0))
/** pdf-lib writes drawn text as hex strings. */
const drawn = (s: string): string => hex(latin(s)).toUpperCase()

async function pageText(bytes: Uint8Array, index = 0): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const contents = doc.getPage(index).node.Contents()
  const stream = contents instanceof PDFRawStream ? contents : doc.context.lookup((contents as unknown as { get(i: number): PDFRef }).get(0))
  return new TextDecoder('latin1').decode(decodePDFRawStream(stream as PDFRawStream).decode())
}

describe('primitives', () => {
  it('md5 matches RFC 1321 vectors', () => {
    expect(hex(md5(new Uint8Array()))).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(hex(md5(latin('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(hex(md5(latin('a'.repeat(1000))))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8')
  })
  it('rc4 matches the classic test vector', () => {
    expect(hex(rc4(latin('Key'), latin('Plaintext')))).toBe('bbf316e8d940af0ad3')
  })
  it('round-trips permission flags', () => {
    const p = { ...ALL_PERMISSIONS, modify: false, copy: false }
    expect(pToPermissions(permissionsToP(p))).toEqual({ ...p, assemble: true })
  })
})

describe('decrypt files produced by pypdf (RC4)', () => {
  for (const name of ['rc4-40.pdf', 'rc4-128.pdf']) {
    it(`${name}: user password gives a restricted, decrypted copy`, async () => {
      const bytes = fixture(name)
      expect(await isEncryptedPdf(bytes)).toBe(true)
      const res = await decryptPdf(bytes, 'user')
      expect(res.restricted).toBe(true)
      expect(res.protection.permissions.print).toBe(true)
      expect(res.protection.permissions.modify).toBe(false)
      const doc = await PDFDocument.load(res.bytes)
      expect(doc.getPageCount()).toBe(2)
      expect(doc.getTitle()).toBe('Секретный документ')
      expect(await pageText(res.bytes, 1)).toContain(drawn('Hello secret page 2'))
    })
    it(`${name}: owner password unlocks and recovers the user password`, async () => {
      const res = await decryptPdf(fixture(name), 'owner')
      expect(res.restricted).toBe(false)
      expect(res.protection.userPassword).toBe('user')
      expect(res.protection.ownerPassword).toBe('owner')
    })
    it(`${name}: wrong password is rejected`, async () => {
      await expect(decryptPdf(fixture(name), 'nope')).rejects.toBeInstanceOf(WrongPasswordError)
    })
  }
})

describe('AES-256 encryption', () => {
  const protection = {
    userPassword: 'пароль',
    ownerPassword: 'владелец',
    permissions: { ...ALL_PERMISSIONS, modify: false }
  }

  it('is readable by pdf.js only with the right password', async () => {
    const enc = await encryptPdf(fixture('base.pdf'), protection)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    await expect(pdfjs.getDocument({ data: enc.slice() }).promise).rejects.toMatchObject({ name: 'PasswordException' })
    const pdf = await pdfjs.getDocument({ data: enc.slice(), password: 'пароль' }).promise
    const text = await (await pdf.getPage(1)).getTextContent()
    expect(text.items.map((i) => ('str' in i ? i.str : '')).join('')).toContain('Hello secret page 1')
    const meta = await pdf.getMetadata()
    expect((meta.info as { Title?: string }).Title).toBe('Секретный документ')
    await pdf.loadingTask.destroy()
  })

  it('round-trips through decryptPdf with user and owner passwords', async () => {
    const enc = await encryptPdf(fixture('base.pdf'), protection)
    const asUser = await decryptPdf(enc, 'пароль')
    expect(asUser.restricted).toBe(true)
    expect(await pageText(asUser.bytes)).toContain(drawn('Hello secret page 1'))
    const asOwner = await decryptPdf(enc, 'владелец')
    expect(asOwner.restricted).toBe(false)
    await expect(decryptPdf(enc, 'x')).rejects.toBeInstanceOf(WrongPasswordError)
  })

  it('an empty user password opens without prompting', async () => {
    const enc = await encryptPdf(fixture('base.pdf'), { userPassword: '', ownerPassword: 'o', permissions: ALL_PERMISSIONS })
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: enc.slice() }).promise
    expect(pdf.numPages).toBe(2)
    await pdf.loadingTask.destroy()
    expect((await decryptPdf(enc, '')).restricted).toBe(false)
  })
})

// A hand-built file with an encrypted object stream (what Acrobat typically writes).
async function handcrafted(aes: boolean): Promise<Uint8Array> {
  const { legacyKey, legacyU, ownerRc4Key, legacyObjectKey, padPassword } = __internals
  const id0 = latin('0123456789abcdef')
  const P = -4
  const info: EncryptInfo = {
    V: aes ? 4 : 2,
    R: aes ? 4 : 3,
    lengthBytes: 16,
    O: new Uint8Array(32),
    U: new Uint8Array(32),
    OE: new Uint8Array(),
    UE: new Uint8Array(),
    P,
    id0,
    encryptMetadata: true,
    stm: aes ? 'aes128' : 'rc4',
    str: aes ? 'aes128' : 'rc4'
  }
  const ok = ownerRc4Key(info, latin('owner'))
  let O = rc4(ok, padPassword(latin('user')))
  for (let i = 1; i <= 19; i++) O = rc4(ok.map((b) => b ^ i), O)
  info.O = O
  const key = legacyKey(info, padPassword(latin('user')))
  const U = concat(legacyU(info, key), new Uint8Array(16))

  const enc = async (num: number, data: Uint8Array): Promise<Uint8Array> => {
    const k = legacyObjectKey(key, PDFRef.of(num, 0), aes)
    if (!aes) return rc4(k, data)
    const iv = new Uint8Array(16).fill(7)
    return concat(iv, await aesEncrypt(k, iv, data))
  }

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> /PSNote (plain in objstm) >>'
  ]
  let header = ''
  let body = ''
  objs.forEach((o, i) => {
    header += `${i + 1} ${body.length} `
    body += o + '\n'
  })
  const objstm = latin(header + body)
  const content = latin('BT /F1 12 Tf (Hello objstm) Tj ET')

  const parts: (string | Uint8Array)[] = []
  const add = (s: string | Uint8Array): void => void parts.push(s)
  add('%PDF-1.6\n')
  const c4 = await enc(4, content)
  add(`4 0 obj\n<< /Length ${c4.length} >>\nstream\n`)
  add(c4)
  add('\nendstream\nendobj\n')
  const c5 = await enc(5, objstm)
  add(`5 0 obj\n<< /Type /ObjStm /N 3 /First ${header.length} /Length ${c5.length} >>\nstream\n`)
  add(c5)
  add('\nendstream\nendobj\n')
  const cf = aes ? '/CF << /StdCF << /CFM /AESV2 /Length 16 /AuthEvent /DocOpen >> >> /StmF /StdCF /StrF /StdCF ' : ''
  add(`6 0 obj\n<< /Filter /Standard /V ${info.V} /R ${info.R} /Length 128 ${cf}/O <${hex(O)}> /U <${hex(U)}> /P ${P} >>\nendobj\n`)
  add(`7 0 obj\n<< /Title <${hex(await enc(7, latin('Hand made')))}> >>\nendobj\n`)
  add(`trailer\n<< /Size 8 /Root 1 0 R /Encrypt 6 0 R /Info 7 0 R /ID [<${hex(id0)}> <${hex(id0)}>] >>\nstartxref\n0\n%%EOF\n`)
  return concat(...parts.map((p) => (typeof p === 'string' ? latin(p) : p)))
}

describe('encrypted object streams', () => {
  for (const aes of [false, true]) {
    it(`decrypts ${aes ? 'AES-128' : 'RC4-128'} files with object streams`, async () => {
      const bytes = await handcrafted(aes)
      const res = await decryptPdf(bytes, 'user')
      const doc = await PDFDocument.load(res.bytes)
      expect(doc.getPageCount()).toBe(1)
      expect(doc.getTitle()).toBe('Hand made')
      expect(await pageText(res.bytes)).toContain('Hello objstm')
      const note = doc.getPage(0).node.lookup(PDFName.of('PSNote'))
      expect(note?.toString()).toBe('(plain in objstm)')
      expect((await decryptPdf(bytes, 'owner')).protection.userPassword).toBe('user')
    })
  }
})
