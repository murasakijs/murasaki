// src/app/page.tsx — Home. Now using murasaki's UI components.

import {
  Button,
  Card,
  Input,
  Link,
  List,
  ListItem,
  Modal,
  Pane,
  Row,
  Sidebar,
  SidebarItem,
  Stack,
  Text,
  Textarea,
  TitleBar,
  View,
} from 'murasaki'
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
  const [name, setName] = useState('Murasaki')
  const [note, setNote] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
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
    setNote(text.slice(0, 1000))
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
          <SidebarItem active={section === 'form'} onClick={() => setSection('form')}>
            Form
          </SidebarItem>
          <SidebarItem active={section === 'native'} onClick={() => setSection('native')}>
            Native APIs
          </SidebarItem>
          <SidebarItem active={section === 'list'} onClick={() => setSection('list')}>
            List
          </SidebarItem>
          <SidebarItem active={section === 'window'} onClick={() => setSection('window')}>
            Window
          </SidebarItem>
        </Sidebar>

        <Pane>
          {section === 'counter' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                Counter
              </Text>
              <Card>
                <Row gap={12} align="center" justify="center">
                  <Button variant="secondary" onClick={() => setCount(count - 1)}>
                    −
                  </Button>
                  <Text size={28} weight="bold" style={{ minWidth: '64px', textAlign: 'center' }}>
                    {count}
                  </Text>
                  <Button onClick={() => setCount(count + 1)}>+</Button>
                </Row>
              </Card>
              <nav>
                <Link href="/about">About →</Link>
              </nav>
            </Stack>
          )}

          {section === 'form' && (
            <Stack gap={16} style={{ maxWidth: '480px' }}>
              <Text as="h1" size={28} weight="bold">
                Form
              </Text>
              <Card>
                <Stack gap={12}>
                  <Stack gap={4}>
                    <Text size={12} weight="medium" color="#666">
                      Name
                    </Text>
                    <Input
                      value={name}
                      onInput={(e) => setName((e.target as HTMLInputElement).value)}
                      placeholder="Your name"
                    />
                  </Stack>
                  <Stack gap={4}>
                    <Text size={12} weight="medium" color="#666">
                      Note
                    </Text>
                    <Textarea
                      value={note}
                      rows={4}
                      onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
                      placeholder="Anything…"
                    />
                  </Stack>
                  <Row gap={8} justify="end">
                    <Button variant="ghost" onClick={() => setNote('')}>
                      Clear
                    </Button>
                    <Button onClick={() => setModalOpen(true)}>Preview</Button>
                  </Row>
                </Stack>
              </Card>
            </Stack>
          )}

          {section === 'native' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                Native APIs
              </Text>
              <Row gap={8} wrap>
                <Button onClick={() => notify({ title: 'Hello', body: `${name} — ${count}` })}>
                  🔔 Notify
                </Button>
                <Button variant="secondary" onClick={() => clipboard.write(name)}>
                  📋 Copy name
                </Button>
                <Button variant="secondary" onClick={pickAndRead}>
                  📂 Pick & read
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => shell.openExternal('https://github.com/murasakijs/murasaki')}
                >
                  🔗 Repo
                </Button>
              </Row>
              {filePath && (
                <Text size={12} color="#888">
                  Last picked: <code>{filePath}</code>
                </Text>
              )}
            </Stack>
          )}

          {section === 'list' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                List
              </Text>
              <List>
                <ListItem active onClick={() => notify({ title: 'Picked', body: 'Inbox' })}>
                  Inbox
                </ListItem>
                <ListItem onClick={() => notify({ title: 'Picked', body: 'Sent' })}>Sent</ListItem>
                <ListItem onClick={() => notify({ title: 'Picked', body: 'Drafts' })}>
                  Drafts
                </ListItem>
                <ListItem onClick={() => notify({ title: 'Picked', body: 'Trash' })}>
                  Trash
                </ListItem>
              </List>
            </Stack>
          )}

          {section === 'window' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                Window control
              </Text>
              <Row gap={8} wrap>
                <Button variant="secondary" onClick={() => win.minimize()}>
                  🟡 Minimize
                </Button>
                <Button variant="secondary" onClick={() => win.toggleMaximize()}>
                  🟢 Toggle max
                </Button>
                <Button variant="secondary" onClick={() => win.setSize(1440, 900)}>
                  ↔ Resize 1440×900
                </Button>
                <Button onClick={() => win.setTitle(`Murasaki — ${name}`)}>🪟 Title = name</Button>
              </Row>
            </Stack>
          )}
        </Pane>
      </Row>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={`Preview: ${name}`}>
        <Text>{note || '(empty)'}</Text>
      </Modal>
    </View>
  )
}
