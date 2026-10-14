/** Crypto primitives for the PDF standard security handler. */

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

export function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

export function bytesEqual(a: Uint8Array, b: Uint8Array, n = Math.max(a.length, b.length)): boolean {
  if (a.length < n || b.length < n) return false
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false
  return true
}

// ---------------------------------------------------------------------------
// MD5 (RFC 1321)
// ---------------------------------------------------------------------------

const MD5_R = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
]
const MD5_K = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0)

export function md5(data: Uint8Array): Uint8Array {
  const len = data.length
  const padded = new Uint8Array(((len + 72) >> 6) << 6)
  padded.set(data)
  padded[len] = 0x80
  const bits = len * 8
  const n = padded.length
  padded[n - 8] = bits & 0xff
  padded[n - 7] = (bits >>> 8) & 0xff
  padded[n - 6] = (bits >>> 16) & 0xff
  padded[n - 5] = (bits >>> 24) & 0xff
  padded[n - 4] = Math.floor(bits / 2 ** 32) & 0xff

  let h0 = 0x67452301
  let h1 = 0xefcdab89 | 0
  let h2 = 0x98badcfe | 0
  let h3 = 0x10325476
  const w = new Int32Array(16)
  for (let off = 0; off < n; off += 64) {
    for (let j = 0; j < 16; j++) {
      const p = off + j * 4
      w[j] = padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24)
    }
    let a = h0, b = h1, c = h2, d = h3
    for (let j = 0; j < 64; j++) {
      let f: number, g: number
      if (j < 16) {
        f = (b & c) | (~b & d)
        g = j
      } else if (j < 32) {
        f = (d & b) | (~d & c)
        g = (5 * j + 1) % 16
      } else if (j < 48) {
        f = b ^ c ^ d
        g = (3 * j + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * j) % 16
      }
      const tmp = d
      d = c
      c = b
      const x = (a + f + MD5_K[j] + w[g]) | 0
      b = (b + ((x << MD5_R[j]) | (x >>> (32 - MD5_R[j])))) | 0
      a = tmp
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
  }
  const out = new Uint8Array(16)
  ;[h0, h1, h2, h3].forEach((h, i) => {
    out[i * 4] = h & 0xff
    out[i * 4 + 1] = (h >>> 8) & 0xff
    out[i * 4 + 2] = (h >>> 16) & 0xff
    out[i * 4 + 3] = (h >>> 24) & 0xff
  })
  return out
}

// ---------------------------------------------------------------------------
// RC4
// ---------------------------------------------------------------------------

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256)
  for (let i = 0; i < 256; i++) s[i] = i
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff
    const t = s[i]
    s[i] = s[j]
    s[j] = t
  }
  const out = new Uint8Array(data.length)
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff
    j = (j + s[i]) & 0xff
    const t = s[i]
    s[i] = s[j]
    s[j] = t
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff]
  }
  return out
}

// ---------------------------------------------------------------------------
// SHA-2 and AES-CBC via WebCrypto
// ---------------------------------------------------------------------------

export async function sha(alg: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest(`SHA-${alg}`, data as BufferSource))
}

const keyCache = new Map<string, Promise<CryptoKey>>()

function importAes(key: Uint8Array): Promise<CryptoKey> {
  const id = Array.from(key).join(',')
  let k = keyCache.get(id)
  if (!k) {
    k = subtle().importKey('raw', key as BufferSource, 'AES-CBC', false, ['encrypt', 'decrypt'])
    keyCache.set(id, k)
    if (keyCache.size > 64) keyCache.delete(keyCache.keys().next().value!)
  }
  return k
}

/** AES-CBC with PKCS#7 padding. */
export async function aesEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await importAes(key)
  return new Uint8Array(await subtle().encrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, data as BufferSource))
}

/** AES-CBC without padding (data length must be a multiple of 16). */
export async function aesEncryptNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return (await aesEncrypt(key, iv, data)).subarray(0, data.length)
}

/** AES-CBC decryption without padding removal. */
export async function aesDecryptNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (!data.length) return data
  const k = await importAes(key)
  // Append a block that decrypts to valid PKCS#7 padding, so WebCrypto accepts the input.
  const last = data.subarray(data.length - 16)
  const extra = (await aesEncrypt(key, last, new Uint8Array(16).fill(16))).subarray(0, 16)
  const plain = await subtle().decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, concat(data, extra) as BufferSource)
  return new Uint8Array(plain).subarray(0, data.length)
}

/** Decrypts `iv || ciphertext` with PKCS#7 padding; tolerates broken padding. */
export async function aesDecrypt(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length <= 16) return new Uint8Array(0)
  const iv = data.subarray(0, 16)
  let body = data.subarray(16)
  if (body.length % 16 !== 0) body = body.subarray(0, body.length - (body.length % 16))
  if (!body.length) return new Uint8Array(0)
  try {
    const k = await importAes(key)
    return new Uint8Array(await subtle().decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, k, body as BufferSource))
  } catch {
    const raw = await aesDecryptNoPad(key, iv, body)
    const pad = raw[raw.length - 1]
    return pad > 0 && pad <= 16 ? raw.subarray(0, raw.length - pad) : raw
  }
}
