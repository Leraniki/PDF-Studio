import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { useDocStore, getDoc } from '../../store/docStore'
import { useUi } from '../../store/uiStore'
import { DRAW_TOOLS, uid, type Annot, type AnnotType, type PageRef, type Tool } from '../../lib/model'
import {
  apply,
  applyRect,
  applyVector,
  invert,
  normalizeRect,
  type Matrix,
  type Rect
} from '../../lib/pdf/coords'
import { arrowHead, FREETEXT_PAD } from '../../lib/pdf/annotIO'
import { resizePatch, translatePatch, withRect } from '../../lib/annotOps'

const EMPTY: Annot[] = []

interface Props {
  docId: string
  page: PageRef
  transform: Matrix
  width: number
  height: number
  scale: number
  rotation: number
}

type Draft =
  | { kind: 'ink'; points: number[] }
  | { kind: 'shape'; tool: Tool; start: [number, number]; end: [number, number] }

type Gesture =
  | { kind: 'move'; annot: Annot; x: number; y: number; dx: number; dy: number }
  | { kind: 'resize'; annot: Annot; handle: string; start: Rect; cur: Rect }
  | { kind: 'endpoint'; annot: Annot; which: 0 | 1; cur: [number, number] }

const pts = (m: Matrix, p: number[]): string => {
  const out: string[] = []
  for (let i = 0; i + 1 < p.length; i += 2) {
    const [x, y] = apply(m, p[i], p[i + 1])
    out.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return out.join(' ')
}

function pathD(m: Matrix, p: number[]): string {
  if (p.length < 2) return ''
  const [x0, y0] = apply(m, p[0], p[1])
  let d = `M${x0.toFixed(1)} ${y0.toFixed(1)}`
  if (p.length === 2) d += ` L${(x0 + 0.1).toFixed(1)} ${y0.toFixed(1)}`
  for (let i = 2; i + 1 < p.length; i += 2) {
    const [x, y] = apply(m, p[i], p[i + 1])
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

/** Geometry of an annotation with an in-progress gesture applied. */
function previewAnnot(a: Annot, g: Gesture | null, inv: Matrix): Annot {
  if (!g || g.annot.id !== a.id) return a
  if (g.kind === 'move') {
    const [dx, dy] = applyVector(inv, g.dx, g.dy)
    return { ...a, ...translatePatch(a, dx, dy) }
  }
  if (g.kind === 'resize') {
    return { ...a, ...resizePatch(a, applyRect(inv, g.cur)) }
  }
  const [x, y] = apply(inv, g.cur[0], g.cur[1])
  const line = [...(a.line ?? [0, 0, 0, 0])] as [number, number, number, number]
  line[g.which * 2] = x
  line[g.which * 2 + 1] = y
  return withRect({ ...a, line })
}

export const AnnotLayer = memo(function AnnotLayer({ docId, page, transform, width, height, scale, rotation }: Props) {
  const annots = useDocStore((s) => s.docs[docId]?.annots[page.id] ?? EMPTY)
  const tool = useUi((s) => s.tool)
  const selection = useUi((s) => s.selection)
  const editingId = useUi((s) => s.editingId)
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const inv = useMemo(() => invert(transform), [transform])

  const selectedId = selection?.docId === docId && selection.pageId === page.id ? selection.annotId : null
  const drawing = DRAW_TOOLS.includes(tool)

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  const add = (a: Annot, keepTool = false): void => {
    useDocStore.getState().addAnnot(docId, page.id, withRect(a))
    if (!keepTool) {
      useUi.getState().setTool('select')
      useUi.getState().select({ docId, pageId: page.id, annotId: a.id })
    }
  }

  const base = (type: AnnotType): Annot => {
    const st = useUi.getState().styles[type]
    const now = Date.now()
    return {
      id: uid('a'),
      type,
      rect: [0, 0, 0, 0],
      color: st.color,
      opacity: st.opacity,
      author: useUi.getState().author,
      contents: '',
      created: now,
      modified: now
    }
  }

  // ---------------- drawing new annotations ----------------

  const onDrawDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!drawing || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const p = local(e)
    const [x, y] = apply(inv, p[0], p[1])
    const st = useUi.getState().styles
    if (tool === 'note') {
      const a = { ...base('note'), rect: [x - 10, y - 10, x + 10, y + 10] as Rect }
      add(a)
      useUi.getState().setEditing(a.id)
      return
    }
    if (tool === 'image') {
      const pending = useUi.getState().pendingImage
      if (!pending) return
      const pageW = page.view[2] - page.view[0]
      const pageH = page.view[3] - page.view[1]
      const ratio = pending.height / Math.max(1, pending.width)
      let w: number
      let h: number
      if (pending.signature) {
        w = 160
        h = w * ratio
        if (h > 70) {
          h = 70
          w = h / ratio
        }
      } else {
        // 96 dpi pixels → points, limited to 60% of the page.
        w = pending.width * 0.75
        h = pending.height * 0.75
        const k = Math.min(1, (Math.min(pageW, pageH) * 0.6) / Math.max(w, h))
        w *= k
        h *= k
      }
      add({
        ...base('image'),
        image: pending.src,
        signature: pending.signature,
        rect: [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
      })
      return
    }
    if (tool === 'stamp') {
      const label = st.stamp.label || 'УТВЕРЖДЕНО'
      const w = Math.max(110, label.length * 11 + 36)
      const h = 38
      const a = { ...base('stamp'), label, rect: [x - w / 2, y - h / 2, x + w / 2, y + h / 2] as Rect }
      add(a)
      return
    }
    svgRef.current!.setPointerCapture(e.pointerId)
    if (tool === 'ink') setDraft({ kind: 'ink', points: [x, y] })
    else setDraft({ kind: 'shape', tool, start: p, end: p })
  }

  const constrain = (start: [number, number], end: [number, number], shift: boolean, t: Tool): [number, number] => {
    if (!shift) return end
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    if (t === 'line' || t === 'arrow') {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      const len = Math.hypot(dx, dy)
      return [start[0] + len * Math.cos(ang), start[1] + len * Math.sin(ang)]
    }
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    return [start[0] + Math.sign(dx || 1) * s, start[1] + Math.sign(dy || 1) * s]
  }

  const onDrawMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (!draft) return
    const p = local(e)
    if (draft.kind === 'ink') {
      const [x, y] = apply(inv, p[0], p[1])
      const n = draft.points.length
      const [lx, ly] = apply(transform, draft.points[n - 2], draft.points[n - 1])
      if (Math.hypot(p[0] - lx, p[1] - ly) < 1.5) return
      setDraft({ kind: 'ink', points: [...draft.points, x, y] })
    } else {
      setDraft({ ...draft, end: constrain(draft.start, p, e.shiftKey, draft.tool) })
    }
  }

  const onDrawUp = (): void => {
    if (!draft) return
    const d = draft
    setDraft(null)
    const st = useUi.getState().styles
    if (d.kind === 'ink') {
      add({ ...base('ink'), paths: [d.points], width: st.ink.width }, true)
      return
    }
    const [sx, sy] = d.start
    let [ex, ey] = d.end
    const tiny = Math.hypot(ex - sx, ey - sy) < 4
    if (d.tool === 'freetext') {
      if (tiny || Math.abs(ex - sx) < 30 || Math.abs(ey - sy) < 12) {
        ex = sx + 200 * scale
        ey = sy + (st.freetext.fontSize * 1.2 + FREETEXT_PAD * 2 + 4) * scale
      }
      const rect = applyRect(inv, [sx, sy, ex, ey])
      const a = { ...base('freetext'), rect, fontSize: st.freetext.fontSize }
      add(a)
      useUi.getState().setEditing(a.id)
      return
    }
    if (tiny) return
    const t = d.tool as AnnotType
    const [x1, y1] = apply(inv, sx, sy)
    const [x2, y2] = apply(inv, ex, ey)
    if (t === 'line' || t === 'arrow') {
      add({ ...base(t), line: [x1, y1, x2, y2], width: st[t].width })
    } else if (t === 'rect' || t === 'ellipse') {
      add({ ...base(t), rect: normalizeRect([x1, y1, x2, y2]), width: st[t].width, fill: st[t].fill })
    }
  }

  // ---------------- selecting / moving / resizing ----------------

  const startGesture = (e: React.PointerEvent, g: Gesture): void => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    gestureRef.current = g
    setGesture(g)
  }

  const onAnnotDown = (e: React.PointerEvent, a: Annot): void => {
    if (tool !== 'select' || e.button !== 0) return
    window.getSelection()?.removeAllRanges()
    useUi.getState().select({ docId, pageId: page.id, annotId: a.id })
    if (a.type === 'highlight' || a.type === 'underline' || a.type === 'strikeout') {
      e.stopPropagation()
      return
    }
    if (editingId === a.id) return
    startGesture(e, { kind: 'move', annot: a, x: e.clientX, y: e.clientY, dx: 0, dy: 0 })
  }

  const onGestureMove = (e: React.PointerEvent): void => {
    const g = gestureRef.current
    if (!g) return
    let next: Gesture
    if (g.kind === 'move') {
      next = { ...g, dx: e.clientX - g.x, dy: e.clientY - g.y }
    } else if (g.kind === 'resize') {
      const [px, py] = local(e)
      const r: Rect = [...g.start]
      if (g.handle.includes('w')) r[0] = Math.min(px, r[2] - 6)
      if (g.handle.includes('e')) r[2] = Math.max(px, r[0] + 6)
      if (g.handle.includes('n')) r[1] = Math.min(py, r[3] - 6)
      if (g.handle.includes('s')) r[3] = Math.max(py, r[1] + 6)
      if (g.annot.type === 'image' && g.handle.length === 2) {
        // Corner handles keep the image proportions.
        const w0 = g.start[2] - g.start[0]
        const h0 = g.start[3] - g.start[1]
        const s = Math.max((r[2] - r[0]) / w0, (r[3] - r[1]) / h0)
        if (g.handle.includes('w')) r[0] = r[2] - w0 * s
        else r[2] = r[0] + w0 * s
        if (g.handle.includes('n')) r[1] = r[3] - h0 * s
        else r[3] = r[1] + h0 * s
      }
      next = { ...g, cur: r }
    } else {
      next = { ...g, cur: local(e) }
    }
    gestureRef.current = next
    setGesture(next)
  }

  const onGestureUp = (): void => {
    const g = gestureRef.current
    gestureRef.current = null
    setGesture(null)
    if (!g) return
    if (g.kind === 'move' && Math.hypot(g.dx, g.dy) < 2) return
    const updated = previewAnnot(g.annot, g, inv)
    const patch: Partial<Annot> = { rect: updated.rect }
    if (updated.quads) patch.quads = updated.quads
    if (updated.paths) patch.paths = updated.paths
    if (updated.line) patch.line = updated.line
    useDocStore.getState().updateAnnot(docId, page.id, g.annot.id, withRect({ ...g.annot, ...patch }))
  }

  const onDouble = (a: Annot): void => {
    if (a.type === 'freetext' || a.type === 'note') useUi.getState().setEditing(a.id)
  }

  // ---------------- rendering ----------------

  const shown = annots.map((a) => previewAnnot(a, gesture, inv))
  const selected = shown.find((a) => a.id === selectedId) ?? null

  return (
    <>
      <svg
        ref={svgRef}
        className="annot-layer"
        width={width}
        height={height}
        onPointerDown={onDrawDown}
        onPointerMove={(e) => {
          onDrawMove(e)
          onGestureMove(e)
        }}
        onPointerUp={() => {
          onDrawUp()
          onGestureUp()
        }}
        onPointerCancel={() => {
          setDraft(null)
          gestureRef.current = null
          setGesture(null)
        }}
      >
        {shown.map((a) => (
          <AnnotShape
            key={a.id}
            a={a}
            m={transform}
            scale={scale}
            onDown={(e) => onAnnotDown(e, a)}
            onDouble={() => onDouble(a)}
          />
        ))}
        {draft && <DraftShape draft={draft} m={transform} scale={scale} />}
        {selected && tool === 'select' && (
          <SelectionFrame
            a={selected}
            m={transform}
            editing={editingId === selected.id}
            onHandleDown={(e, handle, rect) => startGesture(e, { kind: 'resize', annot: annots.find((x) => x.id === selected.id)!, handle, start: rect, cur: rect })}
            onEndpointDown={(e, which, p) => startGesture(e, { kind: 'endpoint', annot: annots.find((x) => x.id === selected.id)!, which, cur: p })}
          />
        )}
      </svg>
      <div className="annot-html" style={{ left: 0, top: 0, width, height }}>
        {shown.map((a) =>
          a.type === 'freetext' ? (
            <FreeTextBox key={a.id} docId={docId} pageId={page.id} a={a} m={transform} scale={scale} rotation={rotation} editing={editingId === a.id} />
          ) : a.type === 'stamp' ? (
            <StampBox key={a.id} a={a} m={transform} scale={scale} rotation={rotation} />
          ) : a.type === 'image' && a.image ? (
            <img
              key={a.id}
              className="image-box"
              src={a.image}
              alt=""
              draggable={false}
              style={{ ...orientedBox(transform, a.rect, scale, rotation), opacity: a.opacity }}
            />
          ) : null
        )}
        {shown.map((a) =>
          a.type === 'note' && editingId === a.id ? (
            <NotePopup key={a.id} docId={docId} pageId={page.id} a={a} m={transform} pageWidth={width} />
          ) : null
        )}
      </div>
    </>
  )
})

// ---------------------------------------------------------------------------

function AnnotShape({
  a,
  m,
  scale,
  onDown,
  onDouble
}: {
  a: Annot
  m: Matrix
  scale: number
  onDown: (e: React.PointerEvent) => void
  onDouble: () => void
}): React.JSX.Element | null {
  const common = { onPointerDown: onDown, onDoubleClick: onDouble }
  const sw = Math.max(1, (a.width ?? 2) * scale)
  const hitW = Math.max(10, sw + 6)

  switch (a.type) {
    case 'highlight': {
      const rects = (a.quads ?? [a.rect]).map((q) => applyRect(m, q))
      return (
        <g style={{ mixBlendMode: 'multiply' }}>
          {rects.map((r, i) => (
            <rect key={i} x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} fill={a.color} opacity={a.opacity} />
          ))}
          {rects.map((r, i) => (
            <rect key={`h${i}`} className="annot-hit markup" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} fill="transparent" {...common} />
          ))}
        </g>
      )
    }
    case 'underline':
    case 'strikeout': {
      return (
        <g>
          {(a.quads ?? [a.rect]).map((q, i) => {
            const h = q[3] - q[1]
            const y = a.type === 'underline' ? q[1] + h * 0.08 : q[1] + h * 0.45
            const [x1, y1] = apply(m, q[0], y)
            const [x2, y2] = apply(m, q[2], y)
            const r = applyRect(m, q)
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={a.color} strokeOpacity={a.opacity} strokeWidth={Math.max(1, h * 0.07 * scale)} />
                <rect className="annot-hit markup" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} fill="transparent" {...common} />
              </g>
            )
          })}
        </g>
      )
    }
    case 'ink': {
      return (
        <g>
          {(a.paths ?? []).map((p, i) => (
            <path key={i} d={pathD(m, p)} fill="none" stroke={a.color} strokeOpacity={a.opacity} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {(a.paths ?? []).map((p, i) => (
            <path key={`h${i}`} className="annot-hit" d={pathD(m, p)} fill="none" stroke="transparent" strokeWidth={hitW} {...common} />
          ))}
        </g>
      )
    }
    case 'rect':
    case 'ellipse': {
      const r = applyRect(m, a.rect)
      const inset = sw / 2
      const x = r[0] + inset
      const y = r[1] + inset
      const w = Math.max(0, r[2] - r[0] - sw)
      const h = Math.max(0, r[3] - r[1] - sw)
      const shape =
        a.type === 'rect' ? (
          <rect x={x} y={y} width={w} height={h} />
        ) : (
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
        )
      return (
        <g>
          <g fill={a.fill ?? 'none'} fillOpacity={a.opacity} stroke={a.color} strokeOpacity={a.opacity} strokeWidth={sw}>
            {shape}
          </g>
          <g className="annot-hit" fill={a.fill ? 'transparent' : 'none'} stroke="transparent" strokeWidth={hitW} {...common}>
            {shape}
          </g>
        </g>
      )
    }
    case 'line':
    case 'arrow': {
      const l = a.line ?? [a.rect[0], a.rect[1], a.rect[2], a.rect[3]]
      const [x1, y1] = apply(m, l[0], l[1])
      const [x2, y2] = apply(m, l[2], l[3])
      const head = a.type === 'arrow' ? pts(m, arrowHead(l, a.width ?? 2)) : null
      return (
        <g>
          <g stroke={a.color} strokeOpacity={a.opacity} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none">
            <line x1={x1} y1={y1} x2={x2} y2={y2} />
            {head && <polyline points={head} />}
          </g>
          <line className="annot-hit" x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={hitW} {...common} />
        </g>
      )
    }
    case 'note': {
      const r = applyRect(m, a.rect)
      const s = Math.max(16, Math.min(28, r[2] - r[0]))
      const x = (r[0] + r[2]) / 2 - s / 2
      const y = (r[1] + r[3]) / 2 - s / 2
      return (
        <g className="annot-hit" {...common}>
          <path
            d={`M${x + 2} ${y + 2} h${s - 4} v${s * 0.66} h${-s * 0.5} l${-s * 0.22} ${s * 0.26} v${-s * 0.26} h${-s * 0.28 + 4} z`}
            fill={a.color}
            fillOpacity={a.opacity}
            stroke="#222"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          <line x1={x + s * 0.22} y1={y + s * 0.26} x2={x + s * 0.78} y2={y + s * 0.26} stroke="#222" strokeWidth={1} />
          <line x1={x + s * 0.22} y1={y + s * 0.46} x2={x + s * 0.64} y2={y + s * 0.46} stroke="#222" strokeWidth={1} />
        </g>
      )
    }
    case 'freetext':
    case 'stamp':
    case 'image': {
      const r = applyRect(m, a.rect)
      return <rect className="annot-hit" x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} fill="transparent" {...common} />
    }
  }
}

function DraftShape({ draft, m, scale }: { draft: Draft; m: Matrix; scale: number }): React.JSX.Element | null {
  const styles = useUi.getState().styles
  if (draft.kind === 'ink') {
    const st = styles.ink
    return (
      <path d={pathD(m, draft.points)} fill="none" stroke={st.color} strokeOpacity={st.opacity} strokeWidth={Math.max(1, st.width * scale)} strokeLinecap="round" strokeLinejoin="round" />
    )
  }
  const [sx, sy] = draft.start
  const [ex, ey] = draft.end
  const t = draft.tool as AnnotType
  const st = styles[t]
  const sw = Math.max(1, st.width * scale)
  const x = Math.min(sx, ex)
  const y = Math.min(sy, ey)
  const w = Math.abs(ex - sx)
  const h = Math.abs(ey - sy)
  if (t === 'freetext') return <rect x={x} y={y} width={w} height={h} fill="none" stroke="#5b8cff" strokeDasharray="4 3" />
  if (t === 'rect') return <rect x={x} y={y} width={w} height={h} fill={st.fill ?? 'none'} stroke={st.color} strokeWidth={sw} opacity={st.opacity} />
  if (t === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={st.fill ?? 'none'} stroke={st.color} strokeWidth={sw} opacity={st.opacity} />
  if (t === 'line' || t === 'arrow') {
    const inv = invert(m)
    const [x1, y1] = apply(inv, sx, sy)
    const [x2, y2] = apply(inv, ex, ey)
    const head = t === 'arrow' ? pts(m, arrowHead([x1, y1, x2, y2], st.width)) : null
    return (
      <g stroke={st.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={st.opacity}>
        <line x1={sx} y1={sy} x2={ex} y2={ey} />
        {head && <polyline points={head} />}
      </g>
    )
  }
  return null
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function SelectionFrame({
  a,
  m,
  editing,
  onHandleDown,
  onEndpointDown
}: {
  a: Annot
  m: Matrix
  editing: boolean
  onHandleDown: (e: React.PointerEvent, handle: string, rect: Rect) => void
  onEndpointDown: (e: React.PointerEvent, which: 0 | 1, p: [number, number]) => void
}): React.JSX.Element {
  if ((a.type === 'line' || a.type === 'arrow') && a.line) {
    const p1 = apply(m, a.line[0], a.line[1])
    const p2 = apply(m, a.line[2], a.line[3])
    return (
      <g>
        {[p1, p2].map((p, i) => (
          <circle key={i} className="annot-handle" cx={p[0]} cy={p[1]} r={5} style={{ cursor: 'crosshair' }} onPointerDown={(e) => onEndpointDown(e, i as 0 | 1, p)} />
        ))}
      </g>
    )
  }
  const r = applyRect(m, a.rect)
  const pad = a.type === 'ink' ? 4 : 2
  const box: Rect = [r[0] - pad, r[1] - pad, r[2] + pad, r[3] + pad]
  const resizable = !['highlight', 'underline', 'strikeout', 'note'].includes(a.type) && !editing
  const pos = (h: string): [number, number] => [
    h.includes('w') ? box[0] : h.includes('e') ? box[2] : (box[0] + box[2]) / 2,
    h.includes('n') ? box[1] : h.includes('s') ? box[3] : (box[1] + box[3]) / 2
  ]
  return (
    <g>
      <rect className="annot-sel" x={box[0]} y={box[1]} width={box[2] - box[0]} height={box[3] - box[1]} />
      {resizable &&
        HANDLES.map((h) => {
          const [x, y] = pos(h)
          return (
            <rect
              key={h}
              className="annot-handle"
              x={x - 4}
              y={y - 4}
              width={8}
              height={8}
              rx={2}
              style={{ cursor: `${h}-resize` }}
              onPointerDown={(e) => onHandleDown(e, h, r)}
            />
          )
        })}
    </g>
  )
}

/** Box for text that reads along the page's own x axis, rotated with the page. */
export function orientedBox(m: Matrix, rect: Rect, scale: number, rotation: number): React.CSSProperties {
  const r = applyRect(m, rect)
  const w = (rect[2] - rect[0]) * scale
  const h = (rect[3] - rect[1]) * scale
  const cx = (r[0] + r[2]) / 2
  const cy = (r[1] + r[3]) / 2
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: rotation ? `rotate(${rotation}deg)` : undefined }
}

/**
 * Runs `commit` when the component unmounts for real (not on the StrictMode
 * double-mount), so edits are kept even if editing ends by deselection.
 */
function useCommitOnUnmount(commit: () => void): void {
  const mounted = useRef(false)
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (!mounted.current) commitRef.current()
      })
    }
  }, [])
}

function FreeTextBox({
  docId,
  pageId,
  a,
  m,
  scale,
  rotation,
  editing
}: {
  docId: string
  pageId: string
  a: Annot
  m: Matrix
  scale: number
  rotation: number
  editing: boolean
}): React.JSX.Element {
  const style: React.CSSProperties = {
    ...orientedBox(m, a.rect, scale, rotation),
    color: a.color,
    opacity: a.opacity,
    fontSize: (a.fontSize ?? 12) * scale,
    padding: FREETEXT_PAD * scale
  }
  if (editing) return <FreeTextEditor docId={docId} pageId={pageId} a={a} scale={scale} style={style} />
  return (
    <div className="freetext-box" style={style}>
      {a.contents}
    </div>
  )
}

function FreeTextEditor({
  docId,
  pageId,
  a,
  scale,
  style
}: {
  docId: string
  pageId: string
  a: Annot
  scale: number
  style: React.CSSProperties
}): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(a.contents)
  const latest = useRef({ value: a.contents, height: 0 })
  const done = useRef(false)

  useLayoutEffect(() => {
    latest.current = { value, height: ref.current?.scrollHeight ?? 0 }
  }, [value])

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (): void => {
    if (done.current) return
    done.current = true
    if (useUi.getState().editingId === a.id) useUi.getState().setEditing(null)
    const store = useDocStore.getState()
    const current = getDoc(docId)?.annots[pageId]?.find((x) => x.id === a.id)
    if (!current) return
    const { value: text, height } = latest.current
    if (!text.trim()) {
      store.deleteAnnot(docId, pageId, a.id)
      const sel = useUi.getState().selection
      if (sel?.annotId === a.id) useUi.getState().select(null)
      return
    }
    const patch: Partial<Annot> = {}
    if (text !== current.contents) patch.contents = text
    const boxHeight = (current.rect[3] - current.rect[1]) * scale
    if (height > boxHeight + 1) {
      patch.rect = [current.rect[0], current.rect[3] - height / scale - 2, current.rect[2], current.rect[3]]
    }
    if (Object.keys(patch).length) store.updateAnnot(docId, pageId, a.id, patch)
  }
  useCommitOnUnmount(commit)

  return (
    <div className="freetext-box" style={{ ...style, padding: 0, overflow: 'visible' }}>
      <textarea
        ref={ref}
        value={value}
        style={{ padding: style.padding }}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') ref.current?.blur()
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}

function StampBox({ a, m, scale, rotation }: { a: Annot; m: Matrix; scale: number; rotation: number }): React.JSX.Element {
  const box = orientedBox(m, a.rect, scale, rotation)
  const h = (a.rect[3] - a.rect[1]) * scale
  const w = (a.rect[2] - a.rect[0]) * scale
  const label = a.label ?? ''
  const fontSize = Math.min(h * 0.5, (w - h * 0.4) / Math.max(1, label.length * 0.68))
  return (
    <div
      className="stamp-box"
      style={{
        ...box,
        color: a.color,
        borderColor: a.color,
        borderWidth: Math.max(1.5, h * 0.06),
        borderRadius: Math.min(h * 0.18, 8 * scale),
        opacity: a.opacity,
        fontSize
      }}
    >
      {label}
    </div>
  )
}

function NotePopup({
  docId,
  pageId,
  a,
  m,
  pageWidth
}: {
  docId: string
  pageId: string
  a: Annot
  m: Matrix
  pageWidth: number
}): React.JSX.Element {
  const [value, setValue] = useState(a.contents)
  const r = applyRect(m, a.rect)
  const left = r[2] + 240 + 8 > pageWidth ? Math.max(0, r[0] - 248) : r[2] + 8
  const commit = (): void => {
    const current = getDoc(docId)?.annots[pageId]?.find((x) => x.id === a.id)
    if (current && value !== current.contents) useDocStore.getState().updateAnnot(docId, pageId, a.id, { contents: value })
  }
  useCommitOnUnmount(commit)
  return (
    <div
      className="note-popup"
      style={{ left, top: r[1] }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="note-popup-head">
        <span style={{ flex: 1 }}>
          {a.author || 'Без автора'} · {new Date(a.modified).toLocaleString()}
        </span>
        <button
          className="icon-btn square"
          style={{ width: 24, height: 24, minWidth: 24 }}
          title="Удалить"
          onClick={() => {
            useDocStore.getState().deleteAnnot(docId, pageId, a.id)
            useUi.getState().select(null)
          }}
        >
          <Trash2 size={14} />
        </button>
        <button
          className="icon-btn square"
          style={{ width: 24, height: 24, minWidth: 24 }}
          title="Закрыть"
          onClick={() => {
            commit()
            useUi.getState().setEditing(null)
          }}
        >
          <X size={14} />
        </button>
      </div>
      <textarea
        autoFocus
        value={value}
        placeholder="Комментарий…"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            commit()
            useUi.getState().setEditing(null)
          }
        }}
      />
    </div>
  )
}

