import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { runBeforeBuild } from '../dist/cli/build.js'

test('build.before runs in the project directory and propagates failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-before-build-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const script = JSON.stringify("require('node:fs').writeFileSync('generated.txt', process.cwd())")
  await runBeforeBuild(`${JSON.stringify(process.execPath)} -e ${script}`, root)
  assert.equal(
    await realpath(await readFile(join(root, 'generated.txt'), 'utf8')),
    await realpath(root),
  )
  await assert.rejects(
    runBeforeBuild(`${JSON.stringify(process.execPath)} -e "process.exit(7)"`, root),
    /exit code 7/,
  )
})
