import { memo, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useDocStore } from '../../store/docStore'
import type { FormValue, PageRef } from '../../lib/model'
import { getPage } from '../../lib/pdf/sources'
import type { Matrix, Rect } from '../../lib/pdf/coords'
import { orientedBox } from './AnnotLayer'

/** Subset of pdf.js widget annotation data used to build HTML form controls. */
interface Widget {
  id: string
  fieldName: string
  fieldType: 'Tx' | 'Btn' | 'Ch'
  rect: Rect
  readOnly?: boolean
  hidden?: boolean
  multiLine?: boolean
  maxLen?: number
  comb?: boolean
  textAlignment?: number
  checkBox?: boolean
  radioButton?: boolean
  exportValue?: string
  buttonValue?: string
  combo?: boolean
  multiSelect?: boolean
  options?: { exportValue: string; displayValue: string }[]
  alternativeText?: string
  defaultAppearanceData?: { fontSize?: number; fontColor?: ArrayLike<number> }
}

const cache = new Map<string, Promise<Widget[]>>()

function getWidgets(page: PageRef): Promise<Widget[]> {
  const key = `${page.sourceId}:${page.srcIndex}`
  let v = cache.get(key)
  if (!v) {
    v = getPage(page.sourceId, page.srcIndex)
      .then((p) => p.getAnnotations({ intent: 'display' }))
      .then((list) =>
        (list as (Widget & { subtype?: string; pushButton?: boolean; fieldType?: string })[]).filter(
          (a) =>
            a.subtype === 'Widget' &&
            a.fieldName &&
            (a.fieldType === 'Tx' || a.fieldType === 'Ch' || (a.fieldType === 'Btn' && !a.pushButton)) &&
            !a.hidden
        )
      )
      .catch(() => [])
    cache.set(key, v)
  }
  return v
}

export const FormLayer = memo(function FormLayer({
  docId,
  page,
  transform,
  scale,
  rotation
}: {
  docId: string
  page: PageRef
  transform: Matrix
  scale: number
  rotation: number
}) {
  const [widgets, setWidgets] = useState<Widget[]>([])
  const highlight = useDocStore((s) => s.docs[docId]?.form.highlight ?? true)

  useEffect(() => {
    let alive = true
    getWidgets(page).then((w) => alive && setWidgets(w))
    return () => {
      alive = false
    }
  }, [page])

  if (!widgets.length) return null
  return (
    <div className={`form-layer${highlight ? ' highlight' : ''}`}>
      {widgets.map((w) => (
        <Field key={w.id} docId={docId} w={w} m={transform} scale={scale} rotation={rotation} />
      ))}
    </div>
  )
})

function Field({
  docId,
  w,
  m,
  scale,
  rotation
}: {
  docId: string
  w: Widget
  m: Matrix
  scale: number
  rotation: number
}): React.JSX.Element | null {
  const value = useDocStore((s) => s.docs[docId]?.form.values[w.fieldName])
  const set = (v: FormValue): void => useDocStore.getState().setFormValue(docId, w.fieldName, v)
  const box = orientedBox(m, w.rect, scale, rotation)
  const h = (w.rect[3] - w.rect[1]) * scale
  const da = w.defaultAppearanceData
  const auto = w.multiLine ? 10 * scale : Math.min(h * 0.68, 12 * scale)
  const fontSize = da?.fontSize ? da.fontSize * scale : auto
  const color = da?.fontColor && da.fontColor.length >= 3 ? `rgb(${da.fontColor[0]}, ${da.fontColor[1]}, ${da.fontColor[2]})` : '#000'
  const common = {
    className: 'form-field',
    title: w.alternativeText || w.fieldName,
    disabled: w.readOnly,
    style: { ...box, fontSize, color },
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation()
  }

  if (w.fieldType === 'Tx') {
    const text = Array.isArray(value) ? value.join(', ') : (value ?? '')
    const align = w.textAlignment === 1 ? 'center' : w.textAlignment === 2 ? 'right' : 'left'
    const props = {
      ...common,
      value: text,
      maxLength: w.maxLen || undefined,
      style: {
        ...common.style,
        textAlign: align as React.CSSProperties['textAlign'],
        letterSpacing: w.comb && w.maxLen ? `${((w.rect[2] - w.rect[0]) * scale) / w.maxLen - fontSize * 0.6}px` : undefined
      },
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(e.target.value)
    }
    return w.multiLine ? <textarea {...props} /> : <input {...props} />
  }

  if (w.fieldType === 'Btn') {
    const onValue = (w.radioButton ? w.buttonValue : w.exportValue) ?? 'Yes'
    const checked = value === onValue || (!w.radioButton && !!value && value !== 'Off' && value === onValue)
    return (
      <button
        {...common}
        type="button"
        role={w.radioButton ? 'radio' : 'checkbox'}
        aria-checked={checked}
        className={`form-field form-toggle${w.radioButton ? ' radio' : ''}${checked ? ' on' : ''}`}
        onClick={() => set(checked ? (w.radioButton ? onValue : 'Off') : onValue)}
      >
        {checked && (w.radioButton ? <span className="radio-dot" /> : <Check size={Math.max(8, h * 0.8)} strokeWidth={3} />)}
      </button>
    )
  }

  const opts = w.options ?? []
  if (w.combo || !w.multiSelect) {
    const v = Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
    return (
      <select {...common} value={v} onChange={(e) => set(e.target.value)} size={w.combo ? undefined : Math.max(2, opts.length)}>
        {w.combo && <option value="" />}
        {opts.map((o) => (
          <option key={o.exportValue} value={o.exportValue}>
            {o.displayValue}
          </option>
        ))}
      </select>
    )
  }
  const values = Array.isArray(value) ? value : value ? [value] : []
  return (
    <select
      {...common}
      multiple
      value={values}
      onChange={(e) => set(Array.from(e.target.selectedOptions, (o) => o.value))}
    >
      {opts.map((o) => (
        <option key={o.exportValue} value={o.exportValue}>
          {o.displayValue}
        </option>
      ))}
    </select>
  )
}
