import { useState } from 'react'
import { X, Plus, Trash2, MessageSquarePlus, Users } from 'lucide-react'
import { PERSONA_PRESETS } from '../../../../shared/config-types'
import { DEFAULT_MODEL, MODEL_CATALOG } from '../../../../shared/models'
import { useChat } from '../../stores/chat'

interface MemberDraft {
  provider: 'claude' | 'codex'
  model: string
  title: string
  persona: string // preset name or ''
}

function defaultMember(existing: MemberDraft[]): MemberDraft {
  const provider = 'claude'
  const count = existing.filter((m) => m.provider === provider).length
  return {
    provider,
    model: DEFAULT_MODEL[provider],
    title: count === 0 ? 'Claude' : `Claude-${count + 1}`,
    persona: ''
  }
}

export function NewConversationModal({ onClose }: { onClose: () => void }) {
  const newConversation = useChat((s) => s.newConversation)
  const newGroup = useChat((s) => s.newGroup)
  const [name, setName] = useState('')
  const [members, setMembers] = useState<MemberDraft[]>([defaultMember([])])
  const [creating, setCreating] = useState(false)

  const update = (i: number, patch: Partial<MemberDraft>): void => {
    setMembers((prev) =>
      prev.map((m, j) => {
        if (j !== i) return m
        const next = { ...m, ...patch }
        if (patch.provider && patch.provider !== m.provider) {
          next.model = DEFAULT_MODEL[patch.provider]
          const count = prev.filter((x, k) => k !== i && x.provider === patch.provider).length
          next.title = patch.provider === 'claude' ? 'Claude' : 'Codex'
          if (count > 0) next.title += `-${count + 1}`
        }
        if (patch.persona !== undefined && patch.persona) next.title = patch.persona
        return next
      })
    )
  }

  const create = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    try {
      if (members.length === 1) {
        const m = members[0]
        const preset = PERSONA_PRESETS.find((p) => p.name === m.persona)
        await newConversation(
          m.provider,
          m.model,
          preset ? { name: preset.name, prompt: preset.prompt } : null
        )
      } else {
        await newGroup(
          name.trim() || `Group: ${members.map((m) => m.title).join(', ')}`,
          members.map((m) => {
            const preset = PERSONA_PRESETS.find((p) => p.name === m.persona)
            return {
              provider: m.provider,
              model: m.model,
              title: m.title.trim() || m.provider,
              personaName: preset?.name ?? null,
              personaPrompt: preset?.prompt ?? null
            }
          })
        )
      }
      onClose()
    } finally {
      setCreating(false)
    }
  }

  const isGroup = members.length > 1
  const titlesUnique = new Set(members.map((m) => m.title.trim().toLowerCase())).size === members.length

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="w-[620px] max-w-[94vw] rounded-xl border border-[#30363d] bg-[#10151c] p-4 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          {isGroup ? (
            <Users size={16} className="text-cyan-400" />
          ) : (
            <MessageSquarePlus size={16} className="text-sky-400" />
          )}
          <span className="font-medium text-slate-100">
            {isGroup ? 'New group chat' : 'New conversation'}
          </span>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>

        {isGroup && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name (optional)"
            className="mb-3 w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
          />
        )}

        <div className="space-y-2">
          {members.map((m, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-2"
            >
              <select
                value={m.provider}
                onChange={(e) => update(i, { provider: e.target.value as 'claude' | 'codex' })}
                className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-sm"
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
              <select
                value={m.model}
                onChange={(e) => update(i, { model: e.target.value })}
                className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-sm"
              >
                {MODEL_CATALOG[m.provider].map((mod) => (
                  <option key={mod.id} value={mod.id}>
                    {mod.name}
                  </option>
                ))}
              </select>
              {isGroup && (
                <input
                  value={m.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder="Name (@-mention handle)"
                  className="w-36 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-sm"
                />
              )}
              <select
                value={m.persona}
                onChange={(e) => update(i, { persona: e.target.value })}
                className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-sm text-slate-400"
              >
                <option value="">No persona</option>
                {PERSONA_PRESETS.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              {members.length > 1 && (
                <button
                  onClick={() => setMembers((prev) => prev.filter((_, j) => j !== i))}
                  className="text-slate-600 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setMembers((prev) => [...prev, defaultMember(prev)])}
            className="flex items-center gap-1.5 rounded-md border border-[#30363d] px-2.5 py-1.5 text-sm text-slate-300 hover:bg-[#21262d]"
          >
            <Plus size={14} /> Add agent
          </button>
          {isGroup && (
            <span className="text-xs text-slate-600">
              Plain messages go to everyone; @Name targets one member.
            </span>
          )}
          <button
            onClick={() => void create()}
            disabled={creating || (isGroup && !titlesUnique)}
            className="ml-auto rounded-md bg-sky-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-40"
            title={isGroup && !titlesUnique ? 'Member names must be unique' : undefined}
          >
            {isGroup ? `Create group (${members.length})` : 'Create chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
