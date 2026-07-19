# @murasakijs/mcp

Read-only local [Model Context Protocol](https://modelcontextprotocol.io/) server for Murasaki.
It searches the checked-in documentation, reports the canonical capability manifest, returns the
configuration schema, and diagnoses the structure of a local Murasaki project without executing it.

Install or run the published package directly from npm. A typical MCP client configuration is:

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
- `list_capabilities`
- `get_config_schema`
- `doctor`
- `list_recipes` / `get_recipe`
- `list_ui_components`
- `check_compatibility`

Call `list_capabilities` before `check_compatibility`; the compatibility tool accepts the canonical
feature IDs returned by that list and reports suggestions for unknown IDs.

Every tool is annotated read-only. There are intentionally no build, publish, shell, release, or
file-writing tools.
