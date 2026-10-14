import { Copy, Highlighter, Strikethrough, Underline } from 'lucide-react'
import { getDoc, useDocStore } from '../../store/docStore'
import { useUi } from '../../store/uiStore'
import { mergeLineRects } from '../../lib/annotOps'
import { uid, type Annot } from '../../lib/model'
import { PDF_TO_CSS, applyRect, invert, normRotation, unionRects, viewportTransform, type Rect } from '../../lib/pdf/coords'

type MarkupKind = 'highlight' | 'underline' | 'strikeout'

/** Converts the current text selection into markup annotations (one per page). */
export function applyMarkupFromSelection(docId: string, kind: MarkupKind, root: HTMLElement): void {
  const sel = window.getSelection()
  const doc = getDoc(docId)
  if (!sel || sel.isCollapsed || !sel.rangeCount || !doc) return
  const range = sel.getRangeAt(0)
  const style = useUi.getState().styles[kind]
  const author = useUi.getState().author
  const created: { pageId: string; annot: Annot }[] = []

  root.querySelectorAll<HTMLElement>('.page').forEach((pageEl) => {
    if (!range.intersectsNode(pageEl)) return
    const pageId = pageEl.dataset.pageId!
    const page = doc.pages.find((p) => p.id === pageId)
    if (!page) return
    const pr = pageEl.getBoundingClientRect()
    const rot = normRotation(page.baseRotate + page.rotation + doc.view.viewRotation)
    const inv = invert(viewportTransform(page.view, doc.view.zoom * PDF_TO_CSS, rot))
    const rects: Rect[] = []
    pageEl.querySelectorAll<HTMLElement>('.textLayer span:not(.markedContent)').forEach((span) => {
      if (!span.firstChild || !range.intersectsNode(span)) return
      const r = document.createRange()
      r.selectNodeContents(span)
      if (span.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset)
      if (span.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset)
      const b = r.getBoundingClientRect()
      if (b.width < 0.5 || b.height < 0.5) return
      rects.push(applyRect(inv, [b.left - pr.left, b.top - pr.top, b.right - pr.left, b.bottom - pr.top]))
    })
    const quads = mergeLineRects(rects)
    if (!quads.length) return
    const now = Date.now()
    created.push({
      pageId,
      annot: {
        id: uid('a'),
        type: kind,
        rect: unionRects(quads),
        quads,
        color: style.color,
        opacity: style.opacity,
        author,
        contents: '',
        created: now,
        modified: now
      }
    })
  })

  if (!created.length) return
  useDocStore.getState().commit(docId, (d) => {
    for (const c of created) (d.annots[c.pageId] ??= []).push(c.annot)
  })
  sel.removeAllRanges()
}

export function SelectionPopup({
  x,
  y,
  onAction
}: {
  x: number
  y: number
  onAction: (kind: MarkupKind | 'copy') => void
}): React.JSX.Element {
  const left = Math.min(x, window.innerWidth - 180)
  const top = Math.min(y, window.innerHeight - 50)
  return (
    <div className="selection-popup" style={{ left, top }} onMouseDown={(e) => e.preventDefault()}>
      <button className="icon-btn square" title="Выделить цветом" onClick={() => onAction('highlight')}>
        <Highlighter size={17} />
      </button>
      <button className="icon-btn square" title="Подчеркнуть" onClick={() => onAction('underline')}>
        <Underline size={17} />
      </button>
      <button className="icon-btn square" title="Зачеркнуть" onClick={() => onAction('strikeout')}>
        <Strikethrough size={17} />
      </button>
      <div className="sep" />
      <button className="icon-btn square" title="Копировать (Ctrl+C)" onClick={() => onAction('copy')}>
        <Copy size={16} />
      </button>
    </div>
  )
}
