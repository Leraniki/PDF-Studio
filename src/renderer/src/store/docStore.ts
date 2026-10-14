import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { original, type Draft } from 'immer'
import type { Annot, Decorations, FormValue, PageRef } from '../lib/model'
import { NO_DECOR, uid } from '../lib/model'
import type { SpreadMode } from '../lib/pdf/layout'
import type { Protection } from '../lib/pdf/security'

export type ZoomMode = 'custom' | 'fitWidth' | 'fitPage'

export interface ViewState {
  zoom: number
  zoomMode: ZoomMode
  spread: SpreadMode
  viewRotation: number
  currentPage: number
}

export interface OutlineNode {
  title: string
  bold?: boolean
  italic?: boolean
  dest: string | unknown[] | null
  url: string | null
  items: OutlineNode[]
}

export interface Snapshot {
  pages: PageRef[]
  annots: Record<string, Annot[]>
  decor: Decorations
}

export interface FormState {
  hasFields: boolean
  /** Current values by fully qualified field name. */
  values: Record<string, FormValue>
  /** Values edited in this session (the ones written on save). */
  changed: string[]
  defaults: Record<string, FormValue>
  highlight: boolean
}

export interface DocInfo {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: string
  modDate?: string
  version?: string
  fileSize: number
}

export interface Doc {
  id: string
  name: string
  path: string | null
  sourceIds: string[]
  primarySourceId: string | null
  pages: PageRef[]
  annots: Record<string, Annot[]>
  outline: OutlineNode[]
  info: DocInfo
  /** Encrypted with a scheme the app cannot decrypt: view only. */
  encrypted: boolean
  /** Protection applied when saving (null = no password). */
  protection: Protection | null
  /** Opened with the user password of a permission-restricted file. */
  restricted: boolean
  decor: Decorations
  form: FormState
  dirty: boolean
  past: Snapshot[]
  future: Snapshot[]
  view: ViewState
}

const HISTORY_LIMIT = 100
let lastMerge = { key: '', time: 0 }

/** Snapshot of the committed (non-draft) state, safe to keep in history. */
function snap(d: Draft<Doc>): Snapshot {
  return {
    pages: (original(d.pages) ?? d.pages) as PageRef[],
    annots: (original(d.annots) ?? d.annots) as Record<string, Annot[]>,
    decor: (original(d.decor) ?? d.decor) as Decorations
  }
}

function restore(d: Draft<Doc>, s: Snapshot): void {
  d.pages = s.pages as Draft<PageRef[]>
  d.annots = s.annots as Draft<Record<string, Annot[]>>
  d.decor = s.decor as Draft<Decorations>
}

interface DocStore {
  docs: Record<string, Doc>
  order: string[]
  activeId: string | null

  addDoc: (
    doc: Omit<Doc, 'past' | 'future' | 'dirty' | 'view' | 'decor' | 'form' | 'protection' | 'restricted'> &
      Partial<Pick<Doc, 'dirty' | 'decor' | 'form' | 'protection' | 'restricted'>>
  ) => void
  closeDoc: (id: string) => void
  setActive: (id: string | null) => void
  updateView: (id: string, patch: Partial<ViewState>) => void
  /** Applies an undoable change to pages / annotations. */
  /**
   * Applies an undoable change. Changes with the same `mergeKey` made in quick
   * succession (e.g. dragging a slider) collapse into one undo step.
   */
  commit: (id: string, recipe: (draft: Snapshot) => void, mergeKey?: string) => void
  undo: (id: string) => void
  redo: (id: string) => void
  markSaved: (id: string, path: string, name: string) => void
  addSource: (id: string, sourceId: string) => void

  addAnnot: (id: string, pageId: string, a: Annot) => void
  updateAnnot: (id: string, pageId: string, annotId: string, patch: Partial<Annot>) => void
  deleteAnnot: (id: string, pageId: string, annotId: string) => void

  rotatePages: (id: string, pageIds: string[], delta: number) => void
  deletePages: (id: string, pageIds: string[]) => void
  movePages: (id: string, pageIds: string[], targetIndex: number) => void
  insertPages: (id: string, index: number, pages: PageRef[], annots?: Record<string, Annot[]>) => void
  duplicatePages: (id: string, pageIds: string[]) => void

  setDecor: (id: string, patch: Partial<Decorations>) => void
  setFormValue: (id: string, name: string, value: FormValue) => void
  resetForm: (id: string) => void
  setFormHighlight: (id: string, on: boolean) => void
  setProtection: (id: string, p: Protection | null) => void
  unlock: (id: string, p: Protection) => void
}

export const useDocStore: UseBoundStore<StoreApi<DocStore>> = create<DocStore>()(
  immer((set) => ({
    docs: {},
    order: [],
    activeId: null,

    addDoc: (doc) =>
      set((s) => {
        s.docs[doc.id] = {
          ...doc,
          decor: doc.decor ?? NO_DECOR,
          form: doc.form ?? { hasFields: false, values: {}, changed: [], defaults: {}, highlight: true },
          protection: doc.protection ?? null,
          restricted: doc.restricted ?? false,
          dirty: doc.dirty ?? false,
          past: [],
          future: [],
          view: { zoom: 1, zoomMode: 'fitWidth', spread: 'single', viewRotation: 0, currentPage: 0 }
        }
        s.order.push(doc.id)
        s.activeId = doc.id
      }),

    closeDoc: (id) =>
      set((s) => {
        const idx = s.order.indexOf(id)
        if (idx < 0) return
        s.order.splice(idx, 1)
        delete s.docs[id]
        if (s.activeId === id) s.activeId = s.order[Math.min(idx, s.order.length - 1)] ?? null
      }),

    setActive: (id) =>
      set((s) => {
        s.activeId = id
      }),

    updateView: (id, patch) =>
      set((s) => {
        const d = s.docs[id]
        if (d) Object.assign(d.view, patch)
      }),

    commit: (id, recipe, mergeKey) =>
      set((s) => {
        const d = s.docs[id]
        if (!d) return
        const now = Date.now()
        const merge = !!mergeKey && lastMerge.key === `${id}:${mergeKey}` && now - lastMerge.time < 1500 && d.past.length > 0
        lastMerge = { key: mergeKey ? `${id}:${mergeKey}` : '', time: now }
        if (!merge) {
          d.past.push(snap(d))
          if (d.past.length > HISTORY_LIMIT) d.past.shift()
        }
        d.future = []
        const draft = { pages: d.pages, annots: d.annots, decor: d.decor }
        recipe(draft)
        d.pages = draft.pages
        d.annots = draft.annots
        d.decor = draft.decor
        d.dirty = true
      }),

    undo: (id) =>
      set((s) => {
        lastMerge = { key: '', time: 0 }
        const d = s.docs[id]
        const prev = d?.past.pop()
        if (!d || !prev) return
        d.future.push(snap(d))
        restore(d, prev)
        d.dirty = true
      }),

    redo: (id) =>
      set((s) => {
        const d = s.docs[id]
        const next = d?.future.pop()
        if (!d || !next) return
        d.past.push(snap(d))
        restore(d, next)
        d.dirty = true
      }),

    markSaved: (id, path, name) =>
      set((s) => {
        const d = s.docs[id]
        if (!d) return
        d.path = path
        d.name = name
        d.dirty = false
      }),

    addSource: (id, sourceId) =>
      set((s) => {
        s.docs[id]?.sourceIds.push(sourceId)
      }),

    addAnnot: (id: string, pageId: string, a: Annot) =>
      useDocStore.getState().commit(id, (d) => {
        ;(d.annots[pageId] ??= []).push(a)
      }),

    updateAnnot: (id: string, pageId: string, annotId: string, patch: Partial<Annot>) => {
      const keys = Object.keys(patch)
      const styleOnly = keys.every((k) => ['color', 'opacity', 'width', 'fill', 'fontSize'].includes(k))
      useDocStore.getState().commit(
        id,
        (d) => {
          const a = d.annots[pageId]?.find((x) => x.id === annotId)
          if (a) Object.assign(a, patch, { modified: Date.now() })
        },
        styleOnly ? `${annotId}:${keys.sort().join(',')}` : undefined
      )
    },

    deleteAnnot: (id: string, pageId: string, annotId: string) =>
      useDocStore.getState().commit(id, (d) => {
        const list = d.annots[pageId]
        if (list) d.annots[pageId] = list.filter((x) => x.id !== annotId)
      }),

    rotatePages: (id: string, pageIds: string[], delta: number) =>
      useDocStore.getState().commit(id, (d) => {
        const ids = new Set(pageIds)
        for (const p of d.pages) if (ids.has(p.id)) p.rotation = (((p.rotation + delta) % 360) + 360) % 360
      }),

    deletePages: (id: string, pageIds: string[]) =>
      useDocStore.getState().commit(id, (d) => {
        const ids = new Set(pageIds)
        if (ids.size >= d.pages.length) return
        d.pages = d.pages.filter((p) => !ids.has(p.id))
      }),

    movePages: (id: string, pageIds: string[], targetIndex: number) =>
      useDocStore.getState().commit(id, (d) => {
        const ids = new Set(pageIds)
        const moving = d.pages.filter((p) => ids.has(p.id))
        const before = d.pages.slice(0, targetIndex).filter((p) => !ids.has(p.id)).length
        const rest = d.pages.filter((p) => !ids.has(p.id))
        rest.splice(before, 0, ...moving)
        d.pages = rest
      }),

    insertPages: (id: string, index: number, pages: PageRef[], annots?: Record<string, Annot[]>) =>
      useDocStore.getState().commit(id, (d) => {
        d.pages.splice(index, 0, ...pages)
        if (annots) Object.assign(d.annots, annots)
      }),

    duplicatePages: (id: string, pageIds: string[]) =>
      useDocStore.getState().commit(id, (d) => {
        const ids = new Set(pageIds)
        const out: PageRef[] = []
        for (const p of d.pages) {
          out.push(p)
          if (ids.has(p.id)) {
            const copy = { ...p, id: uid('p') }
            out.push(copy)
            const list = d.annots[p.id]
            if (list) d.annots[copy.id] = list.map((a) => ({ ...a, id: uid('a') }))
          }
        }
        d.pages = out
      }),

    setDecor: (id: string, patch: Partial<Decorations>) =>
      useDocStore.getState().commit(id, (d) => {
        d.decor = { ...d.decor, ...patch }
      }),

    setFormValue: (id: string, name: string, value: FormValue) =>
      set((s) => {
        const d = s.docs[id]
        if (!d) return
        d.form.values[name] = value
        if (!d.form.changed.includes(name)) d.form.changed.push(name)
        d.dirty = true
      }),

    resetForm: (id: string) =>
      set((s) => {
        const d = s.docs[id]
        if (!d) return
        for (const name of Object.keys(d.form.values)) {
          const def = d.form.defaults[name] ?? ''
          d.form.values[name] = def
          if (!d.form.changed.includes(name)) d.form.changed.push(name)
        }
        d.dirty = true
      }),

    setFormHighlight: (id: string, on: boolean) =>
      set((s) => {
        const d = s.docs[id]
        if (d) d.form.highlight = on
      }),

    setProtection: (id: string, p: Protection | null) =>
      set((s) => {
        const d = s.docs[id]
        if (!d) return
        d.protection = p
        d.dirty = true
      }),

    unlock: (id: string, p: Protection) =>
      set((s) => {
        const d = s.docs[id]
        if (!d) return
        d.protection = p
        d.restricted = false
      })
  }))
)

export function useActiveDoc(): Doc | null {
  return useDocStore((s) => (s.activeId ? (s.docs[s.activeId] ?? null) : null))
}

export function getDoc(id: string): Doc | undefined {
  return useDocStore.getState().docs[id]
}
