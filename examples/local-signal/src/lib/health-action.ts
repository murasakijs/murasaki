'use server'

import { defineAction } from 'murasaki'
import type { ActionState } from 'murasaki'

export type HealthCheckResult = {
  checkedAt: string
  node: string
  duration: number
  status: 'healthy' | 'degraded'
}

export const runHealthCheck = defineAction(
  async (_previous: ActionState<HealthCheckResult>, _formData: FormData): Promise<ActionState<HealthCheckResult>> => {
    const started = Date.now()
    await new Promise((resolve) => setTimeout(resolve, 650))
    return {
      data: {
        checkedAt: new Date().toISOString(),
        node: process.version,
        duration: Date.now() - started,
        status: 'healthy',
      },
      error: null,
      isPending: false,
    }
  },
)
