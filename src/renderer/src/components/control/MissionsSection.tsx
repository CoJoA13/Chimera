import { useEffect, useState } from 'react'
import { Target, Trash2, Plus } from 'lucide-react'
import { useChat } from '../../stores/chat'

interface MissionRow {
  id: string
  title: string
  goal: string
  conversationId: string
  status: 'active' | 'paused' | 'done'
  progress: string | null
  updatedAt: number
}

const STATUS_CLS: Record<MissionRow['status'], string> = {
  active: 'text-cyan-300 bg-cyan-950/40',
  paused: 'text-amber-300 bg-amber-950/40',
  done: 'text-emerald-300 bg-emerald-950/40'
}

export function MissionsSection() {
  const conversations = useChat((s) => s.conversations)
  const selectConversation = useChat((s) => s.selectConversation)
  const [missions, setMissions] = useState<MissionRow[]>([])
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [convId, setConvId] = useState('')
  const [hours, setHours] = useState(24)

  const refresh = async (): Promise<void> => {
    setMissions(await window.chimera.listMissions())
  }

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(interval)
  }, [])

  const add = async (): Promise<void> => {
    if (!title.trim() || !goal.trim() || !convId) return
    await window.chimera.addMission(title.trim(), goal.trim(), convId, {
      type: 'interval',
      minutes: hours * 60
    })
    setTitle('')
    setGoal('')
    setAdding(false)
    await refresh()
  }

  return (
    <section className="rounded-xl border border-[#30363d] bg-[#10151c] p-4">
      <div className="mb-2 flex items-center gap-2 text-slate-100">
        <Target size={15} className="text-cyan-400" />
        <span className="font-medium">Missions</span>
        <button
          onClick={() => setAdding(!adding)}
          className="ml-auto text-slate-500 hover:text-slate-200"
          title="New mission"
        >
          <Plus size={14} />
        </button>
      </div>

      {adding && (
        <div className="mb-2 space-y-1.5 rounded-lg border border-[#30363d] bg-[#0d1117] p-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mission title"
            className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs"
          />
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="The goal, in enough detail to work from over days…"
            rows={3}
            className="w-full resize-none rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs"
          />
          <div className="flex items-center gap-1.5 text-xs">
            <select
              value={convId}
              onChange={(e) => setConvId(e.target.value)}
              className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1"
            >
              <option value="">Assign to…</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} {c.kind === 'group' ? '(group)' : ''}
                </option>
              ))}
            </select>
            <span className="text-slate-500">every</span>
            <input
              type="number"
              min={1}
              max={168}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="w-14 rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1"
            />
            <span className="text-slate-500">h</span>
          </div>
          <button
            onClick={() => void add()}
            disabled={!title.trim() || !goal.trim() || !convId}
            className="w-full rounded bg-cyan-700 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-40"
          >
            Launch mission
          </button>
        </div>
      )}

      {missions.length === 0 && !adding && (
        <p className="text-xs text-slate-600">
          A mission is a goal that outlives sessions: the assigned agent works it on a cadence,
          keeps progress in memory, and reports milestones here.
        </p>
      )}
      <div className="space-y-1.5">
        {missions.map((m) => (
          <div key={m.id} className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5">
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-px text-[10px] uppercase ${STATUS_CLS[m.status]}`}>
                {m.status}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{m.title}</span>
              <button
                onClick={() => void selectConversation(m.conversationId)}
                className="text-xs text-sky-400 hover:underline"
              >
                open
              </button>
              <button
                onClick={() => void window.chimera.removeMission(m.id).then(refresh)}
                className="text-slate-600 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
            {m.progress && <p className="mt-1 text-xs text-slate-400">{m.progress}</p>}
            <p className="mt-0.5 text-[10px] text-slate-600">
              updated {new Date(m.updatedAt).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
