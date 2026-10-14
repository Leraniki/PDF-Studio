import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Lock, Plus, X } from 'lucide-react'
import { useUi } from '../store/uiStore'
import { useActiveDoc } from '../store/docStore'
import { mergeFiles, splitDoc, type FileInput } from '../lib/actions'
import { parseRanges } from '../lib/pdf/export'
import { HeaderFooterDialog, ProtectDialog, SignatureDialog, WatermarkDialog } from './DocDialogs'
import { PrintDialog } from './PrintDialog'

export function Modal({
  children,
  onClose,
  wide
}: {
  children: React.ReactNode
  onClose: () => void
  wide?: boolean
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} onKeyDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function Dialogs(): React.JSX.Element | null {
  const dialog = useUi((s) => s.dialog)
  const close = (): void => useUi.getState().setDialog(null)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'password':
      return <PasswordDialog name={dialog.name} incorrect={dialog.incorrect} onDone={dialog.resolve} />
    case 'confirm-close':
      return (
        <Modal onClose={() => dialog.resolve('cancel')}>
          <h2>Сохранить изменения?</h2>
          <div className="muted" style={{ lineHeight: 1.5 }}>
            {dialog.names.length === 1
              ? `В документе «${dialog.names[0]}» есть несохранённые изменения.`
              : `Несохранённые изменения в документах: ${dialog.names.join(', ')}.`}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => dialog.resolve('cancel')}>
              Отмена
            </button>
            <button className="btn danger" onClick={() => dialog.resolve('discard')}>
              Не сохранять
            </button>
            <button className="btn primary" autoFocus onClick={() => dialog.resolve('save')}>
              Сохранить
            </button>
          </div>
        </Modal>
      )
    case 'properties':
      return <PropertiesDialog onClose={close} />
    case 'split':
      return <SplitDialog onClose={close} />
    case 'merge':
      return <MergeDialog onClose={close} />
    case 'settings':
      return <SettingsDialog onClose={close} />
    case 'watermark':
      return <WatermarkDialog onClose={close} />
    case 'headerFooter':
      return <HeaderFooterDialog onClose={close} />
    case 'protect':
      return <ProtectDialog onClose={close} />
    case 'signature':
      return <SignatureDialog onClose={close} />
    case 'print':
      return <PrintDialog onClose={close} />
    case 'print-flip':
      return (
        <Modal onClose={() => dialog.resolve(false)}>
          <h2>Печать второй стороны</h2>
          <div className="muted" style={{ lineHeight: 1.5 }}>
            Лицевые стороны напечатаны. Дождитесь, пока принтер закончит, переверните стопку чистой стороной для печати и вложите
            её обратно в лоток, не меняя порядок листов.
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => dialog.resolve(false)}>
              Отмена
            </button>
            <button className="btn primary" autoFocus onClick={() => dialog.resolve(true)}>
              Печатать вторую сторону
            </button>
          </div>
        </Modal>
      )
    default:
      return null
  }
}

function PasswordDialog({
  name,
  incorrect,
  onDone
}: {
  name: string
  incorrect: boolean
  onDone: (pw: string | null) => void
}): React.JSX.Element {
  const [pw, setPw] = useState('')
  return (
    <Modal onClose={() => onDone(null)}>
      <h2 className="row">
        <Lock size={16} /> Документ защищён паролем
      </h2>
      <div className="muted" style={{ marginBottom: 12 }}>
        «{name}»
      </div>
      <input
        type="password"
        autoFocus
        style={{ width: '100%' }}
        placeholder="Пароль"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onDone(pw)}
      />
      {incorrect && <div style={{ color: 'var(--danger)', marginTop: 8 }}>Неверный пароль, попробуйте ещё раз.</div>}
      <div className="modal-actions">
        <button className="btn" onClick={() => onDone(null)}>
          Отмена
        </button>
        <button className="btn primary" onClick={() => onDone(pw)}>
          Открыть
        </button>
      </div>
    </Modal>
  )
}

function formatPdfDate(s?: string): string {
  if (!s) return '—'
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s)
  if (!m) return s
  const d = new Date(+m[1], (+(m[2] ?? 1) || 1) - 1, +(m[3] ?? 1) || 1, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
  return d.toLocaleString()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(2)} МБ`
}

function PropertiesDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const doc = useActiveDoc()
  if (!doc) return null
  const p = doc.pages[doc.view.currentPage]
  const w = p ? p.view[2] - p.view[0] : 0
  const h = p ? p.view[3] - p.view[1] : 0
  const mm = (pt: number): string => `${Math.round((pt / 72) * 25.4)} мм`
  const rows: [string, string][] = [
    ['Файл', doc.path ?? doc.name],
    ['Название', doc.info.title || '—'],
    ['Автор', doc.info.author || '—'],
    ['Тема', doc.info.subject || '—'],
    ['Ключевые слова', doc.info.keywords || '—'],
    ['Создано', formatPdfDate(doc.info.creationDate)],
    ['Изменено', formatPdfDate(doc.info.modDate)],
    ['Приложение', doc.info.creator || '—'],
    ['PDF-производитель', doc.info.producer || '—'],
    ['Версия PDF', doc.info.version || '—'],
    ['Размер файла', formatSize(doc.info.fileSize)],
    ['Страниц', String(doc.pages.length)],
    ['Размер страницы', p ? `${mm(w)} × ${mm(h)} (${Math.round(w)} × ${Math.round(h)} pt)` : '—'],
    ['Защита', doc.encrypted ? 'Зашифрован' : 'Нет']
  ]
  return (
    <Modal onClose={onClose}>
      <h2>Свойства документа</h2>
      <table className="props-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td style={{ wordBreak: 'break-word' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </Modal>
  )
}

function SplitDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const doc = useActiveDoc()
  const [mode, setMode] = useState<'every' | 'ranges'>('every')
  const [every, setEvery] = useState(1)
  const [ranges, setRanges] = useState('')
  if (!doc) return null
  const total = doc.pages.length
  let groups: number[][] | null = null
  if (mode === 'every') {
    const n = Math.max(1, every)
    groups = []
    for (let i = 0; i < total; i += n) groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k))
  } else {
    groups = parseRanges(ranges, total)
  }
  return (
    <Modal onClose={onClose}>
      <h2>Разделить документ</h2>
      <div className="field">
        <label className="check">
          <input type="radio" checked={mode === 'every'} onChange={() => setMode('every')} />
          Каждые N страниц
        </label>
        <input
          type="number"
          min={1}
          max={total}
          value={every}
          disabled={mode !== 'every'}
          onChange={(e) => setEvery(parseInt(e.target.value, 10) || 1)}
          style={{ width: 120 }}
        />
      </div>
      <div className="field">
        <label className="check">
          <input type="radio" checked={mode === 'ranges'} onChange={() => setMode('ranges')} />
          По диапазонам (каждый — отдельный файл)
        </label>
        <input
          placeholder="например: 1-3, 5, 8-10"
          value={ranges}
          disabled={mode !== 'ranges'}
          onChange={(e) => setRanges(e.target.value)}
        />
      </div>
      <div className="muted">
        {groups ? `Будет создано файлов: ${groups.length}` : 'Укажите корректные диапазоны страниц (1–' + total + ')'}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button
          className="btn primary"
          disabled={!groups || !groups.length}
          onClick={() => {
            onClose()
            if (groups) void splitDoc(doc.id, groups)
          }}
        >
          Разделить…
        </button>
      </div>
    </Modal>
  )
}

function MergeDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [files, setFiles] = useState<FileInput[]>([])
  const add = async (): Promise<void> => {
    const picked = await window.api.openDialog({ multi: true, title: 'Добавить файлы' })
    setFiles((f) => [...f, ...picked])
  }
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current) {
      opened.current = true
      void add()
    }
  }, [])
  const move = (i: number, d: number): void =>
    setFiles((f) => {
      const next = [...f]
      const [x] = next.splice(i, 1)
      next.splice(Math.max(0, Math.min(next.length, i + d)), 0, x)
      return next
    })
  return (
    <Modal onClose={onClose}>
      <h2>Объединить файлы</h2>
      <div className="muted">Файлы будут объединены в указанном порядке.</div>
      <div className="merge-list">
        {files.map((f, i) => (
          <div key={`${f.path}-${i}`} className="merge-item" title={f.path ?? f.name}>
            <span>{f.name}</span>
            <button className="icon-btn square" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={14} />
            </button>
            <button className="icon-btn square" disabled={i === files.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={14} />
            </button>
            <button className="icon-btn square" onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}>
              <X size={14} />
            </button>
          </div>
        ))}
        {!files.length && <div className="empty-note">Файлы не выбраны</div>}
      </div>
      <button className="btn" onClick={() => void add()}>
        <Plus size={15} /> Добавить файлы
      </button>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button
          className="btn primary"
          disabled={files.length < 2}
          onClick={() => {
            onClose()
            void mergeFiles(files)
          }}
        >
          Объединить
        </button>
      </div>
    </Modal>
  )
}

function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [author, setAuthor] = useState(useUi.getState().author)
  const save = async (): Promise<void> => {
    useUi.getState().setAuthor(author)
    const s = await window.api.getSettings()
    await window.api.setSettings({ ...s, author })
    onClose()
  }
  return (
    <Modal onClose={onClose}>
      <h2>Настройки</h2>
      <div className="field">
        <label>Имя автора комментариев</label>
        <input value={author} autoFocus onChange={(e) => setAuthor(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button className="btn primary" onClick={() => void save()}>
          Сохранить
        </button>
      </div>
    </Modal>
  )
}
