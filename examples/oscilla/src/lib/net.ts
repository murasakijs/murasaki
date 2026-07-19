export async function readBoundedResponseBody(response: Response, maxBytes = 2 * 1024 * 1024): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel('response limit exceeded'); throw new Error(`Response exceeds ${maxBytes} byte limit`) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(joined)
}
