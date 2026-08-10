import { FolderOpen } from 'lucide-react'
import { useChat } from '../../stores/chat'

/** Shows and changes the conversation's working directory. */
export function CwdButton() {
  const cwd = useChat((s) => s.conversations.find((c) => c.id === s.activeConvId)?.cwd ?? null)
  const setCwd = useChat((s) => s.setCwd)
  const label = cwd ? (cwd.split('/').filter(Boolean).pop() ?? cwd) : '~'

  return (
    <button
      onClick={() => void setCwd()}
      title={`Working directory: ${cwd ?? 'home'} — click to change (reconnects the session)`}
      className="flex max-w-[160px] items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1 text-sm text-slate-300 hover:bg-[#21262d]"
    >
      <FolderOpen size={13} className="shrink-0 text-slate-500" />
      <span className="truncate">{label}</span>
    </button>
  )
}
