import { useEffect, useState } from 'react'
import { CalendarClock, Trash2 } from 'lucide-react'
import { useChat } from '../../stores/chat'

type Cadence = { type: 'interval'; minutes: number } | { type: 'daily'; time: string }

interface ScheduleRow {
  id: string
  conversationId: string
  prompt: string
  cadence: Cadence
  enabled: boolean
  nextRunAt: number
  lastRunAt: number | null
}

export function SchedulesPane() {
  const conversations = useChat((s) => s.conversations)
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [convId, setConvId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<'daily' | 'interval'>('daily')
  const [time, setTime] = useState('08:00')
  const [hours, setHours] = useState(4)

  const refresh = async (): Promise<void> => {
    setSchedules(await window.chimera.listSchedules())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const add = async (): Promise<void> => {
    if (!convId || !prompt.trim()) return
    const cadence: Cadence =
      mode === 'daily' ? { type: 'daily', time } : { type: 'interval', minutes: hours * 60 }
    await window.chimera.addSchedule(convId, prompt.trim(), cadence)
    setPrompt('')
    await refresh()
  }

  const titleOf = (id: string): string =>
    conversations.find((c) => c.id === id)?.title ?? 'deleted conversation'

  const cadenceLabel = (c: Cadence): string =>
    c.type === 'daily' ? `daily at ${c.time}` : `every ${Math.round(c.minutes / 60)}h`

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Scheduled prompts run in their conversation like a normal message — while the app is open.
        Combine with personas and memory for standing jobs (e.g. a morning repo report).
      </p>

      <div className="space-y-2 rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
        <select
          value={convId}
          onChange={(e) => setConvId(e.target.value)}
          className="w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
        >
          <option value="">Choose a conversation…</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} {c.kind === 'group' ? '(group)' : ''}
            </option>
          ))}
        </select>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="The prompt to send on schedule…"
          rows={2}
          className="w-full resize-none rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
        />
        <div className="flex items-center gap-2 text-sm">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'daily' | 'interval')}
            className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5"
          >
            <option value="daily">Daily at</option>
            <option value="interval">Every</option>
          </select>
          {mode === 'daily' ? (
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1"
            />
          ) : (
            <>
              <input
                type="number"
                min={1}
                max={168}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="w-16 rounded border border-[#30363d] bg-[#161b22] px-2 py-1"
              />
              <span className="text-slate-400">hours</span>
            </>
          )}
          <button
            onClick={() => void add()}
            disabled={!convId || !prompt.trim()}
            className="ml-auto rounded-md bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600 disabled:opacity-40"
          >
            Add schedule
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {schedules.length === 0 && <p className="text-sm text-slate-500">No schedules yet.</p>}
        {schedules.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          >
            <CalendarClock size={14} className="shrink-0 text-slate-500" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-200">
                {titleOf(s.conversationId)}
                <span className="ml-2 text-xs text-slate-500">{cadenceLabel(s.cadence)}</span>
              </div>
              <div className="truncate text-xs text-slate-500">{s.prompt}</div>
              <div className="text-[11px] text-slate-600">
                next: {new Date(s.nextRunAt).toLocaleString()}
                {s.lastRunAt && ` · last: ${new Date(s.lastRunAt).toLocaleString()}`}
              </div>
            </div>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) =>
                  void window.chimera.setScheduleEnabled(s.id, e.target.checked).then(refresh)
                }
              />
              on
            </label>
            <button
              onClick={() => void window.chimera.removeSchedule(s.id).then(refresh)}
              className="text-slate-600 hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
