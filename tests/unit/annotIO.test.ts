import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { importAnnotations, writeAnnotation, wrapText } from '../../src/renderer/src/lib/pdf/annotIO'
import type { Annot } from '../../src/renderer/src/lib/model'

const base = (over: Partial<Annot>): Annot => ({
  id: 'a1',
  type: 'highlight',
  rect: [100, 100, 200, 120],
  color: '#ff0000',
  opacity: 0.5,
  author: 'Тестер',
  contents: 'Комментарий',
  created: Date.UTC(2026, 0, 1),
  modified: Date.UTC(2026, 0, 2),
  ...over
})

const samples: Annot[] = [
  base({ id: 'h', type: 'highlight', quads: [[100, 100, 200, 120], [100, 80, 150, 98]], rect: [100, 80, 200, 120] }),
  base({ id: 'u', type: 'underline', quads: [[100, 100, 200, 120]] }),
  base({ id: 's', type: 'strikeout', quads: [[100, 100, 200, 120]] }),
  base({ id: 'n', type: 'note', rect: [300, 300, 320, 320], color: '#ffd84d', opacity: 1 }),
  base({ id: 'i', type: 'ink', paths: [[10, 10, 20, 30, 40, 20]], width: 3, rect: [8, 8, 42, 32], opacity: 1 }),
  base({ id: 'r', type: 'rect', rect: [50, 50, 150, 100], width: 2, fill: '#00ff00', opacity: 1 }),
  base({ id: 'e', type: 'ellipse', rect: [50, 150, 150, 200], width: 2, fill: null, opacity: 1 }),
  base({ id: 'l', type: 'line', line: [10, 400, 200, 450], width: 2, rect: [10, 400, 200, 450], opacity: 1 }),
  base({ id: 'ar', type: 'arrow', line: [10, 500, 200, 550], width: 2, rect: [10, 500, 200, 550], opacity: 1 }),
  base({ id: 'f', type: 'freetext', rect: [300, 500, 500, 540], fontSize: 14, contents: 'Привет, мир', opacity: 1 }),
  base({ id: 'st', type: 'stamp', rect: [300, 600, 450, 640], label: 'УТВЕРЖДЕНО', opacity: 1 })
]

describe('annotation round-trip', () => {
  it('writes every supported type and imports it back', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    for (const a of samples) await writeAnnotation({ doc, font: null }, page, a)
    const bytes = await doc.save()

    const res = await importAnnotations(bytes)
    const list = res.annots.get(0)!
    expect(list).toHaveLength(samples.length)

    for (const src of samples) {
      const got = list.find((a) => a.id === src.id)!
      expect(got, src.id).toBeTruthy()
      expect(got.type).toBe(src.type)
      expect(got.author).toBe('Тестер')
      if (src.type !== 'freetext') expect(got.color).toBe(src.color)
      expect(got.opacity).toBeCloseTo(src.opacity)
      expect(got.contents).toBe(src.contents)
    }
    expect(list.find((a) => a.id === 'h')!.quads).toHaveLength(2)
    expect(list.find((a) => a.id === 'i')!.paths).toEqual([[10, 10, 20, 30, 40, 20]])
    expect(list.find((a) => a.id === 'r')!.fill).toBe('#00ff00')
    expect(list.find((a) => a.id === 'e')!.fill).toBeNull()
    expect(list.find((a) => a.id === 'ar')!.line).toEqual([10, 500, 200, 550])
    expect(list.find((a) => a.id === 'f')!.fontSize).toBe(14)
    expect(list.find((a) => a.id === 'st')!.label).toBe('УТВЕРЖДЕНО')

    // Imported annotations are removed from the bytes handed to the renderer.
    const again = await importAnnotations(res.bytes)
    expect(again.annots.size).toBe(0)
  })

  it('leaves files without annotations untouched', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const bytes = await doc.save()
    const res = await importAnnotations(bytes)
    expect(res.bytes).toBe(bytes)
  })
})

describe('wrapText', () => {
  it('wraps on word boundaries and keeps explicit line breaks', () => {
    const measure = (s: string): number => s.length
    expect(wrapText('aaa bbb ccc', 7, measure)).toEqual(['aaa bbb', 'ccc'])
    expect(wrapText('a\nb', 10, measure)).toEqual(['a', 'b'])
  })
})
