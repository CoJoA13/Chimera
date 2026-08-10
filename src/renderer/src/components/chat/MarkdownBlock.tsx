import { memo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

export const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            // Unwrap: the code component below renders the full block.
            return <>{children}</>
          },
          code(props) {
            const { className, children } = props as {
              className?: string
              children?: ReactNode
            }
            const lang = /language-(\w+)/.exec(className ?? '')?.[1]
            const raw = String(children ?? '')
            // Fenced blocks carry a language class or contain newlines.
            if (lang || raw.includes('\n')) {
              return <CodeBlock code={raw.replace(/\n$/, '')} lang={lang ?? 'text'} />
            }
            return <code className={className}>{children}</code>
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
