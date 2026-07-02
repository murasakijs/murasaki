import { useActionState, useTransition } from 'react'

export interface ActionState<T> {
  data: T | null
  error: string | null
  isPending: boolean
}

export type ActionResult<T> = T | { ok: false; error: string }

/**
 * Same shape as Next.js `defineAction` — just a passthrough that carries
 * the `'use server'` semantics through TypeScript. Server-Actions plugin
 * handles the actual code split.
 */
export function defineAction<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return fn
}

/**
 * Manually invoke an action without a Form.
 */
export async function callAction<T>(
  action: (...args: any[]) => Promise<T>,
  ...args: any[]
): Promise<T> {
  return action(...args)
}

/**
 * React 19-flavoured hook.
 *
 * ```tsx
 * const [state, run, isPending] = useAction(myAction, { data: null, error: null })
 * ```
 */
export function useAction<T>(
  action: (prevState: ActionState<T>, formData: FormData) => Promise<ActionState<T>>,
  initial: ActionState<T>,
) {
  return useActionState(action, initial)
}

export { useTransition }
