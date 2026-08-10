import { useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { useChat } from '../../stores/chat'

/** Save the active conversation's lineup (members/personas/models) as a template. */
export function TemplateButton() {
  const active = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId))
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)

  if (!active) return null

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    await window.chimera.saveTemplate(active.id, name.trim())
    setSaved(true)
    setTimeout(() => {
      setOpen(false)
      setSaved(false)
      setName('')
    }, 900)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Save this lineup as a template"
        className="flex items-center rounded-md border border-[#30363d] bg-[#161b22] p-1.5 text-slate-400 hover:bg-[#21262d]"
      >
        <LayoutTemplate size={13} />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-56 rounded-lg border border-[#30363d] bg-[#10151c] p-2 shadow-xl">
          {saved ? (
            <p className="py-1 text-center text-xs text-emerald-400">Template saved</p>
          ) : (
            <>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void save()}
                placeholder="Template name"
                autoFocus
                className="mb-1.5 w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs"
              />
              <button
                onClick={() => void save()}
                disabled={!name.trim()}
                className="w-full rounded bg-sky-700 px-2 py-1 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-40"
              >
                Save template
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
