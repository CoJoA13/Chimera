import { Virtuoso } from 'react-virtuoso'
import { AlertTriangle, Brain, CheckCircle2, Loader2, Wrench, XCircle } from 'lucide-react'
import { useChat, type Block } from '../../stores/chat'
import { MarkdownBlock } from './MarkdownBlock'
import { BusMessageCard } from './BusMessageCard'
import { VerificationChip } from './VerificationChip'
import { EventTime } from './EventTime'

const MEMBER_COLORS = [
  'text-orange-300',
  'text-emerald-300',
  'text-sky-300',
  'text-pink-300',
  'text-yellow-300',
  'text-violet-300'
]

function memberColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return MEMBER_COLORS[Math.abs(hash) % MEMBER_COLORS.length]
}

function MemberLabel({ name }: { name?: string }) {
  if (!name) return null
  return (
    <div className={`mb-0.5 text-xs font-semibold ${memberColor(name)}`}>{name}</div>
  )
}

function renderBlock(block: Block, onInspect: (id: string) => void) {
  switch (block.kind) {
    case 'user':
      return (
        <div className="my-3 flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-sky-900/50 px-4 py-2.5 text-[15px] whitespace-pre-wrap">
            {block.text}
            {block.attachments && block.attachments.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {block.attachments.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className="rounded bg-sky-950/60 px-1.5 py-0.5 text-xs text-sky-300"
                  >
                    📎 {name}
                  </span>
                ))}
              </div>
            )}
            <EventTime at={block.at} className="mt-1 block text-right text-[10px] text-sky-400/60" />
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className="my-2">
          <MemberLabel name={block.memberName} />
          <MarkdownBlock text={block.text} />
          {block.streaming && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-slate-400 align-text-bottom" />
          )}
          <EventTime at={block.at} className="mt-1 block text-[10px] text-slate-600" />
        </div>
      )
    case 'thinking':
      return (
        <button onClick={() => onInspect(block.id)} className="my-1 flex items-center gap-1.5 rounded-full border border-slate-800 bg-[#11151c] px-2.5 py-1 text-xs text-slate-500 hover:border-slate-600 hover:text-slate-300">
          <Brain size={12} /> {block.streaming ? 'Thinking…' : 'Reasoning'}
          <EventTime at={block.at} className="text-[10px] text-slate-700" />
        </button>
      )
    case 'tool':
      return (
        <button onClick={() => onInspect(block.id)} className="my-1 flex max-w-full items-center gap-1.5 rounded-full border border-[#30363d] bg-[#161b22] px-2.5 py-1 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-200">
          <Wrench size={12} />
          <span className="truncate font-mono">{block.toolName}</span>
          {!block.done ? <Loader2 size={12} className="animate-spin text-sky-400" /> : block.isError ? <XCircle size={12} className="text-red-400" /> : <CheckCircle2 size={12} className="text-emerald-400" />}
          <EventTime at={block.at} className="text-[10px] text-slate-600" />
        </button>
      )
    case 'footer':
      return (
        <div className="my-2 flex items-center gap-3 text-xs text-slate-600">
          {block.memberName && (
            <span className={memberColor(block.memberName)}>{block.memberName}</span>
          )}
          <EventTime at={block.at} className="ml-auto" />
          {block.isError ? (
            <span className="flex items-center gap-1 text-red-400">
              <AlertTriangle size={12} />
              {block.errorMessage ?? 'Turn failed'}
            </span>
          ) : (
            <>
              {block.usage && (
                <span>
                  {block.usage.inputTokens.toLocaleString()} in /{' '}
                  {block.usage.outputTokens.toLocaleString()} out
                </span>
              )}
              {block.costUsd !== undefined && <span>${block.costUsd.toFixed(4)}</span>}
              {block.durationMs !== undefined && (
                <span>{(block.durationMs / 1000).toFixed(1)}s</span>
              )}
            </>
          )}
        </div>
      )
    case 'error':
      return (
        <div className="my-3 flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
          <AlertTriangle size={15} />
          {block.text}
        </div>
      )
    case 'bus':
      return (
        <BusMessageCard
          direction={block.direction}
          peerLocalId={block.peerLocalId}
          text={block.text}
          isReply={block.isReply}
        />
      )
    case 'verification':
      return <VerificationChip verdict={block.verdict} note={block.note} verifier={block.verifier} />
  }
}

const EMPTY_BLOCKS: Block[] = []

export function ChatView() {
  const blocks = useChat((s) =>
    s.activeConvId ? (s.blocksByConv[s.activeConvId] ?? EMPTY_BLOCKS) : EMPTY_BLOCKS
  )
  const openInspector = useChat((s) => s.openActivityInspector)

  if (blocks.length === 0) {
    return (
      <div className="flex-1 px-4">
        <div className="mt-24 text-center text-slate-600">
          <p className="text-2xl font-light">Chimera</p>
          <p className="mt-2 text-sm">Start a conversation.</p>
        </div>
      </div>
    )
  }

  return (
    <Virtuoso
      className="flex-1"
      data={blocks}
      computeItemKey={(_i, block) => block.id}
      // Pin to bottom only while already at the bottom; don't yank during reading.
      followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
      initialTopMostItemIndex={blocks.length - 1}
      increaseViewportBy={{ top: 600, bottom: 300 }}
      itemContent={(_i, block) => (
        // flow-root stops child margins collapsing through the wrapper, which
        // was breaking Virtuoso's height measurement (blank rows on scroll).
        <div className="flow-root px-4">
          <div className="mx-auto max-w-3xl">{renderBlock(block, openInspector)}</div>
        </div>
      )}
      components={{
        Header: () => <div className="h-4" />,
        Footer: () => <div className="h-4" />
      }}
    />
  )
}
