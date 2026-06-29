// src/app/page.tsx — Home, rebuilt with murasaki primitives + desktop layout.
//
// Mixes Murasaki components (<TitleBar>/<Sidebar>/<Pane>/<View>/<Text>) with
// plain HTML where it makes sense (<button>, <code>). Both coexist.

import { Link, NoDrag, Pane, Row, Sidebar, SidebarItem, Stack, Text, TitleBar, Toolbar, View } from 'murasaki'
import {
  useClipboard,
  useDialog,
  useFs,
  useNotification,
  useShell,
  useState,
  useWindow,
} from 'murasaki/jsx/dom'

export default function HomePage() {
  const [count, setCount] = useState(0)
  const [section, setSection] = useState('counter')
  const [filePath, setFilePath] = useState('')

  const notify = useNotification()
  const clipboard = useClipboard()
  const shell = useShell()
  const dialog = useDialog()
  const fs = useFs()
  const win = useWindow()

  async function pickAndRead() {
    const paths = await dialog.openFile({ title: 'Pick a text file' })
    if (paths.length === 0) return
    setFilePath(paths[0])
    const text = await fs.readFile(paths[0])
    notify({ title: 'File loaded', body: `${text.length} chars from ${paths[0]}` })
  }

  return (
    <View style={{ height: '100vh' }}>
      <TitleBar>
        <Text size={13} weight="medium">
          Murasaki Example
        </Text>
      </TitleBar>

      <Row grow>
        <Sidebar width={200}>
          <SidebarItem active={section === 'counter'} onClick={() => setSection('counter')}>
            Counter
          </SidebarItem>
          <SidebarItem active={section === 'native'} onClick={() => setSection('native')}>
            Native APIs
          </SidebarItem>
          <SidebarItem active={section === 'window'} onClick={() => setSection('window')}>
            Window
          </SidebarItem>
          <SidebarItem onClick={() => shell.openExternal('https://github.com/murasakijs/murasaki')}>
            GitHub ↗
          </SidebarItem>
        </Sidebar>

        <Pane>
          {section === 'counter' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                Counter
              </Text>
              <Text color="#666">A small useState demo.</Text>
              <Row gap={12} align="center">
                <button onClick={() => setCount(count - 1)}>−</button>
                <Text size={24} weight="bold">
                  {count}
                </Text>
                <button onClick={() => setCount(count + 1)}>+</button>
              </Row>
              <nav>
                <Link href="/about">About →</Link>
              </nav>
            </Stack>
          )}

          {section === 'native' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                Native APIs
              </Text>
              <Row gap={8} wrap>
                <button onClick={() => notify({ title: 'Hello', body: `Count: ${count}` })}>
                  🔔 Notify
                </button>
                <button onClick={() => clipboard.write(`Count: ${count}`)}>📋 Copy</button>
                <button onClick={pickAndRead}>📂 Pick & read</button>
                <button onClick={() => shell.openExternal('https://github.com/murasakijs/murasaki')}>
                  🔗 Open repo
                </button>
              </Row>
              {filePath && (
                <Text size={12} color="#888">
                  Last picked: <code>{filePath}</code>
                </Text>
              )}
            </Stack>
          )}

          {section === 'window' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                Window control
              </Text>
              <Row gap={8} wrap>
                <button onClick={() => win.minimize()}>🟡 Minimize</button>
                <button onClick={() => win.toggleMaximize()}>🟢 Toggle max</button>
                <button onClick={() => win.setSize(1440, 900)}>↔ Resize 1440×900</button>
                <button onClick={() => win.setTitle(`Murasaki — ${count}`)}>
                  🪟 Title = count
                </button>
              </Row>
            </Stack>
          )}
        </Pane>
      </Row>
    </View>
  )
}
