import { useState } from 'react'
import { UserRound, X } from 'lucide-react'
import { PERSONA_PRESETS } from '../../../../shared/config-types'
import { useChat } from '../../stores/chat'

/** Assign a persona (name + role prompt) to the active conversation. */
export function PersonaButton() {
  const [open, setOpen] = useState(false)
  const active = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId))
  const setPersona = useChat((s) => s.setPersona)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')

  if (!active) return null

  const openEditor = (): void => {
    setName(active.personaName ?? '')
    setPrompt(active.personaPrompt ?? '')
    setOpen(true)
  }

  const save = async (n: string | null, p: string | null): Promise<void> => {
    setOpen(false)
    await setPersona(n, p)
  }

  return (
    <>
      <button
        onClick={openEditor}
        title={
          active.personaName
            ? `Persona: ${active.personaName} — click to change`
            : 'Assign a persona to this agent'
        }
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${
          active.personaName
            ? 'border-violet-800 bg-violet-950/40 text-violet-300 hover:bg-violet-950/70'
            : 'border-[#30363d] bg-[#161b22] text-slate-300 hover:bg-[#21262d]'
        }`}
      >
        <UserRound size={13} />
        {active.personaName ?? 'Persona'}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="w-[520px] max-w-[92vw] rounded-xl border border-[#30363d] bg-[#10151c] p-4 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <UserRound size={16} className="text-violet-400" />
              <span className="font-medium text-slate-100">Persona for “{active.title}”</span>
              <button
                onClick={() => setOpen(false)}
                className="ml-auto text-slate-500 hover:text-slate-200"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PERSONA_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setName(preset.name)
                    setPrompt(preset.prompt)
                  }}
                  className="rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-300 hover:border-violet-700 hover:text-violet-300"
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Persona name (shown to peer agents)"
              className="mb-2 w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Role instructions (added to the agent's system prompt)"
              rows={5}
              className="mb-3 w-full resize-none rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
            />
            <div className="flex items-center gap-2">
              <p className="text-xs text-slate-600">Applies via session reconnect.</p>
              <div className="ml-auto flex gap-2">
                {active.personaName && (
                  <button
                    onClick={() => void save(null, null)}
                    className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-slate-400 hover:bg-[#21262d]"
                  >
                    Remove persona
                  </button>
                )}
                <button
                  onClick={() => void save(name.trim() || null, prompt.trim() || null)}
                  disabled={!name.trim()}
                  className="rounded-md bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
