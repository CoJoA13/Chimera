import { AlertCircle, Info, X } from 'lucide-react'
import { useChat } from '../../stores/chat'

export function Toasts() {
  const toasts = useChat((s) => s.toasts)
  const dismiss = useChat((s) => s.dismissToast)
  if (toasts.length === 0) return null

  return (
    <div className="fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm shadow-xl ${
            toast.kind === 'error'
              ? 'border-red-900/60 bg-red-950/90 text-red-200'
              : 'border-[#30363d] bg-[#161b22]/95 text-slate-200'
          }`}
        >
          {toast.kind === 'error' ? (
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={15} className="mt-0.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1">{toast.text}</span>
          <button onClick={() => dismiss(toast.id)} className="shrink-0 opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
