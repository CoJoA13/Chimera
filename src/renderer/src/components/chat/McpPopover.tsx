import { useEffect, useState } from 'react'
import { Server, RefreshCw } from 'lucide-react'
import type { ConversationMcpState } from '../../../../shared/config-types'
import { useChat } from '../../stores/chat'

/** Per-conversation MCP toggles. Changes apply after a session reconnect. */
export function McpPopover() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<ConversationMcpState[]>([])
  const [dirty, setDirty] = useState(false)
  const activeConvId = useChat((s) => s.activeConvId)
  const restart = useChat((s) => s.restartActiveSession)

  useEffect(() => {
    if (open && activeConvId) {
      void window.chimera.conversationMcp(activeConvId).then(setState)
    }
  }, [open, activeConvId])

  if (!activeConvId) return null

  const toggle = async (serverId: string, enabled: boolean): Promise<void> => {
    await window.chimera.setConversationMcp(activeConvId, serverId, enabled)
    setState(await window.chimera.conversationMcp(activeConvId))
    setDirty(true)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="MCP servers for this conversation"
        className="flex items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1 text-sm text-slate-300 hover:bg-[#21262d]"
      >
        <Server size={13} />
        MCP
        <span className="text-xs text-slate-500">{state.filter((s) => s.enabled).length || ''}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 w-72 rounded-lg border border-[#30363d] bg-[#10151c] p-2 shadow-xl">
          {state.length === 0 && (
            <p className="px-2 py-1 text-xs text-slate-500">
              No MCP servers configured. Add them in Settings.
            </p>
          )}
          {state.map(({ server, enabled }) => (
            <label
              key={server.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-300 hover:bg-[#161b22]"
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => void toggle(server.id, e.target.checked)}
              />
              <span className="truncate">{server.name}</span>
              <span className="ml-auto text-[10px] tracking-wide text-slate-600 uppercase">
                {server.transport.type}
              </span>
            </label>
          ))}
          {dirty && (
            <button
              onClick={() => {
                setDirty(false)
                setOpen(false)
                void restart()
              }}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-sky-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-sky-600"
            >
              <RefreshCw size={12} />
              Apply and reconnect session
            </button>
          )}
        </div>
      )}
    </div>
  )
}
