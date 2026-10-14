import type { Annot } from './model'
import { computeRect } from './pdf/annotIO'
import { normalizeRect, type Rect } from './pdf/coords'

const mapRect = (r: Rect, fx: (x: number) => number, fy: (y: number) => number): Rect =>
  normalizeRect([fx(r[0]), fy(r[1]), fx(r[2]), fy(r[3])])

function mapPoints(pts: number[], fx: (x: number) => number, fy: (y: number) => number): number[] {
  return pts.map((v, i) => (i % 2 === 0 ? fx(v) : fy(v)))
}

/** Returns the geometry patch that moves an annotation by (dx, dy) in PDF space. */
export function translatePatch(a: Annot, dx: number, dy: number): Partial<Annot> {
  const fx = (x: number): number => x + dx
  const fy = (y: number): number => y + dy
  const patch: Partial<Annot> = { rect: mapRect(a.rect, fx, fy) }
  if (a.quads) patch.quads = a.quads.map((q) => mapRect(q, fx, fy))
  if (a.paths) patch.paths = a.paths.map((p) => mapPoints(p, fx, fy))
  if (a.line) patch.line = mapPoints(a.line, fx, fy) as Annot['line']
  return patch
}

/** Returns the geometry patch that fits an annotation into a new bounding rect. */
export function resizePatch(a: Annot, next: Rect): Partial<Annot> {
  const old = a.rect
  const ow = old[2] - old[0] || 1
  const oh = old[3] - old[1] || 1
  const n = normalizeRect(next)
  const fx = (x: number): number => n[0] + ((x - old[0]) / ow) * (n[2] - n[0])
  const fy = (y: number): number => n[1] + ((y - old[1]) / oh) * (n[3] - n[1])
  const patch: Partial<Annot> = { rect: n }
  if (a.paths) patch.paths = a.paths.map((p) => mapPoints(p, fx, fy))
  if (a.line) patch.line = mapPoints(a.line, fx, fy) as Annot['line']
  return patch
}

export function withRect(a: Annot): Annot {
  return { ...a, rect: computeRect(a) }
}

/** Merges per-span rectangles into one rectangle per text line. */
export function mergeLineRects(rects: Rect[]): Rect[] {
  const sorted = rects
    .map(normalizeRect)
    .filter((r) => r[2] - r[0] > 0.2 && r[3] - r[1] > 0.2)
    .sort((a, b) => b[3] - a[3] || a[0] - b[0])
  const out: Rect[] = []
  for (const r of sorted) {
    const h = r[3] - r[1]
    const w = r[2] - r[0]
    const target = out.find((o) => {
      const oh = o[3] - o[1]
      const ow = o[2] - o[0]
      const vOverlap = Math.min(o[3], r[3]) - Math.max(o[1], r[1])
      const hOverlap = Math.min(o[2], r[2]) - Math.max(o[0], r[0])
      // Same horizontal line of text.
      const sameRow = vOverlap > 0.5 * Math.min(h, oh)
      const rowGap = Math.max(o[0], r[0]) - Math.min(o[2], r[2])
      // Same vertical column (rotated text).
      const sameCol = hOverlap > 0.5 * Math.min(w, ow) && w < h && ow < oh
      return (sameRow && rowGap < Math.max(h, oh) * 1.5) || sameCol
    })
    if (target) {
      target[0] = Math.min(target[0], r[0])
      target[1] = Math.min(target[1], r[1])
      target[2] = Math.max(target[2], r[2])
      target[3] = Math.max(target[3], r[3])
    } else {
      out.push([...r])
    }
  }
  return out
}
