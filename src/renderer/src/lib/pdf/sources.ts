import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { Rect } from './coords'
import type { Protection } from './security'

/**
 * Loaded source documents. Kept outside React state: pdf.js proxies are not
 * serializable and must not be copied by immer.
 */
export interface Source {
  id: string
  name: string
  /** Bytes given to pdf.js (supported annotations already moved into the model). */
  bytes: Uint8Array
  /** Original file bytes. */
  originalBytes: Uint8Array
  pdf: PDFDocumentProxy
  /** Encrypted with an unsupported scheme: `bytes` are still encrypted, view only. */
  encrypted: boolean
  /** Password protection the file had when opened. */
  protection?: Protection | null
  /** Opened with the user password while permissions are restricted. */
  restricted?: boolean
  pages: Map<number, Promise<PDFPageProxy>>
}

const sources = new Map<string, Source>()

export function registerSource(s: Source): void {
  sources.set(s.id, s)
}

export function getSource(id: string): Source | undefined {
  return sources.get(id)
}

export function releaseSource(id: string): void {
  const s = sources.get(id)
  if (!s) return
  sources.delete(id)
  s.pdf.loadingTask.destroy().catch(() => undefined)
}

export function getPage(sourceId: string, index: number): Promise<PDFPageProxy> {
  const s = sources.get(sourceId)
  if (!s) return Promise.reject(new Error(`Unknown source ${sourceId}`))
  let p = s.pages.get(index)
  if (!p) {
    p = s.pdf.getPage(index + 1)
    s.pages.set(index, p)
  }
  return p
}

export interface PageInfo {
  view: Rect
  rotate: number
}

/** Reads the view box and intrinsic rotation of every page (batched). */
export async function readPageInfos(
  sourceId: string,
  onProgress?: (done: number, total: number) => void
): Promise<PageInfo[]> {
  const s = sources.get(sourceId)!
  const total = s.pdf.numPages
  const out: PageInfo[] = new Array(total)
  const BATCH = 24
  for (let i = 0; i < total; i += BATCH) {
    const idx = Array.from({ length: Math.min(BATCH, total - i) }, (_, k) => i + k)
    const pages = await Promise.all(idx.map((k) => getPage(sourceId, k)))
    pages.forEach((p, k) => {
      out[i + k] = { view: [...p.view] as Rect, rotate: p.rotate }
    })
    onProgress?.(Math.min(total, i + BATCH), total)
  }
  return out
}
