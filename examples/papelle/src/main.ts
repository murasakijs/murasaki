import { defineMain } from 'murasaki/main'
import { closeStore, readWorkspace } from './backend/store'
import { configureRuntime } from './backend/runtime'

export default defineMain({
  async ready({ paths, launch, log }) {
    const noSampleData = launch.argv.includes('--no-sample-data')
    configureRuntime(paths.data, noSampleData)
    const { workspace, path } = readWorkspace()
    log.info('Papelle workspace ready', {
      database: path,
      sampleData: workspace.sampleData,
      pageCount: workspace.pages.length,
    })
  },
  async openRequested(_context, event) {
    // File associations are surfaced here. The current vertical slice keeps
    // import user-mediated in the renderer because Murasaki has no durable
    // grant token that proves a renderer path came from the native picker.
    console.info('Papelle open request', event.targets.map((target) => target.kind))
  },
  async shutdown({ log }) {
    closeStore()
    log.info('Papelle SQLite store closed')
  },
})
