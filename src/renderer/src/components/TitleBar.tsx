import logo from '../../../../resources/icon.svg'
import { useEffect, useRef, useState } from 'react'
import { Menu, Plus, X } from 'lucide-react'
import { useDocStore } from '../store/docStore'
import { useUi } from '../store/uiStore'
import { closeDoc, openFromDialog, openPaths, printDoc, saveDoc } from '../lib/actions'

type RecentEntry = Awaited<ReturnType<typeof window.api.getRecent>>[number]

export function TitleBar(): React.JSX.Element {
  const order = useDocStore((s) => s.order)
  const docs = useDocStore((s) => s.docs)
  const activeId = useDocStore((s) => s.activeId)
  const setActive = useDocStore((s) => s.setActive)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="titlebar">
      <div className="no-drag" style={{ position: 'relative' }}>
        <button className="icon-btn" onClick={() => setMenuOpen((v) => !v)} title="Меню">
          <Menu size={17} />
        </button>
        {menuOpen && <AppMenu onClose={() => setMenuOpen(false)} />}
      </div>
      <div className="brand">
        <img className="brand-logo" src={logo} alt="" />
        {!order.length && <span>PDF Studio</span>}
      </div>
      <div className="tabs">
        {order.map((id) => {
          const d = docs[id]
          return (
            <div
              key={id}
              className={`tab${id === activeId ? ' active' : ''}`}
              title={d.path ?? d.name}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  void closeDoc(id)
                } else setActive(id)
              }}
            >
              <span className="tab-name">{d.name}</span>
              {d.dirty && <span className="dot" title="Есть несохранённые изменения" />}
              <button
                className="tab-close"
                title="Закрыть (Ctrl+W)"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void closeDoc(id)}
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
        {order.length > 0 && (
          <button className="icon-btn square tab-new" title="Открыть (Ctrl+O)" onClick={() => void openFromDialog()}>
            <Plus size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

function AppMenu({ onClose }: { onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const activeId = useDocStore((s) => s.activeId)
  const [recent, setRecent] = useState<RecentEntry[]>([])

  useEffect(() => {
    window.api.getRecent().then(setRecent).catch(() => undefined)
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', onDown))
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const run = (fn: () => unknown) => () => {
    onClose()
    fn()
  }
  const setDialog = useUi.getState().setDialog

  return (
    <div className="menu" ref={ref} style={{ top: 36, left: 0 }}>
      <button className="menu-item" onClick={run(openFromDialog)}>
        <span className="grow">Открыть…</span>
        <kbd>Ctrl+O</kbd>
      </button>
      <button className="menu-item" onClick={run(() => setDialog({ kind: 'merge' }))}>
        <span className="grow">Объединить файлы…</span>
      </button>
      <div className="menu-sep" />
      <button className="menu-item" disabled={!activeId} onClick={run(() => activeId && saveDoc(activeId))}>
        <span className="grow">Сохранить</span>
        <kbd>Ctrl+S</kbd>
      </button>
      <button className="menu-item" disabled={!activeId} onClick={run(() => activeId && saveDoc(activeId, true))}>
        <span className="grow">Сохранить как…</span>
        <kbd>Ctrl+Shift+S</kbd>
      </button>
      <button className="menu-item" disabled={!activeId} onClick={run(() => activeId && printDoc(activeId))}>
        <span className="grow">Печать…</span>
        <kbd>Ctrl+P</kbd>
      </button>
      <div className="menu-sep" />
      <button className="menu-item" disabled={!activeId} onClick={run(() => setDialog({ kind: 'split' }))}>
        <span className="grow">Разделить документ…</span>
      </button>
      <button className="menu-item" disabled={!activeId} onClick={run(() => setDialog({ kind: 'watermark' }))}>
        <span className="grow">Водяной знак…</span>
      </button>
      <button className="menu-item" disabled={!activeId} onClick={run(() => setDialog({ kind: 'headerFooter' }))}>
        <span className="grow">Колонтитулы и нумерация…</span>
      </button>
      <button className="menu-item" disabled={!activeId} onClick={run(() => setDialog({ kind: 'protect' }))}>
        <span className="grow">Защита паролем…</span>
      </button>
      <button className="menu-item" disabled={!activeId} onClick={run(() => setDialog({ kind: 'properties' }))}>
        <span className="grow">Свойства документа</span>
        <kbd>Ctrl+D</kbd>
      </button>
      <button className="menu-item" onClick={run(() => setDialog({ kind: 'settings' }))}>
        <span className="grow">Настройки</span>
      </button>
      {recent.length > 0 && (
        <>
          <div className="menu-sep" />
          <div className="menu-label">Недавние</div>
          {recent.slice(0, 8).map((r) => (
            <button key={r.path} className="menu-item" title={r.path} onClick={run(() => openPaths([r.path]))}>
              <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.name}
              </span>
            </button>
          ))}
        </>
      )}
      <div className="menu-sep" />
      <button className="menu-item" disabled={!activeId} onClick={run(() => activeId && closeDoc(activeId))}>
        <span className="grow">Закрыть документ</span>
        <kbd>Ctrl+W</kbd>
      </button>
    </div>
  )
}
