import { ShieldQuestion } from 'lucide-react'
import { useChat } from '../../stores/chat'

/** Toggle cross-model auto-verification for the active conversation. */
export function VerifyToggle() {
  const active = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId))
  if (!active || active.kind === 'group') return null

  const toggle = async (): Promise<void> => {
    const enabled = !active.autoVerify
    await window.chimera.setAutoVerify(active.id, enabled)
    useChat.setState((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === active.id ? { ...c, autoVerify: enabled } : c
      )
    }))
  }

  return (
    <button
      onClick={() => void toggle()}
      title={
        active.autoVerify
          ? 'Auto-verify ON: answers are checked by the other provider'
          : 'Auto-verify: have the other provider fact-check every answer'
      }
      className={`flex items-center rounded-md border p-1.5 ${
        active.autoVerify
          ? 'border-emerald-800 bg-emerald-950/40 text-emerald-400'
          : 'border-[#30363d] bg-[#161b22] text-slate-400 hover:bg-[#21262d]'
      }`}
    >
      <ShieldQuestion size={13} />
    </button>
  )
}
