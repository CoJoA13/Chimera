import { useEffect, useState } from 'react'
import { Globe, Trash2, Copy, Check } from 'lucide-react'

interface Peer {
  id: string
  name: string
  url: string
}

export function FederationPane() {
  const [status, setStatus] = useState<{ enabled: boolean; address: string | null; name: string } | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [peerName, setPeerName] = useState('')
  const [peerUrl, setPeerUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const refresh = async (): Promise<void> => {
    setStatus(await window.chimera.fedStatus())
    setPeers(await window.chimera.fedListPeers())
  }

  useEffect(() => {
    void refresh()
  }, [])

  if (!status) return null

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Federation connects two Chimera instances on a trusted network: your agents and a peer's
        agents see each other on the bus and can collaborate across machines, each running on its
        own subscriptions. Exchange addresses manually — the URL embeds a secret token, so share it
        only with people you trust. Anyone with the address can message your agents.
      </p>

      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
        <div className="flex items-center gap-2">
          <Globe size={16} className={status.enabled ? 'text-cyan-400' : 'text-slate-600'} />
          <span className="font-medium text-slate-200">This machine</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={status.enabled}
              onChange={(e) => void window.chimera.fedSetEnabled(e.target.checked).then(refresh)}
            />
            enabled
          </label>
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-slate-500">Name:</span>
          <input
            defaultValue={status.name}
            onBlur={(e) => void window.chimera.fedSetName(e.target.value || 'chimera')}
            className="w-32 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs"
          />
        </div>
        {status.enabled && status.address && (
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-[#161b22] px-2 py-1 text-xs text-cyan-300">
              {status.address}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(status.address!)
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
              className="text-slate-500 hover:text-slate-200"
              title="Copy your address for the peer"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-4">
        <p className="mb-2 text-sm font-medium text-slate-300">Peers</p>
        <div className="mb-2 flex gap-1.5">
          <input
            value={peerName}
            onChange={(e) => setPeerName(e.target.value)}
            placeholder="Peer name"
            className="w-28 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs"
          />
          <input
            value={peerUrl}
            onChange={(e) => setPeerUrl(e.target.value)}
            placeholder="http://192.168.…/fed/<token>"
            className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 font-mono text-xs"
          />
          <button
            onClick={() =>
              void window.chimera.fedAddPeer(peerName.trim(), peerUrl.trim()).then(() => {
                setPeerName('')
                setPeerUrl('')
                void refresh()
              })
            }
            disabled={!peerName.trim() || !peerUrl.trim()}
            className="rounded-md bg-cyan-700 px-3 py-1.5 text-xs text-white hover:bg-cyan-600 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {peers.length === 0 && <p className="text-xs text-slate-600">No peers yet.</p>}
        {peers.map((peer) => (
          <div key={peer.id} className="flex items-center gap-2 border-b border-[#161b22] py-1.5">
            <span className="text-sm text-slate-300">{peer.name}</span>
            <code className="min-w-0 flex-1 truncate text-xs text-slate-600">{peer.url}</code>
            <button
              onClick={() => void window.chimera.fedRemovePeer(peer.id).then(refresh)}
              className="text-slate-600 hover:text-red-400"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
