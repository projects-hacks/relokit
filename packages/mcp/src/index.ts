#!/usr/bin/env -S npx tsx
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ConstraintSet } from '@relokit/schema'
import { plan } from '@relokit/planner'
import { z } from 'zod'
import { loadRegistry } from './registry.ts'

/**
 * The planner as a tool. relokit_plan costs nothing and touches no network,
 * which is the point: a calling agent can see what a question would cost before
 * deciding to spend anything on it.
 */
const server = new McpServer({ name: 'relokit', version: '0.1.0' })

const budget = z
  .object({
    max_cost_units: z.number().int().positive().default(200),
    max_stages: z.number().int().positive().default(6),
    cluster_count: z.number().int().positive().default(12),
    overshoot_factor: z.number().min(1).default(1.3),
  })
  .default(() => ({
    max_cost_units: 200,
    max_stages: 6,
    cluster_count: 12,
    overshoot_factor: 1.3,
  }))

server.registerTool(
  'relokit_plan',
  {
    title: 'Plan a constraint set',
    description:
      'Turn a typed constraint set into a staged execution plan with a cost trace. Runs locally, makes no API calls and spends nothing.',
    inputSchema: { constraint_set: z.unknown(), budget },
  },
  async ({ constraint_set, budget: b }) => {
    const registry = loadRegistry()
    const result = plan({
      constraints: ConstraintSet.parse(constraint_set),
      registry: registry.capabilities,
      registry_version: registry.registry_version,
      budget: b,
      now_ms: 0,
    })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.registerTool(
  'relokit_registry',
  {
    title: 'List capabilities',
    description:
      'The capability registry: which sources can answer which constraint, at what granularity, cost and TTL.',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(loadRegistry(), null, 2) }],
  }),
)

await server.connect(new StdioServerTransport())
