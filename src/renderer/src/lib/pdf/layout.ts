/**
 * Exact, precomputed layout for continuous scrolling. Every page gets a fixed box
 * before anything is rendered, so rendering never shifts content (no scroll jumps).
 */
export interface PageBox {
  top: number
  left: number
  width: number
  height: number
}

export interface Row {
  top: number
  height: number
  pages: number[]
}

export interface Layout {
  boxes: PageBox[]
  rows: Row[]
  totalWidth: number
  totalHeight: number
}

export const PAGE_GAP = 12
export const PAGE_PAD = 24

export type SpreadMode = 'single' | 'spread'

export function rowsFor(count: number, spread: SpreadMode): number[][] {
  const rows: number[][] = []
  if (spread === 'single') {
    for (let i = 0; i < count; i++) rows.push([i])
  } else {
    for (let i = 0; i < count; i += 2) rows.push(i + 1 < count ? [i, i + 1] : [i])
  }
  return rows
}

export function computeLayout(
  sizes: { width: number; height: number }[],
  spread: SpreadMode,
  containerWidth: number
): Layout {
  const rowIdx = rowsFor(sizes.length, spread)
  const rowWidths = rowIdx.map((r) => r.reduce((s, i) => s + sizes[i].width, 0) + PAGE_GAP * (r.length - 1))
  const maxRowWidth = rowWidths.reduce((m, w) => Math.max(m, w), 0)
  const totalWidth = Math.max(containerWidth, maxRowWidth + PAGE_PAD * 2)

  const boxes: PageBox[] = new Array(sizes.length)
  const rows: Row[] = []
  let y = PAGE_PAD
  rowIdx.forEach((r, ri) => {
    const height = r.reduce((m, i) => Math.max(m, sizes[i].height), 0)
    let x = Math.round((totalWidth - rowWidths[ri]) / 2)
    for (const i of r) {
      boxes[i] = {
        top: Math.round(y + (height - sizes[i].height) / 2),
        left: x,
        width: sizes[i].width,
        height: sizes[i].height
      }
      x += sizes[i].width + PAGE_GAP
    }
    rows.push({ top: y, height, pages: r })
    y += height + PAGE_GAP
  })
  const totalHeight = rows.length ? y - PAGE_GAP + PAGE_PAD : 0
  return { boxes, rows, totalWidth, totalHeight }
}

/** Index of the first row whose bottom edge is below `y` (binary search). */
export function rowAt(layout: Layout, y: number): number {
  const rows = layout.rows
  let lo = 0
  let hi = rows.length - 1
  if (hi < 0) return -1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].top + rows[mid].height + PAGE_GAP <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Range of page indexes intersecting [y0, y1]. */
export function pagesInRange(layout: Layout, y0: number, y1: number): [number, number] {
  if (!layout.rows.length) return [0, -1]
  const r0 = rowAt(layout, Math.max(0, y0))
  let r1 = rowAt(layout, Math.max(0, y1))
  if (r1 < 0) r1 = layout.rows.length - 1
  const first = layout.rows[r0].pages[0]
  const lastRow = layout.rows[r1].pages
  return [first, lastRow[lastRow.length - 1]]
}

/** The page the reader is looking at: the one covering the most of the viewport. */
export function currentPageAt(layout: Layout, scrollTop: number, viewHeight: number): number {
  if (!layout.rows.length) return 0
  const [a, b] = pagesInRange(layout, scrollTop, scrollTop + viewHeight)
  let best = a
  let bestVisible = -1
  for (let i = a; i <= b; i++) {
    const box = layout.boxes[i]
    const visible = Math.min(box.top + box.height, scrollTop + viewHeight) - Math.max(box.top, scrollTop)
    if (visible > bestVisible + 1) {
      best = i
      bestVisible = visible
    }
  }
  return best
}

/** Page under a point in content coordinates (nearest page in that row). */
export function pageAtPoint(layout: Layout, x: number, y: number): number {
  const ri = rowAt(layout, y)
  if (ri < 0) return 0
  const pages = layout.rows[ri].pages
  let best = pages[0]
  let bestDist = Infinity
  for (const i of pages) {
    const b = layout.boxes[i]
    const dist = x < b.left ? b.left - x : x > b.left + b.width ? x - b.left - b.width : 0
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  return best
}
