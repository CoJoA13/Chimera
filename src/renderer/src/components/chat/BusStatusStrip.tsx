import { Network } from 'lucide-react'
import { useChat } from '../../stores/chat'

/** Shown above the composer while this conversation awaits a bus reply. */
export function BusStatusStrip() {
  const peerLocalId = useChat((s) => (s.activeConvId ? s.busAwaitByConv[s.activeConvId] : null))
  const peerTitle = useChat((s) => {
    if (!peerLocalId) return null
    const convId = s.convByLocal[peerLocalId] ?? peerLocalId
    return s.conversations.find((c) => c.id === convId)?.title ?? 'peer session'
  })
  if (!peerLocalId) return null

  return (
    <div className="border-t border-violet-900/40 bg-violet-950/20 px-4 py-1.5">
      <div className="mx-auto flex max-w-3xl items-center gap-2 text-xs text-violet-300">
        <Network size={13} className="animate-pulse" />
        Waiting for a reply from <span className="font-medium">{peerTitle}</span>…
      </div>
    </div>
  )
}
