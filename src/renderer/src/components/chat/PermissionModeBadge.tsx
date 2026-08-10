import { Shield, ShieldAlert, ShieldCheck, Map } from 'lucide-react'
import { useChat } from '../../stores/chat'

const MODES = [
  { id: 'default', label: 'Ask for permission', icon: Shield },
  { id: 'acceptEdits', label: 'Auto-accept edits', icon: ShieldCheck },
  { id: 'plan', label: 'Plan mode (read-only)', icon: Map },
  { id: 'bypassPermissions', label: 'Full access (enables Codex bus replies)', icon: ShieldAlert }
] as const

export function PermissionModeBadge() {
  const active = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId))
  const setPermissionMode = useChat((s) => s.setPermissionMode)
  if (!active) return null

  const mode = MODES.find((m) => m.id === active.permissionMode) ?? MODES[0]
  const Icon = mode.icon

  return (
    <div className="flex items-center gap-1">
      <Icon
        size={13}
        className={mode.id === 'bypassPermissions' ? 'text-red-400' : 'text-slate-500'}
      />
      <select
        value={mode.id}
        onChange={(e) => {
          const next = e.target.value as (typeof MODES)[number]['id']
          if (
            next === 'bypassPermissions' &&
            !window.confirm(
              'Full access disables permission prompts (Claude) and the sandbox (Codex). Continue?'
            )
          ) {
            return
          }
          void setPermissionMode(next)
        }}
        className="rounded-md border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-xs text-slate-400 focus:outline-none"
        title="Permission mode for this conversation"
      >
        {MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  )
}
