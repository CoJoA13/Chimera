import { useEffect, useRef, useState } from 'react'
import { Search, MessageSquare, Users } from 'lucide-react'
import { useChat } from '../../stores/chat'

interface Hit {
  conversationId: string
  title: string
  snippet: string | null
  kind: 'single' | 'group'
}

/** Cmd/Ctrl+K: fuzzy conversation switcher + full-text transcript search. */
export function CommandPalette() {
  const open = useChat((s) => s.paletteOpen)
  const setOpen = useChat((s) => s.setPaletteOpen)
  const conversations = useChat((s) => s.conversations)
  const selectConversation = useChat((s) => s.selectConversation)
  const [query, setQuery] = useState('')
  const [contentHits, setContentHits] = useState<Hit[]>([])
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setContentHits([])
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (query.trim().length < 2) {
      setContentHits([])
      return
    }
    debounce.current = setTimeout(() => {
      void window.chimera.searchAll(query.trim()).then((hits) => {
        setContentHits(
          hits.map((h) => ({
            ...h,
            snippet: h.snippet,
            kind: conversations.find((c) => c.id === h.conversationId)?.kind ?? 'single'
          }))
        )
      })
    }, 250)
  }, [query, conversations])

  if (!open) return null

  const q = query.trim().toLowerCase()
  const titleHits: Hit[] = conversations
    .filter((c) => !q || c.title.toLowerCase().includes(q))
    .slice(0, q ? 8 : 10)
    .map((c) => ({ conversationId: c.id, title: c.title, snippet: null, kind: c.kind }))
  const seen = new Set(titleHits.map((h) => h.conversationId))
  const results = [...titleHits, ...contentHits.filter((h) => !seen.has(h.conversationId))]

  const pick = (hit: Hit): void => {
    setOpen(false)
    void selectConversation(hit.conversationId)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, results.length - 1))
    else if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0))
    else if (e.key === 'Enter' && results[cursor]) pick(results[cursor])
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-[#30363d] bg-[#10151c] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[#21262d] px-3 py-2.5">
          <Search size={15} className="text-slate-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search conversations and messages…"
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none"
          />
          <kbd className="rounded border border-[#30363d] px-1.5 py-0.5 text-[10px] text-slate-600">
            esc
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-slate-600">No matches.</p>
          )}
          {results.map((hit, i) => (
            <button
              key={hit.conversationId}
              onClick={() => pick(hit)}
              onMouseEnter={() => setCursor(i)}
              className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left ${
                i === cursor ? 'bg-[#1c2431]' : ''
              }`}
            >
              {hit.kind === 'group' ? (
                <Users size={14} className="mt-0.5 shrink-0 text-cyan-400/80" />
              ) : (
                <MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-500" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-200">{hit.title}</span>
                {hit.snippet && (
                  <span className="block truncate text-xs text-slate-500">{hit.snippet}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
