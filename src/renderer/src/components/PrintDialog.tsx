import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Modal } from './Dialogs'
import { useActiveDoc } from '../store/docStore'
import { openPrintPdf, runPrint } from '../lib/actions'
import { renderSheet } from '../lib/pdf/printRender'
import {
  DEFAULT_PRINT,
  PAPER_MM,
  PER_SHEET,
  PERSISTED_KEYS,
  isLandscapePage,
  normalizePrint,
  paperCount,
  selectPages,
  sheetLayout,
  toSheets,
  type PrintSettings,
  type SheetLayout
} from '../lib/print'

const PREVIEW_WIDTH = 230
const PREVIEW_HEIGHT = 330

export function PrintDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const doc = useActiveDoc()
  const [s, setS] = useState<PrintSettings>(DEFAULT_PRINT)
  const [printers, setPrinters] = useState<{ name: string; displayName: string }[] | null>(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const patch = (p: Partial<PrintSettings>): void => setS((v) => ({ ...v, ...p }))

  useEffect(() => {
    window.api.getPrinters().then(setPrinters, () => setPrinters([]))
    void window.api.getSettings().then((all) => {
      const saved = all.print as Partial<PrintSettings> | undefined
      if (!saved) return
      const pick: Partial<PrintSettings> = {}
      for (const k of PERSISTED_KEYS) if (saved[k] !== undefined) (pick as Record<string, unknown>)[k] = saved[k]
      patch(pick)
    })
  }, [])

  // A remembered printer may have been removed from the system: fall back to the default one.
  useEffect(() => {
    if (printers && s.printer && !printers.some((p) => p.name === s.printer)) patch({ printer: '' })
  }, [printers, s.printer])

  const total = doc?.pages.length ?? 0
  const current = doc?.view.currentPage ?? 0
  const pages = useMemo(() => (doc ? selectPages(total, current, s) : null), [doc, total, current, s])
  const sheets = useMemo(() => toSheets(pages ?? [], s.perSheet), [pages, s.perSheet])
  const layout = useMemo(
    () => sheetLayout(s, !!doc && !!pages?.length && isLandscapePage(doc.pages[pages[0]])),
    [doc, pages, s]
  )
  const sheetNo = Math.min(sheetIdx, Math.max(0, sheets.length - 1))
  const rangeBad = s.pageSet === 'range' && !pages
  const empty = !rangeBad && !pages?.length

  if (!doc) return null

  const print = (system: boolean): void => {
    const final = normalizePrint(s)
    const saved: Partial<PrintSettings> = {}
    for (const k of PERSISTED_KEYS) (saved as Record<string, unknown>)[k] = final[k]
    void window.api.getSettings().then((all) => window.api.setSettings({ ...all, print: saved }))
    onClose()
    void runPrint(doc.id, final, system)
  }

  const nUp = s.perSheet > 1
  return (
    <Modal onClose={onClose} wide>
      <h2>Печать</h2>
      <div className="dialog-grid print-grid">
        <div>
          <div className="field">
            <label>Принтер</label>
            <select value={s.printer} onChange={(e) => patch({ printer: e.target.value })}>
              <option value="">Принтер по умолчанию</option>
              {(printers ?? []).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Страницы</label>
            <div className="segmented" style={{ marginLeft: 0, alignSelf: 'flex-start' }}>
              <button className={s.pageSet === 'all' ? 'on' : ''} onClick={() => patch({ pageSet: 'all' })}>
                Все ({total})
              </button>
              <button className={s.pageSet === 'current' ? 'on' : ''} onClick={() => patch({ pageSet: 'current' })}>
                Текущая ({current + 1})
              </button>
              <button className={s.pageSet === 'range' ? 'on' : ''} onClick={() => patch({ pageSet: 'range' })}>
                Диапазон
              </button>
            </div>
            {s.pageSet === 'range' && (
              <input
                autoFocus
                placeholder={`например: 1-3, 5, 8-${total}`}
                value={s.range}
                onChange={(e) => patch({ range: e.target.value })}
              />
            )}
            {empty && <span className="field-error">Под выбранные условия не попадает ни одна страница</span>}
            {rangeBad && (
              <span className="field-error">
                {s.range.trim() ? `Неверный диапазон: номера страниц от 1 до ${total}` : 'Укажите страницы'}
              </span>
            )}
            <div className="row">
              <select className="grow" value={s.subset} onChange={(e) => patch({ subset: e.target.value as PrintSettings['subset'] })}>
                <option value="all">Все выбранные</option>
                <option value="odd">Только нечётные</option>
                <option value="even">Только чётные</option>
              </select>
              <label className="check">
                <input type="checkbox" checked={s.reverse} onChange={(e) => patch({ reverse: e.target.checked })} />
                Обратный порядок
              </label>
            </div>
          </div>

          <div className="print-cols print-copies">
            <div className="field">
              <label>Копии</label>
              <div className="row">
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={s.copies || ''}
                  onChange={(e) => patch({ copies: Math.min(999, parseInt(e.target.value, 10) || 0) })}
                  onBlur={() => patch({ copies: normalizePrint(s).copies })}
                  style={{ width: 72 }}
                />
                <label className="check" title="Печатать копии целиком: 1, 2, 3, 1, 2, 3 вместо 1, 1, 2, 2, 3, 3">
                  <input
                    type="checkbox"
                    checked={s.collate}
                    disabled={s.copies < 2 || s.duplex === 'manual'}
                    onChange={(e) => patch({ collate: e.target.checked })}
                  />
                  Разобрать по копиям
                </label>
              </div>
            </div>
            <div className="field">
              <label>Двусторонняя печать</label>
              <select value={s.duplex} onChange={(e) => patch({ duplex: e.target.value as PrintSettings['duplex'] })}>
                <option value="simplex">Нет</option>
                <option value="longEdge">По длинному краю</option>
                <option value="shortEdge">По короткому краю</option>
                <option value="manual">Вручную, без дуплекса</option>
              </select>
            </div>
          </div>
          {s.duplex === 'manual' && (
            <div className="print-note">
              Сначала печатаются лицевые стороны. Затем программа попросит перевернуть стопку и вложить её обратно в лоток.
              <label className="check" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={s.reverseBacks} onChange={(e) => patch({ reverseBacks: e.target.checked })} />
                Оборотные стороны в обратном порядке
              </label>
            </div>
          )}

          <div className="print-cols">
            <div className="field">
              <label>Страниц на листе</label>
              <div className="row">
                <select
                  className="grow"
                  value={s.perSheet}
                  onChange={(e) => patch({ perSheet: Number(e.target.value) as PrintSettings['perSheet'] })}
                >
                  {PER_SHEET.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <label className="check">
                  <input type="checkbox" checked={s.borders} disabled={!nUp} onChange={(e) => patch({ borders: e.target.checked })} />
                  Рамки
                </label>
              </div>
            </div>
            <div className="field">
              <label>Ориентация</label>
              <select value={s.orientation} onChange={(e) => patch({ orientation: e.target.value as PrintSettings['orientation'] })}>
                <option value="auto">Автоматически</option>
                <option value="portrait">Книжная</option>
                <option value="landscape">Альбомная</option>
              </select>
            </div>
            <div className="field">
              <label>Размер бумаги</label>
              <select value={s.paper} onChange={(e) => patch({ paper: e.target.value as PrintSettings['paper'] })}>
                {Object.entries(PAPER_MM).map(([name, [w, h]]) => (
                  <option key={name} value={name}>
                    {name} · {Math.round(w)}×{Math.round(h)} мм
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Поля</label>
              <select value={s.margin} onChange={(e) => patch({ margin: Number(e.target.value) })}>
                <option value={0}>Без полей</option>
                {[5, 10, 15, 20].map((m) => (
                  <option key={m} value={m}>
                    {m} мм
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Масштаб</label>
              <div className="row">
                <select
                  className="grow"
                  value={nUp ? 'fit' : s.fit}
                  disabled={nUp}
                  title={nUp ? 'При нескольких страницах на листе страницы вписываются в ячейки' : undefined}
                  onChange={(e) => patch({ fit: e.target.value as PrintSettings['fit'] })}
                >
                  <option value="fit">По размеру листа</option>
                  <option value="shrink">Уменьшать крупные</option>
                  <option value="actual">Фактический размер</option>
                  <option value="custom">Свой</option>
                </select>
                {!nUp && s.fit === 'custom' && (
                  <>
                    <input
                      type="number"
                      min={10}
                      max={400}
                      value={s.scale || ''}
                      onChange={(e) => patch({ scale: Math.min(400, parseInt(e.target.value, 10) || 0) })}
                      onBlur={() => patch({ scale: normalizePrint(s).scale })}
                      style={{ width: 64 }}
                    />
                    %
                  </>
                )}
              </div>
            </div>
            <div className="field">
              <label>Цвет и качество</label>
              <div className="row">
                <select className="grow" value={s.color ? 'color' : 'gray'} onChange={(e) => patch({ color: e.target.value === 'color' })}>
                  <option value="color">Цветная</option>
                  <option value="gray">Чёрно-белая</option>
                </select>
                <select value={s.dpi} onChange={(e) => patch({ dpi: Number(e.target.value) as PrintSettings['dpi'] })}>
                  <option value={150}>150 dpi</option>
                  <option value={300}>300 dpi</option>
                </select>
              </div>
            </div>
          </div>

          <label className="check">
            <input type="checkbox" checked={s.annotations} onChange={(e) => patch({ annotations: e.target.checked })} />
            Печатать комментарии и пометки
          </label>
        </div>

        <div className="print-side">
          <SheetPreview settings={s} layout={layout} sheet={sheets[sheetNo] ?? null} />
          <div className="print-nav">
            <button className="icon-btn square" disabled={sheetNo <= 0} onClick={() => setSheetIdx(sheetNo - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span>{sheets.length ? `Лист ${sheetNo + 1} из ${sheets.length}` : 'Нет страниц'}</span>
            <button className="icon-btn square" disabled={sheetNo >= sheets.length - 1} onClick={() => setSheetIdx(sheetNo + 1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="muted print-summary">
            Страниц: {pages?.length ?? 0}
            <br />
            Листов бумаги: {paperCount(sheets.length, s)}
            {layout.landscape ? ' · альбомная' : ' · книжная'}
          </div>
        </div>
      </div>
      <div className="modal-actions">
        <button
          className="btn"
          style={{ marginRight: 'auto' }}
          disabled={rangeBad || empty}
          title="Открыть окно печати Windows с настройками драйвера принтера"
          onClick={() => print(true)}
        >
          Системный диалог…
        </button>
        <button className="btn" onClick={onClose}>
          Отмена
        </button>
        <button className="btn primary" disabled={rangeBad || empty} onClick={() => print(false)}>
          Печать
        </button>
      </div>
    </Modal>
  )
}

/** Live preview of one sheet side, rendered from the document as it will be printed. */
function SheetPreview({
  settings,
  layout,
  sheet
}: {
  settings: PrintSettings
  layout: SheetLayout
  sheet: number[] | null
}): React.JSX.Element {
  const doc = useActiveDoc()
  const host = useRef<HTMLDivElement>(null)
  const pdfs = useRef(new Map<boolean, Promise<PDFDocumentProxy>>())
  const [state, setState] = useState<'busy' | 'ready' | 'error'>('busy')
  const key = JSON.stringify([sheet, layout, settings.fit, settings.scale, settings.margin, settings.color, settings.borders, settings.annotations, settings.orientation])

  useEffect(() => {
    const cache = pdfs.current
    return () => {
      for (const p of cache.values()) void p.then((pdf) => pdf.loadingTask.destroy()).catch(() => undefined)
      cache.clear()
    }
  }, [doc?.id])

  useEffect(() => {
    if (!doc) return
    let stop = false
    setState('busy')
    const run = async (): Promise<void> => {
      let pdf = pdfs.current.get(settings.annotations)
      if (!pdf) {
        pdf = openPrintPdf(doc, settings.annotations)
        pdfs.current.set(settings.annotations, pdf)
      }
      const canvas = await renderSheet(await pdf, sheet, layout, settings, (PREVIEW_WIDTH / layout.width) * 2, () => stop)
      if (stop || !host.current) return
      canvas.className = 'print-preview-canvas'
      host.current.replaceChildren(canvas)
      setState('ready')
    }
    run().catch(() => {
      if (stop) return
      host.current?.replaceChildren()
      setState('error')
    })
    return () => {
      stop = true
    }
  }, [key])

  return (
    <div
      className="print-preview"
      style={{ width: Math.min(PREVIEW_WIDTH, (PREVIEW_HEIGHT * layout.width) / layout.height), aspectRatio: `${layout.width} / ${layout.height}` }}
    >
      <div ref={host} className="print-preview-host" />
      {state !== 'ready' && (
        <div className="print-preview-busy">{state === 'busy' ? 'Подготовка…' : 'Не удалось построить предпросмотр'}</div>
      )}
    </div>
  )
}
