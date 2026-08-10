import { useState } from 'react'
import { BadgeCheck, BadgeAlert, BadgeHelp } from 'lucide-react'

export function VerificationChip({
  verdict,
  note,
  verifier
}: {
  verdict: 'corroborated' | 'disputed' | 'uncertain'
  note: string
  verifier: string
}) {
  const [open, setOpen] = useState(verdict === 'disputed')
  const style = {
    corroborated: { icon: BadgeCheck, cls: 'text-emerald-400 border-emerald-900/50 bg-emerald-950/20' },
    disputed: { icon: BadgeAlert, cls: 'text-red-400 border-red-900/50 bg-red-950/20' },
    uncertain: { icon: BadgeHelp, cls: 'text-amber-400 border-amber-900/50 bg-amber-950/20' }
  }[verdict]
  const Icon = style.icon

  return (
    <div className={`my-1 inline-block rounded-lg border px-2.5 py-1 text-xs ${style.cls}`}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5">
        <Icon size={13} />
        <span className="font-medium capitalize">{verdict}</span>
        <span className="text-slate-500">· checked by {verifier}</span>
      </button>
      {open && note && <p className="mt-1 text-slate-300">{note}</p>}
    </div>
  )
}
