import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib'
import { buildPdf, parseRanges, type ExportSource } from '../../src/renderer/src/lib/pdf/export'
import type { Annot, PageRef } from '../../src/renderer/src/lib/model'

async function sourceWithPages(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle('Исходник')
  for (const s of sizes) doc.addPage(s)
  return doc.save()
}

function refs(sourceId: string, sizes: [number, number][]): PageRef[] {
  return sizes.map((s, i) => ({
    id: `${sourceId}-${i}`,
    sourceId,
    srcIndex: i,
    view: [0, 0, s[0], s[1]],
    baseRotate: 0,
    rotation: 0
  }))
}

describe('buildPdf', () => {
  const sizesA: [number, number][] = [
    [100, 200],
    [110, 200],
    [120, 200]
  ]
  const sizesB: [number, number][] = [[300, 400]]

  it('reorders, rotates, deletes, duplicates and merges pages', async () => {
    const a = await sourceWithPages(sizesA)
    const b = await sourceWithPages(sizesB)
    const sources = new Map<string, ExportSource>([
      ['A', { id: 'A', bytes: a, encrypted: false }],
      ['B', { id: 'B', bytes: b, encrypted: false }]
    ])
    const pa = refs('A', sizesA)
    const pb = refs('B', sizesB)
    const pages: PageRef[] = [
      { ...pa[2], rotation: 90 },
      pb[0],
      pa[0],
      { ...pa[0], id: 'dup' },
      { id: 'blank', sourceId: 'blank', srcIndex: -1, view: [0, 0, 50, 60], baseRotate: 0, rotation: 0 }
    ]
    const note: Annot = {
      id: 'n1',
      type: 'note',
      rect: [10, 10, 30, 30],
      color: '#ffd84d',
      opacity: 1,
      author: 'me',
      contents: 'x',
      created: 0,
      modified: 0
    }
    const out = await buildPdf({ pages, annots: { [pb[0].id]: [note] }, sources, mode: 'preserve' })
    const doc = await PDFDocument.load(out)
    const got = doc.getPages()
    expect(got.map((p) => Math.round(p.getWidth()))).toEqual([120, 300, 100, 100, 50])
    expect(got[0].getRotation().angle).toBe(90)
    expect(doc.getTitle()).toBe('Исходник')
    const annots = got[1].node.lookup(PDFName.of('Annots'), PDFArray)
    expect(annots.size()).toBe(1)
  })

  it('fresh mode contains only the requested pages', async () => {
    const a = await sourceWithPages(sizesA)
    const sources = new Map<string, ExportSource>([['A', { id: 'A', bytes: a, encrypted: false }]])
    const out = await buildPdf({ pages: [refs('A', sizesA)[1]], annots: {}, sources, mode: 'fresh' })
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
    expect(Math.round(doc.getPage(0).getWidth())).toBe(110)
  })

  it('refuses to save encrypted sources', async () => {
    const a = await sourceWithPages(sizesA)
    const sources = new Map<string, ExportSource>([['A', { id: 'A', bytes: a, encrypted: true }]])
    await expect(buildPdf({ pages: refs('A', sizesA), annots: {}, sources, mode: 'preserve' })).rejects.toThrow()
  })
})

describe('parseRanges', () => {
  it('parses lists and ranges', () => {
    expect(parseRanges('1-3, 5', 10)).toEqual([[0, 1, 2], [4]])
    expect(parseRanges('3-1', 10)).toEqual([[2, 1, 0]])
  })
  it('rejects invalid input', () => {
    expect(parseRanges('0', 10)).toBeNull()
    expect(parseRanges('1-20', 10)).toBeNull()
    expect(parseRanges('abc', 10)).toBeNull()
    expect(parseRanges('', 10)).toBeNull()
  })
})
