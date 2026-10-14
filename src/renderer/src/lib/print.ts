import type { PageRef } from './model'
import { normRotation } from './pdf/coords'
import { parseRanges } from './ranges'

export type PageSet = 'all' | 'current' | 'range'
export type PageSubset = 'all' | 'odd' | 'even'
/** 'manual' prints the fronts, asks to flip the stack, then prints the backs. */
export type Duplex = 'simplex' | 'longEdge' | 'shortEdge' | 'manual'
export type Orientation = 'auto' | 'portrait' | 'landscape'
export type Paper = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal'
/** fit: scale to the printable area; shrink: only scale down; actual: 100 %; custom: `scale` %. */
export type FitMode = 'fit' | 'shrink' | 'actual' | 'custom'

export const PER_SHEET = [1, 2, 4, 6, 9, 16] as const
export type PerSheet = (typeof PER_SHEET)[number]

export interface PrintSettings {
  /** System printer name, '' = default printer. */
  printer: string
  pageSet: PageSet
  range: string
  subset: PageSubset
  reverse: boolean
  copies: number
  collate: boolean
  duplex: Duplex
  /** Manual duplex: print the backs last-to-first (for printers that stack face up). */
  reverseBacks: boolean
  perSheet: PerSheet
  borders: boolean
  orientation: Orientation
  paper: Paper
  fit: FitMode
  /** Percent, used with fit = 'custom'. */
  scale: number
  /** Sheet margin in millimetres. */
  margin: number
  color: boolean
  /** Print comments and markup (signatures and placed images are always printed). */
  annotations: boolean
  dpi: 150 | 300
}

export const DEFAULT_PRINT: PrintSettings = {
  printer: '',
  pageSet: 'all',
  range: '',
  subset: 'all',
  reverse: false,
  copies: 1,
  collate: true,
  duplex: 'simplex',
  reverseBacks: false,
  perSheet: 1,
  borders: false,
  orientation: 'auto',
  paper: 'A4',
  fit: 'fit',
  scale: 100,
  margin: 0,
  color: true,
  annotations: true,
  dpi: 150
}

/** Settings remembered between print jobs (page selection is per job). */
export const PERSISTED_KEYS = [
  'printer',
  'collate',
  'duplex',
  'reverseBacks',
  'perSheet',
  'borders',
  'orientation',
  'paper',
  'fit',
  'scale',
  'margin',
  'color',
  'annotations',
  'dpi'
] as const satisfies readonly (keyof PrintSettings)[]

/** Clamps values that number inputs leave out of range while the user is typing. */
export function normalizePrint(s: PrintSettings): PrintSettings {
  return {
    ...s,
    copies: Math.min(999, Math.max(1, Math.floor(s.copies) || 1)),
    scale: Math.min(400, Math.max(10, Math.round(s.scale) || 100))
  }
}

/** Portrait paper sizes in millimetres. */
export const PAPER_MM: Record<Paper, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6]
}

/**
 * 0-based page indices to print, in print order. Returns null when the range is invalid.
 * Odd / even refer to page numbers in the document.
 */
export function selectPages(total: number, current: number, s: Pick<PrintSettings, 'pageSet' | 'range' | 'subset' | 'reverse'>): number[] | null {
  let pages: number[]
  if (s.pageSet === 'current') pages = [Math.min(Math.max(current, 0), total - 1)]
  else if (s.pageSet === 'range') {
    const groups = parseRanges(s.range, total)
    if (!groups) return null
    pages = groups.flat()
  } else pages = Array.from({ length: total }, (_, i) => i)
  if (s.subset !== 'all') pages = pages.filter((i) => (i % 2 === 0) === (s.subset === 'odd'))
  if (s.reverse) pages.reverse()
  return pages
}

/** Whether the page is displayed wider than tall (rotation included). */
export function isLandscapePage(p: PageRef): boolean {
  const w = p.view[2] - p.view[0]
  const h = p.view[3] - p.view[1]
  return normRotation(p.baseRotate + p.rotation) % 180 ? h > w : w > h
}

/** Grid for N pages on one sheet: 2 and 6 pages turn the cells against the sheet. */
export function gridFor(perSheet: PerSheet, landscapeSheet: boolean): { cols: number; rows: number } {
  const [a, b] = ({ 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3], 16: [4, 4] } as const)[perSheet]
  return landscapeSheet ? { cols: a, rows: b } : { cols: b, rows: a }
}

/** Sheet orientation. In auto mode it follows the first printed page. */
export function sheetIsLandscape(s: Pick<PrintSettings, 'orientation' | 'perSheet'>, firstPageLandscape: boolean): boolean {
  if (s.orientation !== 'auto') return s.orientation === 'landscape'
  return s.perSheet === 2 || s.perSheet === 6 ? !firstPageLandscape : firstPageLandscape
}

export interface SheetLayout {
  /** Sheet size in millimetres. */
  width: number
  height: number
  landscape: boolean
  cols: number
  rows: number
}

export function sheetLayout(s: PrintSettings, firstPageLandscape: boolean): SheetLayout {
  const landscape = sheetIsLandscape(s, firstPageLandscape)
  const [pw, ph] = PAPER_MM[s.paper]
  return { width: landscape ? ph : pw, height: landscape ? pw : ph, landscape, ...gridFor(s.perSheet, landscape) }
}

/** Splits the printed pages into sheet sides. */
export function toSheets(pages: number[], perSheet: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < pages.length; i += perSheet) out.push(pages.slice(i, i + perSheet))
  return out
}

export interface PrintJob {
  /** Sheet sides in print order; null = blank side (manual duplex padding). */
  sheets: (number[] | null)[]
  copies: number
  collate: boolean
  duplexMode: 'simplex' | 'longEdge' | 'shortEdge'
  /** Ask the user to turn the printed stack over before this job. */
  flipFirst: boolean
}

/** Turns sheet sides and settings into one job, or two jobs for manual duplex. */
export function planJobs(sheets: number[][], s: Pick<PrintSettings, 'copies' | 'collate' | 'duplex' | 'reverseBacks'>): PrintJob[] {
  const copies = Math.max(1, Math.floor(s.copies) || 1)
  if (s.duplex !== 'manual') {
    return [{ sheets, copies, collate: s.collate, duplexMode: s.duplex, flipFirst: false }]
  }
  // Each copy is padded to an even number of sides so fronts and backs stay paired.
  const sides: (number[] | null)[] = []
  for (let c = 0; c < copies; c++) {
    sides.push(...sheets)
    if (sheets.length % 2) sides.push(null)
  }
  const fronts = sides.filter((_, i) => i % 2 === 0)
  const backs = sides.filter((_, i) => i % 2 === 1)
  if (s.reverseBacks) backs.reverse()
  const jobs: PrintJob[] = [{ sheets: fronts, copies: 1, collate: true, duplexMode: 'simplex', flipFirst: false }]
  if (backs.some(Boolean)) jobs.push({ sheets: backs, copies: 1, collate: true, duplexMode: 'simplex', flipFirst: true })
  return jobs
}

/** Sheets of paper used by the job. */
export function paperCount(sides: number, s: Pick<PrintSettings, 'copies' | 'duplex'>): number {
  const copies = Math.max(1, Math.floor(s.copies) || 1)
  return (s.duplex === 'simplex' ? sides : Math.ceil(sides / 2)) * copies
}

/**
 * Page scale (page points → sheet millimetres) inside a cell of the given size.
 * Above one page per sheet the page always fits its cell.
 */
export function pageScale(
  s: Pick<PrintSettings, 'fit' | 'scale' | 'perSheet'>,
  pageMm: [number, number],
  cellMm: [number, number]
): number {
  const fit = Math.min(cellMm[0] / pageMm[0], cellMm[1] / pageMm[1])
  if (s.perSheet > 1 || s.fit === 'fit') return fit
  if (s.fit === 'shrink') return Math.min(1, fit)
  if (s.fit === 'actual') return 1
  return Math.min(4, Math.max(0.1, s.scale / 100))
}
