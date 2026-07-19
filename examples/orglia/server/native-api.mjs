import { Readable } from 'node:stream'
import { hashPassword, readSecret } from './auth.mjs'
import { accountsFor, bootstrapData, tenantIds } from './sample-data.mjs'
import { createOrgliaHandler } from './server.mjs'
import { openStore } from './storage.mjs'

let handlerPromise

async function nativeHandler() {
  if (!handlerPromise) handlerPromise = (async () => {
    const store = await openStore()
    const withSample = process.env.NO_SAMPLE_DATA !== '1'
    const password = await readSecret('ORGLIA_BOOTSTRAP_PASSWORD', { developmentFallback: 'orglia-demo-change-me' })
    const passwordHash = await hashPassword(password)
    for (const tenantId of withSample ? tenantIds : [tenantIds[0]]) {
      const data = bootstrapData(tenantId, withSample)
      await store.initializeTenant(tenantId, data, accountsFor(data), passwordHash)
    }
    return createOrgliaHandler({ store, secureCookie: false })
  })()
  return handlerPromise
}

export async function handleNativeApi(request) {
  const url = new URL(request.url)
  // Preserve the framework Request stream so server.mjs's 256 KiB bound is
  // enforced while bytes arrive. Materializing arrayBuffer() here would apply
  // the limit only after an attacker-controlled body was already in memory.
  const nodeRequest = request.body ? Readable.fromWeb(request.body) : Readable.from([])
  nodeRequest.url = `${url.pathname}${url.search}`
  nodeRequest.method = request.method
  nodeRequest.headers = Object.fromEntries(request.headers.entries())
  nodeRequest.socket = { remoteAddress: 'murasaki-native', encrypted: url.protocol === 'https:' }
  return new Promise(async (resolve, reject) => {
    let status = 200; let headers = {}; const chunks = []
    const nodeResponse = {
      writeHead(nextStatus, nextHeaders) { status = nextStatus; headers = nextHeaders; return this },
      write(chunk) { chunks.push(Buffer.from(chunk)); return true },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk))
        resolve(new Response(Buffer.concat(chunks), { status, headers }))
      },
    }
    try { await (await nativeHandler())(nodeRequest, nodeResponse) } catch (error) { reject(error) }
  })
}
