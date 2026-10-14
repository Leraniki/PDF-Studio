import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import type { PageRef } from '../model'
import { getPage } from './sources'

export interface PageText {
  /** Item strings in text-layer order (index = text layer span index). */
  items: string[]
  /** Start offset of each item in `text`. */
  starts: number[]
  /** Baseline origin of each item in PDF space. */
  origins: [number, number][]
  /** Searchable text (line breaks replaced by spaces, same length as the raw text). */
  text: string
}

const cache = new Map<string, Promise<PageText>>()

export function pageTextKey(p: Pick<PageRef, 'sourceId' | 'srcIndex'>): string {
  return `${p.sourceId}:${p.srcIndex}`
}

export function getPageText(p: Pick<PageRef, 'sourceId' | 'srcIndex'>): Promise<PageText> {
  const key = pageTextKey(p)
  let v = cache.get(key)
  if (!v) {
    v = (async () => {
      const page = await getPage(p.sourceId, p.srcIndex)
      const tc = await page.getTextContent()
      const items: string[] = []
      const starts: number[] = []
      const origins: [number, number][] = []
      let text = ''
      for (const raw of tc.items) {
        const it = raw as TextItem
        if (typeof it.str !== 'string') continue
        items.push(it.str)
        starts.push(text.length)
        origins.push([it.transform[4], it.transform[5]])
        text += it.str
        if (it.hasEOL) text += ' '
      }
      return { items, starts, origins, text }
    })()
    cache.set(key, v)
  }
  return v
}

export function clearTextCache(sourceId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${sourceId}:`)) cache.delete(k)
}

export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
}

export interface ItemRange {
  item: number
  from: number
  to: number
}

export interface SearchMatch {
  pageId: string
  pageIndex: number
  start: number
  end: number
  ranges: ItemRange[]
  before: string
  match: string
  after: string
  origin: [number, number]
}

export function buildRegex(query: string, opts: SearchOptions): RegExp | null {
  const q = query.trim()
  if (!q) return null
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const body = opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped
  return new RegExp(body, opts.caseSensitive ? 'gu' : 'giu')
}

/** Maps a [start, end) range of page text to text-layer item ranges. */
export function itemRanges(pt: PageText, start: number, end: number): ItemRange[] {
  const out: ItemRange[] = []
  let lo = 0
  let hi = pt.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pt.starts[mid] <= start) lo = mid
    else hi = mid - 1
  }
  for (let i = lo; i < pt.items.length && pt.starts[i] < end; i++) {
    const s = pt.starts[i]
    const from = Math.max(0, start - s)
    const to = Math.min(pt.items[i].length, end - s)
    if (to > from) out.push({ item: i, from, to })
  }
  return out
}

export function findInPage(pt: PageText, re: RegExp, pageId: string, pageIndex: number): SearchMatch[] {
  const out: SearchMatch[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(pt.text))) {
    if (m[0].length === 0) {
      re.lastIndex++
      continue
    }
    const start = m.index
    const end = start + m[0].length
    const ranges = itemRanges(pt, start, end)
    out.push({
      pageId,
      pageIndex,
      start,
      end,
      ranges,
      before: pt.text.slice(Math.max(0, start - 40), start),
      match: m[0],
      after: pt.text.slice(end, end + 60),
      origin: ranges.length ? pt.origins[ranges[0].item] : [0, 0]
    })
  }
  return out
}
