import { useState } from 'react'
import { Users, Trash2, Plus } from 'lucide-react'
import { PERSONA_PRESETS } from '../../../../shared/config-types'
import { DEFAULT_MODEL } from '../../../../shared/models'
import { useChat } from '../../stores/chat'

/** View and edit the lineup of the active group chat. */
export function GroupMembersPopover() {
  const active = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId))
  const adoptConversation = useChat((s) => s.adoptConversation)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [provider, setProvider] = useState<'claude' | 'codex'>('claude')
  const [title, setTitle] = useState('')
  const [persona, setPersona] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!active || active.kind !== 'group') return null
  const members = active.groupMembers ?? []

  const refresh = async (): Promise<void> => {
    await adoptConversation(active.id)
  }

  const addMember = async (): Promise<void> => {
    setError(null)
    const preset = PERSONA_PRESETS.find((p) => p.name === persona)
    try {
      await window.chimera.addGroupMember(active.id, {
        provider,
        model: DEFAULT_MODEL[provider],
        title: title.trim() || (preset?.name ?? provider),
        personaName: preset?.name ?? null,
        personaPrompt: preset?.prompt ?? null
      })
      setTitle('')
      setPersona('')
      setAdding(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const removeMember = async (memberId: string): Promise<void> => {
    setError(null)
    try {
      await window.chimera.removeGroupMember(memberId)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1 text-sm text-slate-300 hover:bg-[#21262d]"
        title="Group members"
      >
        <Users size={13} className="text-cyan-400" />
        {members.length}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 w-80 rounded-lg border border-[#30363d] bg-[#10151c] p-2 shadow-xl">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-300"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  m.provider === 'claude' ? 'bg-orange-400/70' : 'bg-emerald-400/70'
                }`}
              />
              <span className="flex-1 truncate">{m.title}</span>
              <button
                onClick={() => void removeMember(m.id)}
                className="text-slate-600 hover:text-red-400"
                title="Remove from group"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {adding ? (
            <div className="mt-1 space-y-1.5 rounded-md border border-[#30363d] bg-[#0d1117] p-2">
              <div className="flex gap-1.5">
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as 'claude' | 'codex')}
                  className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-xs"
                >
                  <option value="claude">Claude</option>
                  <option value="codex">Codex</option>
                </select>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Name"
                  className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-xs"
                />
              </div>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                className="w-full rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-xs text-slate-400"
              >
                <option value="">No persona</option>
                {PERSONA_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void addMember()}
                className="w-full rounded bg-cyan-700 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-600"
              >
                Add to group
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[#30363d] px-2 py-1.5 text-xs text-slate-400 hover:bg-[#161b22]"
            >
              <Plus size={12} /> Add member
            </button>
          )}
          {error && <p className="mt-1 px-1 text-xs text-red-400">{error}</p>}
          <p className="mt-1 px-1 text-[10px] text-slate-600">
            New members catch up on room history when first addressed.
          </p>
        </div>
      )}
    </div>
  )
}
