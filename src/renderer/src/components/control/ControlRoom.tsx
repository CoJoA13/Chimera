import { useEffect, useState } from 'react'
import {
  Radio,
  Network,
  ArrowRight,
  RefreshCw,
  Loader2,
  MessageSquareReply,
  Inbox
} from 'lucide-react'
import { useChat } from '../../stores/chat'
import { MissionsSection } from './MissionsSection'
import { BriefSection } from './BriefSection'
import { EventTime } from '../chat/EventTime'

interface TimelineRow {
  messageId: string
  fromId: string
  toId: string
  inReplyTo: string | null
  kind: string
  text: string
  createdAt: number
}

interface ConferenceResult {
  conversationId: string
  status: 'replied' | 'timeout' | 'error'
  text?: string
  error?: string
}

const CONTROL_ROOM_ID = 'control-room'

export function ControlRoom() {
  const conversations = useChat((s) => s.conversations)
  const controlInbound = useChat((s) => s.controlInbound)
  const selectConversation = useChat((s) => s.selectConversation)

  const [timeline, setTimeline] = useState<TimelineRow[]>([])
  const [question, setQuestion] = useState('')
  const [targets, setTargets] = useState<string[]>([])
  const [synthesizer, setSynthesizer] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<ConferenceResult[] | null>(null)

  const refreshTimeline = async (): Promise<void> => {
    setTimeline(await window.chimera.busHistory())
  }

  useEffect(() => {
    void refreshTimeline()
    const interval = setInterval(() => void refreshTimeline(), 5000)
    return () => clearInterval(interval)
  }, [])

  const nameOf = (id: string): string => {
    if (id === CONTROL_ROOM_ID) return 'Control Room'
    const conv = conversations.find((c) => c.id === id)
    if (!conv) return 'deleted session'
    return conv.personaName ? `${conv.title} (${conv.personaName})` : conv.title
  }

  const runConference = async (): Promise<void> => {
    if (!question.trim() || targets.length === 0 || running) return
    setRunning(true)
    setResults(null)
    try {
      const replies = await window.chimera.runConference(
        question.trim(),
        targets,
        synthesizer || null,
        120
      )
      setResults(replies)
      await refreshTimeline()
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-1 gap-4 overflow-hidden p-4">
      {/* Left: brief + missions + conference + inbound reports */}
      <div className="flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto">
        <BriefSection />
        <MissionsSection />
        <section className="rounded-xl border border-[#30363d] bg-[#10151c] p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-100">
            <Radio size={16} className="text-cyan-400" />
            <span className="font-medium">Conference</span>
          </div>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="One question for multiple agents…"
            rows={3}
            className="mb-2 w-full resize-none rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm"
          />
          <div className="mb-2 space-y-1">
            {conversations.map((conv) => (
              <label
                key={conv.id}
                className="flex items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-300 hover:bg-[#161b22]"
              >
                <input
                  type="checkbox"
                  checked={targets.includes(conv.id)}
                  onChange={(e) =>
                    setTargets(
                      e.target.checked
                        ? [...targets, conv.id]
                        : targets.filter((t) => t !== conv.id)
                    )
                  }
                />
                <span className="truncate">{nameOf(conv.id)}</span>
                <span className="ml-auto text-[10px] tracking-wide text-slate-600 uppercase">
                  {conv.provider}
                </span>
              </label>
            ))}
          </div>
          <select
            value={synthesizer}
            onChange={(e) => setSynthesizer(e.target.value)}
            className="mb-3 w-full rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-sm text-slate-400"
          >
            <option value="">No synthesis — just collect answers</option>
            {conversations.map((conv) => (
              <option key={conv.id} value={conv.id}>
                Synthesize in: {nameOf(conv.id)}
              </option>
            ))}
          </select>
          <button
            onClick={() => void runConference()}
            disabled={!question.trim() || targets.length === 0 || running}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-40"
          >
            {running ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Collecting answers…
              </>
            ) : (
              <>Ask {targets.length || ''} session{targets.length === 1 ? '' : 's'}</>
            )}
          </button>

          {results && (
            <div className="mt-3 space-y-2">
              {results.map((r) => (
                <div
                  key={r.conversationId}
                  className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2.5"
                >
                  <div className="mb-1 flex items-center gap-1.5 text-xs">
                    <MessageSquareReply
                      size={12}
                      className={r.status === 'replied' ? 'text-emerald-400' : 'text-amber-400'}
                    />
                    <button
                      onClick={() => void selectConversation(r.conversationId)}
                      className="text-sky-400 hover:underline"
                    >
                      {nameOf(r.conversationId)}
                    </button>
                    {r.status !== 'replied' && (
                      <span className="text-amber-400">({r.status})</span>
                    )}
                  </div>
                  {r.text && (
                    <div className="max-h-40 overflow-y-auto text-sm whitespace-pre-wrap text-slate-300">
                      {r.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[#30363d] bg-[#10151c] p-4">
          <div className="mb-2 flex items-center gap-2 text-slate-100">
            <Inbox size={15} className="text-violet-400" />
            <span className="font-medium">Reports to you</span>
          </div>
          {controlInbound.length === 0 ? (
            <p className="text-xs text-slate-600">
              Agents can send you reports with send_to_session → "Control Room".
            </p>
          ) : (
            <div className="space-y-2">
              {[...controlInbound].reverse().map((msg) => (
                <div
                  key={msg.messageId}
                  className="rounded-lg border border-violet-900/50 bg-violet-950/20 p-2.5"
                >
                  <div className="mb-1 text-xs text-violet-300">
                    {nameOf(msg.fromId)} · <EventTime at={msg.at} />
                  </div>
                  <div className="text-sm whitespace-pre-wrap text-slate-300">{msg.text}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Right: bus timeline */}
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-[#30363d] bg-[#10151c]">
        <div className="flex items-center gap-2 border-b border-[#21262d] px-4 py-3 text-slate-100">
          <Network size={16} className="text-cyan-400" />
          <span className="font-medium">Bus timeline</span>
          <span className="text-xs text-slate-600">{timeline.length} messages</span>
          <button
            onClick={() => void refreshTimeline()}
            className="ml-auto text-slate-500 hover:text-slate-200"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {timeline.length === 0 && (
            <p className="mt-8 text-center text-sm text-slate-600">
              No agent-to-agent traffic yet. Run a conference or ask a session to message a peer.
            </p>
          )}
          {timeline.map((row) => (
            <div key={row.messageId} className="mb-2 rounded-lg border border-[#21262d] bg-[#0d1117] px-3 py-2">
              <div className="mb-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                <span className={row.kind === 'replied' ? 'text-violet-400' : 'text-cyan-400'}>
                  {nameOf(row.fromId)}
                </span>
                <ArrowRight size={11} />
                <span>{nameOf(row.toId)}</span>
                {row.inReplyTo && <span className="text-violet-500">(reply)</span>}
                <EventTime at={row.createdAt} className="ml-auto" />
              </div>
              <div className="line-clamp-3 text-sm whitespace-pre-wrap text-slate-300">
                {row.text}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
