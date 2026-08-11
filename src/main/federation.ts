import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { z } from 'zod'
import { getDb } from './store/db'
import { getSetting, setSetting } from './store/settings'
import { logActivity } from './store/activity'
import type { BusCore, BusMessage } from './bus/BusCore'

export interface FedPeer {
  id: string
  name: string
  /** Base URL incl. token path, e.g. http://192.168.1.20:7777/fed/<token> */
  url: string
}

interface WireMessage {
  messageId: string
  targetId: string
  fromId: string
  fromTitle: string
  fromPersona?: string
  text: string
  inReplyTo?: string
  expectsReply: boolean
}

const FED_PREFIX = 'fed:'
const FED_MESSAGE_PREFIX = 'fedmsg:'
const MAX_DELIVERY_BYTES = 256 * 1024

const wireMessageSchema = z.object({
  messageId: z.string().min(1).max(256),
  targetId: z.string().min(1).max(256),
  fromId: z.string().min(1).max(256),
  fromTitle: z.string().min(1).max(200),
  fromPersona: z.string().max(2000).optional(),
  text: z.string().max(MAX_DELIVERY_BYTES),
  inReplyTo: z.string().min(1).max(512).optional(),
  expectsReply: z.boolean()
})

export function validateWireMessage(payload: unknown): WireMessage {
  return wireMessageSchema.parse(payload) as WireMessage
}

export function decodeWireBody(chunks: Buffer[], totalBytes: number): string {
  return Buffer.concat(chunks, totalBytes).toString('utf8')
}

function federatedMessageId(peerId: string, remoteId: string): string {
  return `${FED_MESSAGE_PREFIX}${peerId}:${remoteId}`
}

function remoteReplyId(peerId: string, localId: string | undefined): string | undefined {
  if (!localId) return undefined
  const prefix = `${FED_MESSAGE_PREFIX}${peerId}:`
  return localId.startsWith(prefix) ? localId.slice(prefix.length) : localId
}

/**
 * LAN bus federation: expose local sessions to trusted peer Chimera instances
 * and mirror their sessions onto the local bus as proxy entries. Peers are
 * added manually by exchanging each side's address (URL embeds a secret token).
 */
export class FederationManager {
  private server: Server | null = null
  private port = 0

  constructor(private readonly bus: BusCore) {}

  // ---------- identity ----------

  token(): string {
    let token = getSetting<string | null>('fedToken', null)
    if (!token) {
      token = randomUUID().replaceAll('-', '')
      setSetting('fedToken', token)
    }
    return token
  }

  displayName(): string {
    return getSetting<string>('fedName', 'chimera')
  }

  address(): string | null {
    if (!this.server) return null
    const nets = networkInterfaces()
    let ip = '127.0.0.1'
    for (const list of Object.values(nets)) {
      for (const net of list ?? []) {
        if (net.family === 'IPv4' && !net.internal) ip = net.address
      }
    }
    return `http://${ip}:${this.port}/fed/${this.token()}`
  }

  // ---------- peers ----------

  listPeers(): FedPeer[] {
    const rows = getDb().prepare('SELECT * FROM fed_peers ORDER BY added_at').all() as unknown as {
      id: string
      name: string
      url: string
    }[]
    return rows.map((r) => ({ id: r.id, name: r.name, url: r.url }))
  }

  addPeer(name: string, url: string): void {
    getDb()
      .prepare('INSERT INTO fed_peers (id, name, url, added_at) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), name, url.replace(/\/$/, ''), Date.now())
    void this.syncPeers()
  }

  removePeer(id: string): void {
    const peer = this.listPeers().find((p) => p.id === id)
    getDb().prepare('DELETE FROM fed_peers WHERE id = ?').run(id)
    if (peer) {
      for (const info of this.bus.listSessions('')) {
        if (info.localId.startsWith(`${FED_PREFIX}${peer.id}:`)) this.bus.unregister(info.localId)
      }
    }
  }

  // ---------- lifecycle ----------

  async start(): Promise<void> {
    if (this.server || !getSetting<boolean>('fedEnabled', false)) return
    this.server = createServer((req, res) => void this.handle(req, res))
    const port = getSetting<number>('fedPort', 7777)
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(port, '0.0.0.0', () => {
        const addr = this.server!.address()
        if (addr && typeof addr === 'object') this.port = addr.port
        resolve()
      })
    }).catch(() => {
      this.server = null
    })
    if (this.server) {
      setInterval(() => void this.syncPeers(), 60_000)
      void this.syncPeers()
    }
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  async setEnabled(enabled: boolean): Promise<void> {
    setSetting('fedEnabled', enabled)
    if (enabled) await this.start()
    else this.stop()
  }

  // ---------- outbound ----------

  /** Poll each peer's session list and register proxies on the local bus. */
  async syncPeers(): Promise<void> {
    for (const peer of this.listPeers()) {
      try {
        const res = await fetch(`${peer.url}/sessions`, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) continue
        const sessions = (await res.json()) as {
          id: string
          title: string
          provider: string
          persona?: string
        }[]
        for (const remote of sessions) {
          const proxyId = `${FED_PREFIX}${peer.id}:${remote.id}`
          this.bus.register(
            proxyId,
            () => ({
              localId: proxyId,
              conversationId: proxyId,
              title: `${remote.title} @ ${peer.name}`,
              provider: remote.provider,
              status: 'idle',
              persona: remote.persona
            }),
            (msg) => void this.deliverToPeer(peer, remote.id, msg)
          )
        }
      } catch {
        // peer unreachable — proxies stay stale until next sync
      }
    }
  }

  private async deliverToPeer(peer: FedPeer, targetId: string, msg: BusMessage): Promise<void> {
    const from = this.bus.listSessions('').find((s) => s.localId === msg.from)
    const wire: WireMessage = {
      messageId: msg.messageId,
      targetId,
      fromId: msg.from,
      fromTitle: from ? `${from.title} @ ${this.displayName()}` : this.displayName(),
      fromPersona: from?.persona,
      text: msg.text,
      inReplyTo: remoteReplyId(peer.id, msg.inReplyTo),
      expectsReply: msg.expectsReply
    }
    try {
      const response = await fetch(`${peer.url}/deliver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(wire),
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) throw new Error(`Peer returned HTTP ${response.status}`)
    } catch {
      logActivity('federation', `Delivery to peer "${peer.name}" failed`)
    }
  }

  // ---------- inbound ----------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const match = /^\/fed\/([a-f0-9]{32})\/(sessions|deliver)$/.exec(req.url ?? '')
    if (!match || match[1] !== this.token()) {
      res.writeHead(404).end()
      return
    }
    // Inbound callers must be a configured peer (or loopback for local testing):
    // federation only activates once BOTH sides have added each other.
    const remote = req.socket.remoteAddress?.replace('::ffff:', '') ?? ''
    const isLoopback = remote === '127.0.0.1' || remote === '::1'
    if (!isLoopback && this.peerForRequest(req) === null) {
      res.writeHead(403).end()
      return
    }
    if (match[2] === 'sessions' && req.method === 'GET') {
      const sessions = this.bus
        .listSessions('')
        .filter((s) => !s.localId.startsWith(FED_PREFIX)) // no transitive federation
        .map((s) => ({ id: s.localId, title: s.title, provider: s.provider, persona: s.persona }))
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(sessions))
      return
    }
    if (match[2] === 'deliver' && req.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
        res.writeHead(415).end()
        return
      }
      const contentLength = Number(req.headers['content-length'] ?? 0)
      if (Number.isFinite(contentLength) && contentLength > MAX_DELIVERY_BYTES) {
        res.writeHead(413).end()
        req.destroy()
        return
      }
      const chunks: Buffer[] = []
      let bodyBytes = 0
      let rejected = false
      req.setTimeout(10_000, () => {
        if (rejected) return
        rejected = true
        res.writeHead(408).end()
        req.destroy()
      })
      req.on('data', (chunk: Buffer) => {
        if (rejected) return
        bodyBytes += chunk.length
        if (bodyBytes > MAX_DELIVERY_BYTES) {
          rejected = true
          res.writeHead(413).end()
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (rejected) return
        try {
          const body = decodeWireBody(chunks, bodyBytes)
          const wire = validateWireMessage(JSON.parse(body))
          // Represent the remote sender as a proxy the local bus can reply to.
          const peer = this.peerForRequest(req)
          const peerId = peer?.id ?? 'loopback'
          const senderProxy = `${FED_PREFIX}${peerId}:${wire.fromId}`
          if (peer) {
            this.bus.register(
              senderProxy,
              () => ({
                localId: senderProxy,
                conversationId: senderProxy,
                title: wire.fromTitle,
                provider: 'remote',
                status: 'idle',
                persona: wire.fromPersona
              }),
              (msg) => void this.deliverToPeer(peer, wire.fromId, msg)
            )
          }
          this.bus.injectExternal({
            messageId: federatedMessageId(peerId, wire.messageId),
            from: senderProxy,
            to: wire.targetId,
            text: wire.text,
            inReplyTo: wire.inReplyTo,
            expectsReply: wire.expectsReply
          })
          logActivity('federation', `Message from ${wire.fromTitle}`, wire.targetId)
          res.writeHead(200).end('{"ok":true}')
        } catch {
          res.writeHead(400).end()
        }
      })
      return
    }
    res.writeHead(405).end()
  }

  /** Strict: match the caller to a configured peer by remote address host. */
  private peerForRequest(req: IncomingMessage): FedPeer | null {
    const remote = req.socket.remoteAddress?.replace('::ffff:', '')
    if (!remote) return null
    return (
      this.listPeers().find((p) => {
        try {
          return new URL(p.url).hostname === remote
        } catch {
          return false
        }
      }) ?? null
    )
  }
}
