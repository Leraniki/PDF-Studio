import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Maximize,
  Minus,
  Moon,
  PanelLeft,
  Plus,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Search,
  StretchHorizontal,
  Undo2,
  Wrench,
  ImagePlus,
  Signature,
  Droplets,
  ListOrdered,
  Lock,
  Eraser,
  FileLock
} from 'lucide-react'
import { useDocStore, useActiveDoc } from '../store/docStore'
import { useUi } from '../store/uiStore'
import { getViewer, nextZoom, ZOOM_STEPS } from '../lib/viewerRegistry'
import { printDoc, saveDoc, startImagePlacement } from '../lib/actions'

export function Toolbar(): React.JSX.Element | null {
  const doc = useActiveDoc()
  const mode = useUi((s) => s.mode)
  const setMode = useUi((s) => s.setMode)
  const sidebar = useUi((s) => s.sidebar)
  const setSidebar = useUi((s) => s.setSidebar)
  const nightMode = useUi((s) => s.nightMode)
  const searchOpen = useUi((s) => s.search.open)
  const { undo, redo, updateView } = useDocStore.getState()
  if (!doc) return null
  const v = doc.view
  const viewer = getViewer(doc.id)
  const view = mode === 'view'

  const toggleNight = (): void => {
    const next = !nightMode
    useUi.getState().setNightMode(next)
    window.api.getSettings().then((s) => window.api.setSettings({ ...s, nightMode: next }))
  }

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          className={`icon-btn square${sidebar && view ? ' active' : ''}`}
          title="Боковая панель (F4)"
          disabled={!view}
          onClick={() => setSidebar(sidebar ? null : 'thumbs')}
        >
          <PanelLeft size={18} />
        </button>
        <div className="segmented">
          <button className={view ? 'on' : ''} onClick={() => setMode('view')}>
            Просмотр
          </button>
          <button className={!view ? 'on' : ''} onClick={() => setMode('organize')}>
            Страницы
          </button>
        </div>
      </div>

      <div className="toolbar-group">
        {view && (
          <>
            <button
              className="icon-btn square"
              title="Предыдущая страница"
              disabled={v.currentPage <= 0}
              onClick={() => viewer?.scrollToPage(v.currentPage - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <PageInput docId={doc.id} current={v.currentPage} total={doc.pages.length} />
            <button
              className="icon-btn square"
              title="Следующая страница"
              disabled={v.currentPage >= doc.pages.length - 1}
              onClick={() => viewer?.scrollToPage(v.currentPage + 1)}
            >
              <ChevronRight size={18} />
            </button>
            <div className="sep" />
            <button className="icon-btn square" title="Уменьшить (Ctrl −)" onClick={() => viewer?.zoomTo(nextZoom(v.zoom, -1))}>
              <Minus size={17} />
            </button>
            <ZoomMenu docId={doc.id} zoom={v.zoom} />
            <button className="icon-btn square" title="Увеличить (Ctrl +)" onClick={() => viewer?.zoomTo(nextZoom(v.zoom, 1))}>
              <Plus size={17} />
            </button>
            <div className="sep" />
            <button
              className={`icon-btn square${v.zoomMode === 'fitWidth' ? ' active' : ''}`}
              title="По ширине (Ctrl+2)"
              onClick={() => viewer?.fit('fitWidth')}
            >
              <StretchHorizontal size={17} />
            </button>
            <button
              className={`icon-btn square${v.zoomMode === 'fitPage' ? ' active' : ''}`}
              title="Страница целиком (Ctrl+0)"
              onClick={() => viewer?.fit('fitPage')}
            >
              <Maximize size={16} />
            </button>
            <button
              className={`icon-btn square${v.spread === 'spread' ? ' active' : ''}`}
              title="Разворот (две страницы)"
              onClick={() => updateView(doc.id, { spread: v.spread === 'spread' ? 'single' : 'spread' })}
            >
              <Columns2 size={17} />
            </button>
            <button
              className="icon-btn square"
              title="Повернуть вид (Ctrl+Shift++)"
              onClick={() => updateView(doc.id, { viewRotation: (v.viewRotation + 90) % 360 })}
            >
              <RotateCw size={16} />
            </button>
            <button className={`icon-btn square${nightMode ? ' active' : ''}`} title="Ночной режим страниц" onClick={toggleNight}>
              <Moon size={16} />
            </button>
            <button
              className="icon-btn square"
              title="Режим чтения — полный экран (Ctrl+L)"
              onClick={() => document.documentElement.requestFullscreen()}
            >
              <BookOpen size={17} />
            </button>
          </>
        )}
      </div>

      <div className="toolbar-group right">
        <button className="icon-btn square" title="Отменить (Ctrl+Z)" disabled={!doc.past.length} onClick={() => undo(doc.id)}>
          <Undo2 size={17} />
        </button>
        <button className="icon-btn square" title="Повторить (Ctrl+Y)" disabled={!doc.future.length} onClick={() => redo(doc.id)}>
          <Redo2 size={17} />
        </button>
        <div className="sep" />
        {view && (
          <button
            className={`icon-btn square${searchOpen ? ' active' : ''}`}
            title="Поиск (Ctrl+F)"
            onClick={() => useUi.getState().setSearch({ open: !searchOpen })}
          >
            <Search size={17} />
          </button>
        )}
        <DocToolsMenu docId={doc.id} hasForm={doc.form.hasFields} protectedDoc={!!doc.protection} />
        <button className="icon-btn square" title="Печать (Ctrl+P)" onClick={() => void printDoc(doc.id)}>
          <Printer size={17} />
        </button>
        <button className="icon-btn" title="Сохранить (Ctrl+S)" onClick={() => void saveDoc(doc.id)}>
          <Save size={17} />
          {doc.dirty && <span style={{ color: 'var(--text)' }}>Сохранить</span>}
        </button>
      </div>
    </div>
  )
}

function DocToolsMenu({
  docId,
  hasForm,
  protectedDoc
}: {
  docId: string
  hasForm: boolean
  protectedDoc: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const run = (fn: () => unknown) => () => {
    setOpen(false)
    fn()
  }
  const dialog = useUi.getState().setDialog
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className={`icon-btn square${open ? ' active' : ''}`} title="Инструменты документа" onClick={() => setOpen((v) => !v)}>
        <Wrench size={17} />
      </button>
      {open && (
        <div className="menu" style={{ top: 36, right: 0 }}>
          <div className="menu-label">Добавить</div>
          <button className="menu-item" onClick={run(() => startImagePlacement(false))}>
            <ImagePlus size={15} /> <span className="grow">Изображение…</span>
          </button>
          <button className="menu-item" onClick={run(() => dialog({ kind: 'signature' }))}>
            <Signature size={15} /> <span className="grow">Подпись…</span>
          </button>
          <button className="menu-item" onClick={run(() => dialog({ kind: 'watermark' }))}>
            <Droplets size={15} /> <span className="grow">Водяной знак…</span>
          </button>
          <button className="menu-item" onClick={run(() => dialog({ kind: 'headerFooter' }))}>
            <ListOrdered size={15} /> <span className="grow">Колонтитулы и нумерация…</span>
          </button>
          <div className="menu-sep" />
          <div className="menu-label">Защита и формы</div>
          <button className="menu-item" onClick={run(() => dialog({ kind: 'protect' }))}>
            <Lock size={15} /> <span className="grow">{protectedDoc ? 'Изменить защиту…' : 'Защитить паролем…'}</span>
          </button>
          {hasForm && (
            <>
              <button className="menu-item" onClick={run(() => useDocStore.getState().resetForm(docId))}>
                <Eraser size={15} /> <span className="grow">Очистить форму</span>
              </button>
              <button className="menu-item" onClick={run(() => saveDoc(docId, true, true))}>
                <FileLock size={15} /> <span className="grow">Сохранить копию со сглаженной формой…</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PageInput({ docId, current, total }: { docId: string; current: number; total: number }): React.JSX.Element {
  const [value, setValue] = useState(String(current + 1))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setValue(String(current + 1))
  }, [current, focused])
  return (
    <div className="page-input">
      <input
        id="page-input"
        value={value}
        onFocus={(e) => {
          setFocused(true)
          e.target.select()
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = Math.max(1, Math.min(total, parseInt(value, 10) || 1))
            getViewer(docId)?.scrollToPage(n - 1)
            setValue(String(n))
            getViewer(docId)?.focus()
          } else if (e.key === 'Escape') {
            getViewer(docId)?.focus()
          }
        }}
      />
      <span>/ {total}</span>
    </div>
  )
}

function ZoomMenu({ docId, zoom }: { docId: string; zoom: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const viewer = getViewer(docId)
  return (
    <div className="zoom-select" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)}>
        {Math.round(zoom * 100)}%<ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu" style={{ top: 36, left: -60, minWidth: 190 }}>
          <button className="menu-item" onClick={() => (viewer?.fit('fitWidth'), setOpen(false))}>
            <span className="grow">По ширине</span>
            <kbd>Ctrl+2</kbd>
          </button>
          <button className="menu-item" onClick={() => (viewer?.fit('fitPage'), setOpen(false))}>
            <span className="grow">Страница целиком</span>
            <kbd>Ctrl+0</kbd>
          </button>
          <button className="menu-item" onClick={() => (viewer?.zoomTo(1), setOpen(false))}>
            <span className="grow">Реальный размер</span>
            <kbd>Ctrl+1</kbd>
          </button>
          <div className="menu-sep" />
          {ZOOM_STEPS.filter((z) => z >= 0.25 && z <= 4).map((z) => (
            <button key={z} className="menu-item" onClick={() => (viewer?.zoomTo(z), setOpen(false))}>
              {Math.round(z * 100)}%
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
