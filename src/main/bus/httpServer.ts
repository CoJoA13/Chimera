import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { BusCore } from './BusCore'
import { busToolDefs } from './tools'

/**
 * Localhost streamable-HTTP bridge exposing the chimera-bus to sessions whose
 * provider runs out-of-process (Codex). Each session gets a secret token; the
 * URL path identifies the calling session, so tool calls are attributed.
 * Stateless mode: a fresh McpServer + transport per request.
 */
export class BusHttpServer {
  private server: Server | null = null
  private port = 0
  /** token -> localId */
  private tokens = new Map<string, string>()

  constructor(private readonly core: BusCore) {}

  async start(): Promise<void> {
    if (this.server) return
    this.server = createServer((req, res) => void this.handle(req, res))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (addr && typeof addr === 'object') this.port = addr.port
        resolve()
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  /** Register a session and return its bus endpoint URL. */
  issueEndpoint(localId: string): string {
    const token = randomUUID().replaceAll('-', '')
    this.tokens.set(token, localId)
    return `http://127.0.0.1:${this.port}/mcp/${token}`
  }

  revoke(localId: string): void {
    for (const [token, id] of this.tokens) {
      if (id === localId) this.tokens.delete(token)
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const match = /^\/mcp\/([a-f0-9]{32})$/.exec(req.url ?? '')
    const localId = match ? this.tokens.get(match[1]) : undefined
    if (!localId) {
      res.writeHead(404).end()
      return
    }
    try {
      const server = new McpServer({ name: 'chimera-bus', version: '1.0.0' })
      for (const def of busToolDefs(this.core, localId)) {
        server.registerTool(
          def.name,
          {
            description: def.description,
            ...(Object.keys(def.schema).length > 0
              ? { inputSchema: def.schema as z.ZodRawShape }
              : {})
          },
          async (args: unknown) => def.handler((args ?? {}) as Record<string, never>)
        )
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch {
      if (!res.headersSent) res.writeHead(500).end()
    }
  }
}
