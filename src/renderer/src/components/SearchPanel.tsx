import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useUi } from '../store/uiStore'
import { getDoc, useDocStore } from '../store/docStore'
import { buildRegex, findInPage, getPageText, type SearchMatch } from '../lib/pdf/search'
import { getViewer } from '../lib/viewerRegistry'

let runToken = 0

export async function runSearch(): Promise<void> {
  const token = ++runToken
  const ui = useUi.getState()
  const docId = useDocStore.getState().activeId
  const doc = docId ? getDoc(docId) : null
  const re = buildRegex(ui.search.query, ui.search.options)
  if (!doc || !re) {
    ui.setSearch({ results: [], active: -1, running: false, docId })
    return
  }
  ui.setSearch({ results: [], active: -1, running: true, progress: 0, docId: doc.id })
  const results: SearchMatch[] = []
  let lastFlush = performance.now()
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i]
    if (p.sourceId !== 'blank') {
      try {
        const pt = await getPageText(p)
        if (token !== runToken) return
        results.push(...findInPage(pt, re, p.id, i))
      } catch {
        /* unreadable page */
      }
    }
    if (performance.now() - lastFlush > 120) {
      lastFlush = performance.now()
      useUi.getState().setSearch({ results: [...results], progress: (i + 1) / doc.pages.length })
    }
  }
  if (token !== runToken) return
  // Start at the first match at or after the current page.
  const cur = getDoc(doc.id)?.view.currentPage ?? 0
  const first = results.findIndex((m) => m.pageIndex >= cur)
  useUi.getState().setSearch({ results, running: false, progress: 1 })
  if (results.length) goToMatch(first >= 0 ? first : 0)
}

export function goToMatch(index: number): void {
  const { search } = useUi.getState()
  const n = search.results.length
  if (!n) return
  const i = ((index % n) + n) % n
  useUi.getState().setSearch({ active: i })
  const m = search.results[i]
  const doc = search.docId ? getDoc(search.docId) : null
  if (!doc) return
  const pageIndex = doc.pages.findIndex((p) => p.id === m.pageId)
  if (pageIndex >= 0) getViewer(doc.id)?.scrollToPage(pageIndex, m.origin)
}

export function SearchPanel(): React.JSX.Element {
  const search = useUi((s) => s.search)
  const setSearch = useUi((s) => s.setSearch)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [search.open])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.search-result.on')
    const list = listRef.current
    if (!el || !list) return
    const top = el.offsetTop - list.offsetTop
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 3
    }
  }, [search.active])

  const close = (): void => {
    runToken++
    setSearch({ open: false, results: [], active: -1, running: false })
  }

  return (
    <div className="rightpanel">
      <div className="panel-section">
        <div className="panel-title">
          <span style={{ flex: 1 }}>Поиск</span>
          <button className="icon-btn square" title="Закрыть (Esc)" onClick={close}>
            <X size={15} />
          </button>
        </div>
        <div className="search-box">
          <input
            ref={inputRef}
            id="search-input"
            placeholder="Найти в документе"
            value={search.query}
            onChange={(e) => setSearch({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const same = search.results.length && !search.running
                if (same && e.shiftKey) goToMatch(search.active - 1)
                else if (same) goToMatch(search.active + 1)
                else void runSearch()
              } else if (e.key === 'Escape') close()
            }}
          />
          <button className="icon-btn square" title="Предыдущее (Shift+F3)" disabled={!search.results.length} onClick={() => goToMatch(search.active - 1)}>
            <ChevronUp size={16} />
          </button>
          <button className="icon-btn square" title="Следующее (F3)" disabled={!search.results.length} onClick={() => goToMatch(search.active + 1)}>
            <ChevronDown size={16} />
          </button>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 14 }}>
          <label className="check">
            <input
              type="checkbox"
              checked={search.options.caseSensitive}
              onChange={(e) => {
                setSearch({ options: { ...search.options, caseSensitive: e.target.checked } })
                if (search.query) void runSearch()
              }}
            />
            Учитывать регистр
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={search.options.wholeWord}
              onChange={(e) => {
                setSearch({ options: { ...search.options, wholeWord: e.target.checked } })
                if (search.query) void runSearch()
              }}
            />
            Слово целиком
          </label>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {search.running
            ? `Поиск… ${Math.round(search.progress * 100)}%`
            : search.results.length
              ? `${search.active + 1} из ${search.results.length}`
              : search.query && search.docId
                ? 'Совпадений не найдено'
                : 'Нажмите Enter для поиска'}
        </div>
      </div>
      <div className="search-results" ref={listRef}>
        {search.results.slice(0, 2000).map((m, i) => (
          <div key={i} className={`search-result${i === search.active ? ' on' : ''}`} onClick={() => goToMatch(i)}>
            <div className="search-page">Страница {m.pageIndex + 1}</div>
            …{m.before}
            <mark>{m.match}</mark>
            {m.after}…
          </div>
        ))}
      </div>
    </div>
  )
}
