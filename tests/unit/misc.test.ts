import { describe, expect, it } from 'vitest'
import { mergeLineRects, resizePatch, translatePatch } from '../../src/renderer/src/lib/annotOps'
import { buildRegex, findInPage, type PageText } from '../../src/renderer/src/lib/pdf/search'
import type { Annot } from '../../src/renderer/src/lib/model'

describe('mergeLineRects', () => {
  it('merges spans on the same line and keeps separate lines apart', () => {
    const out = mergeLineRects([
      [10, 100, 50, 112],
      [52, 100, 90, 112],
      [10, 80, 60, 92]
    ])
    expect(out).toEqual([
      [10, 100, 90, 112],
      [10, 80, 60, 92]
    ])
  })
})

describe('annotation geometry', () => {
  const ink: Annot = {
    id: 'i',
    type: 'ink',
    rect: [0, 0, 10, 10],
    paths: [[0, 0, 10, 10]],
    color: '#000000',
    opacity: 1,
    author: '',
    contents: '',
    created: 0,
    modified: 0
  }
  it('translates every coordinate', () => {
    expect(translatePatch(ink, 5, -5)).toEqual({ rect: [5, -5, 15, 5], paths: [[5, -5, 15, 5]] })
  })
  it('scales paths into a new rect', () => {
    expect(resizePatch(ink, [0, 0, 20, 40]).paths).toEqual([[0, 0, 20, 40]])
  })
})

describe('search', () => {
  const pt: PageText = {
    items: ['Привет мир', 'и снова Мир'],
    starts: [0, 11],
    origins: [
      [0, 0],
      [0, 20]
    ],
    text: 'Привет мир и снова Мир'
  }
  it('is case-insensitive by default and maps matches to text items', () => {
    const re = buildRegex('мир', { caseSensitive: false, wholeWord: false })!
    const m = findInPage(pt, re, 'p', 0)
    expect(m).toHaveLength(2)
    expect(m[1].ranges).toEqual([{ item: 1, from: 8, to: 11 }])
    expect(m[1].origin).toEqual([0, 20])
  })
  it('respects case and whole-word options', () => {
    expect(findInPage(pt, buildRegex('Мир', { caseSensitive: true, wholeWord: false })!, 'p', 0)).toHaveLength(1)
    expect(findInPage(pt, buildRegex('ми', { caseSensitive: false, wholeWord: true })!, 'p', 0)).toHaveLength(0)
  })
  it('escapes regex characters in the query', () => {
    expect(buildRegex('a.b', { caseSensitive: false, wholeWord: false })!.test('axb')).toBe(false)
  })
})
