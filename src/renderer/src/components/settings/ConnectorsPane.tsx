import { useEffect, useState } from 'react'
import { Plug, Check, ExternalLink } from 'lucide-react'
import type { ConnectorEntry } from '../../../../shared/ipc'

export function ConnectorsPane() {
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([])

  const refresh = async (): Promise<void> => {
    setConnectors(await window.chimera.listConnectors())
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <div className="grid grid-cols-2 gap-3">
      {connectors.map((c) => (
        <div key={c.id} className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
          <div className="flex items-center gap-2">
            <Plug size={14} className="text-slate-500" />
            <span className="text-sm font-medium text-slate-200">{c.name}</span>
            <a
              href={c.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-slate-600 hover:text-slate-300"
              title="Documentation"
            >
              <ExternalLink size={13} />
            </a>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{c.description}</p>
          <p className="mt-1 text-[11px] text-slate-600">{c.authNote}</p>
          {c.installed ? (
            <span className="mt-2 flex items-center gap-1 text-xs text-emerald-400">
              <Check size={13} /> Added
            </span>
          ) : (
            <button
              onClick={() => void window.chimera.addConnector(c.id).then(refresh)}
              className="mt-2 rounded-md bg-sky-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-600"
            >
              Add
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
