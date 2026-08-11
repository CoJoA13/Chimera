import { useMemo, useState } from 'react'
import { Brain, X } from 'lucide-react'
import { useChat, type Block } from '../../stores/chat'
import { ToolCallCard } from './ToolCallCard'
import { ThinkingBlock } from './ThinkingBlock'
import { EventTime } from './EventTime'

function isActivity(block: Block): boolean {
  return block.kind === 'thinking' || block.kind === 'tool' || block.kind === 'bus' || block.kind === 'error' || block.kind === 'verification'
}

export function ActivityInspector() {
  const activeId = useChat((s) => s.activeConvId)
  const open = useChat((s) => s.activityInspectorOpen)
  const selected = useChat((s) => s.activityInspectorSelection)
  const close = useChat((s) => s.closeActivityInspector)
  const activity = useChat((s) => (activeId ? s.activityByConv[activeId] : undefined))
  const blocks = useChat((s) => (activeId ? (s.blocksByConv[activeId] ?? []) : []))
  const [member, setMember] = useState<string>('all')
  const members = useMemo(
    () => [...new Set(blocks.flatMap((block) => ('memberName' in block && block.memberName ? [block.memberName] : [])))],
    [blocks]
  )
  const entries = blocks.filter((block) => isActivity(block) && (member === 'all' || ('memberName' in block && block.memberName === member)))
  const hasThinking = entries.some((block) => block.kind === 'thinking')
  if (!open) return null

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[420px] flex-col border-l border-[#30363d] bg-[#0d1117] shadow-2xl lg:static lg:z-auto lg:w-[360px] lg:shrink-0 lg:shadow-none">
      <div className="flex items-center gap-2 border-b border-[#30363d] px-3 py-3">
        <Brain size={15} className="text-cyan-400" />
        <span className="text-sm font-semibold text-slate-100">Agent activity</span>
        <span className="ml-auto text-xs text-slate-500">{activity?.phase ?? 'idle'}</span>
        <button onClick={close} className="rounded p-1 text-slate-500 hover:bg-[#21262d] hover:text-slate-200" aria-label="Close activity inspector">
          <X size={15} />
        </button>
      </div>
      {members.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-[#21262d] p-2">
          {['all', ...members].map((name) => (
            <button key={name} onClick={() => setMember(name)} className={`rounded-full px-2 py-1 text-xs ${member === name ? 'bg-cyan-900/60 text-cyan-200' : 'bg-[#161b22] text-slate-500'}`}>
              {name === 'all' ? 'All agents' : name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3">
        {!hasThinking && activity?.phase !== 'idle' && (
          <div className="mb-3 rounded-lg border border-slate-800 bg-[#11151c] p-3 text-xs text-slate-400">
            No provider-supplied reasoning is available for this turn. Live status and tool activity will still appear here.
          </div>
        )}
        {entries.length === 0 ? (
          <div className="mt-16 text-center text-sm text-slate-600">Tool calls, reasoning, and agent traffic will appear here.</div>
        ) : (
          entries.map((block) => (
            <div key={block.id} data-selected={selected === block.id || undefined} className={selected === block.id ? 'rounded-lg ring-1 ring-cyan-700' : ''}>
              <div className="flex items-center gap-2 px-1 pt-2 text-[11px] text-slate-600">
                {'memberName' in block && block.memberName && <span className="text-slate-400">{block.memberName}</span>}
                <EventTime at={block.at} className="ml-auto" />
              </div>
              {block.kind === 'tool' && <ToolCallCard toolName={block.toolName} input={block.input} output={block.output} isError={block.isError} done={block.done} defaultOpen={selected === block.id} />}
              {block.kind === 'thinking' && <ThinkingBlock text={block.text} streaming={block.streaming} defaultOpen={selected === block.id} />}
              {block.kind === 'bus' && <div className="my-2 rounded-lg border border-violet-900/40 bg-violet-950/20 p-2 text-xs whitespace-pre-wrap text-violet-200">{block.direction === 'in' ? 'From' : 'To'} {block.peerLocalId}: {block.text}</div>}
              {block.kind === 'error' && <div className="my-2 rounded-lg border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-300">{block.text}</div>}
              {block.kind === 'verification' && <div className="my-2 rounded-lg border border-slate-800 p-2 text-xs text-slate-300">Verification: {block.verdict} — {block.note}</div>}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
