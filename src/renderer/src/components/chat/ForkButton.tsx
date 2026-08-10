import { GitBranch } from 'lucide-react'
import { useChat } from '../../stores/chat'

/** Branch a Claude conversation from its current point into a new one. */
export function ForkButton() {
  const active = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId))
  const adoptConversation = useChat((s) => s.adoptConversation)

  if (!active || active.kind !== 'single' || active.provider !== 'claude' || !active.providerSessionId) {
    return null
  }

  const fork = async (): Promise<void> => {
    const created = await window.chimera.forkConversation(active.id)
    await adoptConversation(created.id)
  }

  return (
    <button
      onClick={() => void fork()}
      title="Fork this conversation — branch from here without affecting the original"
      className="flex items-center rounded-md border border-[#30363d] bg-[#161b22] p-1.5 text-slate-400 hover:bg-[#21262d]"
    >
      <GitBranch size={13} />
    </button>
  )
}
