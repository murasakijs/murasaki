import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const componentsDir = resolve(import.meta.dirname, '../content/docs/components')

async function json(name) {
  return JSON.parse(await readFile(resolve(componentsDir, name), 'utf8'))
}

async function text(name) {
  return readFile(resolve(componentsDir, name), 'utf8')
}

function catalogPages(meta) {
  return meta.pages.filter((page) => page !== 'index' && !page.startsWith('---'))
}

test('the component catalog has matching English/Japanese navigation, pages, and index cards', async () => {
  const [englishMeta, japaneseMeta, englishIndex, japaneseIndex, filenames] = await Promise.all([
    json('meta.json'),
    json('meta.ja.json'),
    text('index.mdx'),
    text('index.ja.mdx'),
    readdir(componentsDir),
  ])

  const pages = catalogPages(englishMeta)
  assert.deepEqual(catalogPages(japaneseMeta), pages)
  assert.equal(new Set(pages).size, pages.length, 'component navigation contains duplicate slugs')

  const documentedEnglish = new Set(
    filenames
      .filter((name) => name.endsWith('.mdx') && !name.endsWith('.ja.mdx'))
      .map((name) => name.slice(0, -'.mdx'.length))
      .filter((name) => name !== 'index'),
  )
  const documentedJapanese = new Set(
    filenames
      .filter((name) => name.endsWith('.ja.mdx'))
      .map((name) => name.slice(0, -'.ja.mdx'.length))
      .filter((name) => name !== 'index'),
  )

  assert.deepEqual([...documentedEnglish].sort(), [...pages].sort())
  assert.deepEqual([...documentedJapanese].sort(), [...pages].sort())

  for (const slug of pages) {
    const href = `href="/docs/components/${slug}"`
    assert.equal(
      englishIndex.split(href).length - 1,
      1,
      `English component index must link ${slug} exactly once`,
    )
    assert.equal(
      japaneseIndex.split(href).length - 1,
      1,
      `Japanese component index must link ${slug} exactly once`,
    )
  }
})
