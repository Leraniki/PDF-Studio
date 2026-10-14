import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDocStore, getDoc } from '../../store/docStore'
import { useUi } from '../../store/uiStore'
import { DRAW_TOOLS, MARKUP_TOOLS } from '../../lib/model'
import { PDF_TO_CSS, apply, normRotation, viewportSize, viewportTransform } from '../../lib/pdf/coords'
import { computeLayout, currentPageAt, pageAtPoint, pagesInRange, PAGE_GAP, PAGE_PAD, rowsFor, type Layout } from '../../lib/pdf/layout'
import { registerViewer, MAX_ZOOM, MIN_ZOOM, type ZoomAnchor } from '../../lib/viewerRegistry'
import { PageView } from './PageView'
import { SelectionPopup, applyMarkupFromSelection } from './SelectionPopup'

interface Range {
  a: number
  b: number
  ra: number
  rb: number
}

interface PendingAnchor {
  index: number
  fx: number
  fy: number
  cx: number
  cy: number
}

const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

export function Viewer({ docId }: { docId: string }): React.JSX.Element | null {
  const pages = useDocStore((s) => s.docs[docId]?.pages)
  const zoom = useDocStore((s) => s.docs[docId]?.view.zoom ?? 1)
  const zoomMode = useDocStore((s) => s.docs[docId]?.view.zoomMode ?? 'fitWidth')
  const spread = useDocStore((s) => s.docs[docId]?.view.spread ?? 'single')
  const viewRotation = useDocStore((s) => s.docs[docId]?.view.viewRotation ?? 0)
  const updateView = useDocStore((s) => s.updateView)
  const tool = useUi((s) => s.tool)
  const nightMode = useUi((s) => s.nightMode)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [range, setRange] = useState<Range>({ a: 0, b: -1, ra: 0, rb: -1 })
  const pendingAnchor = useRef<PendingAnchor | null>(null)
  const pendingScroll = useRef<(() => void) | null>(null)

  const scale = zoom * PDF_TO_CSS

  const rotations = useMemo(
    () => (pages ?? []).map((p) => normRotation(p.baseRotate + p.rotation + viewRotation)),
    [pages, viewRotation]
  )
  const sizes = useMemo(
    () => (pages ?? []).map((p, i) => viewportSize(p.view, scale, rotations[i])),
    [pages, scale, rotations]
  )
  const layout = useMemo(() => computeLayout(sizes, spread, size.w), [sizes, spread, size.w])
  const layoutRef = useRef<Layout>(layout)
  layoutRef.current = layout

  // ---- visible range & current page (read-only from scroll position) ----

  const computeRange = useCallback(() => {
    const el = scrollRef.current
    const L = layoutRef.current
    if (!el || !L.rows.length) return
    const top = el.scrollTop
    const h = el.clientHeight || 1
    const [ra, rb] = pagesInRange(L, top - h * 0.75, top + h * 1.75)
    const [a, b] = pagesInRange(L, top - h * 2.5, top + h * 3.5)
    setRange((prev) => (prev.a === a && prev.b === b && prev.ra === ra && prev.rb === rb ? prev : { a, b, ra, rb }))
    const cur = currentPageAt(L, top, h)
    const d = getDoc(docId)
    if (d && d.view.currentPage !== cur) updateView(docId, { currentPage: cur })
  }, [docId, updateView])

  const rafRef = useRef(0)
  const onScroll = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      computeRange()
    })
  }, [computeRange])

  // ---- container size ----

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- zoom with anchor: the point under the cursor stays still ----

  const captureAnchor = useCallback((anchor: ZoomAnchor = 'center'): void => {
    const el = scrollRef.current
    const L = layoutRef.current
    if (!el || !L.rows.length) return
    const rect = el.getBoundingClientRect()
    let cx: number, cy: number
    if (anchor === 'center') {
      cx = el.clientWidth / 2
      cy = el.clientHeight / 2
    } else if (anchor === 'top') {
      cx = el.clientWidth / 2
      cy = 0
    } else {
      cx = anchor.clientX - rect.left
      cy = anchor.clientY - rect.top
    }
    const px = el.scrollLeft + cx
    const py = el.scrollTop + cy
    const index = pageAtPoint(L, px, py)
    const box = L.boxes[index]
    pendingAnchor.current = {
      index,
      fx: (px - box.left) / box.width,
      fy: (py - box.top) / box.height,
      cx,
      cy
    }
  }, [])

  const zoomTo = useCallback(
    (z: number, anchor?: ZoomAnchor) => {
      const next = clampZoom(z)
      const d = getDoc(docId)
      if (!d || Math.abs(next - d.view.zoom) < 1e-4) {
        if (d && d.view.zoomMode !== 'custom') updateView(docId, { zoomMode: 'custom' })
        return
      }
      captureAnchor(anchor)
      updateView(docId, { zoom: next, zoomMode: 'custom' })
    },
    [docId, captureAnchor, updateView]
  )

  const fitZoom = useCallback(
    (mode: 'fitWidth' | 'fitPage'): number | null => {
      const el = scrollRef.current
      const d = getDoc(docId)
      if (!el || !d || !d.pages.length || !el.clientWidth) return null
      const unit = d.pages.map((p) => viewportSize(p.view, PDF_TO_CSS, p.baseRotate + p.rotation + d.view.viewRotation))
      const rows = rowsFor(unit.length, d.view.spread)
      let maxRowW = 0
      for (const r of rows) {
        maxRowW = Math.max(maxRowW, r.reduce((s, i) => s + unit[i].width, 0) + PAGE_GAP * (r.length - 1))
      }
      const availW = el.clientWidth - PAGE_PAD * 2
      const zw = availW / maxRowW
      if (mode === 'fitWidth') return clampZoom(zw)
      const cur = Math.min(d.view.currentPage, unit.length - 1)
      const row = rows.find((r) => r.includes(cur)) ?? [cur]
      const rowH = row.reduce((m, i) => Math.max(m, unit[i].height), 0)
      const rowW = row.reduce((s, i) => s + unit[i].width, 0) + PAGE_GAP * (row.length - 1)
      return clampZoom(Math.min(availW / rowW, (el.clientHeight - PAGE_PAD * 2) / rowH))
    },
    [docId]
  )

  const scrollToPage = useCallback(
    (index: number, pdfPoint?: [number, number] | null, smooth = false) => {
      const el = scrollRef.current
      const L = layoutRef.current
      const d = getDoc(docId)
      if (!el || !d || !L.boxes[index]) return
      const box = L.boxes[index]
      let top = box.top - PAGE_PAD / 2
      let left: number | null = null
      if (pdfPoint) {
        const p = d.pages[index]
        const rot = normRotation(p.baseRotate + p.rotation + d.view.viewRotation)
        const m = viewportTransform(p.view, d.view.zoom * PDF_TO_CSS, rot)
        const [vx, vy] = apply(m, pdfPoint[0], pdfPoint[1])
        top = box.top + Math.max(0, Math.min(box.height, vy)) - Math.min(120, el.clientHeight / 3)
        const x = box.left + vx
        if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth) left = x - el.clientWidth / 3
      }
      el.scrollTo({ top: Math.max(0, top), left: left ?? el.scrollLeft, behavior: smooth ? 'smooth' : 'auto' })
      computeRange()
    },
    [docId, computeRange]
  )

  const fit = useCallback(
    (mode: 'fitWidth' | 'fitPage') => {
      const z = fitZoom(mode)
      if (z === null) return
      const d = getDoc(docId)!
      const cur = d.view.currentPage
      if (Math.abs(z - d.view.zoom) > 1e-4) {
        if (mode === 'fitPage') pendingScroll.current = () => scrollToPage(cur)
        else captureAnchor('top')
        updateView(docId, { zoom: z, zoomMode: mode })
      } else {
        updateView(docId, { zoomMode: mode })
        if (mode === 'fitPage') scrollToPage(cur)
      }
    },
    [docId, fitZoom, captureAnchor, scrollToPage, updateView]
  )

  // Keep fit modes in sync with the window size / rotation / spread.
  useEffect(() => {
    if (zoomMode === 'custom' || !size.w) return
    const z = fitZoom(zoomMode)
    if (z !== null && Math.abs(z - zoom) > 1e-3) {
      captureAnchor('top')
      updateView(docId, { zoom: z })
    }
  }, [size.w, size.h, zoomMode, spread, viewRotation, pages, fitZoom, zoom, captureAnchor, docId, updateView])

  // Apply anchors in the same frame as the new layout: no visible jump.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const a = pendingAnchor.current
    if (el && a && layout.boxes[a.index]) {
      const box = layout.boxes[a.index]
      el.scrollLeft = box.left + a.fx * box.width - a.cx
      el.scrollTop = box.top + a.fy * box.height - a.cy
    }
    pendingAnchor.current = null
    if (pendingScroll.current) {
      const fn = pendingScroll.current
      pendingScroll.current = null
      fn()
    }
    computeRange()
  }, [layout, computeRange])

  // ---- register imperative API ----

  useEffect(
    () =>
      registerViewer(docId, {
        scrollToPage,
        zoomTo,
        fit,
        focus: () => scrollRef.current?.focus({ preventScroll: true }),
        element: () => scrollRef.current
      }),
    [docId, scrollToPage, zoomTo, fit]
  )

  useEffect(() => {
    scrollRef.current?.focus({ preventScroll: true })
  }, [docId])

  // ---- Ctrl + wheel / pinch zoom ----

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const d = getDoc(docId)
      if (!d) return
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.5 : 0.0025
      const factor = Math.exp(-e.deltaY * unit)
      zoomTo(d.view.zoom * factor, { clientX: e.clientX, clientY: e.clientY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [docId, zoomTo])

  // ---- hand tool ----

  const drag = useRef<{ x: number; y: number; sl: number; st: number; id: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (tool === 'hand' && e.button === 0) {
      const el = scrollRef.current!
      drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, id: e.pointerId }
      el.setPointerCapture(e.pointerId)
      setDragging(true)
      e.preventDefault()
      return
    }
    if (tool === 'select' && !target.closest('.annot-hit, .annot-handle, .note-popup, .freetext-box textarea')) {
      const sel = useUi.getState().selection
      if (sel?.docId === docId) useUi.getState().select(null)
    }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const el = scrollRef.current!
    el.scrollLeft = d.sl - (e.clientX - d.x)
    el.scrollTop = d.st - (e.clientY - d.y)
  }
  const endDrag = (): void => {
    if (drag.current) {
      drag.current = null
      setDragging(false)
    }
  }

  // ---- text selection → markup ----

  const [popup, setPopup] = useState<{ x: number; y: number } | null>(null)
  const onMouseUp = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setPopup(null)
      return
    }
    const range = sel.getRangeAt(0)
    if (!scrollRef.current?.contains(range.commonAncestorContainer)) return
    if (MARKUP_TOOLS.includes(tool)) {
      applyMarkupFromSelection(docId, tool as 'highlight' | 'underline' | 'strikeout', scrollRef.current)
      setPopup(null)
      return
    }
    if (tool === 'select') {
      const rects = range.getClientRects()
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect()
      setPopup({ x: last.right, y: last.bottom + 8 })
    }
  }

  useEffect(() => setPopup(null), [zoom, tool])

  if (!pages) return null

  const drawing = DRAW_TOOLS.includes(tool)
  const classes = ['viewer-scroll']
  if (tool === 'hand') classes.push('hand')
  if (dragging) classes.push('dragging')
  if (drawing) classes.push('tool-drawing')
  if (nightMode) classes.push('night')

  const items: React.JSX.Element[] = []
  if (size.w) {
    for (let i = Math.max(0, range.a); i <= Math.min(range.b, pages.length - 1); i++) {
      const p = pages[i]
      items.push(
        <PageView
          key={p.id}
          docId={docId}
          page={p}
          index={i}
          box={layout.boxes[i]}
          scale={scale}
          rotation={rotations[i]}
          active={i >= range.ra && i <= range.rb}
        />
      )
    }
  }

  return (
    <>
      <div
        ref={scrollRef}
        className={classes.join(' ')}
        tabIndex={0}
        onScroll={() => {
          onScroll()
          if (popup) setPopup(null)
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onMouseUp={onMouseUp}
        data-testid="viewer"
      >
        <div className="viewer-content" style={{ width: layout.totalWidth, height: layout.totalHeight }}>
          {items}
        </div>
      </div>
      {popup && (
        <SelectionPopup
          x={popup.x}
          y={popup.y}
          onAction={(kind) => {
            if (kind === 'copy') {
              navigator.clipboard.writeText(window.getSelection()?.toString() ?? '').catch(() => undefined)
            } else if (scrollRef.current) {
              applyMarkupFromSelection(docId, kind, scrollRef.current)
            }
            setPopup(null)
          }}
        />
      )}
    </>
  )
}
