import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { BusCore } from './BusCore'
import { busToolDefs } from './tools'

/** In-process chimera-bus MCP server for a Claude session. */
export function createClaudeBusServer(
  core: BusCore,
  callerLocalId: string
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'chimera-bus',
    version: '1.0.0',
    tools: busToolDefs(core, callerLocalId).map((def) =>
      tool(def.name, def.description, def.schema, async (args) =>
        def.handler(args as Record<string, never>)
      )
    )
  })
}
