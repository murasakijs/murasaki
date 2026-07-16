import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createRequire } from 'node:module'
import { z } from 'zod'
import {
  checkCompatibility,
  doctor,
  getApiReference,
  getConfigSchema,
  getRecipe,
  listRecipes,
  searchDocs,
} from './knowledge.mjs'

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
const { version } = createRequire(import.meta.url)('../package.json')

function response(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: { ...value },
  }
}

export function createServer() {
  const server = new McpServer(
    { name: 'murasaki-docs', version },
    {
      instructions: 'Read-only Murasaki reference. Treat planned, experimental, and partial capability labels literally; never present planned APIs as available.',
    },
  )

  server.registerTool('search_docs', {
    title: 'Search Murasaki documentation',
    description: 'Search the checked-in English and Japanese Murasaki documentation. Returns short excerpts and canonical URLs.',
    inputSchema: {
      query: z.string().min(1),
      locale: z.enum(['en', 'ja', 'all']).default('en'),
      limit: z.number().int().min(1).max(20).default(5),
    },
    annotations: readOnlyAnnotations,
  }, async (input) => response(await searchDocs(input)))

  server.registerTool('get_api_reference', {
    title: 'Get Murasaki API reference',
    description: 'Look up public symbols and their evidence-backed feature maturity, platform support, limitations, and docs URL.',
    inputSchema: {
      symbol: z.string().min(1).optional(),
      featureId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(100).default(30),
    },
    annotations: readOnlyAnnotations,
  }, async (input) => response(await getApiReference(input)))

  server.registerTool('get_config_schema', {
    title: 'Get Murasaki configuration schema',
    description: 'Return the complete JSON Schema for murasaki.config or a property selected by dot path or JSON Pointer.',
    inputSchema: { path: z.string().optional() },
    annotations: readOnlyAnnotations,
  }, async (input) => response(await getConfigSchema(input)))

  server.registerTool('doctor', {
    title: 'Diagnose a Murasaki project',
    description: 'Read only known project metadata and entry paths, then report configuration and toolchain readiness. It never runs project code or modifies files.',
    inputSchema: { projectPath: z.string().optional() },
    annotations: readOnlyAnnotations,
  }, async (input) => response(await doctor(input)))

  server.registerTool('list_recipes', {
    title: 'List Murasaki recipes',
    description: 'List task-oriented recipes backed by the checked-in documentation.',
    inputSchema: { locale: z.enum(['en', 'ja']).default('en') },
    annotations: readOnlyAnnotations,
  }, async (input) => response(await listRecipes(input)))

  server.registerTool('get_recipe', {
    title: 'Get a Murasaki recipe',
    description: 'Get the full checked-in documentation page for a recipe returned by list_recipes.',
    inputSchema: {
      id: z.string().min(1),
      locale: z.enum(['en', 'ja']).default('en'),
    },
    annotations: readOnlyAnnotations,
  }, async (input) => response(await getRecipe(input)))

  server.registerTool('check_compatibility', {
    title: 'Check Murasaki feature compatibility',
    description: 'Check required canonical feature IDs against a target platform without treating planned or partial work as complete.',
    inputSchema: {
      features: z.array(z.string().min(1)).min(1).max(50),
      platform: z.enum(['macos', 'windows', 'linux']),
    },
    annotations: readOnlyAnnotations,
  }, async (input) => response(await checkCompatibility(input)))

  return server
}

export async function startStdioServer() {
  const server = createServer()
  await server.connect(new StdioServerTransport())
  return server
}
