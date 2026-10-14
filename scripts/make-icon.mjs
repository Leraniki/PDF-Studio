// Rasterizes resources/icon.svg into icon.png (512 px) and a multi-size icon.ico.
// Usage: node scripts/make-icon.mjs  (needs @napi-rs/canvas, installed with pdfjs-dist)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'resources', 'icon.svg'))

async function render(size) {
  const img = await loadImage(svg)
  const canvas = createCanvas(size, size)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, size, size)
  return canvas.toBuffer('image/png')
}

// ICO container with PNG-compressed entries (supported since Windows Vista).
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2)
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = []
for (const size of sizes) images.push({ size, data: await render(size) })
writeFileSync(join(root, 'resources', 'icon.ico'), ico(images))
writeFileSync(join(root, 'resources', 'icon.png'), await render(512))
console.log('icon.ico and icon.png written to resources/')
