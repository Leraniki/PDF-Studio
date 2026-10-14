import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnnotationMode, TextLayer, type RenderTask } from 'pdfjs-dist'
import type { PageRef } from '../../lib/model'
import type { PageBox } from '../../lib/pdf/layout'
import { applyRect, viewportTransform, type Rect } from '../../lib/pdf/coords'
import { getPage } from '../../lib/pdf/sources'
import { useUi } from '../../store/uiStore'
import { useDocStore } from '../../store/docStore'
import { goToDest } from '../../lib/actions'
import { AnnotLayer } from './AnnotLayer'
import { DecorLayer } from './DecorLayer'
import { FormLayer } from './FormLayer'

const MAX_CANVAS_PIXELS = 4096 * 4096 * 1.5

interface LinkInfo {
  rect: Rect
  url: string | null
  dest: string | unknown[] | null
}

const linkCache = new Map<string, Promise<LinkInfo[]>>()

function getLinks(page: PageRef): Promise<LinkInfo[]> {
  const key = `${page.sourceId}:${page.srcIndex}`
  let v = linkCache.get(key)
  if (!v) {
    v = getPage(page.sourceId, page.srcIndex)
      .then((p) => p.getAnnotations({ intent: 'display' }))
      .then((list) =>
        list
          .filter((a) => a.subtype === 'Link' && (a.url || a.dest))
          .map((a) => ({ rect: a.rect as Rect, url: (a.url as string) ?? null, dest: a.dest ?? null }))
      )
      .catch(() => [])
    linkCache.set(key, v)
  }
  return v
}

interface Props {
  docId: string
  page: PageRef
  index: number
  box: PageBox
  scale: number
  rotation: number
  /** Whether this page is close enough to the viewport to render its canvas. */
  active: boolean
}

export const PageView = memo(function PageView({ docId, page, index, box, scale, rotation, active }: Props) {
  const holderRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [hasCanvas, setHasCanvas] = useState(false)
  const [textLayer, setTextLayer] = useState<TextLayer | null>(null)
  const textKey = useRef<string>('')
  const [links, setLinks] = useState<LinkInfo[]>([])
  const blank = page.sourceId === 'blank'
  // Form widgets of the main document are drawn as HTML controls instead of on the canvas.
  const formPage = useDocStore((s) => {
    const d = s.docs[docId]
    return !!d?.form.hasFields && d.primarySourceId === page.sourceId
  })

  const transform = useMemo(() => viewportTransform(page.view, scale, rotation), [page.view, scale, rotation])

  // ---- canvas: render off-screen, then swap in (old bitmap stays stretched meanwhile) ----
  useEffect(() => {
    const holder = holderRef.current
    if (!holder || blank) return
    if (!active) {
      holder.replaceChildren()
      setHasCanvas(false)
      return
    }
    let cancelled = false
    let task: RenderTask | null = null
    const run = async (): Promise<void> => {
      const pdfPage = await getPage(page.sourceId, page.srcIndex)
      if (cancelled) return
      const vp = pdfPage.getViewport({ scale, rotation })
      let os = window.devicePixelRatio || 1
      if (vp.width * vp.height * os * os > MAX_CANVAS_PIXELS) {
        os = Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height))
      }
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.floor(vp.width * os))
      canvas.height = Math.max(1, Math.floor(vp.height * os))
      task = pdfPage.render({
        canvas,
        viewport: vp,
        transform: os !== 1 ? [os, 0, 0, os, 0, 0] : undefined,
        annotationMode: formPage ? AnnotationMode.ENABLE_FORMS : AnnotationMode.ENABLE
      })
      try {
        await task.promise
      } catch {
        return
      }
      if (cancelled) return
      holder.replaceChildren(canvas)
      setHasCanvas(true)
    }
    const delay = holder.firstChild ? 140 : 0
    const timer = window.setTimeout(() => void run(), delay)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      task?.cancel()
    }
  }, [active, scale, rotation, page.sourceId, page.srcIndex, blank, formPage])

  // ---- text layer: built once per rotation, scales via CSS variables ----
  useEffect(() => {
    if (!active || blank) return
    const key = `${page.sourceId}:${page.srcIndex}:${rotation}`
    if (textKey.current === key) return
    let cancelled = false
    let layer: TextLayer | null = null
    ;(async () => {
      const pdfPage = await getPage(page.sourceId, page.srcIndex)
      const div = textRef.current
      if (cancelled || !div) return
      div.replaceChildren()
      layer = new TextLayer({
        textContentSource: pdfPage.streamTextContent(),
        container: div,
        viewport: pdfPage.getViewport({ scale: 1, rotation })
      })
      try {
        await layer.render()
      } catch {
        return
      }
      if (cancelled) return
      const end = document.createElement('div')
      end.className = 'endOfContent'
      div.append(end)
      textKey.current = key
      setTextLayer(layer)
    })()
    return () => {
      cancelled = true
      if (textKey.current !== key) layer?.cancel()
    }
  }, [active, rotation, page.sourceId, page.srcIndex, blank])

  // ---- links ----
  useEffect(() => {
    if (!active || blank) return
    let alive = true
    getLinks(page).then((l) => alive && setLinks(l))
    return () => {
      alive = false
    }
  }, [active, page, blank])

  const onTextDown = (): void => textRef.current?.classList.add('selecting')
  useEffect(() => {
    const up = (): void => textRef.current?.classList.remove('selecting')
    document.addEventListener('pointerup', up)
    return () => document.removeEventListener('pointerup', up)
  }, [])

  return (
    <div
      className="page"
      data-page-id={page.id}
      data-page-index={index}
      style={
        {
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          '--scale-factor': scale,
          '--total-scale-factor': scale
        } as React.CSSProperties
      }
    >
      <div className="page-canvas" ref={holderRef} />
      {!hasCanvas && !blank && active && <div className="page-loading">{index + 1}</div>}
      <DecorLayer docId={docId} index={index} width={box.width} height={box.height} scale={scale} />
      <div className="textLayer" ref={textRef} onPointerDown={onTextDown} />
      <SearchHighlights docId={docId} page={page} textLayer={textLayer} width={box.width} height={box.height} />
      <div className="link-layer">
        {links.map((l, i) => {
          const r = applyRect(transform, l.rect)
          return (
            <a
              key={i}
              title={l.url ?? undefined}
              style={{ left: r[0], top: r[1], width: r[2] - r[0], height: r[3] - r[1] }}
              onClick={(e) => {
                e.preventDefault()
                if (l.url) window.api.openExternal(l.url)
                else goToDest(docId, page.sourceId, l.dest)
              }}
            />
          )
        })}
      </div>
      {formPage && active && <FormLayer docId={docId} page={page} transform={transform} scale={scale} rotation={rotation} />}
      <AnnotLayer
        docId={docId}
        page={page}
        transform={transform}
        width={box.width}
        height={box.height}
        scale={scale}
        rotation={rotation}
      />
    </div>
  )
})

// ---------------------------------------------------------------------------

interface HlRect {
  l: number
  t: number
  w: number
  h: number
  on: boolean
}

function SearchHighlights({
  docId,
  page,
  textLayer,
  width,
  height
}: {
  docId: string
  page: PageRef
  textLayer: TextLayer | null
  width: number
  height: number
}): React.JSX.Element | null {
  const results = useUi((s) => (s.search.docId === docId ? s.search.results : null))
  const active = useUi((s) => s.search.active)
  const viewRotation = useDocStore((s) => s.docs[docId]?.view.viewRotation)
  const [rects, setRects] = useState<HlRect[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const host = ref.current?.parentElement
    if (!results || !textLayer || !host) {
      setRects([])
      return
    }
    const divs = textLayer.textDivs
    const pr = host.getBoundingClientRect()
    const out: HlRect[] = []
    results.forEach((m, mi) => {
      if (m.pageId !== page.id) return
      for (const r of m.ranges) {
        const span = divs[r.item]
        const node = span?.firstChild
        if (!node) continue
        const range = document.createRange()
        try {
          range.setStart(node, Math.min(r.from, node.textContent?.length ?? 0))
          range.setEnd(node, Math.min(r.to, node.textContent?.length ?? 0))
        } catch {
          continue
        }
        const b = range.getBoundingClientRect()
        if (!b.width || !pr.width) continue
        out.push({
          l: ((b.left - pr.left) / pr.width) * 100,
          t: ((b.top - pr.top) / pr.height) * 100,
          w: (b.width / pr.width) * 100,
          h: (b.height / pr.height) * 100,
          on: mi === active
        })
      }
    })
    setRects(out)
  }, [results, active, textLayer, page.id, viewRotation, width, height])

  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {rects.map((r, i) => (
        <div
          key={i}
          className={`search-hl${r.on ? ' on' : ''}`}
          style={{ left: `${r.l}%`, top: `${r.t}%`, width: `${r.w}%`, height: `${r.h}%` }}
        />
      ))}
    </div>
  )
}
