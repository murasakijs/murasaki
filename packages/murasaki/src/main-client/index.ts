import { parseWire } from '../runtime/wire.js'

export interface MainEventSubscriptionOptions {
  signal?: AbortSignal
}

/** Subscribe to events published by `emitMainEvent()` in the Node Main process. */
export function subscribeMainEvent<T>(
  channel: string,
  listener: (value: T) => void,
  options: MainEventSubscriptionOptions = {},
): () => void {
  if (typeof EventSource === 'undefined') {
    throw new Error('subscribeMainEvent() is only available in the Murasaki renderer')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(channel)) {
    throw new TypeError('main event channel must be 1-128 safe identifier characters')
  }
  const source = new EventSource(`/__murasaki/main/events?channel=${encodeURIComponent(channel)}`)
  const onMessage = (event: MessageEvent<string>) => {
    const envelope = JSON.parse(event.data) as { payload: string }
    listener(parseWire(envelope.payload) as T)
  }
  source.addEventListener('message', onMessage as EventListener)
  const close = () => {
    source.removeEventListener('message', onMessage as EventListener)
    source.close()
    options.signal?.removeEventListener('abort', close)
  }
  if (options.signal?.aborted) close()
  else options.signal?.addEventListener('abort', close, { once: true })
  return close
}
