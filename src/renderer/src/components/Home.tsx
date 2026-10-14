import logo from '../../../../resources/icon.svg'
import { useEffect, useState } from 'react'
import { Combine, FileText, FolderOpen, X } from 'lucide-react'
import { openFromDialog, openPaths } from '../lib/actions'
import { useUi } from '../store/uiStore'

type RecentEntry = Awaited<ReturnType<typeof window.api.getRecent>>[number]

function ago(ms: number): string {
  const d = Date.now() - ms
  const min = Math.round(d / 60000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ч назад`
  return new Date(ms).toLocaleDateString()
}

export function Home(): React.JSX.Element {
  const [recent, setRecent] = useState<RecentEntry[]>([])
  useEffect(() => {
    window.api.getRecent().then(setRecent).catch(() => undefined)
  }, [])

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-hero">
          <img className="home-logo" src={logo} alt="" />
          <h1>PDF Studio</h1>
          <div className="muted">Чтение, комментирование и организация PDF-документов</div>
        </div>
        <div className="home-actions">
          <button className="btn primary" onClick={() => void openFromDialog()}>
            <FolderOpen size={16} /> Открыть файл
          </button>
          <button className="btn" onClick={() => useUi.getState().setDialog({ kind: 'merge' })}>
            <Combine size={16} /> Объединить файлы
          </button>
        </div>
        <div className="dropzone">
          Перетащите PDF сюда · <kbd>Ctrl+O</kbd> — открыть
        </div>
        {recent.length > 0 && (
          <div>
            <div className="recent-title">Недавние файлы</div>
            {recent.map((r) => (
              <div key={r.path} className="recent-item" onClick={() => void openPaths([r.path])}>
                <FileText size={18} className="muted" />
                <div className="info">
                  <div className="name">{r.name}</div>
                  <div className="path">{r.path}</div>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>
                  {ago(r.openedAt)}
                </span>
                <button
                  className="icon-btn square remove"
                  title="Убрать из списка"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.api.removeRecent(r.path).then(setRecent)
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
