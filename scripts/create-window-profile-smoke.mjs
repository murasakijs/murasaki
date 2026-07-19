#!/usr/bin/env node

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetArg = process.argv[2]
const platform = process.argv[3] ?? process.platform
if (!targetArg) {
  process.stderr.write('usage: node scripts/create-window-profile-smoke.mjs <target-dir> [platform-label]\n')
  process.exit(2)
}

const target = resolve(targetArg)
const template = resolve(root, 'packages/create-murasaki/templates/default')
mkdirSync(target, { recursive: true })
cpSync(template, target, { recursive: true, force: true })

const insideWorkspace = !relative(root, target).startsWith('..') && !isAbsolute(relative(root, target))
const dependency = (name) => insideWorkspace
  ? 'workspace:*'
  : `link:${resolve(root, name === 'murasaki' ? 'packages/murasaki' : 'packages/ui')}`
const manifestPath = resolve(target, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.name = `murasaki-window-profile-smoke-${platform}`
manifest.dependencies.murasaki = dependency('murasaki')
manifest.dependencies['@murasakijs/ui'] = dependency('@murasakijs/ui')
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

writeFileSync(resolve(target, 'murasaki.config.ts'), `import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'app.murasaki.ci.profile.${platform.replace(/[^a-z0-9]/gi, '-').toLowerCase()}',
  productName: 'Murasaki Profile Smoke',
  version: '0.0.0',
  icon: 'src/assets/icon.png',
  locales: ['en'],
  window: {
    title: 'Murasaki profile isolation',
    width: 800,
    height: 600,
    capabilities: ['window:getLabel'],
    backendCapabilities: [
      'api:GET:/api/main-only',
      'api:GET:/api/profile-state',
      'api:POST:/api/profile-state',
    ],
  },
  windows: {
    probe: {
      route: '/',
      title: 'Untrusted worker probe',
      width: 640,
      height: 480,
      visible: false,
      capabilities: ['window:getLabel'],
      backendCapabilities: ['api:POST:/api/profile-state'],
    },
  },
})
`)

writeFileSync(resolve(target, 'src/app/page.tsx'), `'use client'

import { useEffect } from 'react'
import { appWindow } from 'murasaki/native'

const marker = 'MURASAKI_WINDOW_PROFILE_ISOLATION_OK=service-worker-denied'

async function report(stage: string, detail?: string) {
  await fetch('/api/profile-state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage, detail }),
  })
}

export default function ProfileIsolationProbe() {
  useEffect(() => {
    void (async () => {
      const label = await appWindow.getLabel()
      if (label === 'probe') {
        if (!('serviceWorker' in navigator)) throw new Error('Service Worker is unavailable')
        const registration = await navigator.serviceWorker.register('/authority-worker.js', { scope: '/' })
        await navigator.serviceWorker.ready
        if (!registration.active) throw new Error('Service Worker did not activate')
        await report('worker-ready')
        return
      }
      if (label !== 'main') throw new Error('unexpected window label: ' + label)

      if (sessionStorage.getItem('murasaki-profile-reloaded') !== '1') {
        const deadline = Date.now() + 30_000
        while (Date.now() < deadline) {
          const response = await fetch('/api/profile-state')
          const state = await response.json() as { workerReady?: boolean }
          if (state.workerReady) {
            sessionStorage.setItem('murasaki-profile-reloaded', '1')
            location.reload()
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        throw new Error('secondary Service Worker never became ready')
      }

      const response = await fetch('/api/main-only')
      const result = await response.json() as { source?: string }
      if (!response.ok || result.source !== 'server') {
        throw new Error('main-only request was intercepted by another window profile')
      }
      await report('isolated', marker)
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('MURASAKI_WINDOW_PROFILE_ISOLATION_FAIL', message)
      void report('error', message)
    })
  }, [])

  return <main>Per-window browser profile isolation probe</main>
}
`)

mkdirSync(resolve(target, 'src/api/main-only'), { recursive: true })
writeFileSync(resolve(target, 'src/api/main-only/route.ts'), `import type { RouteHandler } from 'murasaki'

export const GET: RouteHandler = async () => Response.json({ source: 'server' })
`)

mkdirSync(resolve(target, 'src/api/profile-state'), { recursive: true })
writeFileSync(resolve(target, 'src/api/profile-state/route.ts'), `import type { RouteHandler } from 'murasaki'

const marker = 'MURASAKI_WINDOW_PROFILE_ISOLATION_OK=service-worker-denied'
let workerReady = false

export const GET: RouteHandler = async () => Response.json({ workerReady })

export const POST: RouteHandler = async (request) => {
  const body = await request.json() as { stage?: string; detail?: string }
  if (body.stage === 'worker-ready') {
    workerReady = true
    return Response.json({ ok: true }, { status: 202 })
  }
  if (body.stage === 'isolated' && body.detail === marker && workerReady) {
    console.log(marker)
    return Response.json({ ok: true })
  }
  console.error('MURASAKI_WINDOW_PROFILE_ISOLATION_FAIL=' + String(body.detail ?? body.stage))
  return Response.json({ ok: false }, { status: 400 })
}
`)

mkdirSync(resolve(target, 'public'), { recursive: true })
writeFileSync(resolve(target, 'public/authority-worker.js'), `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname !== '/api/main-only') return
  event.respondWith(new Response(JSON.stringify({ source: 'service-worker' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
})
`)

process.stdout.write(`${target}\n`)
