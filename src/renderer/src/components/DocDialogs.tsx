import { useEffect, useMemo, useRef, useState } from 'react'
import { Eraser, ImagePlus, Lock, ShieldCheck, Trash2 } from 'lucide-react'
import { Modal } from './Dialogs'
import { useActiveDoc, useDocStore } from '../store/docStore'
import { useUi, type SavedSignature } from '../store/uiStore'
import { PALETTE, uid, type HeaderFooter, type HFSlot, type Watermark } from '../lib/model'
import { decorItems } from '../lib/decor'
import { parseRanges } from '../lib/ranges'
import { pickImage, startImagePlacement, unlockWithOwnerPassword, type PickedImage } from '../lib/actions'
import { ALL_PERMISSIONS, type Permissions, type Protection } from '../lib/pdf/security'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Colors({ value, onChange }: { value: string; onChange: (c: string) => void }): React.JSX.Element {
  return (
    <div className="swatches">
      {PALETTE.map((c) => (
        <button key={c} className={`swatch${value.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <input className="color-input" type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function PagesField({ value, onChange, total }: { value: string; onChange: (v: string) => void; total: number }): React.JSX.Element {
  const bad = !!value.trim() && !parseRanges(value, total)
  return (
    <div className="field">
      <label>Страницы</label>
      <input placeholder={`все (или например 1-3, 5 из ${total})`} value={value} onChange={(e) => onChange(e.target.value)} />
      {bad && <span style={{ color: 'var(--danger)', fontSize: 12 }}>Неверный диапазон — будут использованы все страницы</span>}
    </div>
  )
}

/** A4 page preview of decorations. */
function DecorPreview({ watermark, headerFooter }: { watermark: Watermark | null; headerFooter: HeaderFooter | null }): React.JSX.Element {
  const W = 595
  const H = 842
  const items = decorItems({ watermark, headerFooter }, W, H, { pageIndex: 0, pageCount: 12, fileName: 'Документ.pdf', date: new Date() })
  return (
    <svg className="decor-preview" viewBox={`0 0 ${W} ${H}`}>
      <rect width={W} height={H} fill="#fff" />
      {[140, 190, 240, 290, 340, 390, 440, 490, 540, 590, 640].map((y, i) => (
        <rect key={y} x={70} y={y} width={i % 3 === 2 ? 300 : 455} height={14} rx={3} fill="#e4e4ea" />
      ))}
      {items.map((it, i) =>
        it.kind === 'text' ? (
          <text
            key={i}
            x={it.x}
            y={it.y}
            fontSize={it.size}
            fontFamily="Arial, sans-serif"
            fill={it.color}
            opacity={it.opacity}
            textAnchor={it.anchor}
            dominantBaseline={it.middle ? 'central' : 'alphabetic'}
            transform={it.angle ? `rotate(${-it.angle} ${it.x} ${it.y})` : undefined}
          >
            {it.text}
          </text>
        ) : (
          <image
            key={i}
            href={it.src}
            x={it.cx - it.w / 2}
            y={it.cy - it.h / 2}
            width={it.w}
            height={it.h}
            opacity={it.opacity}
            preserveAspectRatio="none"
            transform={it.angle ? `rotate(${-it.angle} ${it.cx} ${it.cy})` : undefined}
          />
        )
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

const DEFAULT_WM: Watermark = {
  text: 'КОНФИДЕНЦИАЛЬНО',
  image: null,
  imageWidth: 1,
  imageHeight: 1,
  imageScale: 0.5,
  fontSize: 64,
  color: '#d93a3a',
  opacity: 0.25,
  angle: 45,
  position: 'center',
  pages: ''
}

export function WatermarkDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const doc = useActiveDoc()
  const [wm, setWm] = useState<Watermark>(doc?.decor.watermark ?? DEFAULT_WM)
  const [kind, setKind] = useState<'text' | 'image'>(wm.image ? 'image' : 'text')
  if (!doc) return null
  const patch = (p: Partial<Watermark>): void => setWm((w) => ({ ...w, ...p }))
  const effective: Watermark = kind === 'text' ? { ...wm, image: null } : wm
  const valid = kind === 'text' ? !!wm.text.trim() : !!wm.image

  return (
    <Modal onClose={onClose} wide>
      <h2>Водяной знак</h2>
      <div className="dialog-grid">
        <div>
          <div className="segmented" style={{ marginLeft: 0, marginBottom: 14, display: 'inline-flex' }}>
            <button className={kind === 'text' ? 'on' : ''} onClick={() => setKind('text')}>
              Текст
            </button>
            <button className={kind === 'image' ? 'on' : ''} onClick={() => setKind('image')}>
              Изображение
            </button>
          </div>
          {kind === 'text' ? (
            <>
              <div className="field">
                <label>Текст</label>
                <input value={wm.text} autoFocus onChange={(e) => patch({ text: e.target.value })} />
              </div>
              <div className="field">
                <label>Размер · {wm.fontSize} pt</label>
                <input type="range" min={12} max={160} value={wm.fontSize} onChange={(e) => patch({ fontSize: +e.target.value })} />
              </div>
              <div className="field">
                <label>Цвет</label>
                <Colors value={wm.color} onChange={(color) => patch({ color })} />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label>Изображение</label>
                <button
                  className="btn"
                  onClick={async () => {
                    const img = await pickImage()
                    if (img) patch({ image: img.src, imageWidth: img.width, imageHeight: img.height })
                  }}
                >
                  <ImagePlus size={15} /> {wm.image ? 'Заменить…' : 'Выбрать…'}
                </button>
              </div>
              <div className="field">
                <label>Ширина · {Math.round(wm.imageScale * 100)}% страницы</label>
                <input type="range" min={0.1} max={1} step={0.05} value={wm.imageScale} onChange={(e) => patch({ imageScale: +e.target.value })} />
              </div>
            </>
          )}
          <div className="field">
            <label>Прозрачность · {Math.round(wm.opacity * 100)}%</label>
            <input type="range" min={0.05} max={1} step={0.05} value={wm.opacity} onChange={(e) => patch({ opacity: +e.target.value })} />
          </div>
          <div className="field">
            <label>Поворот · {wm.angle}°</label>
            <div className="row">
              <input className="grow" type="range" min={-90} max={90} value={wm.angle} onChange={(e) => patch({ angle: +e.target.value })} />
              <button className="btn" onClick={() => patch({ angle: 0 })}>0°</button>
              <button className="btn" onClick={() => patch({ angle: 45 })}>45°</button>
            </div>
          </div>
          <div className="field">
            <label>Положение</label>
            <select value={wm.position} onChange={(e) => patch({ position: e.target.value as Watermark['position'] })}>
              <option value="center">По центру</option>
              <option value="top">Сверху</option>
              <option value="bottom">Снизу</option>
            </select>
          </div>
          <PagesField value={wm.pages} onChange={(pages) => patch({ pages })} total={doc.pages.length} />
        </div>
        <DecorPreview watermark={valid ? effective : null} headerFooter={doc.decor.headerFooter} />
      </div>
      <div className="muted" style={{ fontSize: 12 }}>Водяной знак впечатывается в страницы при сохранении. До этого его можно изменить или удалить.</div>
      <div className="modal-actions">
        {doc.decor.watermark && (
          <button
            className="btn danger"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              useDocStore.getState().setDecor(doc.id, { watermark: null })
              onClose()
            }}
          >
            <Trash2 size={15} /> Удалить
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => {
            useDocStore.getState().setDecor(doc.id, { watermark: effective })
            onClose()
          }}
        >
          Применить
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Headers, footers, page numbers
// ---------------------------------------------------------------------------

const EMPTY_SLOTS: Record<HFSlot, string> = { tl: '', tc: '', tr: '', bl: '', bc: '', br: '' }
const DEFAULT_HF: HeaderFooter = {
  slots: { ...EMPTY_SLOTS, bc: 'Страница {page} из {total}' },
  fontSize: 10,
  color: '#1f1f1f',
  marginX: 42,
  marginY: 28,
  startNumber: 1,
  pages: ''
}
const SLOT_LABELS: [HFSlot, string][] = [
  ['tl', 'Слева'],
  ['tc', 'По центру'],
  ['tr', 'Справа'],
  ['bl', 'Слева'],
  ['bc', 'По центру'],
  ['br', 'Справа']
]
const TOKENS: [string, string][] = [
  ['{page}', 'Номер страницы'],
  ['{total}', 'Всего страниц'],
  ['{date}', 'Дата'],
  ['{file}', 'Имя файла']
]
const PT_PER_MM = 72 / 25.4

export function HeaderFooterDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const doc = useActiveDoc()
  const [hf, setHf] = useState<HeaderFooter>(doc?.decor.headerFooter ?? DEFAULT_HF)
  const [focus, setFocus] = useState<HFSlot>('bc')
  const inputs = useRef<Partial<Record<HFSlot, HTMLInputElement | null>>>({})
  if (!doc) return null
  const patch = (p: Partial<HeaderFooter>): void => setHf((h) => ({ ...h, ...p }))
  const setSlot = (slot: HFSlot, v: string): void => setHf((h) => ({ ...h, slots: { ...h.slots, [slot]: v } }))
  const insert = (token: string): void => {
    const el = inputs.current[focus]
    const cur = hf.slots[focus]
    const pos = el?.selectionStart ?? cur.length
    setSlot(focus, cur.slice(0, pos) + token + cur.slice(el?.selectionEnd ?? pos))
    setTimeout(() => {
      el?.focus()
      el?.setSelectionRange(pos + token.length, pos + token.length)
    })
  }
  const preset = (slots: Partial<Record<HFSlot, string>>): void => patch({ slots: { ...EMPTY_SLOTS, ...slots } })
  const any = Object.values(hf.slots).some((s) => s.trim())

  return (
    <Modal onClose={onClose} wide>
      <h2>Колонтитулы и нумерация страниц</h2>
      <div className="dialog-grid">
        <div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button className="btn" onClick={() => preset({ bc: '{page}' })}>1, 2, 3 — внизу</button>
            <button className="btn" onClick={() => preset({ bc: 'Страница {page} из {total}' })}>Страница N из M</button>
            <button className="btn" onClick={() => preset({ br: '{page}' })}>Справа внизу</button>
          </div>
          {(['Верхний колонтитул', 'Нижний колонтитул'] as const).map((title, gi) => (
            <div className="field" key={title}>
              <label>{title}</label>
              <div className="slot-grid">
                {SLOT_LABELS.slice(gi * 3, gi * 3 + 3).map(([slot, label]) => (
                  <input
                    key={slot}
                    ref={(el) => {
                      inputs.current[slot] = el
                    }}
                    placeholder={label}
                    value={hf.slots[slot]}
                    onFocus={() => setFocus(slot)}
                    onChange={(e) => setSlot(slot, e.target.value)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {TOKENS.map(([t, label]) => (
              <button key={t} className="btn chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t)} title={`Вставить ${t}`}>
                + {label}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field grow">
              <label>Размер · {hf.fontSize} pt</label>
              <input type="range" min={6} max={24} value={hf.fontSize} onChange={(e) => patch({ fontSize: +e.target.value })} />
            </div>
            <div className="field" style={{ width: 110 }}>
              <label>Первый номер</label>
              <input type="number" min={1} value={hf.startNumber} onChange={(e) => patch({ startNumber: Math.max(1, +e.target.value || 1) })} />
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field grow">
              <label>Отступ сбоку, мм</label>
              <input type="number" min={0} value={Math.round(hf.marginX / PT_PER_MM)} onChange={(e) => patch({ marginX: Math.max(0, +e.target.value) * PT_PER_MM })} />
            </div>
            <div className="field grow">
              <label>Отступ сверху/снизу, мм</label>
              <input type="number" min={0} value={Math.round(hf.marginY / PT_PER_MM)} onChange={(e) => patch({ marginY: Math.max(0, +e.target.value) * PT_PER_MM })} />
            </div>
          </div>
          <div className="field">
            <label>Цвет</label>
            <Colors value={hf.color} onChange={(color) => patch({ color })} />
          </div>
          <PagesField value={hf.pages} onChange={(pages) => patch({ pages })} total={doc.pages.length} />
        </div>
        <DecorPreview watermark={doc.decor.watermark} headerFooter={hf} />
      </div>
      <div className="modal-actions">
        {doc.decor.headerFooter && (
          <button
            className="btn danger"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              useDocStore.getState().setDecor(doc.id, { headerFooter: null })
              onClose()
            }}
          >
            <Trash2 size={15} /> Удалить
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button
          className="btn primary"
          disabled={!any}
          onClick={() => {
            useDocStore.getState().setDecor(doc.id, { headerFooter: hf })
            onClose()
          }}
        >
          Применить
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Password protection
// ---------------------------------------------------------------------------

const PERMISSION_LABELS: [keyof Permissions, string][] = [
  ['print', 'Печать'],
  ['modify', 'Изменение документа'],
  ['copy', 'Копирование текста и изображений'],
  ['annotate', 'Комментирование'],
  ['fillForms', 'Заполнение форм'],
  ['assemble', 'Сборка документа (страницы)']
]

export function ProtectDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const doc = useActiveDoc()
  const p = doc?.protection
  const [openPw, setOpenPw] = useState(!!p?.userPassword)
  const [user, setUser] = useState(p?.userPassword ?? '')
  const [user2, setUser2] = useState(p?.userPassword ?? '')
  const [restrict, setRestrict] = useState(!!p && Object.values(p.permissions).some((v) => !v))
  const [owner, setOwner] = useState(p?.ownerPassword ?? '')
  const [owner2, setOwner2] = useState(p?.ownerPassword ?? '')
  const [perms, setPerms] = useState<Permissions>(p?.permissions ?? ALL_PERMISSIONS)
  const [unlockPw, setUnlockPw] = useState('')
  const [error, setError] = useState('')
  if (!doc) return null

  if (doc.encrypted) {
    return (
      <Modal onClose={onClose}>
        <h2 className="row">
          <Lock size={16} /> Защита
        </h2>
        <div className="muted">Тип шифрования этого документа не поддерживается: его можно только просматривать.</div>
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </Modal>
    )
  }

  if (doc.restricted) {
    const tryUnlock = async (): Promise<void> => {
      if (await unlockWithOwnerPassword(doc.id, unlockPw)) {
        useUi.getState().toast('Ограничения сняты', 'success')
        onClose()
      } else setError('Неверный пароль владельца')
    }
    return (
      <Modal onClose={onClose}>
        <h2 className="row">
          <Lock size={16} /> Документ защищён
        </h2>
        <div className="muted" style={{ lineHeight: 1.5, marginBottom: 12 }}>
          Владелец ограничил действия с этим документом. Чтобы изменять и сохранять его, введите пароль владельца.
        </div>
        <input type="password" autoFocus style={{ width: '100%' }} placeholder="Пароль владельца" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void tryUnlock()} />
        {error && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={() => void tryUnlock()}>
            Разблокировать
          </button>
        </div>
      </Modal>
    )
  }

  const apply = (): void => {
    if (!openPw && !restrict) {
      useDocStore.getState().setProtection(doc.id, null)
      onClose()
      return
    }
    if (openPw && !user) return setError('Введите пароль для открытия')
    if (openPw && user !== user2) return setError('Пароли для открытия не совпадают')
    if (restrict && !owner) return setError('Введите пароль владельца')
    if (restrict && owner !== owner2) return setError('Пароли владельца не совпадают')
    if (restrict && openPw && owner === user) return setError('Пароль владельца должен отличаться от пароля для открытия')
    const prot: Protection = {
      userPassword: openPw ? user : '',
      ownerPassword: restrict ? owner : user,
      permissions: restrict ? perms : ALL_PERMISSIONS
    }
    useDocStore.getState().setProtection(doc.id, prot)
    useUi.getState().toast('Защита будет применена при сохранении', 'info')
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="row">
        <ShieldCheck size={16} /> Защита паролем
      </h2>
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={openPw} onChange={(e) => setOpenPw(e.target.checked)} />
        Требовать пароль для открытия
      </label>
      {openPw && (
        <div className="row" style={{ marginBottom: 14 }}>
          <input className="grow" type="password" placeholder="Пароль" value={user} onChange={(e) => setUser(e.target.value)} />
          <input className="grow" type="password" placeholder="Повторите" value={user2} onChange={(e) => setUser2(e.target.value)} />
        </div>
      )}
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} />
        Ограничить печать и редактирование
      </label>
      {restrict && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="grow" type="password" placeholder="Пароль владельца" value={owner} onChange={(e) => setOwner(e.target.value)} />
            <input className="grow" type="password" placeholder="Повторите" value={owner2} onChange={(e) => setOwner2(e.target.value)} />
          </div>
          <div className="perm-grid">
            {PERMISSION_LABELS.map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms((x) => ({ ...x, [k]: e.target.checked }))} />
                {label}
              </label>
            ))}
          </div>
        </>
      )}
      <div className="muted" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
        Шифрование AES-256. Защита применяется при сохранении документа. Забытый пароль восстановить нельзя.
      </div>
      {error && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
      <div className="modal-actions">
        {doc.protection && (
          <button
            className="btn danger"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              useDocStore.getState().setProtection(doc.id, null)
              useUi.getState().toast('Защита будет снята при сохранении', 'info')
              onClose()
            }}
          >
            Снять защиту
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button className="btn primary" onClick={apply}>
          Применить
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

const SIGNATURE_FONTS = ['Segoe Script', 'Ink Free', 'Gabriola', 'Brush Script MT', 'Lucida Handwriting']
const INK = ['#111111', '#1a3d9e', '#0b5a2a']
const MAX_SIGNATURES = 12

/** Crops a canvas to its non-transparent pixels and returns a PNG. */
function trimmed(canvas: HTMLCanvasElement, pad = 8): PickedImage | null {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad)
  y1 = Math.min(height - 1, y1 + pad)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1
  out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return { src: out.toDataURL('image/png'), width: out.width / 2, height: out.height / 2 }
}

function typedSignature(text: string, font: string, color: string): PickedImage | null {
  const size = 96
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = `${size}px "${font}", cursive`
  const w = Math.ceil(ctx.measureText(text).width) + size
  c.width = w
  c.height = size * 2
  ctx.font = `${size}px "${font}", cursive`
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, size)
  return trimmed(c)
}

export async function persistSignatures(list: SavedSignature[]): Promise<void> {
  useUi.getState().setSignatures(list)
  const s = await window.api.getSettings()
  await window.api.setSettings({ ...s, signatures: list })
}

export function SignatureDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<'draw' | 'type' | 'image'>('draw')
  const [color, setColor] = useState(INK[0])
  const [name, setName] = useState(useUi.getState().author)
  const [font, setFont] = useState(SIGNATURE_FONTS[0])
  const [image, setImage] = useState<PickedImage | null>(null)
  const [save, setSave] = useState(true)
  const [hasInk, setHasInk] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = c.clientWidth * 2
    c.height = c.clientHeight * 2
    setHasInk(false)
  }, [tab])

  const point = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2 }
  }
  const clear = (): void => {
    const c = canvasRef.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    setHasInk(false)
  }

  const fonts = useMemo(() => SIGNATURE_FONTS, [])

  const result = (): PickedImage | null => {
    if (tab === 'draw') return canvasRef.current && hasInk ? trimmed(canvasRef.current) : null
    if (tab === 'type') return name.trim() ? typedSignature(name.trim(), font, color) : null
    return image
  }
  const ready = tab === 'draw' ? hasInk : tab === 'type' ? !!name.trim() : !!image

  const done = async (): Promise<void> => {
    const img = result()
    if (!img) return
    if (save) {
      const list = [{ id: uid('sig'), ...img }, ...useUi.getState().signatures].slice(0, MAX_SIGNATURES)
      await persistSignatures(list)
    }
    onClose()
    await startImagePlacement(true, img)
  }

  return (
    <Modal onClose={onClose} wide>
      <h2>Создать подпись</h2>
      <div className="segmented" style={{ marginLeft: 0, marginBottom: 14, display: 'inline-flex' }}>
        <button className={tab === 'draw' ? 'on' : ''} onClick={() => setTab('draw')}>
          Нарисовать
        </button>
        <button className={tab === 'type' ? 'on' : ''} onClick={() => setTab('type')}>
          Ввести
        </button>
        <button className={tab === 'image' ? 'on' : ''} onClick={() => setTab('image')}>
          Изображение
        </button>
      </div>

      {tab === 'draw' && (
        <div className="sig-pad">
          <canvas
            ref={canvasRef}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = point(e)
              const ctx = e.currentTarget.getContext('2d')!
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(drawing.current.x, drawing.current.y, 2.6, 0, Math.PI * 2)
              ctx.fill()
              setHasInk(true)
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return
              const p = point(e)
              const ctx = e.currentTarget.getContext('2d')!
              ctx.strokeStyle = color
              ctx.lineWidth = 5
              ctx.lineCap = 'round'
              ctx.lineJoin = 'round'
              ctx.beginPath()
              ctx.moveTo(drawing.current.x, drawing.current.y)
              ctx.lineTo(p.x, p.y)
              ctx.stroke()
              drawing.current = p
            }}
            onPointerUp={() => (drawing.current = null)}
          />
          <div className="sig-line" />
          {!hasInk && <div className="sig-hint">Распишитесь здесь</div>}
          <button className="icon-btn sig-clear" onClick={clear} title="Очистить">
            <Eraser size={15} /> Очистить
          </button>
        </div>
      )}

      {tab === 'type' && (
        <>
          <input style={{ width: '100%', marginBottom: 10 }} value={name} autoFocus placeholder="Ваше имя" onChange={(e) => setName(e.target.value)} />
          <div className="sig-fonts">
            {fonts.map((f) => (
              <button key={f} className={`sig-font${font === f ? ' on' : ''}`} style={{ fontFamily: `"${f}", cursive`, color }} onClick={() => setFont(f)}>
                {name || 'Подпись'}
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'image' && (
        <div className="sig-pad image">
          {image ? <img src={image.src} alt="" /> : <span className="muted">PNG с прозрачным фоном подойдёт лучше всего</span>}
          <button className="btn sig-clear" onClick={async () => setImage(await pickImage())}>
            <ImagePlus size={15} /> {image ? 'Заменить…' : 'Выбрать файл…'}
          </button>
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        {tab !== 'image' && (
          <div className="swatches">
            {INK.map((c) => (
              <button key={c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        )}
        <label className="check" style={{ marginLeft: 'auto' }}>
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          Сохранить для повторного использования
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button className="btn primary" disabled={!ready} onClick={() => void done()}>
          Готово
        </button>
      </div>
    </Modal>
  )
}
