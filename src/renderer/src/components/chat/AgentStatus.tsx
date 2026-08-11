import { useEffect, useState } from 'react'
import { Brain, Circle, Hand, Loader2, MessageCircle, Users, Wrench } from 'lucide-react'
import { useChat } from '../../stores/chat'
import type { ActivityPhase } from '../../../../shared/activity'

const LABELS: Record<ActivityPhase, string> = {
  idle: 'Idle',
  queued: 'Queued',
  thinking: 'Thinking',
  using_tool: 'Using tool',
  waiting_permission: 'Needs approval',
  waiting_peer: 'Waiting for agent',
  responding: 'Responding',
  error: 'Error'
}

function elapsed(since: number | null, now: number): string {
  if (since === null) return ''
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function AgentStatus() {
  const activeId = useChat((s) => s.activeConvId)
  const activity = useChat((s) => (activeId ? s.activityByConv[activeId] : undefined))
  const open = useChat((s) => s.openActivityInspector)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!activity || activity.phase === 'idle') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [activity])
  const phase = activity?.phase ?? 'idle'
  const Icon =
    phase === 'using_tool' ? Wrench : phase === 'waiting_permission' ? Hand : phase === 'waiting_peer' ? Users : phase === 'responding' ? MessageCircle : phase === 'idle' ? Circle : phase === 'error' ? Circle : phase === 'queued' ? Loader2 : Brain
  const busy = phase !== 'idle' && phase !== 'error'
  return (
    <button
      onClick={() => open()}
      className="flex max-w-[220px] items-center gap-1.5 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-300 hover:border-slate-600"
      title="Open activity inspector"
    >
      <Icon size={12} className={busy ? 'text-cyan-400' : phase === 'error' ? 'text-red-400' : 'text-slate-600'} />
      <span>{LABELS[phase]}</span>
      {activity?.memberName && <span className="truncate text-slate-500">· {activity.memberName}</span>}
      {activity?.detail && <span className="truncate text-slate-500">· {activity.detail}</span>}
      {busy && <span className="tabular-nums text-slate-600">{elapsed(activity?.since ?? null, now)}</span>}
    </button>
  )
}
