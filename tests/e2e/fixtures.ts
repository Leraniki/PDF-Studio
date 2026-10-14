import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const FIXTURE_DIR = join(__dirname, '..', 'fixtures')

/** A long document with mixed page sizes and orientations. */
export async function makeLongPdf(pages = 320, name = 'long.pdf'): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const sizes: [number, number][] = [
    [595, 842], // A4 portrait
    [842, 595], // A4 landscape
    [612, 792], // Letter
    [420, 595] // A5
  ]
  for (let i = 0; i < pages; i++) {
    const [w, h] = sizes[i % 7 === 3 ? 1 : i % 5 === 4 ? 3 : i % 3 === 2 ? 2 : 0]
    const page = doc.addPage([w, h])
    page.drawText(`Page ${i + 1}`, { x: 48, y: h - 80, size: 28, font, color: rgb(0.1, 0.1, 0.1) })
    for (let l = 0; l < 20; l++) {
      page.drawText(`Line ${l + 1} of page ${i + 1}: the quick brown fox jumps over the lazy dog`, {
        x: 48,
        y: h - 130 - l * 22,
        size: 11,
        font
      })
    }
    page.drawRectangle({ x: 24, y: 24, width: w - 48, height: h - 48, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 })
  }
  mkdirSync(FIXTURE_DIR, { recursive: true })
  const path = join(FIXTURE_DIR, name)
  writeFileSync(path, await doc.save())
  return path
}
