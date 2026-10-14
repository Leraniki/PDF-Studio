import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRINT,
  gridFor,
  isLandscapePage,
  normalizePrint,
  pageScale,
  paperCount,
  planJobs,
  selectPages,
  sheetLayout,
  toSheets
} from '../../src/renderer/src/lib/print'
import type { PageRef } from '../../src/renderer/src/lib/model'

const sel = (over: Partial<typeof DEFAULT_PRINT>) => ({ ...DEFAULT_PRINT, ...over })

describe('selectPages', () => {
  it('selects all, current and ranges', () => {
    expect(selectPages(4, 2, sel({}))).toEqual([0, 1, 2, 3])
    expect(selectPages(4, 2, sel({ pageSet: 'current' }))).toEqual([2])
    expect(selectPages(10, 0, sel({ pageSet: 'range', range: '2-4, 9' }))).toEqual([1, 2, 3, 8])
    expect(selectPages(10, 0, sel({ pageSet: 'range', range: '3-12' }))).toBeNull()
    expect(selectPages(10, 0, sel({ pageSet: 'range', range: '' }))).toBeNull()
  })

  it('filters odd / even page numbers and reverses', () => {
    expect(selectPages(5, 0, sel({ subset: 'odd' }))).toEqual([0, 2, 4])
    expect(selectPages(5, 0, sel({ subset: 'even' }))).toEqual([1, 3])
    expect(selectPages(10, 0, sel({ pageSet: 'range', range: '2-5', subset: 'odd', reverse: true }))).toEqual([4, 2])
  })
})

describe('sheet layout', () => {
  const page = (w: number, h: number, rotation = 0): PageRef => ({
    id: 'p',
    sourceId: 's',
    srcIndex: 0,
    view: [0, 0, w, h],
    baseRotate: 0,
    rotation
  })

  it('detects landscape pages with rotation', () => {
    expect(isLandscapePage(page(842, 595))).toBe(true)
    expect(isLandscapePage(page(595, 842, 90))).toBe(true)
    expect(isLandscapePage(page(595, 842))).toBe(false)
  })

  it('turns the sheet for 2 and 6 pages per sheet in auto mode', () => {
    expect(sheetLayout(sel({ perSheet: 2 }), false)).toMatchObject({ landscape: true, cols: 2, rows: 1, width: 297, height: 210 })
    expect(sheetLayout(sel({ perSheet: 4 }), false)).toMatchObject({ landscape: false, cols: 2, rows: 2 })
    expect(sheetLayout(sel({ orientation: 'portrait', perSheet: 6 }), false)).toMatchObject({ cols: 2, rows: 3 })
    expect(gridFor(16, true)).toEqual({ cols: 4, rows: 4 })
  })

  it('scales pages', () => {
    const a4: [number, number] = [210, 297]
    expect(pageScale(sel({}), a4, [105, 148.5])).toBeCloseTo(0.5)
    expect(pageScale(sel({ fit: 'shrink' }), a4, [420, 594])).toBe(1)
    expect(pageScale(sel({ fit: 'custom', scale: 150 }), a4, [210, 297])).toBe(1.5)
    expect(pageScale(sel({ fit: 'actual', perSheet: 2 }), a4, [105, 148.5])).toBeCloseTo(0.5)
  })
})

describe('print jobs', () => {
  const sheets = toSheets([0, 1, 2, 3, 4], 1)

  it('keeps one job for printer duplex', () => {
    const jobs = planJobs(sheets, sel({ duplex: 'longEdge', copies: 2 }))
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ copies: 2, duplexMode: 'longEdge', flipFirst: false })
    expect(paperCount(5, sel({ duplex: 'longEdge', copies: 2 }))).toBe(6)
  })

  it('splits manual duplex into fronts and backs, padding odd copies', () => {
    const [fronts, backs] = planJobs(sheets, sel({ duplex: 'manual', copies: 2 }))
    expect(fronts.sheets).toEqual([[0], [2], [4], [0], [2], [4]])
    expect(backs.sheets).toEqual([[1], [3], null, [1], [3], null])
    expect(backs.flipFirst).toBe(true)
    const reversed = planJobs(sheets, sel({ duplex: 'manual', reverseBacks: true }))[1]
    expect(reversed.sheets).toEqual([null, [3], [1]])
  })

  it('skips the back pass when there is nothing on it', () => {
    expect(planJobs([[0]], sel({ duplex: 'manual' }))).toHaveLength(1)
  })

  it('groups pages per sheet', () => {
    expect(toSheets([0, 1, 2, 3, 4], 4)).toEqual([[0, 1, 2, 3], [4]])
  })
})

describe('normalizePrint', () => {
  it('clamps values left out of range while typing', () => {
    expect(normalizePrint(sel({ copies: 0, scale: 0 }))).toMatchObject({ copies: 1, scale: 100 })
    expect(normalizePrint(sel({ copies: 5000, scale: 5 }))).toMatchObject({ copies: 999, scale: 10 })
    expect(pageScale(sel({ fit: 'custom', scale: 5000 }), [210, 297], [210, 297])).toBe(4)
  })
})
