import { useState } from 'react'
import { ArrowLeftToLine, ArrowRightFromLine, Network } from 'lucide-react'
import { useChat } from '../../stores/chat'

const COLLAPSE_THRESHOLD = 500

export function BusMessageCard({
  direction,
  peerLocalId,
  text,
  isReply
}: {
  direction: 'in' | 'out'
  peerLocalId: string
  text: string
  isReply: boolean
}) {
  const peerConv = useChat((s) => {
    const convId = s.convByLocal[peerLocalId] ?? peerLocalId
    return s.conversations.find((c) => c.id === convId)
  })
  const selectConversation = useChat((s) => s.selectConversation)
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > COLLAPSE_THRESHOLD
  const shownText = isLong && !expanded ? `${text.slice(0, COLLAPSE_THRESHOLD)}…` : text

  return (
    <div
      className={`my-2 rounded-lg border px-3 py-2 ${
        direction === 'in'
          ? 'border-violet-900/60 bg-violet-950/20'
          : 'border-cyan-900/60 bg-cyan-950/20'
      }`}
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
        <Network size={12} className={direction === 'in' ? 'text-violet-400' : 'text-cyan-400'} />
        {direction === 'in' ? (
          <ArrowLeftToLine size={12} className="text-violet-400" />
        ) : (
          <ArrowRightFromLine size={12} className="text-cyan-400" />
        )}
        <span>
          {isReply ? 'Reply' : 'Message'} {direction === 'in' ? 'from' : 'to'}{' '}
          {peerConv ? (
            <button
              onClick={() => void selectConversation(peerConv.id)}
              className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
            >
              {peerConv.title}
            </button>
          ) : peerLocalId === 'control-room' ? (
            <span className="text-cyan-300">Control Room</span>
          ) : (
            <span className="text-slate-500">another session</span>
          )}
        </span>
      </div>
      <div className="text-sm whitespace-pre-wrap text-slate-300">{shownText}</div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-slate-500 hover:text-slate-300"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
