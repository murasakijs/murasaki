import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

test('stdio server negotiates MCP and exposes only the intended read-only tools', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('bin/murasaki-mcp.mjs')],
    stderr: 'pipe',
  })
  const client = new Client({ name: 'murasaki-mcp-test', version: '1.0.0' })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'check_compatibility',
      'doctor',
      'get_api_reference',
      'get_config_schema',
      'get_recipe',
      'list_recipes',
      'search_docs',
    ])
    assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true))
    assert.ok(tools.every((tool) => tool.annotations?.destructiveHint === false))

    // code-signing is still genuinely "planned" on Linux (linux-distribution
    // itself graduated to "partial" in RFC 0002 phase L2a).
    const response = await client.callTool({ name: 'check_compatibility', arguments: { features: ['code-signing'], platform: 'linux' } })
    assert.equal(response.isError, undefined)
    const parsed = JSON.parse(response.content[0].text)
    assert.equal(parsed.overall, 'planned')
  } finally {
    await client.close()
  }
})
