import type { Rect } from './pdf/coords'

export type AnnotType =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'freetext'
  | 'ink'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'stamp'
  | 'image'

export interface Annot {
  id: string
  type: AnnotType
  /** Bounding box in PDF user space of the unrotated page. */
  rect: Rect
  color: string
  opacity: number
  author: string
  contents: string
  created: number
  modified: number
  /** Text markup: one rect per line. */
  quads?: Rect[]
  /** Ink: list of strokes, each a flat [x, y, x, y, ...] list. */
  paths?: number[][]
  /** Line / arrow: [x1, y1, x2, y2]. */
  line?: [number, number, number, number]
  /** Stroke width in points (ink, shapes, lines). */
  width?: number
  /** Fill color for rect / ellipse, null for none. */
  fill?: string | null
  /** Free text font size in points. */
  fontSize?: number
  /** Stamp label. */
  label?: string
  /** Image annotation: PNG or JPEG data URL. */
  image?: string
  /** Image annotation placed as a signature. */
  signature?: boolean
}

export interface PageRef {
  /** Stable id that survives reordering. */
  id: string
  sourceId: string
  /** 0-based index in the source document (-1 for blank pages). */
  srcIndex: number
  /** Page view box (crop box) in PDF user space. */
  view: Rect
  /** Intrinsic /Rotate of the source page. */
  baseRotate: number
  /** Extra rotation applied by the user in this document. */
  rotation: number
}

export type Tool =
  | 'select'
  | 'hand'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'note'
  | 'freetext'
  | 'ink'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'stamp'
  | 'image'

export const MARKUP_TOOLS: Tool[] = ['highlight', 'underline', 'strikeout']
export const DRAW_TOOLS: Tool[] = ['note', 'freetext', 'ink', 'rect', 'ellipse', 'line', 'arrow', 'stamp', 'image']

export const STAMPS = ['УТВЕРЖДЕНО', 'ОТКЛОНЕНО', 'ЧЕРНОВИК', 'КОНФИДЕНЦИАЛЬНО', 'ОКОНЧАТЕЛЬНО', 'ПРОВЕРЕНО', 'КОПИЯ']

export const PALETTE = ['#ffd84d', '#7ee081', '#6ec8ff', '#ff8fb1', '#ff6b5b', '#b18cff', '#1f1f1f', '#ffffff']

let counter = 0
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0')
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export const ANNOT_LABELS: Record<AnnotType, string> = {
  highlight: 'Выделение',
  underline: 'Подчёркивание',
  strikeout: 'Зачёркивание',
  note: 'Заметка',
  freetext: 'Текст',
  ink: 'Рисунок',
  rect: 'Прямоугольник',
  ellipse: 'Эллипс',
  line: 'Линия',
  arrow: 'Стрелка',
  stamp: 'Штамп',
  image: 'Изображение'
}

// ---------------------------------------------------------------------------
// Document decorations (burned into page content on save)
// ---------------------------------------------------------------------------

export type WatermarkPosition = 'center' | 'top' | 'bottom'

export interface Watermark {
  text: string
  /** Optional image watermark (data URL); used instead of text when set. */
  image: string | null
  imageWidth: number
  imageHeight: number
  /** Image width as a fraction of the page width. */
  imageScale: number
  fontSize: number
  color: string
  opacity: number
  /** Counter-clockwise angle in degrees, as seen on screen. */
  angle: number
  position: WatermarkPosition
  /** Page ranges like "1-3, 5"; empty = all pages. */
  pages: string
}

export type HFSlot = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'

export interface HeaderFooter {
  slots: Record<HFSlot, string>
  fontSize: number
  color: string
  /** Margins in points. */
  marginX: number
  marginY: number
  startNumber: number
  pages: string
}

export interface Decorations {
  watermark: Watermark | null
  headerFooter: HeaderFooter | null
}

export const NO_DECOR: Decorations = { watermark: null, headerFooter: null }

/** Form field value: text, export value of a checked box / radio ('Off' = none), or choice list. */
export type FormValue = string | string[]
