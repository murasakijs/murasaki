#!/usr/bin/env node

import { startStdioServer } from '../src/server.mjs'

startStdioServer().catch((error) => {
  // stdout is reserved for MCP JSON-RPC frames.
  process.stderr.write(`murasaki-mcp: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
