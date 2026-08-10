import { useState, type KeyboardEvent } from 'react'
import { SendHorizonal, Square } from 'lucide-react'
import { useChat } from '../../stores/chat'

export function Composer() {
  const [text, setText] = useState('')
  const status = useChat((s) =>
    s.activeConvId ? (s.statusByConv[s.activeConvId] ?? 'idle') : 'connecting'
  )
  const send = useChat((s) => s.send)
  const interrupt = useChat((s) => s.interrupt)

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed || status !== 'idle') return
    setText('')
    void send(trimmed)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-[#21262d] bg-[#0d1117] px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          placeholder={status === 'connecting' ? 'Connecting…' : 'Send a message…'}
          disabled={status === 'connecting'}
          className="flex-1 resize-none rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-2.5 text-[15px] placeholder-slate-600 focus:border-slate-500 focus:outline-none"
        />
        {status === 'streaming' ? (
          <button
            onClick={() => void interrupt()}
            title="Stop"
            className="rounded-xl border border-[#30363d] bg-[#21262d] p-2.5 text-red-400 hover:bg-[#2d333b]"
          >
            <Square size={18} />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim() || status !== 'idle'}
            title="Send"
            className="rounded-xl bg-sky-700 p-2.5 text-white hover:bg-sky-600 disabled:opacity-40"
          >
            <SendHorizonal size={18} />
          </button>
        )}
      </div>
    </div>
  )
}
