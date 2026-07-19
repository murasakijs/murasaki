export interface LogAccumulator {
  partial: string
  queue: string[]
  dropped: number
}

export function appendLogChunk(accumulator: LogAccumulator, chunk: string, maxLineBytes = 16 * 1024, maxQueuedLines = 1_000) {
  const parts = (accumulator.partial + chunk).split(/\r?\n/)
  accumulator.partial = (parts.pop() ?? '').slice(-maxLineBytes)
  accumulator.queue.push(...parts.map((line) => line.slice(0, maxLineBytes)))
  if (accumulator.queue.length > maxQueuedLines) {
    const dropped = accumulator.queue.length - maxQueuedLines
    accumulator.dropped += dropped
    accumulator.queue.splice(0, dropped)
  }
}

export function drainLogLines(accumulator: LogAccumulator, limit = 100): string[] {
  return accumulator.queue.splice(0, Math.max(0, limit))
}
