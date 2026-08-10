import { MessageSquarePlus, Trash2, Settings, Network } from 'lucide-react'
import { useChat } from '../../stores/chat'

export function Sidebar() {
  const conversations = useChat((s) => s.conversations)
  const activeConvId = useChat((s) => s.activeConvId)
  const statusByConv = useChat((s) => s.statusByConv)
  const busAwaitByConv = useChat((s) => s.busAwaitByConv)
  const unreadBusByConv = useChat((s) => s.unreadBusByConv)
  const newConversation = useChat((s) => s.newConversation)
  const selectConversation = useChat((s) => s.selectConversation)
  const deleteConversation = useChat((s) => s.deleteConversation)
  const setSettingsOpen = useChat((s) => s.setSettingsOpen)
  const activeView = useChat((s) => s.activeView)
  const setActiveView = useChat((s) => s.setActiveView)
  const inboundCount = useChat((s) => s.controlInbound.length)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[#21262d] bg-[#0a0d12]">
      <div className="flex gap-1.5 p-2">
        <button
          onClick={() => void newConversation('claude')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#30363d] px-2 py-2 text-sm text-slate-300 hover:bg-[#161b22]"
          title="New Claude chat"
        >
          <MessageSquarePlus size={14} />
          Claude
        </button>
        <button
          onClick={() => void newConversation('codex')}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#30363d] px-2 py-2 text-sm text-slate-300 hover:bg-[#161b22]"
          title="New Codex chat"
        >
          <MessageSquarePlus size={14} />
          Codex
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        {conversations.map((conv) => (
          <div
            key={conv.id}
            onClick={() => void selectConversation(conv.id)}
            className={`group mb-0.5 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              conv.id === activeConvId
                ? 'bg-[#1c2431] text-slate-100'
                : 'text-slate-400 hover:bg-[#131922]'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                conv.provider === 'claude' ? 'bg-orange-400/70' : 'bg-emerald-400/70'
              }`}
              title={conv.provider}
            />
            <span className="flex-1 truncate">
              {conv.title}
              {conv.personaName && (
                <span className="ml-1.5 rounded bg-violet-950/60 px-1 py-px text-[10px] text-violet-300">
                  {conv.personaName}
                </span>
              )}
            </span>
            {unreadBusByConv[conv.id] && (
              <Network size={12} className="shrink-0 text-violet-400" aria-label="New bus message" />
            )}
            {busAwaitByConv[conv.id] && (
              <Network
                size={12}
                className="shrink-0 animate-pulse text-cyan-400"
                aria-label="Awaiting bus reply"
              />
            )}
            {statusByConv[conv.id] === 'streaming' && (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky-400" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                void deleteConversation(conv.id)
              }}
              className="hidden shrink-0 text-slate-600 group-hover:block hover:text-red-400"
              title="Delete conversation"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </nav>
      <div className="border-t border-[#21262d] p-2">
        <button
          onClick={() => setActiveView(activeView === 'control' ? 'chat' : 'control')}
          className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            activeView === 'control'
              ? 'bg-cyan-950/40 text-cyan-300'
              : 'text-slate-400 hover:bg-[#161b22]'
          }`}
        >
          <Network size={15} />
          Control Room
          {inboundCount > 0 && (
            <span className="ml-auto rounded-full bg-violet-800 px-1.5 text-[10px] text-white">
              {inboundCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-[#161b22]"
        >
          <Settings size={15} />
          Settings
        </button>
      </div>
    </aside>
  )
}
