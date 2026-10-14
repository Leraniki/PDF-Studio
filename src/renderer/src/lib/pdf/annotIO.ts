import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRef,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
  type PDFImage,
  type PDFObject
} from 'pdf-lib'
import type { Annot, AnnotType } from '../model'
import { hexToRgb, rgbToHex, uid } from '../model'
import { boundsOfPoints, normalizeRect, unionRects, type Rect } from './coords'
import { parseDataUrl, toDataUrl } from '../base64'
import { readFormInfo, type FormInfo } from './formInfo'

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const SUBTYPE_TO_TYPE: Record<string, AnnotType> = {
  Highlight: 'highlight',
  Underline: 'underline',
  StrikeOut: 'strikeout',
  Text: 'note',
  FreeText: 'freetext',
  Ink: 'ink',
  Square: 'rect',
  Circle: 'ellipse',
  Line: 'line',
  Stamp: 'stamp'
}

function num(o: PDFObject | undefined): number | undefined {
  return o instanceof PDFNumber ? o.asNumber() : undefined
}

function numbers(arr: PDFArray | undefined): number[] {
  if (!arr) return []
  const out: number[] = []
  for (let i = 0; i < arr.size(); i++) {
    const v = num(arr.lookup(i))
    if (v !== undefined) out.push(v)
  }
  return out
}

function text(o: PDFObject | undefined): string {
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : ''
}

function date(o: PDFObject | undefined): number | undefined {
  try {
    return o instanceof PDFString || o instanceof PDFHexString ? o.decodeDate().getTime() : undefined
  } catch {
    return undefined
  }
}

function colorOf(arr: PDFArray | undefined, fallback: string): string {
  const c = numbers(arr)
  if (c.length === 3) return rgbToHex(c[0], c[1], c[2])
  if (c.length === 1) return rgbToHex(c[0], c[0], c[0])
  if (c.length === 4) return rgbToHex((1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3]))
  return fallback
}

function lookupArray(dict: PDFDict, key: string): PDFArray | undefined {
  const v = dict.lookup(PDFName.of(key))
  return v instanceof PDFArray ? v : undefined
}

function lookupDict(dict: PDFDict, key: string): PDFDict | undefined {
  const v = dict.lookup(PDFName.of(key))
  return v instanceof PDFDict ? v : undefined
}

/** Converts a PDF annotation dictionary into the editable model, or null if unsupported. */
export function parseAnnotation(dict: PDFDict): Annot | null {
  const subtype = dict.lookup(PDFName.of('Subtype'))
  if (!(subtype instanceof PDFName)) return null
  const type = SUBTYPE_TO_TYPE[subtype.decodeText()]
  if (!type) return null

  // Stamps from other tools carry arbitrary artwork we cannot reproduce: keep them as-is.
  const label = text(dict.lookup(PDFName.of('PSLabel')))
  const imageStream = dict.lookup(PDFName.of('PSImage'))
  const image = imageStream instanceof PDFRawStream ? readImage(imageStream) : null
  if (type === 'stamp' && !label && !image) return null

  const rectNums = numbers(lookupArray(dict, 'Rect'))
  if (rectNums.length !== 4) return null
  const rect = normalizeRect(rectNums as Rect)

  const created = date(dict.lookup(PDFName.of('CreationDate'))) ?? date(dict.lookup(PDFName.of('M'))) ?? Date.now()
  const opacity = num(dict.lookup(PDFName.of('CA'))) ?? 1
  const bs = lookupDict(dict, 'BS')
  const width = (bs && num(bs.lookup(PDFName.of('W')))) ?? num(lookupArray(dict, 'Border')?.lookup(2)) ?? 1

  const a: Annot = {
    id: text(dict.lookup(PDFName.of('NM'))) || uid('a'),
    type,
    rect,
    color: colorOf(lookupArray(dict, 'C'), type === 'highlight' ? '#ffd84d' : '#ff6b5b'),
    opacity,
    author: text(dict.lookup(PDFName.of('T'))),
    contents: text(dict.lookup(PDFName.of('Contents'))),
    created,
    modified: date(dict.lookup(PDFName.of('M'))) ?? created
  }

  switch (type) {
    case 'highlight':
    case 'underline':
    case 'strikeout': {
      const q = numbers(lookupArray(dict, 'QuadPoints'))
      const quads: Rect[] = []
      for (let i = 0; i + 7 < q.length; i += 8) {
        quads.push(boundsOfPoints(q.slice(i, i + 8)))
      }
      a.quads = quads.length ? quads : [rect]
      break
    }
    case 'ink': {
      const list = lookupArray(dict, 'InkList')
      const paths: number[][] = []
      if (list) {
        for (let i = 0; i < list.size(); i++) {
          const p = list.lookup(i)
          if (p instanceof PDFArray) paths.push(numbers(p))
        }
      }
      a.paths = paths
      a.width = width
      break
    }
    case 'rect':
    case 'ellipse': {
      const ic = lookupArray(dict, 'IC')
      a.fill = ic && ic.size() ? colorOf(ic, '#ffffff') : null
      a.width = width
      break
    }
    case 'line': {
      const l = numbers(lookupArray(dict, 'L'))
      if (l.length === 4) a.line = l as [number, number, number, number]
      else a.line = [rect[0], rect[1], rect[2], rect[3]]
      const le = lookupArray(dict, 'LE')
      const end = le?.lookup(1)
      if (end instanceof PDFName && end.decodeText() !== 'None') a.type = 'arrow'
      a.width = width
      break
    }
    case 'freetext': {
      const da = text(dict.lookup(PDFName.of('DA')))
      const size = /([\d.]+)\s+Tf/.exec(da)
      a.fontSize = size ? parseFloat(size[1]) : 12
      const rgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da)
      if (rgb) a.color = rgbToHex(+rgb[1], +rgb[2], +rgb[3])
      break
    }
    case 'stamp':
      if (image) {
        a.type = 'image'
        a.image = image
        const kind = dict.lookup(PDFName.of('PSKind'))
        a.signature = kind instanceof PDFName && kind.decodeText() === 'Signature'
      } else {
        a.label = label
      }
      break
    case 'note':
      break
  }
  return a
}

function readImage(stream: PDFRawStream): string | null {
  try {
    const mime = stream.dict.lookup(PDFName.of('PSMime'))
    const type = mime instanceof PDFName ? mime.decodeText() : 'png'
    const bytes = stream.dict.has(PDFName.of('Filter')) ? decodePDFRawStream(stream).decode() : stream.contents
    return toDataUrl(`image/${type}`, bytes)
  } catch {
    return null
  }
}

export interface ImportResult {
  /** Bytes with imported annotations removed (or the original bytes). */
  bytes: Uint8Array
  /** Annotations per 0-based page index. */
  annots: Map<number, Annot[]>
  /** AcroForm fields, or null when the file could not be parsed. */
  form: FormInfo | null
}

/**
 * Moves supported markup annotations out of the file into the editable model, so they
 * are drawn (and edited) by the app instead of being baked into the rendered canvas.
 */
export async function importAnnotations(bytes: Uint8Array): Promise<ImportResult> {
  const annots = new Map<number, Annot[]>()
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch {
    return { bytes, annots, form: null }
  }
  if (doc.isEncrypted) return { bytes, annots, form: null }
  const form = readFormInfo(doc)

  let changed = false
  doc.getPages().forEach((page, index) => {
    const arr = page.node.Annots()
    if (!arr) return
    const removed = new Set<string>()
    const keep: PDFObject[] = []
    const parsed: Annot[] = []
    for (let i = 0; i < arr.size(); i++) {
      const raw = arr.get(i)
      const dict = arr.lookup(i)
      if (!(dict instanceof PDFDict)) {
        keep.push(raw)
        continue
      }
      const a = parseAnnotation(dict)
      if (a) {
        parsed.push(a)
        if (raw instanceof PDFRef) removed.add(raw.toString())
      } else {
        keep.push(raw)
      }
    }
    if (!parsed.length) return
    // Drop popups that belonged to removed annotations.
    const finalKeep = keep.filter((raw) => {
      const d = raw instanceof PDFRef ? doc.context.lookup(raw) : raw
      if (!(d instanceof PDFDict)) return true
      const sub = d.lookup(PDFName.of('Subtype'))
      if (sub instanceof PDFName && sub.decodeText() === 'Popup') {
        const parent = d.get(PDFName.of('Parent'))
        return !(parent instanceof PDFRef && removed.has(parent.toString()))
      }
      return true
    })
    page.node.set(PDFName.of('Annots'), doc.context.obj(finalKeep))
    annots.set(index, parsed)
    changed = true
  })

  if (!changed) return { bytes, annots, form }
  try {
    const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false })
    return { bytes: out, annots, form }
  } catch {
    return { bytes, annots: new Map(), form }
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const f = (n: number): string => (Math.round(n * 1000) / 1000).toString()

function rgbOp(hex: string, op: 'rg' | 'RG'): string {
  const [r, g, b] = hexToRgb(hex)
  return `${f(r)} ${f(g)} ${f(b)} ${op}`
}

function pdfDate(ms: number): PDFString {
  return PDFString.fromDate(new Date(ms))
}

const KAPPA = 0.5522847498

function ellipsePath(r: Rect): string {
  const [x0, y0, x1, y1] = r
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2
  const ry = (y1 - y0) / 2
  const ox = rx * KAPPA
  const oy = ry * KAPPA
  return [
    `${f(cx - rx)} ${f(cy)} m`,
    `${f(cx - rx)} ${f(cy + oy)} ${f(cx - ox)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c`,
    `${f(cx + ox)} ${f(cy + ry)} ${f(cx + rx)} ${f(cy + oy)} ${f(cx + rx)} ${f(cy)} c`,
    `${f(cx + rx)} ${f(cy - oy)} ${f(cx + ox)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c`,
    `${f(cx - ox)} ${f(cy - ry)} ${f(cx - rx)} ${f(cy - oy)} ${f(cx - rx)} ${f(cy)} c`,
    'h'
  ].join('\n')
}

/** Arrow head points for a line ending at (x2, y2). */
export function arrowHead(line: [number, number, number, number], width: number): number[] {
  const [x1, y1, x2, y2] = line
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const len = Math.max(8, width * 4 + 4)
  const spread = Math.PI / 7
  return [
    x2 - len * Math.cos(ang - spread),
    y2 - len * Math.sin(ang - spread),
    x2,
    y2,
    x2 - len * Math.cos(ang + spread),
    y2 - len * Math.sin(ang + spread)
  ]
}

/** Splits text into lines that fit `maxWidth` using the given measure function. */
export function wrapText(value: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const para of value.split(/\r?\n/)) {
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      const next = line + w
      if (line && measure(next.trimEnd()) > maxWidth) {
        lines.push(line.trimEnd())
        line = w.trimStart()
      } else {
        line = next
      }
    }
    lines.push(line.trimEnd())
  }
  return lines
}

export const FREETEXT_PAD = 4

export interface WriteContext {
  doc: PDFDocument
  font: PDFFont | null
}

function measure(ctx: WriteContext, s: string, size: number): number {
  if (ctx.font) {
    try {
      return ctx.font.widthOfTextAtSize(s, size)
    } catch {
      /* fall through */
    }
  }
  return s.length * size * 0.5
}

function encode(ctx: WriteContext, s: string): string {
  if (!ctx.font) return '<>'
  try {
    return ctx.font.encodeText(s).toString()
  } catch {
    return '<>'
  }
}

function appearance(a: Annot, ctx: WriteContext, image?: PDFImage): { content: string; bbox: Rect; resources: Record<string, unknown> } {
  const gs: Record<string, unknown> = { CA: a.opacity, ca: a.opacity }
  const extras: Record<string, unknown> = {}
  const lines: string[] = ['q', '/GS0 gs']
  let bbox: Rect = a.rect

  switch (a.type) {
    case 'highlight': {
      gs['BM'] = PDFName.of('Multiply')
      lines.push(rgbOp(a.color, 'rg'))
      for (const q of a.quads ?? [a.rect]) lines.push(`${f(q[0])} ${f(q[1])} ${f(q[2] - q[0])} ${f(q[3] - q[1])} re f`)
      break
    }
    case 'underline':
    case 'strikeout': {
      lines.push(rgbOp(a.color, 'RG'))
      for (const q of a.quads ?? [a.rect]) {
        const h = q[3] - q[1]
        const w = Math.max(0.5, h * 0.07)
        const y = a.type === 'underline' ? q[1] + h * 0.08 : q[1] + h * 0.45
        lines.push(`${f(w)} w ${f(q[0])} ${f(y)} m ${f(q[2])} ${f(y)} l S`)
      }
      break
    }
    case 'ink': {
      lines.push(rgbOp(a.color, 'RG'), `${f(a.width ?? 2)} w 1 J 1 j`)
      for (const p of a.paths ?? []) {
        if (p.length < 2) continue
        lines.push(`${f(p[0])} ${f(p[1])} m`)
        if (p.length === 2) lines.push(`${f(p[0] + 0.01)} ${f(p[1])} l`)
        for (let i = 2; i + 1 < p.length; i += 2) lines.push(`${f(p[i])} ${f(p[i + 1])} l`)
        lines.push('S')
      }
      break
    }
    case 'rect':
    case 'ellipse': {
      const w = a.width ?? 2
      const inner: Rect = [a.rect[0] + w / 2, a.rect[1] + w / 2, a.rect[2] - w / 2, a.rect[3] - w / 2]
      lines.push(rgbOp(a.color, 'RG'), `${f(w)} w`)
      if (a.fill) lines.push(rgbOp(a.fill, 'rg'))
      const op = a.fill ? (w > 0 ? 'B' : 'f') : 'S'
      if (a.type === 'rect') {
        lines.push(`${f(inner[0])} ${f(inner[1])} ${f(inner[2] - inner[0])} ${f(inner[3] - inner[1])} re ${op}`)
      } else {
        lines.push(ellipsePath(inner), op)
      }
      break
    }
    case 'line':
    case 'arrow': {
      const l = a.line ?? [a.rect[0], a.rect[1], a.rect[2], a.rect[3]]
      const w = a.width ?? 2
      lines.push(rgbOp(a.color, 'RG'), `${f(w)} w 1 J 1 j`, `${f(l[0])} ${f(l[1])} m ${f(l[2])} ${f(l[3])} l S`)
      if (a.type === 'arrow') {
        const h = arrowHead(l, w)
        lines.push(`${f(h[0])} ${f(h[1])} m ${f(h[2])} ${f(h[3])} l ${f(h[4])} ${f(h[5])} l S`)
      }
      break
    }
    case 'note': {
      const [x0, y0, x1, y1] = a.rect
      const w = x1 - x0
      const h = y1 - y0
      lines.push(
        rgbOp(a.color, 'rg'),
        '0.2 0.2 0.2 RG 0.8 w 1 j',
        `${f(x0 + 1)} ${f(y0 + h * 0.3)} m ${f(x1 - 1)} ${f(y0 + h * 0.3)} l ${f(x1 - 1)} ${f(y1 - 1)} l ${f(x0 + 1)} ${f(y1 - 1)} l ${f(x0 + 1)} ${f(y0 + h * 0.3)} l h`,
        `${f(x0 + w * 0.25)} ${f(y0 + h * 0.3)} m ${f(x0 + w * 0.2)} ${f(y0 + 1)} l ${f(x0 + w * 0.5)} ${f(y0 + h * 0.3)} l B`,
        `${f(x0 + w * 0.2)} ${f(y0 + h * 0.75)} m ${f(x1 - w * 0.2)} ${f(y0 + h * 0.75)} l S`,
        `${f(x0 + w * 0.2)} ${f(y0 + h * 0.55)} m ${f(x1 - w * 0.3)} ${f(y0 + h * 0.55)} l S`
      )
      break
    }
    case 'freetext': {
      const size = a.fontSize ?? 12
      const [x0, y0, x1, y1] = a.rect
      const wrapped = wrapText(a.contents, x1 - x0 - FREETEXT_PAD * 2, (s) => measure(ctx, s, size))
      lines.push(`${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)} re W n`, 'BT', `/F1 ${f(size)} Tf`, rgbOp(a.color, 'rg'))
      let y = y1 - FREETEXT_PAD - size * 0.9
      lines.push(`${f(x0 + FREETEXT_PAD)} ${f(y)} Td`)
      wrapped.forEach((ln, i) => {
        if (i > 0) {
          lines.push(`0 ${f(-size * 1.2)} Td`)
          y -= size * 1.2
        }
        lines.push(`${encode(ctx, ln)} Tj`)
      })
      lines.push('ET')
      if (ctx.font) extras['Font'] = { F1: ctx.font.ref }
      break
    }
    case 'stamp': {
      const [x0, y0, x1, y1] = a.rect
      const label = a.label ?? 'STAMP'
      const h = y1 - y0
      const bw = Math.max(1.5, h * 0.06)
      let size = h * 0.5
      const tw = measure(ctx, label, size)
      const maxW = x1 - x0 - h * 0.4
      if (tw > maxW) size *= maxW / tw
      const textW = measure(ctx, label, size)
      const r = Math.min(h * 0.18, 8)
      const ix0 = x0 + bw / 2, iy0 = y0 + bw / 2, ix1 = x1 - bw / 2, iy1 = y1 - bw / 2
      lines.push(
        rgbOp(a.color, 'RG'),
        rgbOp(a.color, 'rg'),
        `${f(bw)} w`,
        `${f(ix0 + r)} ${f(iy0)} m ${f(ix1 - r)} ${f(iy0)} l ${f(ix1)} ${f(iy0)} ${f(ix1)} ${f(iy0 + r)} v`,
        `${f(ix1)} ${f(iy1 - r)} l ${f(ix1)} ${f(iy1)} ${f(ix1 - r)} ${f(iy1)} v`,
        `${f(ix0 + r)} ${f(iy1)} l ${f(ix0)} ${f(iy1)} ${f(ix0)} ${f(iy1 - r)} v`,
        `${f(ix0)} ${f(iy0 + r)} l ${f(ix0)} ${f(iy0)} ${f(ix0 + r)} ${f(iy0)} v h S`,
        'BT',
        `/F1 ${f(size)} Tf 2 Tr ${f(size * 0.04)} w`,
        `${f((x0 + x1) / 2 - textW / 2)} ${f(y0 + h / 2 - size * 0.35)} Td`,
        `${encode(ctx, label)} Tj`,
        'ET'
      )
      if (ctx.font) extras['Font'] = { F1: ctx.font.ref }
      break
    }
  }
  if (a.type === 'image' && image) {
    const [x0, y0, x1, y1] = a.rect
    lines.push(`${f(x1 - x0)} 0 0 ${f(y1 - y0)} ${f(x0)} ${f(y0)} cm`, '/Im0 Do')
    extras['XObject'] = { Im0: image.ref }
  }
  lines.push('Q')
  if (a.type === 'ink' || a.type === 'line' || a.type === 'arrow') {
    const pad = (a.width ?? 2) * 4 + 8
    bbox = [a.rect[0] - pad, a.rect[1] - pad, a.rect[2] + pad, a.rect[3] + pad]
  }
  return { content: lines.join('\n'), bbox, resources: { ExtGState: { GS0: gs }, ...extras } }
}

const TYPE_TO_SUBTYPE: Record<AnnotType, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  note: 'Text',
  freetext: 'FreeText',
  ink: 'Ink',
  rect: 'Square',
  ellipse: 'Circle',
  line: 'Line',
  arrow: 'Line',
  stamp: 'Stamp',
  image: 'Stamp'
}

/** Builds a real PDF annotation (with appearance stream) and attaches it to the page. */
export async function writeAnnotation(ctx: WriteContext, page: PDFPage, a: Annot): Promise<PDFRef> {
  const context = ctx.doc.context
  let image: PDFImage | undefined
  let original: { mime: string; bytes: Uint8Array } | null = null
  if (a.type === 'image' && a.image) {
    original = parseDataUrl(a.image)
    if (original) {
      image = original.mime === 'image/jpeg' ? await ctx.doc.embedJpg(original.bytes) : await ctx.doc.embedPng(original.bytes)
    }
  }
  const ap = appearance(a, ctx, image)
  const [r, g, b] = hexToRgb(a.color)
  const rect = a.type === 'ink' || a.type === 'line' || a.type === 'arrow' ? ap.bbox : a.rect

  const apStream = context.flateStream(ap.content, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: ap.bbox,
    Resources: ap.resources
  } as never)
  const apRef = context.register(apStream)

  const dict: Record<string, unknown> = {
    Type: 'Annot',
    Subtype: TYPE_TO_SUBTYPE[a.type],
    Rect: rect,
    C: [r, g, b],
    CA: a.opacity,
    F: 4,
    NM: PDFHexString.fromText(a.id),
    T: PDFHexString.fromText(a.author || ''),
    Contents: PDFHexString.fromText(a.contents || ''),
    CreationDate: pdfDate(a.created),
    M: pdfDate(a.modified),
    P: page.ref,
    AP: { N: apRef }
  }

  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout': {
      const qp: number[] = []
      for (const q of a.quads ?? [a.rect]) qp.push(q[0], q[3], q[2], q[3], q[0], q[1], q[2], q[1])
      dict['QuadPoints'] = qp
      break
    }
    case 'ink':
      dict['InkList'] = a.paths ?? []
      dict['BS'] = { Type: 'Border', W: a.width ?? 2, S: 'S' }
      break
    case 'rect':
    case 'ellipse':
      dict['BS'] = { Type: 'Border', W: a.width ?? 2, S: 'S' }
      if (a.fill) dict['IC'] = hexToRgb(a.fill)
      break
    case 'line':
    case 'arrow':
      dict['L'] = a.line ?? [a.rect[0], a.rect[1], a.rect[2], a.rect[3]]
      dict['BS'] = { Type: 'Border', W: a.width ?? 2, S: 'S' }
      dict['LE'] = [PDFName.of('None'), PDFName.of(a.type === 'arrow' ? 'OpenArrow' : 'None')]
      break
    case 'note':
      dict['Name'] = 'Comment'
      dict['Open'] = false
      break
    case 'freetext':
      dict['DA'] = PDFString.of(`/Helv ${f(a.fontSize ?? 12)} Tf ${rgbOp(a.color, 'rg')}`)
      dict['Q'] = 0
      dict['BS'] = { W: 0 }
      break
    case 'stamp':
      dict['Name'] = 'Draft'
      dict['PSLabel'] = PDFHexString.fromText(a.label ?? '')
      break
    case 'image':
      dict['Name'] = a.signature ? 'SHSignHere' : 'Image'
      dict['PSKind'] = a.signature ? 'Signature' : 'Image'
      if (original) {
        // Keep the original file so the image stays editable after reopening.
        const mime = original.mime === 'image/jpeg' ? 'jpeg' : 'png'
        dict['PSImage'] = context.register(context.stream(original.bytes, { PSMime: mime } as never))
      }
      break
  }

  const ref = context.register(context.obj(dict as never))
  page.node.addAnnot(ref)
  return ref
}

/** Bounding box for an annotation from its geometry. */
export function computeRect(a: Annot): Rect {
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return a.quads?.length ? unionRects(a.quads) : a.rect
    case 'ink':
      return boundsOfPoints((a.paths ?? []).flat(), (a.width ?? 2) / 2)
    case 'line':
    case 'arrow':
      return a.line ? boundsOfPoints(a.line, (a.width ?? 2) / 2) : a.rect
    default:
      return normalizeRect(a.rect)
  }
}
