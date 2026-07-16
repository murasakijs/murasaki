# @murasakijs/mcp

Read-only local [Model Context Protocol](https://modelcontextprotocol.io/) server for Murasaki.
It searches the checked-in documentation, reports the canonical capability manifest, returns the
configuration schema, and diagnoses the structure of a local Murasaki project without executing it.

The server is implemented but has not been published yet. Until the first npm release, run it from
a repository checkout after `pnpm install`:

```json
{
  "mcpServers": {
    "murasaki": {
      "command": "node",
      "args": ["/absolute/path/to/murasaki/packages/mcp/bin/murasaki-mcp.mjs"]
    }
  }
}
```

After the package is published, the equivalent configuration is:

```json
{
  "mcpServers": {
    "murasaki": {
      "command": "npx",
      "args": ["-y", "@murasakijs/mcp@latest"]
    }
  }
}
```

Tools:

- `search_docs`
- `get_api_reference`
- `get_config_schema`
- `doctor`
- `list_recipes` / `get_recipe`
- `check_compatibility`

Every tool is annotated read-only. There are intentionally no build, publish, shell, release, or
file-writing tools.
