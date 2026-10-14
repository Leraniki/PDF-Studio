/** 2D affine matrix [a, b, c, d, e, f] as used by PDF and pdf.js. */
export type Matrix = [number, number, number, number, number, number]
/** Rectangle [x0, y0, x1, y1]. */
export type Rect = [number, number, number, number]

/** CSS pixels per PDF point at 100% zoom (96 dpi / 72 pt). */
export const PDF_TO_CSS = 96 / 72

export function normRotation(r: number): number {
  return ((r % 360) + 360) % 360
}

/**
 * Transform from PDF user space to viewport (CSS pixel) space.
 * Same math as pdf.js PageViewport, so overlays line up with rendered canvases.
 */
export function viewportTransform(view: Rect, scale: number, rotation: number): Matrix {
  const centerX = (view[2] + view[0]) / 2
  const centerY = (view[3] + view[1]) / 2
  let a: number, b: number, c: number, d: number
  switch (normRotation(rotation)) {
    case 180:
      a = -1; b = 0; c = 0; d = 1
      break
    case 90:
      a = 0; b = 1; c = 1; d = 0
      break
    case 270:
      a = 0; b = -1; c = -1; d = 0
      break
    default:
      a = 1; b = 0; c = 0; d = -1
  }
  let offX: number, offY: number
  if (a === 0) {
    offX = Math.abs(centerY - view[1]) * scale
    offY = Math.abs(centerX - view[0]) * scale
  } else {
    offX = Math.abs(centerX - view[0]) * scale
    offY = Math.abs(centerY - view[1]) * scale
  }
  return [
    a * scale,
    b * scale,
    c * scale,
    d * scale,
    offX - a * scale * centerX - c * scale * centerY,
    offY - b * scale * centerX - d * scale * centerY
  ]
}

/** Size of a page in viewport space. */
export function viewportSize(view: Rect, scale: number, rotation: number): { width: number; height: number } {
  const w = (view[2] - view[0]) * scale
  const h = (view[3] - view[1]) * scale
  return normRotation(rotation) % 180 === 0 ? { width: w, height: h } : { width: h, height: w }
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Applies only the linear part (for vectors / deltas). */
export function applyVector(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y]
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2]
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det
  ]
}

export function normalizeRect(r: Rect): Rect {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]
}

/** Transforms an axis-aligned rect and returns the normalized result. */
export function applyRect(m: Matrix, r: Rect): Rect {
  const p1 = apply(m, r[0], r[1])
  const p2 = apply(m, r[2], r[3])
  return normalizeRect([p1[0], p1[1], p2[0], p2[1]])
}

export function unionRects(rects: Rect[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r[0], r[2])
    y0 = Math.min(y0, r[1], r[3])
    x1 = Math.max(x1, r[0], r[2])
    y1 = Math.max(y1, r[1], r[3])
  }
  return [x0, y0, x1, y1]
}

export function boundsOfPoints(points: number[], pad = 0): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i])
    y0 = Math.min(y0, points[i + 1]); y1 = Math.max(y1, points[i + 1])
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]
}
