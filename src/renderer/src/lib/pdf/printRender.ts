import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pageScale, type PrintSettings, type SheetLayout } from '../print'

const PT_MM = 25.4 / 72

/**
 * Draws one sheet side (one or more pages laid out in a grid) at `pxPerMm`.
 * `sheet` holds 0-based page indices; null gives a blank sheet.
 */
export async function renderSheet(
  pdf: PDFDocumentProxy,
  sheet: number[] | null,
  layout: SheetLayout,
  s: PrintSettings,
  pxPerMm: number,
  cancelled: () => boolean = () => false
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(layout.width * pxPerMm)
  canvas.height = Math.round(layout.height * pxPerMm)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (!sheet) return canvas

  const margin = s.margin * pxPerMm
  const gap = layout.cols * layout.rows > 1 ? 3 * pxPerMm : 0
  const cellW = (canvas.width - 2 * margin - (layout.cols - 1) * gap) / layout.cols
  const cellH = (canvas.height - 2 * margin - (layout.rows - 1) * gap) / layout.rows

  for (let k = 0; k < sheet.length; k++) {
    if (cancelled()) break
    const page = await pdf.getPage(sheet[k] + 1)
    try {
      const base = page.getViewport({ scale: 1 })
      // In auto mode pages that do not match the cell shape are turned to fill it.
      const turn = s.orientation === 'auto' && base.width !== base.height && base.width > base.height !== cellW > cellH
      const rotation = (page.rotate + (turn ? 90 : 0)) % 360
      const w = turn ? base.height : base.width
      const h = turn ? base.width : base.height
      const factor = pageScale(s, [w * PT_MM, h * PT_MM], [cellW / pxPerMm, cellH / pxPerMm])
      const scale = factor * PT_MM * pxPerMm
      const drawnW = w * scale
      const drawnH = h * scale
      // Render only the part of the page that fits the cell (large custom scales).
      const tw = Math.max(1, Math.ceil(Math.min(drawnW, cellW)))
      const th = Math.max(1, Math.ceil(Math.min(drawnH, cellH)))
      const tmp = document.createElement('canvas')
      tmp.width = tw
      tmp.height = th
      const vp = page.getViewport({ scale, rotation, offsetX: (tw - drawnW) / 2, offsetY: (th - drawnH) / 2 })
      await page.render({ canvas: tmp, viewport: vp, intent: 'print', background: '#ffffff' }).promise

      const col = k % layout.cols
      const row = Math.floor(k / layout.cols)
      const x = Math.round(margin + col * (cellW + gap) + (cellW - tw) / 2)
      const y = Math.round(margin + row * (cellH + gap) + (cellH - th) / 2)
      ctx.filter = s.color ? 'none' : 'grayscale(1)'
      ctx.drawImage(tmp, x, y)
      ctx.filter = 'none'
      if (s.borders && s.perSheet > 1) {
        ctx.strokeStyle = '#8a8a8a'
        ctx.lineWidth = Math.max(1, 0.25 * pxPerMm)
        ctx.strokeRect(x, y, tw, th)
      }
      tmp.width = tmp.height = 0
    } finally {
      page.cleanup()
    }
  }
  return canvas
}
