import { useDocStore, getDoc, type Doc, type DocInfo, type FormState, type OutlineNode } from '../store/docStore'
import { useUi } from '../store/uiStore'
import type { Annot, FormValue, PageRef } from './model'
import { uid } from './model'
import { importAnnotations } from './pdf/annotIO'
import { buildPdf, type ExportSource } from './pdf/export'
import { decryptPdf, encryptPdf, isEncryptedPdf, WrongPasswordError, type Protection } from './pdf/security'
import { loadPdf, PasswordRequiredError } from './pdf/pdfjs'
import { getSource, readPageInfos, registerSource, releaseSource, type Source } from './pdf/sources'
import { clearTextCache } from './pdf/search'
import { getViewer } from './viewerRegistry'
import { isLandscapePage, normalizePrint, planJobs, selectPages, sheetLayout, toSheets, type PrintSettings } from './print'
import { renderSheet } from './pdf/printRender'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface FileInput {
  path: string | null
  name: string
  data: Uint8Array
}

const ui = (): ReturnType<typeof useUi.getState> => useUi.getState()
const docs = (): ReturnType<typeof useDocStore.getState> => useDocStore.getState()

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function askPassword(name: string, incorrect: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    ui().setDialog({
      kind: 'password',
      name,
      incorrect,
      resolve: (pw) => {
        ui().setDialog(null)
        resolve(pw)
      }
    })
  })
}

interface LoadedSource {
  source: Source
  pages: PageRef[]
  annots: Record<string, Annot[]>
  form: FormState
}

interface Decrypted {
  bytes: Uint8Array
  protection: Protection | null
  restricted: boolean
}

/**
 * Decrypts a password-protected file so it can be edited and saved. Returns
 * null when the user cancels, or `undefined` when the encryption scheme is not
 * supported (the file is then opened read-only through pdf.js).
 */
async function unlock(file: FileInput): Promise<Decrypted | null | undefined> {
  if (!(await isEncryptedPdf(file.data))) return { bytes: file.data, protection: null, restricted: false }
  let password = ''
  let asked = false
  for (;;) {
    try {
      const res = await decryptPdf(file.data, password)
      return { bytes: res.bytes, protection: res.protection, restricted: res.restricted }
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) return undefined
      const pw = await askPassword(file.name, asked)
      if (pw === null) return null
      password = pw
      asked = true
    }
  }
}

/** Loads a file as a source: decrypts, imports annotations, reads page sizes and form fields. */
async function loadSource(file: FileInput): Promise<LoadedSource | null> {
  const unlocked = await unlock(file)
  if (unlocked === null) return null
  const readOnly = unlocked === undefined
  const imported = readOnly
    ? { bytes: file.data, annots: new Map<number, Annot[]>(), form: null }
    : await importAnnotations(unlocked.bytes)
  let password: string | undefined
  let incorrect = false
  let pdf
  for (;;) {
    try {
      pdf = await loadPdf(imported.bytes, password)
      break
    } catch (e) {
      if (e instanceof PasswordRequiredError) {
        const pw = await askPassword(file.name, incorrect || e.incorrect)
        if (pw === null) return null
        password = pw
        incorrect = true
        continue
      }
      throw e
    }
  }
  const sourceId = uid('src')
  const source: Source = {
    id: sourceId,
    name: file.name,
    bytes: imported.bytes,
    originalBytes: file.data,
    pdf,
    encrypted: readOnly,
    protection: unlocked?.protection ?? null,
    restricted: unlocked?.restricted ?? false,
    pages: new Map()
  }
  registerSource(source)
  const infos = await readPageInfos(sourceId)
  const pages: PageRef[] = infos.map((info, i) => ({
    id: uid('p'),
    sourceId,
    srcIndex: i,
    view: info.view,
    baseRotate: info.rotate,
    rotation: 0
  }))
  const annots: Record<string, Annot[]> = {}
  for (const [index, list] of imported.annots) if (pages[index]) annots[pages[index].id] = list
  const f = imported.form
  const form: FormState = {
    hasFields: !!f?.hasFields,
    values: f?.values ?? {},
    defaults: f?.defaults ?? {},
    changed: [],
    highlight: true
  }
  return { source, pages, annots, form }
}

async function readOutline(source: Source): Promise<OutlineNode[]> {
  try {
    const raw = await source.pdf.getOutline()
    const map = (items: typeof raw): OutlineNode[] =>
      (items ?? []).map((it) => ({
        title: it.title,
        bold: it.bold,
        italic: it.italic,
        dest: (it.dest as OutlineNode['dest']) ?? null,
        url: it.url ?? null,
        items: map(it.items as typeof raw)
      }))
    return map(raw)
  } catch {
    return []
  }
}

async function readInfo(source: Source): Promise<DocInfo> {
  const out: DocInfo = { fileSize: source.originalBytes.byteLength }
  try {
    const meta = await source.pdf.getMetadata()
    const info = (meta.info ?? {}) as Record<string, string>
    out.title = meta.metadata?.get('dc:title') || info['Title']
    out.author = info['Author']
    out.subject = info['Subject']
    out.keywords = info['Keywords']
    out.creator = info['Creator']
    out.producer = info['Producer']
    out.creationDate = info['CreationDate']
    out.modDate = info['ModDate']
    out.version = info['PDFFormatVersion']
  } catch {
    /* ignore */
  }
  return out
}

export async function openFile(file: FileInput): Promise<void> {
  const existing = Object.values(docs().docs).find(
    (d) => file.path && d.path && d.path.toLowerCase() === file.path.toLowerCase()
  )
  if (existing) {
    docs().setActive(existing.id)
    return
  }
  ui().setLoading(`Открытие ${file.name}…`)
  try {
    const loaded = await loadSource(file)
    if (!loaded) return
    const [outline, info] = await Promise.all([readOutline(loaded.source), readInfo(loaded.source)])
    const form = loaded.form
    docs().addDoc({
      id: uid('doc'),
      name: file.name,
      path: file.path,
      sourceIds: [loaded.source.id],
      primarySourceId: loaded.source.id,
      pages: loaded.pages,
      annots: loaded.annots,
      outline,
      info,
      form,
      encrypted: loaded.source.encrypted,
      protection: loaded.source.protection ?? null,
      restricted: loaded.source.restricted ?? false
    })
    ui().setMode('view')
    if (loaded.source.encrypted) {
      ui().toast('Этот тип защиты не поддерживается для редактирования: документ открыт только для просмотра.', 'info')
    }
    if (file.path) window.api.addRecent(file.path).catch(() => undefined)
  } catch (e) {
    ui().toast(`Не удалось открыть «${file.name}»: ${errorText(e)}`, 'error')
  } finally {
    ui().setLoading(null)
  }
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      await openFile(await window.api.readFile(p))
    } catch (e) {
      ui().toast(`Не удалось прочитать файл: ${errorText(e)}`, 'error')
      window.api.removeRecent(p).catch(() => undefined)
    }
  }
}

export async function openFromDialog(): Promise<void> {
  const files = await window.api.openDialog({ multi: true })
  for (const f of files) await openFile(f)
}

let fontPromise: Promise<Uint8Array | null> | null = null
function systemFont(): Promise<Uint8Array | null> {
  fontPromise ??= window.api.getSystemFont().catch(() => null)
  return fontPromise
}

function exportSources(doc: Doc): Map<string, ExportSource> {
  const map = new Map<string, ExportSource>()
  for (const id of doc.sourceIds) {
    const s = getSource(id)
    if (s) map.set(id, { id, bytes: s.bytes, encrypted: s.encrypted })
  }
  return map
}

export interface BuildOptions {
  pages?: PageRef[]
  mode?: 'preserve' | 'fresh'
  /** Apply the document's password protection (Save / Save As). */
  protect?: boolean
  flattenForm?: boolean
  /** Include comments and markup; signatures and placed images are always kept. */
  comments?: boolean
}

function withoutComments(annots: Record<string, Annot[]>): Record<string, Annot[]> {
  const out: Record<string, Annot[]> = {}
  for (const [pageId, list] of Object.entries(annots)) out[pageId] = list.filter((a) => a.type === 'image')
  return out
}

export async function buildDocBytes(doc: Doc, o: BuildOptions = {}): Promise<Uint8Array> {
  const values: Record<string, FormValue> = {}
  for (const name of doc.form.changed) values[name] = doc.form.values[name]
  const bytes = await buildPdf({
    pages: o.pages ?? doc.pages,
    annots: o.comments === false ? withoutComments(doc.annots) : doc.annots,
    sources: exportSources(doc),
    mode: o.mode ?? 'preserve',
    fontBytes: await systemFont(),
    decor: doc.decor,
    formValues: values,
    flattenForm: o.flattenForm,
    fileName: doc.name
  })
  return o.protect && doc.protection ? encryptPdf(bytes, doc.protection) : bytes
}

function baseName(name: string): string {
  return name.replace(/\.pdf$/i, '')
}

const RESTRICTED_TEXT =
  'Документ защищён от изменений. Чтобы сохранить его, введите пароль владельца в разделе «Защита».'

export async function saveDoc(id: string, saveAs = false, flattenForm = false): Promise<boolean> {
  const doc = getDoc(id)
  if (!doc) return false
  if (doc.restricted && !doc.protection?.permissions.modify) {
    ui().toast(RESTRICTED_TEXT, 'error')
    ui().setDialog({ kind: 'protect' })
    return false
  }
  let path = doc.path
  if (saveAs || flattenForm || !path) {
    const suffix = flattenForm ? '_сглаженная' : ''
    path = await window.api.saveDialog({
      defaultPath: flattenForm ? `${baseName(doc.name)}${suffix}.pdf` : (doc.path ?? `${baseName(doc.name)}.pdf`)
    })
    if (!path) return false
  }
  ui().setLoading('Сохранение…')
  try {
    const bytes = await buildDocBytes(doc, { protect: true, flattenForm })
    await window.api.writeFile(path, bytes)
    if (flattenForm) {
      ui().toast('Сохранена копия со сглаженной формой', 'success')
      return true
    }
    const name = path.split(/[\\/]/).pop() ?? doc.name
    docs().markSaved(id, path, name)
    window.api.addRecent(path).catch(() => undefined)
    ui().toast('Сохранено', 'success')
    return true
  } catch (e) {
    ui().toast(`Ошибка сохранения: ${errorText(e)}`, 'error')
    return false
  } finally {
    ui().setLoading(null)
  }
}

function askClose(names: string[]): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise((resolve) => {
    ui().setDialog({
      kind: 'confirm-close',
      names,
      resolve: (r) => {
        ui().setDialog(null)
        resolve(r)
      }
    })
  })
}

function disposeDoc(id: string): void {
  const doc = getDoc(id)
  if (!doc) return
  docs().closeDoc(id)
  for (const s of doc.sourceIds) {
    clearTextCache(s)
    releaseSource(s)
  }
  const sel = ui().selection
  if (sel?.docId === id) ui().select(null)
  if (ui().search.docId === id) ui().setSearch({ results: [], active: -1, docId: null })
}

export async function closeDoc(id: string): Promise<boolean> {
  const doc = getDoc(id)
  if (!doc) return true
  if (doc.dirty) {
    const r = await askClose([doc.name])
    if (r === 'cancel') return false
    if (r === 'save' && !(await saveDoc(id))) return false
  }
  disposeDoc(id)
  return true
}

export async function requestAppClose(): Promise<void> {
  const dirty = docs().order.map((id) => getDoc(id)!).filter((d) => d.dirty)
  if (dirty.length) {
    const r = await askClose(dirty.map((d) => d.name))
    if (r === 'cancel') return
    if (r === 'save') {
      for (const d of dirty) {
        docs().setActive(d.id)
        if (!(await saveDoc(d.id))) return
      }
    }
  }
  await window.api.confirmClose()
}

// ---------------------------------------------------------------------------
// Page organization
// ---------------------------------------------------------------------------

export function insertBlankPage(docId: string, index: number): void {
  const doc = getDoc(docId)
  if (!doc) return
  const ref = doc.pages[Math.max(0, Math.min(index - 1, doc.pages.length - 1))]
  const w = ref ? ref.view[2] - ref.view[0] : 595
  const h = ref ? ref.view[3] - ref.view[1] : 842
  const rot = ref ? ref.baseRotate + ref.rotation : 0
  const page: PageRef = { id: uid('p'), sourceId: 'blank', srcIndex: -1, view: [0, 0, w, h], baseRotate: 0, rotation: rot % 360 }
  docs().insertPages(docId, index, [page])
}

export async function insertFromFile(docId: string, index: number): Promise<void> {
  const files = await window.api.openDialog({ multi: true, title: 'Вставить страницы из PDF' })
  let at = index
  for (const f of files) {
    ui().setLoading(`Загрузка ${f.name}…`)
    try {
      const loaded = await loadSource(f)
      if (!loaded) continue
      docs().addSource(docId, loaded.source.id)
      docs().insertPages(docId, at, loaded.pages, loaded.annots)
      at += loaded.pages.length
    } catch (e) {
      ui().toast(`Не удалось вставить «${f.name}»: ${errorText(e)}`, 'error')
    } finally {
      ui().setLoading(null)
    }
  }
}

export async function extractPages(docId: string, pageIds: string[]): Promise<void> {
  const doc = getDoc(docId)
  if (!doc || !pageIds.length) return
  const ids = new Set(pageIds)
  const pages = doc.pages.filter((p) => ids.has(p.id))
  const path = await window.api.saveDialog({
    title: 'Извлечь страницы',
    defaultPath: `${baseName(doc.name)}_страницы.pdf`
  })
  if (!path) return
  ui().setLoading('Извлечение страниц…')
  try {
    await window.api.writeFile(path, await buildDocBytes(doc, { pages, mode: 'fresh' }))
    ui().toast(`Извлечено страниц: ${pages.length}`, 'success')
  } catch (e) {
    ui().toast(`Ошибка: ${errorText(e)}`, 'error')
  } finally {
    ui().setLoading(null)
  }
}

export async function splitDoc(docId: string, groups: number[][]): Promise<void> {
  const doc = getDoc(docId)
  if (!doc) return
  const dir = await window.api.directoryDialog({ title: 'Папка для частей документа' })
  if (!dir) return
  try {
    for (let g = 0; g < groups.length; g++) {
      ui().setLoading(`Разделение: часть ${g + 1} из ${groups.length}…`)
      const pages = groups[g].map((i) => doc.pages[i]).filter(Boolean)
      const path = await window.api.joinPath(dir, `${baseName(doc.name)}_часть${g + 1}.pdf`)
      await window.api.writeFile(path, await buildDocBytes(doc, { pages, mode: 'fresh' }))
    }
    ui().toast(`Создано файлов: ${groups.length}`, 'success')
    window.api.showItemInFolder(dir).catch(() => undefined)
  } catch (e) {
    ui().toast(`Ошибка разделения: ${errorText(e)}`, 'error')
  } finally {
    ui().setLoading(null)
  }
}

/** Creates a new unsaved document combining the given files in order. */
export async function mergeFiles(files: FileInput[]): Promise<void> {
  if (!files.length) return
  const sourceIds: string[] = []
  const pages: PageRef[] = []
  const annots: Record<string, Annot[]> = {}
  let outline: OutlineNode[] = []
  let info: DocInfo | null = null
  let form: FormState | undefined
  try {
    for (let i = 0; i < files.length; i++) {
      ui().setLoading(`Объединение: ${files[i].name} (${i + 1}/${files.length})…`)
      const loaded = await loadSource(files[i])
      if (!loaded) continue
      sourceIds.push(loaded.source.id)
      pages.push(...loaded.pages)
      Object.assign(annots, loaded.annots)
      if (!info) {
        outline = await readOutline(loaded.source)
        info = await readInfo(loaded.source)
        form = loaded.form
      }
    }
    if (!pages.length) return
    docs().addDoc({
      id: uid('doc'),
      name: 'Объединённый документ.pdf',
      path: null,
      sourceIds,
      primarySourceId: sourceIds[0] ?? null,
      pages,
      annots,
      outline,
      info: info ?? { fileSize: 0 },
      form,
      encrypted: sourceIds.some((s) => getSource(s)?.encrypted),
      restricted: sourceIds.some((s) => getSource(s)?.restricted),
      dirty: true
    })
    ui().setMode('organize')
  } catch (e) {
    ui().toast(`Ошибка объединения: ${errorText(e)}`, 'error')
  } finally {
    ui().setLoading(null)
  }
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** A print job is being prepared or sent; a second one would race for the dialogs. */
let printing = false

export function printDoc(docId: string): void {
  const doc = getDoc(docId)
  // Opening the print dialog over another dialog would orphan that dialog's pending promise.
  if (!doc || ui().dialog || printing) return
  if (doc.restricted && doc.protection && !doc.protection.permissions.print) {
    ui().toast('Печать этого документа запрещена владельцем.', 'error')
    return
  }
  ui().setDialog({ kind: 'print' })
}

/** The document as it will be printed (decorations, form values, optionally comments). */
export async function openPrintPdf(doc: Doc, comments: boolean): Promise<PDFDocumentProxy> {
  return loadPdf(await buildDocBytes(doc, { comments }))
}

function askFlip(): Promise<boolean> {
  return new Promise((resolve) => {
    ui().setDialog({
      kind: 'print-flip',
      resolve: (go) => {
        ui().setDialog(null)
        resolve(go)
      }
    })
  })
}

async function canvasJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('не удалось подготовить изображение листа')
  return new Uint8Array(await blob.arrayBuffer())
}

function printErrorText(reason?: string): string {
  if (!reason || reason === 'failed') return 'принтер недоступен или отклонил задание'
  if (/devicename/i.test(reason)) return 'выбранный принтер не найден'
  return reason
}


/** Prints with the app's settings; `system` shows the Windows print dialog instead. */
export async function runPrint(docId: string, settings: PrintSettings, system = false): Promise<void> {
  const doc = getDoc(docId)
  if (!doc || printing) return
  const s = normalizePrint(settings)
  const pages = selectPages(doc.pages.length, doc.view.currentPage, s)
  if (!pages?.length) {
    ui().toast('Нет страниц для печати.', 'error')
    return
  }
  const layout = sheetLayout(s, isLandscapePage(doc.pages[pages[0]]))
  const jobs = planJobs(toSheets(pages, s.perSheet), system && s.duplex === 'manual' ? { ...s, duplex: 'simplex' } : s)
  printing = true
  ui().setLoading('Подготовка к печати…')
  let pdf: PDFDocumentProxy | undefined
  let jobId: string | undefined
  try {
    pdf = await openPrintPdf(doc, s.annotations)
    jobId = await window.api.printBegin()
    const pxPerMm = s.dpi / 25.4
    // Sheets repeat across copies in manual duplex: render each one once.
    const files = new Map<string, string>()
    const unique = new Set(jobs.flatMap((j) => j.sheets.map((sh) => sh?.join(',') ?? '')))
    const passes: string[][] = []
    for (const job of jobs) {
      const list: string[] = []
      for (const sheet of job.sheets) {
        const key = sheet?.join(',') ?? ''
        let file = files.get(key)
        if (!file) {
          ui().setLoading(`Подготовка к печати: ${files.size + 1} / ${unique.size}`)
          const canvas = await renderSheet(pdf, sheet, layout, s, pxPerMm)
          const bytes = await canvasJpeg(canvas)
          canvas.width = canvas.height = 0
          file = await window.api.printAddSheet(jobId, bytes)
          files.set(key, file)
        }
        list.push(file)
      }
      passes.push(list)
    }
    pdf.loadingTask.destroy().catch(() => undefined)
    pdf = undefined
    ui().setLoading(null)
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]
      if (job.flipFirst && !(await askFlip())) return
      ui().setLoading(i ? 'Печать второй стороны…' : 'Отправка на принтер…')
      const res = await window.api.printRun(jobId, passes[i], {
        silent: !system,
        deviceName: s.printer || undefined,
        copies: job.copies,
        collate: job.collate,
        duplexMode: job.duplexMode,
        color: s.color,
        landscape: layout.landscape,
        paper: s.paper
      })
      ui().setLoading(null)
      if (!res.ok) {
        if (res.error !== 'cancelled') ui().toast(`Ошибка печати: ${printErrorText(res.error)}`, 'error')
        return
      }
    }
    if (!system) ui().toast(jobs.length > 1 ? 'Обе стороны отправлены на печать' : 'Документ отправлен на печать', 'success')
  } catch (e) {
    ui().toast(`Ошибка печати: ${errorText(e)}`, 'error')
  } finally {
    printing = false
    ui().setLoading(null)
    pdf?.loadingTask.destroy().catch(() => undefined)
    if (jobId) void window.api.printEnd(jobId)
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** Resolves a PDF destination (named or explicit) to a page in the document and scrolls there. */
export async function goToDest(docId: string, sourceId: string, dest: string | unknown[] | null): Promise<void> {
  const doc = getDoc(docId)
  const source = getSource(sourceId)
  if (!doc || !source || !dest) return
  try {
    const explicit = typeof dest === 'string' ? await source.pdf.getDestination(dest) : dest
    if (!Array.isArray(explicit) || !explicit.length) return
    const target = explicit[0]
    let srcIndex: number
    if (typeof target === 'number') srcIndex = target
    else srcIndex = await source.pdf.getPageIndex(target as never)
    const pageIndex = doc.pages.findIndex((p) => p.sourceId === sourceId && p.srcIndex === srcIndex)
    if (pageIndex < 0) return
    const kind = (explicit[1] as { name?: string } | undefined)?.name
    let point: [number, number] | null = null
    if (kind === 'XYZ' && typeof explicit[3] === 'number') point = [(explicit[2] as number) ?? 0, explicit[3] as number]
    else if ((kind === 'FitH' || kind === 'FitBH') && typeof explicit[2] === 'number') point = [0, explicit[2] as number]
    getViewer(docId)?.scrollToPage(pageIndex, point)
  } catch {
    /* broken destination */
  }
}

// ---------------------------------------------------------------------------
// Protection
// ---------------------------------------------------------------------------

/** Checks the owner password of a restricted document and lifts the restrictions. */
export async function unlockWithOwnerPassword(docId: string, password: string): Promise<boolean> {
  const doc = getDoc(docId)
  const source = doc?.primarySourceId ? getSource(doc.primarySourceId) : undefined
  if (!doc || !source) return false
  try {
    const res = await decryptPdf(source.originalBytes, password)
    if (res.restricted) return false
    docs().unlock(docId, res.protection)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface PickedImage {
  src: string
  width: number
  height: number
}

/** Loads an image file as PNG/JPEG data URL (other formats are converted to PNG). */
export function readImageFile(file: File): Promise<PickedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const url = String(reader.result)
      const img = new Image()
      img.onerror = () => reject(new Error('Не удалось прочитать изображение'))
      img.onload = () => {
        if (/^data:image\/(png|jpeg);/.test(url)) {
          resolve({ src: url, width: img.naturalWidth, height: img.naturalHeight })
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        resolve({ src: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight })
      }
      img.src = url
    }
    reader.readAsDataURL(file)
  })
}

export function pickImage(): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      readImageFile(f).then(resolve, (e) => {
        ui().toast(errorText(e), 'error')
        resolve(null)
      })
    }
    input.click()
  })
}

/** Starts placing an image (or a signature) on the next click in a page. */
export async function startImagePlacement(signature = false, picked?: PickedImage | null): Promise<void> {
  const img = picked ?? (await pickImage())
  if (!img) return
  ui().setPendingImage({ ...img, signature })
  ui().setTool('image')
}
