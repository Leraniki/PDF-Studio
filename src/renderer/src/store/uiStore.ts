import { create } from 'zustand'
import type { AnnotType, Tool } from '../lib/model'
import type { SearchMatch, SearchOptions } from '../lib/pdf/search'

export type SidebarTab = 'thumbs' | 'outline' | 'comments'
export type Mode = 'view' | 'organize'

export interface ToolStyle {
  color: string
  opacity: number
  width: number
  fill: string | null
  fontSize: number
  label: string
}

export const DEFAULT_STYLES: Record<AnnotType, ToolStyle> = {
  highlight: { color: '#ffd84d', opacity: 0.45, width: 1, fill: null, fontSize: 12, label: '' },
  underline: { color: '#3aa0ff', opacity: 1, width: 1, fill: null, fontSize: 12, label: '' },
  strikeout: { color: '#ff4d4d', opacity: 1, width: 1, fill: null, fontSize: 12, label: '' },
  note: { color: '#ffd84d', opacity: 1, width: 1, fill: null, fontSize: 12, label: '' },
  freetext: { color: '#1f1f1f', opacity: 1, width: 1, fill: null, fontSize: 14, label: '' },
  ink: { color: '#ff4d4d', opacity: 1, width: 2, fill: null, fontSize: 12, label: '' },
  rect: { color: '#ff4d4d', opacity: 1, width: 2, fill: null, fontSize: 12, label: '' },
  ellipse: { color: '#ff4d4d', opacity: 1, width: 2, fill: null, fontSize: 12, label: '' },
  line: { color: '#ff4d4d', opacity: 1, width: 2, fill: null, fontSize: 12, label: '' },
  arrow: { color: '#ff4d4d', opacity: 1, width: 2, fill: null, fontSize: 12, label: '' },
  stamp: { color: '#d93a3a', opacity: 1, width: 1, fill: null, fontSize: 12, label: 'УТВЕРЖДЕНО' },
  image: { color: '#000000', opacity: 1, width: 1, fill: null, fontSize: 12, label: '' }
}

export interface PendingImage {
  src: string
  width: number
  height: number
  signature: boolean
}

export interface SavedSignature {
  id: string
  src: string
  width: number
  height: number
}

export interface Selection {
  docId: string
  pageId: string
  annotId: string
}

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  text: string
}

export interface SearchState {
  open: boolean
  query: string
  options: SearchOptions
  running: boolean
  progress: number
  results: SearchMatch[]
  active: number
  docId: string | null
}

export type DialogState =
  | { kind: 'password'; name: string; incorrect: boolean; resolve: (pw: string | null) => void }
  | { kind: 'confirm-close'; names: string[]; resolve: (r: 'save' | 'discard' | 'cancel') => void }
  | { kind: 'properties' }
  | { kind: 'split' }
  | { kind: 'merge' }
  | { kind: 'settings' }
  | { kind: 'goto' }
  | { kind: 'protect' }
  | { kind: 'watermark' }
  | { kind: 'headerFooter' }
  | { kind: 'signature' }
  | { kind: 'print' }
  | { kind: 'print-flip'; resolve: (go: boolean) => void }
  | null

interface UiStore {
  tool: Tool
  styles: Record<AnnotType, ToolStyle>
  selection: Selection | null
  editingId: string | null
  sidebar: SidebarTab | null
  mode: Mode
  nightMode: boolean
  author: string
  organizeSelection: string[]
  search: SearchState
  toasts: Toast[]
  dialog: DialogState
  loading: string | null
  pendingImage: PendingImage | null
  signatures: SavedSignature[]

  setTool: (t: Tool) => void
  setPendingImage: (p: PendingImage | null) => void
  setSignatures: (list: SavedSignature[]) => void
  setStyle: (type: AnnotType, patch: Partial<ToolStyle>) => void
  select: (s: Selection | null) => void
  setEditing: (id: string | null) => void
  setSidebar: (t: SidebarTab | null) => void
  toggleSidebar: (t: SidebarTab) => void
  setMode: (m: Mode) => void
  setNightMode: (v: boolean) => void
  setAuthor: (v: string) => void
  setOrganizeSelection: (ids: string[]) => void
  setSearch: (patch: Partial<SearchState>) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
  setDialog: (d: DialogState) => void
  setLoading: (text: string | null) => void
}

let toastId = 0

export const useUi = create<UiStore>()((set, get) => ({
  tool: 'select',
  styles: structuredClone(DEFAULT_STYLES),
  selection: null,
  editingId: null,
  sidebar: 'thumbs',
  mode: 'view',
  nightMode: false,
  author: '',
  organizeSelection: [],
  search: {
    open: false,
    query: '',
    options: { caseSensitive: false, wholeWord: false },
    running: false,
    progress: 0,
    results: [],
    active: -1,
    docId: null
  },
  toasts: [],
  dialog: null,
  loading: null,
  pendingImage: null,
  signatures: [],

  setTool: (tool) =>
    set({
      tool,
      selection: tool === 'select' ? get().selection : null,
      editingId: null,
      pendingImage: tool === 'image' ? get().pendingImage : null
    }),
  setPendingImage: (pendingImage) => set({ pendingImage }),
  setSignatures: (signatures) => set({ signatures }),
  setStyle: (type, patch) => set((s) => ({ styles: { ...s.styles, [type]: { ...s.styles[type], ...patch } } })),
  select: (selection) => set({ selection, editingId: null }),
  setEditing: (editingId) => set({ editingId }),
  setSidebar: (sidebar) => set({ sidebar }),
  toggleSidebar: (t) => set((s) => ({ sidebar: s.sidebar === t ? null : t })),
  setMode: (mode) => set({ mode, selection: null, editingId: null }),
  setNightMode: (nightMode) => set({ nightMode }),
  setAuthor: (author) => set({ author }),
  setOrganizeSelection: (organizeSelection) => set({ organizeSelection }),
  setSearch: (patch) => set((s) => ({ search: { ...s.search, ...patch } })),
  toast: (text, kind = 'info') => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setDialog: (dialog) => set({ dialog }),
  setLoading: (loading) => set({ loading })
}))
