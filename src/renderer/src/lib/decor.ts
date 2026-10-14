import type { Decorations, HFSlot } from './model'
import { inRanges } from './ranges'

/**
 * Watermarks and headers/footers as positioned items in *display* space: points,
 * origin top-left, y down, page as seen on screen. The viewer draws these as SVG
 * and the exporter maps them into PDF user space, so both always match.
 */
export type DecorItem =
  | {
      kind: 'text'
      text: string
      x: number
      y: number
      /** Counter-clockwise degrees on screen. */
      angle: number
      size: number
      color: string
      opacity: number
      anchor: 'start' | 'middle' | 'end'
      /** Vertically centered on (x, y) instead of sitting on the baseline. */
      middle: boolean
    }
  | {
      kind: 'image'
      src: string
      cx: number
      cy: number
      w: number
      h: number
      angle: number
      opacity: number
    }

export interface DecorContext {
  pageIndex: number
  pageCount: number
  fileName: string
  date: Date
}

export const HF_TOKENS = ['{page}', '{total}', '{date}', '{file}']

export function fillTokens(text: string, ctx: DecorContext, startNumber: number): string {
  return text
    .replace(/\{page\}/g, String(ctx.pageIndex + startNumber))
    .replace(/\{total\}/g, String(ctx.pageCount + startNumber - 1))
    .replace(/\{date\}/g, ctx.date.toLocaleDateString('ru-RU'))
    .replace(/\{file\}/g, ctx.fileName.replace(/\.pdf$/i, ''))
}

const SLOT_POS: Record<HFSlot, { top: boolean; anchor: 'start' | 'middle' | 'end' }> = {
  tl: { top: true, anchor: 'start' },
  tc: { top: true, anchor: 'middle' },
  tr: { top: true, anchor: 'end' },
  bl: { top: false, anchor: 'start' },
  bc: { top: false, anchor: 'middle' },
  br: { top: false, anchor: 'end' }
}

export function hasDecor(d: Decorations | undefined | null): boolean {
  return !!d && (!!d.watermark || !!d.headerFooter)
}

export function decorItems(d: Decorations, width: number, height: number, ctx: DecorContext): DecorItem[] {
  const out: DecorItem[] = []
  const wm = d.watermark
  if (wm && inRanges(wm.pages, ctx.pageIndex, ctx.pageCount)) {
    const cy = wm.position === 'top' ? height * 0.22 : wm.position === 'bottom' ? height * 0.78 : height / 2
    if (wm.image) {
      const w = width * wm.imageScale
      const h = w * (wm.imageHeight / Math.max(1, wm.imageWidth))
      out.push({ kind: 'image', src: wm.image, cx: width / 2, cy, w, h, angle: wm.angle, opacity: wm.opacity })
    } else if (wm.text.trim()) {
      out.push({
        kind: 'text',
        text: fillTokens(wm.text, ctx, 1),
        x: width / 2,
        y: cy,
        angle: wm.angle,
        size: wm.fontSize,
        color: wm.color,
        opacity: wm.opacity,
        anchor: 'middle',
        middle: true
      })
    }
  }
  const hf = d.headerFooter
  if (hf && inRanges(hf.pages, ctx.pageIndex, ctx.pageCount)) {
    for (const slot of Object.keys(SLOT_POS) as HFSlot[]) {
      const raw = hf.slots[slot]
      if (!raw?.trim()) continue
      const pos = SLOT_POS[slot]
      const x = pos.anchor === 'start' ? hf.marginX : pos.anchor === 'end' ? width - hf.marginX : width / 2
      const y = pos.top ? hf.marginY + hf.fontSize * 0.8 : height - hf.marginY
      out.push({
        kind: 'text',
        text: fillTokens(raw, ctx, hf.startNumber),
        x,
        y,
        angle: 0,
        size: hf.fontSize,
        color: hf.color,
        opacity: 1,
        anchor: pos.anchor,
        middle: false
      })
    }
  }
  return out
}
