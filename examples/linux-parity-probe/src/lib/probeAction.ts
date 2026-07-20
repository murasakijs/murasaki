'use server'

import { defineAction } from 'murasaki'

export interface ProbeActionInput {
  at: Date
  big: bigint
  label: string
}

export interface ProbeActionResult extends ProbeActionInput {
  roundTrippedBy: 'server-action'
  pid: number
}

/**
 * server-actions probe: a plain 'use server' function (not the
 * useActionState/FormData shape — defineAction is a typed passthrough, and
 * callAction() invokes any function signature directly). Returns a Date and a
 * bigint outside JSON's range so the caller can only pass if the wire codec
 * genuinely round-tripped rich values, not just JSON.
 */
export const probeEcho = defineAction(async (input: ProbeActionInput): Promise<ProbeActionResult> => {
  if (!(input?.at instanceof Date) || typeof input.big !== 'bigint' || typeof input.label !== 'string') {
    throw new TypeError('invalid probeEcho input')
  }
  return { ...input, roundTrippedBy: 'server-action', pid: process.pid }
})
