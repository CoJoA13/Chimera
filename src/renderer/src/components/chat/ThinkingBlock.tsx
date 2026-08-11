import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

export function ThinkingBlock({ text, streaming, defaultOpen = false }: { text: string; streaming: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="my-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Brain size={12} />
        {streaming ? 'Thinking…' : 'Thought process'}
      </button>
      {open && (
        <div className="mt-1 rounded border-l-2 border-slate-700 bg-[#11151c] px-3 py-2 text-[13px] whitespace-pre-wrap text-slate-400 italic">
          {text}
        </div>
      )}
    </div>
  )
}
