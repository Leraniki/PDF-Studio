import { useEffect } from 'react'
import { getDoc, useDocStore } from '../store/docStore'
import { useUi } from '../store/uiStore'
import { closeDoc, openFromDialog, printDoc, saveDoc } from '../lib/actions'
import { getViewer, nextZoom } from '../lib/viewerRegistry'
import { goToMatch, runSearch } from '../components/SearchPanel'
import { TOOL_GROUPS } from '../components/ToolRail'
import { uid, type Annot } from '../lib/model'
import { translatePatch } from '../lib/annotOps'

let clipboard: Annot | null = null

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const docs = useDocStore.getState()
      const ui = useUi.getState()
      const id = docs.activeId
      const doc = id ? getDoc(id) : undefined
      const viewer = getViewer(id)
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const typing = isTyping(e)
      const handled = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }

      // ---- global, work even while typing ----
      if (ctrl && key === 'o') return handled(), void openFromDialog()
      if (ctrl && key === 's' && id) return handled(), void saveDoc(id, e.shiftKey)
      if (ctrl && key === 'p' && id) return handled(), void printDoc(id)
      if (ctrl && key === 'w' && id) return handled(), void closeDoc(id)
      if (ctrl && e.key === 'Tab' && docs.order.length > 1) {
        handled()
        const i = docs.order.indexOf(id ?? '')
        const n = docs.order.length
        docs.setActive(docs.order[(i + (e.shiftKey ? -1 : 1) + n) % n])
        return
      }
      if (ctrl && key === 'f' && id) {
        handled()
        ui.setMode('view')
        ui.setSearch({ open: true })
        setTimeout(() => {
          const input = document.getElementById('search-input') as HTMLInputElement | null
          input?.focus()
          input?.select()
        })
        return
      }
      if (e.key === 'F3' && id) {
        handled()
        if (!ui.search.results.length) void runSearch()
        else goToMatch(ui.search.active + (e.shiftKey ? -1 : 1))
        return
      }
      if (e.key === 'F11' || (ctrl && key === 'l')) {
        handled()
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen()
        return
      }
      if (typing || !doc || !id) return

      // ---- document shortcuts ----
      if (ctrl && key === 'z' && !e.shiftKey) return handled(), docs.undo(id)
      if ((ctrl && key === 'y') || (ctrl && e.shiftKey && key === 'z')) return handled(), docs.redo(id)
      if (ctrl && key === 'd') return handled(), ui.setDialog({ kind: 'properties' })
      if (ctrl && key === 'g') {
        handled()
        const input = document.getElementById('page-input') as HTMLInputElement | null
        input?.focus()
        input?.select()
        return
      }
      if (ctrl && (e.key === '=' || e.key === '+') && !e.shiftKey) return handled(), viewer?.zoomTo(nextZoom(doc.view.zoom, 1))
      if (ctrl && (e.key === '-' || e.key === '_') && !e.shiftKey) return handled(), viewer?.zoomTo(nextZoom(doc.view.zoom, -1))
      if (ctrl && e.key === '0') return handled(), viewer?.fit('fitPage')
      if (ctrl && e.key === '1') return handled(), viewer?.zoomTo(1)
      if (ctrl && e.key === '2') return handled(), viewer?.fit('fitWidth')
      if (ctrl && e.shiftKey && (e.key === '+' || e.key === '=' || e.code === 'Equal')) {
        return handled(), docs.updateView(id, { viewRotation: (doc.view.viewRotation + 90) % 360 })
      }
      if (ctrl && e.shiftKey && (e.key === '_' || e.key === '-' || e.code === 'Minus')) {
        return handled(), docs.updateView(id, { viewRotation: (doc.view.viewRotation + 270) % 360 })
      }
      if (e.key === 'F4') return handled(), ui.setSidebar(ui.sidebar ? null : 'thumbs')

      if (ui.mode !== 'view') return

      // ---- annotation shortcuts ----
      const sel = ui.selection?.docId === id ? ui.selection : null
      const selAnnot = sel ? doc.annots[sel.pageId]?.find((a) => a.id === sel.annotId) : undefined
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        handled()
        docs.deleteAnnot(id, sel.pageId, sel.annotId)
        ui.select(null)
        return
      }
      if (ctrl && key === 'c' && selAnnot && !window.getSelection()?.toString()) {
        handled()
        clipboard = selAnnot
        return
      }
      if (ctrl && key === 'v' && clipboard) {
        handled()
        const page = doc.pages[doc.view.currentPage]
        if (!page) return
        const copy: Annot = { ...clipboard, ...translatePatch(clipboard, 12, -12), id: uid('a'), created: Date.now(), modified: Date.now() }
        docs.addAnnot(id, page.id, copy)
        clipboard = copy
        ui.setTool('select')
        ui.select({ docId: id, pageId: page.id, annotId: copy.id })
        return
      }
      if (e.key === 'Escape') {
        if (ui.editingId) ui.setEditing(null)
        else if (sel) ui.select(null)
        else if (ui.search.open) ui.setSearch({ open: false, results: [], active: -1 })
        else ui.setTool('select')
        return
      }
      if (!ctrl && !e.altKey && e.key.length === 1) {
        const def = TOOL_GROUPS.flat().find((t) => t.key.toLowerCase() === key)
        if (def) {
          handled()
          ui.setTool(def.tool)
          return
        }
      }
      // Arrow keys nudge the selected annotation.
      if (selAnnot && sel && e.key.startsWith('Arrow') && selAnnot.type !== 'highlight' && selAnnot.type !== 'underline' && selAnnot.type !== 'strikeout') {
        handled()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0
        docs.updateAnnot(id, sel.pageId, sel.annotId, translatePatch(selAnnot, dx, dy))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
