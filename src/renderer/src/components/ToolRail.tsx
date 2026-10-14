import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Circle,
  Hand,
  Highlighter,
  ImagePlus,
  MessageSquare,
  MousePointer2,
  PenLine,
  Plus,
  Signature,
  Slash,
  Square,
  Stamp,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  type LucideIcon
} from 'lucide-react'
import { useUi } from '../store/uiStore'
import type { Tool } from '../lib/model'
import { startImagePlacement } from '../lib/actions'
import { persistSignatures } from './DocDialogs'

interface ToolDef {
  tool: Tool
  icon: LucideIcon
  title: string
  key: string
}

export const TOOL_GROUPS: ToolDef[][] = [
  [
    { tool: 'select', icon: MousePointer2, title: 'Выбор и выделение текста', key: 'V' },
    { tool: 'hand', icon: Hand, title: 'Рука', key: 'H' }
  ],
  [
    { tool: 'highlight', icon: Highlighter, title: 'Выделить текст цветом', key: 'E' },
    { tool: 'underline', icon: Underline, title: 'Подчеркнуть текст', key: 'U' },
    { tool: 'strikeout', icon: Strikethrough, title: 'Зачеркнуть текст', key: 'K' }
  ],
  [
    { tool: 'note', icon: MessageSquare, title: 'Заметка', key: 'N' },
    { tool: 'freetext', icon: Type, title: 'Текстовое поле', key: 'T' },
    { tool: 'ink', icon: PenLine, title: 'Рисование от руки', key: 'P' }
  ],
  [
    { tool: 'rect', icon: Square, title: 'Прямоугольник', key: 'R' },
    { tool: 'ellipse', icon: Circle, title: 'Эллипс', key: 'O' },
    { tool: 'line', icon: Slash, title: 'Линия', key: 'L' },
    { tool: 'arrow', icon: ArrowUpRight, title: 'Стрелка', key: 'A' }
  ],
  [{ tool: 'stamp', icon: Stamp, title: 'Штамп', key: 'S' }]
]

export function ToolRail(): React.JSX.Element {
  const tool = useUi((s) => s.tool)
  const setTool = useUi((s) => s.setTool)
  const pending = useUi((s) => s.pendingImage)
  const [sigMenu, setSigMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <div className="toolrail">
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} style={{ display: 'contents' }}>
          {gi > 0 && <div className="hsep" />}
          {group.map((t) => (
            <button
              key={t.tool}
              className={`icon-btn square${tool === t.tool ? ' active' : ''}`}
              title={`${t.title} (${t.key})`}
              onClick={() => setTool(tool === t.tool && t.tool !== 'select' ? 'select' : t.tool)}
            >
              <t.icon size={18} />
            </button>
          ))}
        </div>
      ))}
      <div className="hsep" />
      <button
        className={`icon-btn square${tool === 'image' && pending && !pending.signature ? ' active' : ''}`}
        title="Добавить изображение"
        onClick={() => void startImagePlacement(false)}
      >
        <ImagePlus size={18} />
      </button>
      <button
        className={`icon-btn square${(tool === 'image' && pending?.signature) || sigMenu ? ' active' : ''}`}
        title="Подписать"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setSigMenu(sigMenu ? null : { x: r.right + 8, y: r.top })
        }}
      >
        <Signature size={18} />
      </button>
      {sigMenu && <SignatureMenu x={sigMenu.x} y={sigMenu.y} onClose={() => setSigMenu(null)} />}
    </div>
  )
}

function SignatureMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }): React.JSX.Element {
  const signatures = useUi((s) => s.signatures)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    setTimeout(() => document.addEventListener('mousedown', onDown))
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  return (
    <div className="sig-menu" ref={ref} style={{ left: x, top: Math.min(y, window.innerHeight - 380) }}>
      <div className="menu-label" style={{ padding: '2px 4px 8px' }}>
        Подписи
      </div>
      {signatures.map((s) => (
        <div
          key={s.id}
          className="sig-item"
          title="Поставить подпись"
          onClick={() => {
            onClose()
            void startImagePlacement(true, s)
          }}
        >
          <img src={s.src} alt="" />
          <button
            className="icon-btn square"
            title="Удалить подпись"
            onClick={(e) => {
              e.stopPropagation()
              void persistSignatures(signatures.filter((x) => x.id !== s.id))
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        className="menu-item"
        onClick={() => {
          onClose()
          useUi.getState().setDialog({ kind: 'signature' })
        }}
      >
        <Plus size={15} /> Создать подпись…
      </button>
    </div>
  )
}
