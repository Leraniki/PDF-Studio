import { AnnotationMode } from 'pdfjs-dist'
import type { PageRef } from '../model'
import { normRotation } from './coords'
import { getPage } from './sources'

/** Renders small page previews with a tiny LRU cache and limited concurrency. */
const cache = new Map<string, HTMLCanvasElement>()
const inflight = new Map<string, Promise<HTMLCanvasElement | null>>()
const MAX_CACHE = 400
let active = 0
const queue: (() => void)[] = []

function key(p: PageRef, rotation: number, width: number): string {
  return `${p.sourceId}:${p.srcIndex}:${rotation}:${width}`
}

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = (): void => {
      active++
      job()
        .then(resolve, reject)
        .finally(() => {
          active--
          queue.shift()?.()
        })
    }
    if (active < 3) run()
    else queue.push(run)
  })
}

export function renderThumb(p: PageRef, cssWidth: number): Promise<HTMLCanvasElement | null> {
  const rotation = normRotation(p.baseRotate + p.rotation)
  if (p.sourceId === 'blank') return Promise.resolve(null)
  const k = key(p, rotation, cssWidth)
  const hit = cache.get(k)
  if (hit) {
    cache.delete(k)
    cache.set(k, hit)
    return Promise.resolve(hit)
  }
  let pending = inflight.get(k)
  if (!pending) {
    pending = schedule(async () => {
      try {
        const page = await getPage(p.sourceId, p.srcIndex)
        const base = page.getViewport({ scale: 1, rotation })
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr, rotation })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(vp.width))
        canvas.height = Math.max(1, Math.floor(vp.height))
        await page.render({ canvas, viewport: vp, annotationMode: AnnotationMode.ENABLE }).promise
        cache.set(k, canvas)
        if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
        return canvas
      } catch {
        return null
      } finally {
        inflight.delete(k)
      }
    })
    inflight.set(k, pending)
  }
  return pending
}

/** Copies a cached preview into a visible canvas. */
export function paintInto(target: HTMLCanvasElement, src: HTMLCanvasElement): void {
  target.width = src.width
  target.height = src.height
  target.getContext('2d')?.drawImage(src, 0, 0)
}
