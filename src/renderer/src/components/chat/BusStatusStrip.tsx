import { Network } from 'lucide-react'
import { useChat } from '../../stores/chat'

/** Shown above the composer while this conversation awaits bus replies. */
export function BusStatusStrip() {
  const awaitState = useChat((s) => (s.activeConvId ? s.busAwaitByConv[s.activeConvId] : null))
  const peerTitle = useChat((s) => {
    if (!awaitState?.peer) return null
    const convId = s.convByLocal[awaitState.peer] ?? awaitState.peer
    return s.conversations.find((c) => c.id === convId)?.title ?? 'peer session'
  })
  if (!awaitState) return null

  const label =
    awaitState.count > 1 ? (
      <>
        Waiting for replies from <span className="font-medium">{awaitState.count} sessions</span>…
      </>
    ) : (
      <>
        Waiting for a reply from <span className="font-medium">{peerTitle ?? 'a peer'}</span>…
      </>
    )

  return (
    <div className="border-t border-violet-900/40 bg-violet-950/20 px-4 py-1.5">
      <div className="mx-auto flex max-w-3xl items-center gap-2 text-xs text-violet-300">
        <Network size={13} className="animate-pulse" />
        {label}
      </div>
    </div>
  )
}
