import { createActions } from 'murasaki'
import { useCounter } from './counter'

/**
 * The app's context-menu actions, defined once and reused across menus as
 * <Action.increment /> etc. — no per-call-site wrapper. Built-ins (Action.Copy,
 * Action.Reload, …) are merged in, so a file imports a single `Action`.
 */
export const Action = createActions({
  increment: () => useCounter.getState().increment(),
  reset: () => useCounter.getState().reset(),
})
