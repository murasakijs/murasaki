import { defineMain } from 'murasaki/main'
import { initializeRuntime, shutdownRuntime } from './backend/runtime.ts'

export default defineMain({
  async ready(context) {
    const sampleData = !context.launch.argv.includes('--no-sample-data')
    await initializeRuntime(context, sampleData)
  },
  async shutdown({ log }) {
    await shutdownRuntime()
    log.info('Oscilla runtime stopped')
  },
})
