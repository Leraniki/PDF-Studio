import { describe, expect, it } from 'vitest'
import { apply, applyRect, invert, viewportSize, viewportTransform, type Rect } from '../../src/renderer/src/lib/pdf/coords'

const view: Rect = [0, 0, 600, 800]

describe('viewportTransform', () => {
  it('maps the PDF origin (bottom-left) to the viewport bottom-left at 0°', () => {
    const m = viewportTransform(view, 1, 0)
    expect(apply(m, 0, 0)).toEqual([0, 800])
    expect(apply(m, 600, 800)).toEqual([600, 0])
  })

  it('handles all four rotations and keeps the page inside the viewport', () => {
    for (const rot of [0, 90, 180, 270]) {
      const m = viewportTransform(view, 2, rot)
      const size = viewportSize(view, 2, rot)
      const r = applyRect(m, view)
      expect(r[0]).toBeCloseTo(0)
      expect(r[1]).toBeCloseTo(0)
      expect(r[2]).toBeCloseTo(size.width)
      expect(r[3]).toBeCloseTo(size.height)
    }
  })

  it('rotates clockwise by 90° like pdf.js', () => {
    const m = viewportTransform(view, 1, 90)
    // PDF top-left corner (0, 800) ends up at the viewport top-right.
    const [x, y] = apply(m, 0, 800)
    expect(x).toBeCloseTo(800)
    expect(y).toBeCloseTo(0)
  })

  it('supports a crop box with a non-zero origin', () => {
    const m = viewportTransform([50, 100, 650, 900], 1, 0)
    expect(apply(m, 50, 900)).toEqual([0, 0])
  })

  it('inverts exactly', () => {
    for (const rot of [0, 90, 180, 270]) {
      const m = viewportTransform(view, 1.7, rot)
      const inv = invert(m)
      const [vx, vy] = apply(m, 123, 456)
      const [x, y] = apply(inv, vx, vy)
      expect(x).toBeCloseTo(123)
      expect(y).toBeCloseTo(456)
    }
  })
})
