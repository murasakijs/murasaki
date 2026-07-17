import assert from 'node:assert/strict'
import test from 'node:test'
import { windows } from '../dist/main/index.js'
import { isWindowLifecycleEvent } from '../dist/vite-plugin/main-process.js'

const busKey = Symbol.for('murasaki.main.window-control.v1')
const phaseKey = Symbol.for('murasaki.main.window-control.phase.v1')

function bus() {
  return globalThis[busKey]
}

function setPhase(phase) {
  globalThis[phaseKey] = phase
  const control = bus()
  if (!control) return
  control.phase = phase
  if (phase !== 'stopping') return
  for (const pending of control.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error('native window control stopped'))
  }
  control.pending.clear()
  control.commands.length = 0
}

function takeCommands() {
  const control = bus()
  const commands = control.commands.splice(0, 32)
  return commands.filter((command) => control.pending.has(command.id))
}

function settle(id, result) {
  const control = bus()
  const pending = control.pending.get(id)
  if (!pending) return false
  control.pending.delete(id)
  clearTimeout(pending.timer)
  if (result.ok) pending.resolve(result.value)
  else pending.reject(new Error(result.error))
  return true
}

function emit(event) {
  for (const listener of bus().listeners) listener(event)
}

test('Node Main window commands are bounded, labeled, and settled by native transport', async () => {
  setPhase('running')
  const listing = windows.list()
  const state = windows.get('settings')
  const commands = takeCommands()
  assert.deepEqual(commands.map(({ method, label }) => ({ method, label })), [
    { method: 'list', label: undefined },
    { method: 'get', label: 'settings' },
  ])

  const listed = [{
    label: 'main',
    generation: 1,
    primary: true,
    visible: true,
    focused: true,
    minimized: false,
    maximized: false,
  }]
  assert.equal(settle(commands[0].id, {
    ok: true,
    value: listed,
  }), true)
  assert.equal(settle(commands[1].id, {
    ok: true,
    value: null,
  }), true)
  assert.deepEqual(await listing, listed)
  assert.equal(await state, null)
  assert.equal(settle('missing', { ok: true, value: null }), false)
})

test('Node Main window commands reject unsafe labels and startup/shutdown deadlocks', async () => {
  setPhase('starting')
  await assert.rejects(windows.list(), /unavailable inside ready/)

  setPhase('running')
  assert.throws(() => windows.show('../settings'), /window label/)
  const destroying = windows.destroy('settings')
  const [command] = takeCommands()
  setPhase('stopping')
  await assert.rejects(destroying, /native window control stopped/)
  assert.deepEqual(takeCommands(), [])
  assert.equal(command.method, 'destroy')
})

test('Node Main creates and destroys only by configured label', async () => {
  setPhase('running')
  const creating = windows.create('settings')
  const [create] = takeCommands()
  assert.deepEqual(
    { method: create.method, label: create.label, args: create.args },
    { method: 'create', label: 'settings', args: undefined },
  )
  const state = {
    label: 'settings',
    generation: 2,
    primary: false,
    visible: true,
    focused: false,
    minimized: false,
    maximized: false,
  }
  settle(create.id, { ok: true, value: state })
  assert.deepEqual(await creating, state)

  const destroying = windows.destroy('settings')
  const [destroy] = takeCommands()
  assert.deepEqual(
    { method: destroy.method, label: destroy.label, args: destroy.args },
    { method: 'destroy', label: 'settings', args: undefined },
  )
  settle(destroy.id, { ok: true, value: null })
  await destroying
})

test('Node Main window queue enforces its 64-command bound', async () => {
  setPhase('running')
  const pending = Array.from({ length: 64 }, () => windows.get('settings'))
  await assert.rejects(windows.get('settings'), /queue is full/)

  const commands = [...takeCommands(), ...takeCommands()]
  assert.equal(commands.length, 64)
  for (const command of commands) settle(command.id, { ok: true, value: null })
  assert.deepEqual(await Promise.all(pending), Array(64).fill(null))
})

test('Node Main window errors and late timeout results settle exactly once', async () => {
  setPhase('running')
  const creating = windows.create('settings')
  const [create] = takeCommands()
  settle(create.id, { ok: false, error: 'window settings already exists' })
  await assert.rejects(creating, /already exists/)

  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (listener, _delay, ...args) => realSetTimeout(listener, 5, ...args)
  try {
    const request = windows.get('settings')
    const [command] = takeCommands()
    await assert.rejects(request, /native window command get timed out/)
    assert.equal(settle(command.id, { ok: true, value: null }), false)
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
})

test('Node Main exposes only the fixed window command surface', () => {
  assert.deepEqual(Object.keys(windows), [
    'list', 'get', 'create', 'show', 'hide', 'focus', 'destroy', 'subscribe',
  ])
})

test('dev lifecycle validator requires generation and terminal state shape', () => {
  const state = {
    label: 'settings', generation: 7, primary: false, visible: true,
    focused: false, minimized: false, maximized: false,
  }
  assert.equal(isWindowLifecycleEvent({
    type: 'created', label: 'settings', generation: 7, primary: false, state,
  }), true)
  assert.equal(isWindowLifecycleEvent({
    type: 'closed', label: 'settings', generation: 7, primary: false, state: null,
  }), true)
  assert.equal(isWindowLifecycleEvent({
    type: 'created', label: 'settings', generation: 7, primary: false, state: null,
  }), false)
  assert.equal(isWindowLifecycleEvent({
    type: 'closed', label: 'settings', generation: 7, primary: false, state,
  }), false)
  assert.equal(isWindowLifecycleEvent({
    type: 'shown', label: 'settings', generation: 8, primary: false, state,
  }), false)
  assert.equal(isWindowLifecycleEvent({
    type: 'shown', label: 'settings', primary: false, state,
  }), false)
})

test('Node Main window lifecycle subscriptions are removable', () => {
  const events = []
  const unsubscribe = windows.subscribe((event) => events.push(event))
  const event = {
    type: 'hidden',
    label: 'settings',
    generation: 3,
    primary: false,
    state: {
      label: 'settings',
      generation: 3,
      primary: false,
      visible: false,
      focused: false,
      minimized: false,
      maximized: false,
    },
  }
  emit(event)
  unsubscribe()
  emit({ ...event, type: 'shown' })
  assert.deepEqual(events, [event])
})
