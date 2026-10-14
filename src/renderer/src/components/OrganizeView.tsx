import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, FilePlus2, FileOutput, FilePlus, RotateCcw, RotateCw, Scissors, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { useDocStore } from '../store/docStore'
import { useUi } from '../store/uiStore'
import { extractPages, insertBlankPage, insertFromFile } from '../lib/actions'
import { Thumb } from './Sidebar'
import type { PageRef } from '../lib/model'

export function OrganizeView({ docId }: { docId: string }): React.JSX.Element | null {
  const pages = useDocStore((s) => s.docs[docId]?.pages)
  const selected = useUi((s) => s.organizeSelection)
  const setSelected = useUi((s) => s.setOrganizeSelection)
  const [thumbSize, setThumbSize] = useState(170)
  const [dragId, setDragId] = useState<string | null>(null)
  const anchor = useRef<number>(-1)
  const gridRef = useRef<HTMLDivElement>(null)
  const store = useDocStore.getState()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    if (!pages) return
    const ids = new Set(pages.map((p) => p.id))
    if (selected.some((id) => !ids.has(id))) setSelected(selected.filter((id) => ids.has(id)))
  }, [pages, selected, setSelected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.matches('input, textarea, select')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault()
        removeSelected()
      } else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(pages?.map((p) => p.id) ?? [])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!pages) return null

  const sel = new Set(selected)
  const targetIds = selected.length ? selected : []
  const insertIndex = (): number => {
    if (!selected.length) return pages.length
    return Math.max(...selected.map((id) => pages.findIndex((p) => p.id === id))) + 1
  }

  const removeSelected = (): void => {
    if (!selected.length) return
    if (selected.length >= pages.length) {
      useUi.getState().toast('Нельзя удалить все страницы документа', 'error')
      return
    }
    store.deletePages(docId, selected)
    setSelected([])
  }

  const onItemClick = (e: React.MouseEvent, p: PageRef, i: number): void => {
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
      const range = pages.slice(a, b + 1).map((x) => x.id)
      setSelected(e.ctrlKey ? Array.from(new Set([...selected, ...range])) : range)
    } else if (e.ctrlKey || e.metaKey) {
      setSelected(sel.has(p.id) ? selected.filter((id) => id !== p.id) : [...selected, p.id])
      anchor.current = i
    } else {
      setSelected([p.id])
      anchor.current = i
    }
  }

  const onDragStart = (e: DragStartEvent): void => {
    const id = String(e.active.id)
    setDragId(id)
    if (!sel.has(id)) setSelected([id])
  }

  const onDragEnd = (e: DragEndEvent): void => {
    setDragId(null)
    const overId = e.over ? String(e.over.id) : null
    const activeId = String(e.active.id)
    if (!overId || overId === activeId) return
    const moving = sel.has(activeId) ? selected : [activeId]
    const from = pages.findIndex((p) => p.id === activeId)
    const to = pages.findIndex((p) => p.id === overId)
    store.movePages(docId, moving, to > from ? to + 1 : to)
  }

  const dragPage = dragId ? pages.find((p) => p.id === dragId) : null

  return (
    <div className="organize">
      <div className="organize-bar">
        <span className="muted" style={{ marginRight: 8 }}>
          {selected.length ? `Выбрано: ${selected.length}` : `Страниц: ${pages.length}`}
        </span>
        <button className="icon-btn" disabled={!selected.length} title="Повернуть против часовой" onClick={() => store.rotatePages(docId, targetIds, -90)}>
          <RotateCcw size={16} />
        </button>
        <button className="icon-btn" disabled={!selected.length} title="Повернуть по часовой" onClick={() => store.rotatePages(docId, targetIds, 90)}>
          <RotateCw size={16} />
        </button>
        <button className="icon-btn" disabled={!selected.length} title="Удалить (Delete)" onClick={removeSelected}>
          <Trash2 size={16} />
        </button>
        <button className="icon-btn" disabled={!selected.length} title="Дублировать" onClick={() => store.duplicatePages(docId, selected)}>
          <Copy size={16} />
        </button>
        <div className="sep" />
        <button className="icon-btn" title="Вставить пустую страницу" onClick={() => insertBlankPage(docId, insertIndex())}>
          <FilePlus size={16} /> Пустая
        </button>
        <button className="icon-btn" title="Вставить страницы из файла" onClick={() => void insertFromFile(docId, insertIndex())}>
          <FilePlus2 size={16} /> Из файла
        </button>
        <button className="icon-btn" disabled={!selected.length} title="Извлечь выбранные страницы в новый PDF" onClick={() => void extractPages(docId, selected)}>
          <FileOutput size={16} /> Извлечь
        </button>
        <button className="icon-btn" title="Разделить документ" onClick={() => useUi.getState().setDialog({ kind: 'split' })}>
          <Scissors size={16} /> Разделить
        </button>
        <div style={{ flex: 1 }} />
        <button className="icon-btn square" title="Мельче" onClick={() => setThumbSize((s) => Math.max(110, s - 30))}>
          <ZoomOut size={16} />
        </button>
        <button className="icon-btn square" title="Крупнее" onClick={() => setThumbSize((s) => Math.min(340, s + 30))}>
          <ZoomIn size={16} />
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div
            className="organize-grid"
            ref={gridRef}
            style={{ '--thumb-size': `${thumbSize}px` } as React.CSSProperties}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelected([])
            }}
          >
            {pages.map((p, i) => (
              <SortablePage
                key={p.id}
                page={p}
                index={i}
                size={thumbSize - 20}
                selected={sel.has(p.id)}
                dimmed={!!dragId && sel.has(p.id) && p.id !== dragId}
                root={gridRef}
                onClick={(e) => onItemClick(e, p, i)}
                onRotate={() => store.rotatePages(docId, [p.id], 90)}
                onDelete={() => {
                  if (pages.length > 1) store.deletePages(docId, [p.id])
                }}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {dragPage && (
            <div className="org-item selected" style={{ width: thumbSize }}>
              <div className="thumb-wrap">
                <Thumb page={dragPage} index={pages.indexOf(dragPage)} current={false} onClick={() => undefined} root={gridRef} width={thumbSize - 36} />
              </div>
              {selected.length > 1 && <span>{selected.length} стр.</span>}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function SortablePage({
  page,
  index,
  size,
  selected,
  dimmed,
  root,
  onClick,
  onRotate,
  onDelete
}: {
  page: PageRef
  index: number
  size: number
  selected: boolean
  dimmed: boolean
  root: React.RefObject<HTMLElement | null>
  onClick: (e: React.MouseEvent) => void
  onRotate: () => void
  onDelete: () => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`org-item${selected ? ' selected' : ''}${isDragging || dimmed ? ' dragging' : ''}`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <div className="thumb-wrap">
        <Thumb page={page} index={index} current={false} onClick={() => undefined} root={root} width={size - 16} />
      </div>
      <div className="org-actions" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-btn square" title="Повернуть" onClick={(e) => (e.stopPropagation(), onRotate())}>
          <RotateCw size={14} />
        </button>
        <button className="icon-btn square" title="Удалить" onClick={(e) => (e.stopPropagation(), onDelete())}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
