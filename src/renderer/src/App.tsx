import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, Minimize2 } from 'lucide-react'
import { useDocStore } from './store/docStore'
import { useUi, type SavedSignature } from './store/uiStore'
import { InfoBar } from './components/InfoBar'
import { openFile, openPaths, requestAppClose } from './lib/actions'
import { DRAW_TOOLS, MARKUP_TOOLS } from './lib/model'
import { TitleBar } from './components/TitleBar'
import { Toolbar } from './components/Toolbar'
import { ToolRail } from './components/ToolRail'
import { Sidebar } from './components/Sidebar'
import { Viewer } from './components/Viewer/Viewer'
import { OrganizeView } from './components/OrganizeView'
import { SearchPanel } from './components/SearchPanel'
import { PropertiesPanel } from './components/PropertiesPanel'
import { Home } from './components/Home'
import { Dialogs } from './components/Dialogs'
import { useShortcuts } from './hooks/useShortcuts'

export function App(): React.JSX.Element {
  const order = useDocStore((s) => s.order)
  const activeId = useDocStore((s) => s.activeId)
  const mode = useUi((s) => s.mode)
  const sidebar = useUi((s) => s.sidebar)
  const searchOpen = useUi((s) => s.search.open)
  const tool = useUi((s) => s.tool)
  const selection = useUi((s) => s.selection)
  const [dragOver, setDragOver] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useShortcuts()

  // Startup: settings, files passed on the command line, IPC listeners.
  useEffect(() => {
    ;(async () => {
      const settings = await window.api.getSettings().catch(() => ({}) as Record<string, unknown>)
      const author = (settings['author'] as string) || (await window.api.getUsername())
      useUi.getState().setAuthor(author)
      useUi.getState().setNightMode(!!settings['nightMode'])
      if (Array.isArray(settings['signatures'])) useUi.getState().setSignatures(settings['signatures'] as SavedSignature[])
      const pending = await window.api.getPendingPaths()
      if (pending.length) await openPaths(pending)
    })()
    const offOpen = window.api.onOpenPaths((paths) => void openPaths(paths))
    const offClose = window.api.onCloseRequest(() => void requestAppClose())
    return () => {
      offOpen()
      offClose()
    }
  }, [])

  useEffect(() => {
    const onFs = (): void => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // Drag & drop PDF files anywhere in the window.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setDragOver(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragOver(false)
    }
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = async (e: DragEvent): Promise<void> => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragOver(false)
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf')
      if (!files.length) {
        useUi.getState().toast('Перетащите файлы PDF', 'error')
        return
      }
      for (const f of files) {
        const path = window.api.getPathForFile(f) || null
        await openFile({ path, name: f.name, data: new Uint8Array(await f.arrayBuffer()) })
      }
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  const showProps =
    mode === 'view' &&
    (!!selection || MARKUP_TOOLS.includes(tool) || DRAW_TOOLS.includes(tool))

  return (
    <div className={`app${fullscreen ? ' fullscreen' : ''}`}>
      <TitleBar />
      {activeId ? (
        <>
          <Toolbar />
          <InfoBar />
          <div className="workspace">
            {mode === 'view' && <ToolRail />}
            {sidebar && mode === 'view' && <Sidebar />}
            <div className="main">
              {order.map((id) => (
                <div
                  key={id}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    visibility: id === activeId && mode === 'view' ? 'visible' : 'hidden',
                    pointerEvents: id === activeId && mode === 'view' ? 'auto' : 'none'
                  }}
                >
                  <Viewer docId={id} />
                </div>
              ))}
              {mode === 'organize' && <OrganizeView docId={activeId} />}
            </div>
            {searchOpen && mode === 'view' ? <SearchPanel /> : showProps ? <PropertiesPanel /> : null}
          </div>
        </>
      ) : (
        <Home />
      )}
      {fullscreen && (
        <button className="btn fullscreen-exit" onClick={() => document.exitFullscreen()}>
          <Minimize2 size={15} /> Выйти из полноэкранного режима
        </button>
      )}
      {dragOver && (
        <div className="drop-overlay">
          <div>Отпустите, чтобы открыть PDF</div>
        </div>
      )}
      <Dialogs />
      <Toasts />
      <Loading />
    </div>
  )
}

function Toasts(): React.JSX.Element {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'success' ? <CheckCircle2 size={16} /> : t.kind === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}
          {t.text}
        </div>
      ))}
    </div>
  )
}

function Loading(): React.JSX.Element | null {
  const loading = useUi((s) => s.loading)
  if (!loading) return null
  return (
    <div className="loading-bar">
      <div className="spinner" />
      {loading}
    </div>
  )
}
