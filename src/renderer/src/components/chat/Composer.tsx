import { useState, type KeyboardEvent } from 'react'
import { SendHorizonal, Square, Paperclip, X } from 'lucide-react'
import { useChat } from '../../stores/chat'

interface Attachment {
  path: string
  mimeType: string
}

export function Composer() {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const status = useChat((s) =>
    s.activeConvId ? (s.statusByConv[s.activeConvId] ?? 'idle') : 'connecting'
  )
  const send = useChat((s) => s.send)
  const interrupt = useChat((s) => s.interrupt)

  const attach = async (): Promise<void> => {
    const picked = await window.chimera.pickFiles()
    if (picked.length > 0) setAttachments((prev) => [...prev, ...picked])
  }

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed || status !== 'idle') return
    setText('')
    const toSend = attachments
    setAttachments([])
    void send(trimmed, toSend.length > 0 ? toSend : undefined)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-[#21262d] bg-[#0d1117] px-4 py-3">
      {attachments.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5">
          {attachments.map((att, i) => (
            <span
              key={`${att.path}-${i}`}
              className="flex items-center gap-1 rounded-md border border-[#30363d] bg-[#161b22] px-2 py-0.5 text-xs text-slate-300"
            >
              <Paperclip size={11} className="text-slate-500" />
              {att.path.split('/').pop()}
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="text-slate-600 hover:text-red-400"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <button
          onClick={() => void attach()}
          disabled={status === 'connecting'}
          title="Attach files"
          className="rounded-xl border border-[#30363d] bg-[#161b22] p-2.5 text-slate-400 hover:bg-[#21262d] disabled:opacity-40"
        >
          <Paperclip size={18} />
        </button>
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
