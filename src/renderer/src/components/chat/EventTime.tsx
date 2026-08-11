import { useEffect, useState } from 'react'
import { formatRelativeTime } from '../../../../shared/time'

export function EventTime({ at, className = '' }: { at?: number; className?: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (at === undefined) return
    const timer = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(timer)
  }, [at])
  if (at === undefined) return null
  return (
    <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className={className}>
      {formatRelativeTime(at)}
    </time>
  )
}
