import { memo, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Image, ListTree, MessageSquareText, X } from 'lucide-react'
import { useActiveDoc, useDocStore, type OutlineNode } from '../store/docStore'
import { useUi, type SidebarTab } from '../store/uiStore'
import { getViewer } from '../lib/viewerRegistry'
import { goToDest } from '../lib/actions'
import { renderThumb, paintInto } from '../lib/pdf/thumbs'
import { normRotation } from '../lib/pdf/coords'
import { ANNOT_LABELS, type PageRef } from '../lib/model'

const TABS: { id: SidebarTab; icon: typeof Image; title: string }[] = [
  { id: 'thumbs', icon: Image, title: 'Миниатюры' },
  { id: 'outline', icon: ListTree, title: 'Закладки' },
  { id: 'comments', icon: MessageSquareText, title: 'Комментарии' }
]

export function Sidebar(): React.JSX.Element | null {
  const tab = useUi((s) => s.sidebar)
  const setSidebar = useUi((s) => s.setSidebar)
  const doc = useActiveDoc()
  if (!doc || !tab) return null
  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">{TABS.find((t) => t.id === tab)?.title}</span>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`icon-btn square${tab === t.id ? ' active' : ''}`}
            title={t.title}
            onClick={() => setSidebar(t.id)}
          >
            <t.icon size={16} />
          </button>
        ))}
        <button className="icon-btn square" title="Скрыть" onClick={() => setSidebar(null)}>
          <X size={15} />
        </button>
      </div>
      {tab === 'thumbs' && <Thumbnails key={doc.id} docId={doc.id} />}
      {tab === 'outline' && <Outline docId={doc.id} />}
      {tab === 'comments' && <Comments docId={doc.id} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

const THUMB_W = 150

function Thumbnails({ docId }: { docId: string }): React.JSX.Element | null {
  const pages = useDocStore((s) => s.docs[docId]?.pages)
  const current = useDocStore((s) => s.docs[docId]?.view.currentPage ?? 0)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Keep the current page's thumbnail in view (scrolls only the sidebar).
  useEffect(() => {
    const body = bodyRef.current
    const el = body?.querySelector<HTMLElement>(`[data-thumb="${current}"]`)
    if (!body || !el) return
    const top = el.offsetTop - body.offsetTop
    if (top < body.scrollTop || top + el.offsetHeight > body.scrollTop + body.clientHeight) {
      body.scrollTop = top - body.clientHeight / 2 + el.offsetHeight / 2
    }
  }, [current])

  if (!pages) return null
  return (
    <div className="sidebar-body" ref={bodyRef}>
      <div className="thumbs">
        {pages.map((p, i) => (
          <Thumb
            key={p.id}
            page={p}
            index={i}
            current={i === current}
            onClick={() => getViewer(docId)?.scrollToPage(i)}
            root={bodyRef}
          />
        ))}
      </div>
    </div>
  )
}

export function thumbSize(p: PageRef, width: number): { w: number; h: number } {
  const rot = normRotation(p.baseRotate + p.rotation)
  let w = p.view[2] - p.view[0]
  let h = p.view[3] - p.view[1]
  if (rot % 180) [w, h] = [h, w]
  const ratio = h / w
  if (ratio >= 1.35) return { w: width / (ratio / 1.35), h: width * 1.35 }
  return { w: width, h: width * ratio }
}

export const Thumb = memo(function Thumb({
  page,
  index,
  current,
  onClick,
  root,
  width = THUMB_W
}: {
  page: PageRef
  index: number
  current: boolean
  onClick: () => void
  root: React.RefObject<HTMLElement | null>
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const size = thumbSize(page, width)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      root: root.current,
      rootMargin: '400px 0px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    let alive = true
    renderThumb(page, Math.round(size.w)).then((c) => {
      if (alive && c && canvasRef.current) paintInto(canvasRef.current, c)
    })
    return () => {
      alive = false
    }
  }, [visible, page, size.w])

  return (
    <div ref={ref} className={`thumb${current ? ' current' : ''}`} data-thumb={index} onClick={onClick}>
      <div className="thumb-box" style={{ width: size.w, height: size.h }}>
        {page.sourceId !== 'blank' && <canvas ref={canvasRef} />}
      </div>
      <span>{index + 1}</span>
    </div>
  )
})

// ---------------------------------------------------------------------------

function Outline({ docId }: { docId: string }): React.JSX.Element | null {
  const outline = useDocStore((s) => s.docs[docId]?.outline)
  const sourceId = useDocStore((s) => s.docs[docId]?.primarySourceId)
  if (!outline) return null
  if (!outline.length) {
    return (
      <div className="sidebar-body">
        <div className="empty-note">В документе нет закладок</div>
      </div>
    )
  }
  return (
    <div className="sidebar-body" style={{ padding: '6px 0' }}>
      {outline.map((n, i) => (
        <OutlineItem key={i} node={n} depth={0} docId={docId} sourceId={sourceId!} />
      ))}
    </div>
  )
}

function OutlineItem({
  node,
  depth,
  docId,
  sourceId
}: {
  node: OutlineNode
  depth: number
  docId: string
  sourceId: string
}): React.JSX.Element {
  const [open, setOpen] = useState(depth === 0 && node.items.length < 12)
  const has = node.items.length > 0
  return (
    <>
      <div
        className="outline-item"
        style={{ paddingLeft: 4 + depth * 14, fontWeight: node.bold ? 600 : undefined, fontStyle: node.italic ? 'italic' : undefined }}
        onClick={() => {
          if (node.url) window.api.openExternal(node.url)
          else void goToDest(docId, sourceId, node.dest)
        }}
      >
        <button
          className="outline-toggle"
          style={{ visibility: has ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span>{node.title}</span>
      </div>
      {open && node.items.map((c, i) => <OutlineItem key={i} node={c} depth={depth + 1} docId={docId} sourceId={sourceId} />)}
    </>
  )
}

// ---------------------------------------------------------------------------

function Comments({ docId }: { docId: string }): React.JSX.Element | null {
  const pages = useDocStore((s) => s.docs[docId]?.pages)
  const annots = useDocStore((s) => s.docs[docId]?.annots)
  const selection = useUi((s) => s.selection)
  if (!pages || !annots) return null
  const groups = pages
    .map((p, i) => ({ page: p, index: i, list: annots[p.id] ?? [] }))
    .filter((g) => g.list.length)
  if (!groups.length) {
    return (
      <div className="sidebar-body">
        <div className="empty-note">
          Комментариев пока нет.
          <br />
          Используйте инструменты слева, чтобы добавить выделение, заметку или рисунок.
        </div>
      </div>
    )
  }
  return (
    <div className="sidebar-body" style={{ paddingBottom: 12 }}>
      {groups.map((g) => (
        <div key={g.page.id}>
          <div className="comment-group">Страница {g.index + 1}</div>
          {g.list.map((a) => (
            <div
              key={a.id}
              className={`comment${selection?.annotId === a.id ? ' selected' : ''}`}
              onClick={() => {
                useUi.getState().setTool('select')
                useUi.getState().select({ docId, pageId: g.page.id, annotId: a.id })
                getViewer(docId)?.scrollToPage(g.index, [a.rect[0], a.rect[3]], true)
              }}
              onDoubleClick={() => {
                if (a.type === 'note' || a.type === 'freetext') useUi.getState().setEditing(a.id)
              }}
            >
              <div className="comment-head">
                <span className="comment-swatch" style={{ background: a.color }} />
                <span style={{ flex: 1 }}>{ANNOT_LABELS[a.type]}</span>
                <span className="muted">{new Date(a.modified).toLocaleDateString()}</span>
              </div>
              {(a.contents || a.label) && <div className="comment-body">{a.contents || a.label}</div>}
              {a.author && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  {a.author}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
