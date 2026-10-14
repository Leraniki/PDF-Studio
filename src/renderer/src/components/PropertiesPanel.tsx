import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useDocStore } from '../store/docStore'
import { useUi, type ToolStyle } from '../store/uiStore'
import { ANNOT_LABELS, PALETTE, STAMPS, type Annot, type AnnotType } from '../lib/model'

export function PropertiesPanel(): React.JSX.Element | null {
  const tool = useUi((s) => s.tool)
  const styles = useUi((s) => s.styles)
  const setStyle = useUi((s) => s.setStyle)
  const selection = useUi((s) => s.selection)
  const annot = useDocStore((s) =>
    selection ? s.docs[selection.docId]?.annots[selection.pageId]?.find((a) => a.id === selection.annotId) : undefined
  )

  if (annot && selection) {
    const update = (patch: Partial<Annot>): void => {
      useDocStore.getState().updateAnnot(selection.docId, selection.pageId, annot.id, patch)
      // Remember the choice as the default for new annotations of this type.
      const sp: Partial<ToolStyle> = {}
      if (patch.color) sp.color = patch.color
      if (patch.opacity !== undefined) sp.opacity = patch.opacity
      if (patch.width !== undefined) sp.width = patch.width
      if (patch.fill !== undefined) sp.fill = patch.fill
      if (patch.fontSize !== undefined) sp.fontSize = patch.fontSize
      if (Object.keys(sp).length) setStyle(annot.type, sp)
    }
    return (
      <div className="rightpanel">
        <div className="panel-section">
          <div className="panel-title">
            <span style={{ flex: 1 }}>{annot.signature ? 'Подпись' : ANNOT_LABELS[annot.type]}</span>
            <button
              className="icon-btn square"
              title="Удалить (Delete)"
              onClick={() => {
                useDocStore.getState().deleteAnnot(selection.docId, selection.pageId, annot.id)
                useUi.getState().select(null)
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <StyleFields
            type={annot.type}
            value={{
              color: annot.color,
              opacity: annot.opacity,
              width: annot.width ?? 2,
              fill: annot.fill ?? null,
              fontSize: annot.fontSize ?? 12,
              label: annot.label ?? ''
            }}
            onChange={(p) => {
              const patch: Partial<Annot> = { ...p } as Partial<Annot>
              if (p.label !== undefined) patch.label = p.label
              update(patch)
            }}
          />
        </div>
        <div className="panel-section" style={{ borderBottom: 0 }}>
          <div className="field">
            <label>Комментарий</label>
            <CommentField
              key={annot.id}
              value={annot.contents}
              onCommit={(v) => update({ contents: v })}
              placeholder={annot.type === 'freetext' ? 'Текст поля' : 'Добавьте комментарий…'}
            />
          </div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
            Автор: {annot.author || '—'}
            <br />
            Изменено: {new Date(annot.modified).toLocaleString()}
          </div>
        </div>
      </div>
    )
  }

  if (tool === 'select' || tool === 'hand') return null
  const type = tool as AnnotType
  return (
    <div className="rightpanel">
      <div className="panel-section">
        <div className="panel-title">{ANNOT_LABELS[type]}</div>
        <StyleFields type={type} value={styles[type]} onChange={(p) => setStyle(type, p)} />
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {hint(type)}
        </div>
      </div>
    </div>
  )
}

function hint(t: AnnotType): string {
  switch (t) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return 'Выделите текст мышью — разметка применится автоматически.'
    case 'ink':
      return 'Рисуйте на странице. Каждый штрих — отдельный объект.'
    case 'note':
      return 'Щёлкните на странице, чтобы добавить заметку.'
    case 'freetext':
      return 'Щёлкните или растяните рамку, затем введите текст.'
    case 'stamp':
      return 'Выберите штамп и щёлкните на странице.'
    case 'image':
      return 'Щёлкните на странице, чтобы разместить. Угловые маркеры сохраняют пропорции.'
    default:
      return 'Растяните фигуру на странице. Shift — ровные пропорции и углы.'
  }
}

function CommentField({
  value,
  onCommit,
  placeholder
}: {
  value: string
  onCommit: (v: string) => void
  placeholder: string
}): React.JSX.Element {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <textarea
      rows={4}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ resize: 'vertical' }}
    />
  )
}

function StyleFields({
  type,
  value,
  onChange
}: {
  type: AnnotType
  value: ToolStyle
  onChange: (p: Partial<ToolStyle>) => void
}): React.JSX.Element {
  const hasWidth = ['ink', 'rect', 'ellipse', 'line', 'arrow'].includes(type)
  const hasFill = type === 'rect' || type === 'ellipse'
  return (
    <>
      {type !== 'image' && (
        <div className="field">
          <label>{type === 'freetext' ? 'Цвет текста' : 'Цвет'}</label>
          <ColorPicker value={value.color} onChange={(color) => color && onChange({ color })} />
        </div>
      )}
      {hasFill && (
        <div className="field">
          <label>Заливка</label>
          <ColorPicker value={value.fill} allowNone onChange={(fill) => onChange({ fill })} />
        </div>
      )}
      <div className="field">
        <label>Непрозрачность · {Math.round(value.opacity * 100)}%</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={value.opacity}
          onChange={(e) => onChange({ opacity: parseFloat(e.target.value) })}
        />
      </div>
      {hasWidth && (
        <div className="field">
          <label>Толщина · {value.width} pt</label>
          <input
            type="range"
            min={0.5}
            max={12}
            step={0.5}
            value={value.width}
            onChange={(e) => onChange({ width: parseFloat(e.target.value) })}
          />
        </div>
      )}
      {type === 'freetext' && (
        <div className="field">
          <label>Размер шрифта · {value.fontSize} pt</label>
          <input
            type="range"
            min={6}
            max={48}
            step={1}
            value={value.fontSize}
            onChange={(e) => onChange({ fontSize: parseInt(e.target.value, 10) })}
          />
        </div>
      )}
      {type === 'stamp' && (
        <div className="field">
          <label>Штамп</label>
          <select value={value.label} onChange={(e) => onChange({ label: e.target.value })}>
            {STAMPS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  )
}

function ColorPicker({
  value,
  onChange,
  allowNone
}: {
  value: string | null
  onChange: (c: string | null) => void
  allowNone?: boolean
}): React.JSX.Element {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none${value === null ? ' on' : ''}`} title="Нет" onClick={() => onChange(null)} />
      )}
      {PALETTE.map((c) => (
        <button
          key={c}
          className={`swatch${value?.toLowerCase() === c ? ' on' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
      <input
        className="color-input"
        type="color"
        value={value ?? '#ffffff'}
        title="Другой цвет"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
