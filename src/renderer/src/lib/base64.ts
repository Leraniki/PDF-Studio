export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export interface ParsedDataUrl {
  mime: string
  bytes: Uint8Array
}

export function parseDataUrl(url: string): ParsedDataUrl | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url)
  if (!m || !m[2]) return null
  return { mime: m[1], bytes: base64ToBytes(m[3]) }
}

export function toDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}
