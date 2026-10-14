import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { importAnnotations, writeAnnotation } from '../../src/renderer/src/lib/pdf/annotIO'
import { buildPdf, type ExportSource } from '../../src/renderer/src/lib/pdf/export'
import { decorItems, fillTokens } from '../../src/renderer/src/lib/decor'
import { inRanges } from '../../src/renderer/src/lib/ranges'
import { bytesToBase64 } from '../../src/renderer/src/lib/base64'
import type { Annot, Decorations, PageRef } from '../../src/renderer/src/lib/model'

// 1x1 transparent PNG.
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
)
const PNG_URL = `data:image/png;base64,${bytesToBase64(PNG)}`
const ARIAL = (() => {
  try {
    return new Uint8Array(readFileSync('C:/Windows/Fonts/arial.ttf'))
  } catch {
    return null
  }
})()

function refs(sourceId: string, n: number, w = 400, h = 600, rotate = 0): PageRef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${sourceId}-${i}`,
    sourceId,
    srcIndex: i,
    view: [0, 0, w, h],
    baseRotate: rotate,
    rotation: 0
  }))
}

async function source(n: number, w = 400, h = 600, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) doc.addPage([w, h]).setRotation(degrees(rotate))
  return doc.save()
}

describe('image annotations', () => {
  it('round-trip with their original image and signature flag', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([300, 300])
    const a: Annot = {
      id: 'sig1',
      type: 'image',
      rect: [10, 10, 110, 60],
      color: '#000000',
      opacity: 0.8,
      author: 'me',
      contents: '',
      created: 0,
      modified: 0,
      image: PNG_URL,
      signature: true
    }
    await writeAnnotation({ doc, font: null }, page, a)
    const res = await importAnnotations(await doc.save())
    const got = res.annots.get(0)![0]
    expect(got.type).toBe('image')
    expect(got.signature).toBe(true)
    expect(got.image).toBe(PNG_URL)
    expect(got.rect).toEqual([10, 10, 110, 60])
    expect(got.opacity).toBeCloseTo(0.8)
  })
})

describe('decorations', () => {
  const ctx = { pageIndex: 2, pageCount: 10, fileName: 'Отчёт.pdf', date: new Date(2026, 8, 28) }

  it('fills tokens', () => {
    expect(fillTokens('Страница {page} из {total} · {file} · {date}', ctx, 1)).toBe('Страница 3 из 10 · Отчёт · 28.09.2026')
    expect(fillTokens('{page}/{total}', ctx, 5)).toBe('7/14')
  })

  it('honours page ranges', () => {
    expect(inRanges('', 4, 10)).toBe(true)
    expect(inRanges('1-3', 4, 10)).toBe(false)
    expect(inRanges('1-3, 5', 4, 10)).toBe(true)
    expect(inRanges('garbage', 4, 10)).toBe(true)
  })

  it('lays out header / footer slots in display space', () => {
    const d: Decorations = {
      watermark: null,
      headerFooter: {
        slots: { tl: 'A', tc: '', tr: 'B', bl: '', bc: '{page}', br: '' },
        fontSize: 10,
        color: '#000000',
        marginX: 20,
        marginY: 30,
        startNumber: 1,
        pages: ''
      }
    }
    const items = decorItems(d, 400, 600, ctx)
    expect(items).toHaveLength(3)
    const [a, b, c] = items as Extract<(typeof items)[number], { kind: 'text' }>[]
    expect([a.x, a.anchor]).toEqual([20, 'start'])
    expect([b.x, b.anchor]).toEqual([380, 'end'])
    expect([c.x, c.y, c.anchor, c.text]).toEqual([200, 570, 'middle', '3'])
  })

  // Burn a footer into pages with different /Rotate values and check with pdf.js
  // that the text lands at the bottom centre of the page as displayed.
  for (const rotate of [0, 90, 180, 270]) {
    it(`places footers correctly on pages rotated ${rotate}°`, async () => {
      const bytes = await source(1, 400, 600, rotate)
      const sources = new Map<string, ExportSource>([['S', { id: 'S', bytes, encrypted: false }]])
      const decor: Decorations = {
        watermark: null,
        headerFooter: {
          slots: { tl: '', tc: '', tr: '', bl: '', bc: 'FOOTER', br: '' },
          fontSize: 12,
          color: '#000000',
          marginX: 20,
          marginY: 30,
          startNumber: 1,
          pages: ''
        }
      }
      const out = await buildPdf({ pages: refs('S', 1, 400, 600, rotate), annots: {}, sources, mode: 'preserve', decor })
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const pdf = await pdfjs.getDocument({ data: out.slice() }).promise
      const page = await pdf.getPage(1)
      const vp = page.getViewport({ scale: 1 })
      const tc = await page.getTextContent()
      const item = tc.items.find((i) => 'str' in i && i.str === 'FOOTER') as { transform: number[]; width: number }
      expect(item).toBeTruthy()
      const [x, y] = vp.convertToViewportPoint(item.transform[4], item.transform[5])
      const width = Math.hypot(item.transform[0], item.transform[1]) ? item.width : 0
      // Baseline start: centred horizontally, 30pt above the displayed bottom edge.
      expect(Math.abs(x + width / 2 - vp.width / 2)).toBeLessThan(2)
      expect(Math.abs(y - (vp.height - 30))).toBeLessThan(2)
      await pdf.loadingTask.destroy()
    })
  }

  it('draws watermarks with a Cyrillic font on every selected page', async () => {
    if (!ARIAL) return
    const bytes = await source(3)
    const sources = new Map<string, ExportSource>([['S', { id: 'S', bytes, encrypted: false }]])
    const decor: Decorations = {
      headerFooter: null,
      watermark: {
        text: 'КОНФИДЕНЦИАЛЬНО',
        image: null,
        imageWidth: 1,
        imageHeight: 1,
        imageScale: 0.5,
        fontSize: 40,
        color: '#ff0000',
        opacity: 0.3,
        angle: 45,
        position: 'center',
        pages: '1, 3'
      }
    }
    const out = await buildPdf({ pages: refs('S', 3), annots: {}, sources, mode: 'preserve', decor, fontBytes: ARIAL })
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: out.slice() }).promise
    const texts: string[] = []
    for (let i = 1; i <= 3; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent()
      texts.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(''))
    }
    expect(texts[0]).toContain('КОНФИДЕНЦИАЛЬНО')
    expect(texts[1]).not.toContain('КОНФИДЕНЦИАЛЬНО')
    expect(texts[2]).toContain('КОНФИДЕНЦИАЛЬНО')
    await pdf.loadingTask.destroy()
  })
})

describe('forms', () => {
  async function formPdf(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([400, 400])
    const form = doc.getForm()
    form.createTextField('name').addToPage(page, { x: 20, y: 340, width: 200, height: 24, font })
    form.createCheckBox('agree').addToPage(page, { x: 20, y: 300, width: 16, height: 16 })
    const radio = form.createRadioGroup('color')
    radio.addOptionToPage('red', page, { x: 20, y: 260, width: 14, height: 14 })
    radio.addOptionToPage('blue', page, { x: 60, y: 260, width: 14, height: 14 })
    const dd = form.createDropdown('city')
    dd.addOptions(['Paris', 'Rome'])
    dd.addToPage(page, { x: 20, y: 200, width: 150, height: 24, font })
    return doc.save()
  }

  it('writes filled values into the AcroForm', async () => {
    const bytes = await formPdf()
    const sources = new Map<string, ExportSource>([['S', { id: 'S', bytes, encrypted: false }]])
    const out = await buildPdf({
      pages: refs('S', 1, 400, 400),
      annots: {},
      sources,
      mode: 'preserve',
      fontBytes: ARIAL,
      formValues: { name: 'Иван Петров', agree: 'Yes', color: 'blue', city: 'Rome' }
    })
    const form = (await PDFDocument.load(out)).getForm()
    expect(form.getTextField('name').getText()).toBe('Иван Петров')
    expect(form.getCheckBox('agree').isChecked()).toBe(true)
    expect(form.getRadioGroup('color').getSelected()).toBe('blue')
    expect(form.getDropdown('city').getSelected()).toEqual(['Rome'])
  })

  it('flattens the form into page content', async () => {
    const bytes = await formPdf()
    const sources = new Map<string, ExportSource>([['S', { id: 'S', bytes, encrypted: false }]])
    const out = await buildPdf({
      pages: refs('S', 1, 400, 400),
      annots: {},
      sources,
      mode: 'preserve',
      fontBytes: ARIAL,
      formValues: { name: 'Flat value' },
      flattenForm: true
    })
    const doc = await PDFDocument.load(out)
    expect(doc.getForm().getFields()).toHaveLength(0)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: out.slice() }).promise
    const tc = await (await pdf.getPage(1)).getTextContent()
    expect(tc.items.map((i) => ('str' in i ? i.str : '')).join('')).toContain('Flat value')
    await pdf.loadingTask.destroy()
  })
})
