import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFImage,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb
} from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { Annot, Decorations, FormValue, PageRef } from '../model'
import { hexToRgb } from '../model'
import { apply, invert, normRotation, viewportTransform } from './coords'
import { writeAnnotation, type WriteContext } from './annotIO'
import { decorItems, hasDecor, type DecorItem } from '../decor'
import { parseDataUrl } from '../base64'

export { parseRanges } from '../ranges'

export interface ExportSource {
  id: string
  bytes: Uint8Array
  /** Encrypted and not decryptable by the app: cannot be rewritten. */
  encrypted: boolean
}

export interface ExportOptions {
  pages: PageRef[]
  annots: Record<string, Annot[]>
  sources: Map<string, ExportSource>
  /**
   * 'preserve' keeps document-level data of the first source (bookmarks, forms,
   * metadata) and is used for Save. 'fresh' builds a clean file with only the
   * given pages and is used for extract / split.
   */
  mode: 'preserve' | 'fresh'
  fontBytes?: Uint8Array | null
  title?: string
  decor?: Decorations | null
  /** Form values by fully qualified field name (applied in 'preserve' mode). */
  formValues?: Record<string, FormValue>
  /** Burn form fields into page content. */
  flattenForm?: boolean
  fileName?: string
}

export class EncryptedSaveError extends Error {
  constructor() {
    super('Этот зашифрованный документ нельзя сохранить: тип защиты не поддерживается.')
  }
}

function needsFont(opts: ExportOptions): boolean {
  if (hasDecor(opts.decor)) return true
  if (opts.formValues && Object.keys(opts.formValues).length) return true
  return opts.pages.some((p) => (opts.annots[p.id] ?? []).some((a) => a.type === 'freetext' || a.type === 'stamp'))
}

export async function buildPdf(opts: ExportOptions): Promise<Uint8Array> {
  const { pages, annots, sources } = opts
  for (const p of pages) {
    const s = sources.get(p.sourceId)
    if (s?.encrypted) throw new EncryptedSaveError()
  }

  const loaded = new Map<string, PDFDocument>()
  // `key` lets the primary document be loaded twice: once as the output base and
  // once as a pristine copy source for duplicated pages.
  const load = async (id: string, key = id): Promise<PDFDocument> => {
    let d = loaded.get(key)
    if (!d) {
      d = await PDFDocument.load(sources.get(id)!.bytes, { updateMetadata: false })
      loaded.set(key, d)
    }
    return d
  }

  const primaryId = pages.find((p) => sources.has(p.sourceId))?.sourceId
  const preserve = opts.mode === 'preserve' && !!primaryId
  let out: PDFDocument
  let basePages: PDFPage[] = []
  if (preserve) {
    out = await load(primaryId!)
    basePages = out.getPages()
    for (let i = out.getPageCount() - 1; i >= 0; i--) out.removePage(i)
  } else {
    out = await PDFDocument.create({ updateMetadata: false })
    if (primaryId) {
      const src = await load(primaryId)
      const title = src.getTitle()
      if (title) out.setTitle(title)
      const author = src.getAuthor()
      if (author) out.setAuthor(author)
    }
  }
  if (opts.title) out.setTitle(opts.title)
  out.setProducer('PDF Studio')
  out.setModificationDate(new Date())

  const used = new Set<number>()
  for (const p of pages) {
    let page: PDFPage
    if (!sources.has(p.sourceId)) {
      const w = p.view[2] - p.view[0]
      const h = p.view[3] - p.view[1]
      page = out.addPage([w, h])
    } else if (preserve && p.sourceId === primaryId && !used.has(p.srcIndex)) {
      used.add(p.srcIndex)
      page = basePages[p.srcIndex]
      out.addPage(page)
    } else {
      const isBase = preserve && p.sourceId === primaryId
      const src = await load(p.sourceId, isBase ? `${p.sourceId}#copy` : p.sourceId)
      const [copy] = await out.copyPages(src, [p.srcIndex])
      page = out.addPage(copy)
    }
    page.setRotation(degrees(normRotation(p.baseRotate + p.rotation)))
  }

  let font: PDFFont | null = null
  if (needsFont(opts) && opts.fontBytes) {
    out.registerFontkit(fontkit)
    try {
      font = await out.embedFont(opts.fontBytes, { subset: true })
    } catch {
      font = null
    }
  }

  const outPages = out.getPages()

  if (preserve && opts.formValues && (Object.keys(opts.formValues).length || opts.flattenForm)) {
    await applyForm(out, opts.formValues, font, !!opts.flattenForm)
  }

  if (hasDecor(opts.decor)) {
    const decorFont = font ?? (await out.embedFont(StandardFonts.Helvetica))
    const images = new Map<string, PDFImage | null>()
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]
      const rot = normRotation(p.baseRotate + p.rotation)
      const size = rot % 180 ? [p.view[3] - p.view[1], p.view[2] - p.view[0]] : [p.view[2] - p.view[0], p.view[3] - p.view[1]]
      const items = decorItems(opts.decor!, size[0], size[1], {
        pageIndex: i,
        pageCount: pages.length,
        fileName: opts.fileName ?? '',
        date: new Date()
      })
      await drawDecor(out, outPages[i], p, items, decorFont, images)
    }
  }

  const ctx: WriteContext = { doc: out, font }
  for (let i = 0; i < pages.length; i++) {
    for (const a of annots[pages[i].id] ?? []) await writeAnnotation(ctx, outPages[i], a)
  }

  return out.save({ useObjectStreams: true, updateFieldAppearances: false })
}

// ---------------------------------------------------------------------------
// Decorations: display-space items → PDF user space
// ---------------------------------------------------------------------------

async function drawDecor(
  doc: PDFDocument,
  page: PDFPage,
  ref: PageRef,
  items: DecorItem[],
  font: PDFFont,
  images: Map<string, PDFImage | null>
): Promise<void> {
  const R = normRotation(ref.baseRotate + ref.rotation)
  const inv = invert(viewportTransform(ref.view, 1, R))
  for (const it of items) {
    const t = (it.angle * Math.PI) / 180
    // Text direction and "down" vector in display space (y grows downwards).
    const u = [Math.cos(t), -Math.sin(t)]
    const v = [Math.sin(t), Math.cos(t)]
    if (it.kind === 'text') {
      let width: number
      try {
        width = font.widthOfTextAtSize(it.text, it.size)
      } catch {
        continue // glyphs missing in the fallback font
      }
      const along = it.anchor === 'start' ? 0 : it.anchor === 'middle' ? -width / 2 : -width
      const down = it.middle ? it.size * 0.35 : 0
      const sx = it.x + u[0] * along + v[0] * down
      const sy = it.y + u[1] * along + v[1] * down
      const [x, y] = apply(inv, sx, sy)
      const [r, g, b] = hexToRgb(it.color)
      try {
        page.drawText(it.text, { x, y, size: it.size, font, color: rgb(r, g, b), opacity: it.opacity, rotate: degrees(it.angle + R) })
      } catch {
        /* unsupported characters */
      }
    } else {
      let img = images.get(it.src)
      if (img === undefined) {
        const parsed = parseDataUrl(it.src)
        try {
          img = parsed ? (parsed.mime === 'image/jpeg' ? await doc.embedJpg(parsed.bytes) : await doc.embedPng(parsed.bytes)) : null
        } catch {
          img = null
        }
        images.set(it.src, img)
      }
      if (!img) continue
      // Bottom-left corner of the (rotated) image box.
      const cx = it.cx - u[0] * (it.w / 2) + v[0] * (it.h / 2)
      const cy = it.cy - u[1] * (it.w / 2) + v[1] * (it.h / 2)
      const [x, y] = apply(inv, cx, cy)
      page.drawImage(img, { x, y, width: it.w, height: it.h, opacity: it.opacity, rotate: degrees(it.angle + R) })
    }
  }
}

// ---------------------------------------------------------------------------
// AcroForm
// ---------------------------------------------------------------------------

async function applyForm(
  doc: PDFDocument,
  values: Record<string, FormValue>,
  font: PDFFont | null,
  flatten: boolean
): Promise<void> {
  let form
  try {
    form = doc.getForm()
  } catch {
    return
  }
  for (const [name, value] of Object.entries(values)) {
    let field
    try {
      field = form.getFieldMaybe(name)
    } catch {
      field = undefined
    }
    if (!field) continue
    try {
      if (field instanceof PDFTextField) {
        const text = Array.isArray(value) ? value.join(', ') : value
        const max = field.getMaxLength()
        field.setText(max !== undefined ? text.slice(0, max) : text)
      } else if (field instanceof PDFCheckBox) {
        if (value && value !== 'Off') field.check()
        else field.uncheck()
      } else if (field instanceof PDFRadioGroup) {
        if (!value || value === 'Off') field.clear()
        else field.select(String(value))
      } else if (field instanceof PDFDropdown) {
        const v = Array.isArray(value) ? value : value ? [value] : []
        if (v.length) field.select(v.length === 1 ? v[0] : v)
        else field.clear()
      } else if (field instanceof PDFOptionList) {
        const v = Array.isArray(value) ? value : value ? [value] : []
        if (v.length) field.select(v)
        else field.clear()
      }
    } catch {
      /* value not accepted by this field */
    }
  }
  try {
    if (font) form.updateFieldAppearances(font)
    else form.updateFieldAppearances()
  } catch {
    /* keep existing appearances */
  }
  if (flatten) {
    try {
      form.flatten({ updateFieldAppearances: false })
    } catch {
      /* broken form structure */
    }
  }
}
