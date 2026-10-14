import { describe, expect, it } from 'vitest'
import { computeLayout, currentPageAt, pageAtPoint, pagesInRange, PAGE_GAP, PAGE_PAD } from '../../src/renderer/src/lib/pdf/layout'

const sizes = [
  { width: 600, height: 800 },
  { width: 800, height: 600 },
  { width: 600, height: 800 },
  { width: 300, height: 400 }
]

describe('computeLayout', () => {
  it('stacks pages with exact gaps and centers them', () => {
    const L = computeLayout(sizes, 'single', 1000)
    expect(L.boxes[0].top).toBe(PAGE_PAD)
    expect(L.boxes[1].top).toBe(PAGE_PAD + 800 + PAGE_GAP)
    expect(L.boxes[0].left).toBe(200)
    expect(L.totalHeight).toBe(PAGE_PAD * 2 + 800 + 600 + 800 + 400 + PAGE_GAP * 3)
    expect(L.totalWidth).toBe(1000)
  })

  it('grows wider than the container when a page does not fit', () => {
    const L = computeLayout(sizes, 'single', 500)
    expect(L.totalWidth).toBe(800 + PAGE_PAD * 2)
  })

  it('pairs pages in spread mode', () => {
    const L = computeLayout(sizes, 'spread', 2000)
    expect(L.rows.map((r) => r.pages)).toEqual([
      [0, 1],
      [2, 3]
    ])
    expect(L.boxes[1].left).toBe(L.boxes[0].left + 600 + PAGE_GAP)
  })

  it('is deterministic: same input gives identical boxes (no layout drift)', () => {
    expect(computeLayout(sizes, 'single', 1000)).toEqual(computeLayout(sizes, 'single', 1000))
  })
})

describe('layout queries', () => {
  const L = computeLayout(sizes, 'single', 1000)
  it('finds pages in a vertical range', () => {
    expect(pagesInRange(L, 0, 100)).toEqual([0, 0])
    expect(pagesInRange(L, 700, 900)).toEqual([0, 1])
    expect(pagesInRange(L, 0, 1e6)).toEqual([0, 3])
  })
  it('picks the page covering most of the viewport', () => {
    expect(currentPageAt(L, 0, 700)).toBe(0)
    expect(currentPageAt(L, L.boxes[1].top - 50, 500)).toBe(1)
    expect(currentPageAt(L, L.totalHeight - 300, 300)).toBe(3)
  })
  it('resolves the page under a point', () => {
    expect(pageAtPoint(L, 500, L.boxes[2].top + 10)).toBe(2)
  })
})
