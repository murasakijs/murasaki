// src/app/page.tsx — Home. Tier 1 + Tier 2 components in action.

import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ContextMenu,
  Input,
  Link,
  List,
  ListItem,
  Modal,
  Pane,
  Progress,
  Radio,
  Row,
  Sidebar,
  SidebarItem,
  Spinner,
  Stack,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  Textarea,
  Tooltip,
  useToast,
  View,
} from 'murasaki'
import {
  useClipboard,
  useDialog,
  useEffect,
  useFs,
  useNotification,
  useShell,
  useState,
  useWindow,
} from 'murasaki/jsx/dom'

export default function HomePage() {
  const [section, setSection] = useState('basics')

  // Form state (used in Form tab)
  const [count, setCount] = useState(0)
  const [name, setName] = useState('Murasaki')
  const [agree, setAgree] = useState(false)
  const [notify, setNotify] = useState(true)
  const [color, setColor] = useState('purple')
  const [tab, setTab] = useState('counter')
  const [modalOpen, setModalOpen] = useState(false)
  const [note, setNote] = useState('')
  const [filePath, setFilePath] = useState('')
  const [progress, setProgress] = useState(0)
  const [loading, setLoading] = useState(false)

  const notification = useNotification()
  const clipboard = useClipboard()
  const shell = useShell()
  const dialog = useDialog()
  const fs = useFs()
  const win = useWindow()
  const toast = useToast()

  // Progress auto-tick when feedback section is shown.
  useEffect(() => {
    if (section !== 'feedback') return
    const t = setInterval(() => {
      setProgress((p) => (p >= 100 ? 0 : p + 8))
    }, 240)
    return () => clearInterval(t)
  }, [section])

  async function pickAndRead() {
    const paths = await dialog.openFile({ title: 'Pick a text file' })
    if (paths.length === 0) return
    setFilePath(paths[0])
    const text = await fs.readFile(paths[0])
    setNote(text.slice(0, 1000))
  }

  return (
    <View style={{ height: '100vh' }}>
      <Row grow>
        <Sidebar width={200}>
          <SidebarItem active={section === 'basics'} onClick={() => setSection('basics')}>
            Basics
          </SidebarItem>
          <SidebarItem active={section === 'forms'} onClick={() => setSection('forms')}>
            Forms
          </SidebarItem>
          <SidebarItem active={section === 'overlay'} onClick={() => setSection('overlay')}>
            Overlay
          </SidebarItem>
          <SidebarItem active={section === 'feedback'} onClick={() => setSection('feedback')}>
            Feedback
          </SidebarItem>
          <SidebarItem active={section === 'native'} onClick={() => setSection('native')}>
            Native APIs
          </SidebarItem>
        </Sidebar>

        <Pane>
          {section === 'basics' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                Basics
              </Text>

              <Tabs value={tab} onChange={setTab}>
                <TabList>
                  <Tab value="counter" active={tab === 'counter'} onClick={() => setTab('counter')}>
                    Counter
                  </Tab>
                  <Tab value="list" active={tab === 'list'} onClick={() => setTab('list')}>
                    List
                  </Tab>
                  <Tab value="modal" active={tab === 'modal'} onClick={() => setTab('modal')}>
                    Modal
                  </Tab>
                </TabList>

                <TabPanel value="counter" active={tab}>
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
                </TabPanel>

                <TabPanel value="list" active={tab}>
                  <List>
                    <ListItem active>Inbox</ListItem>
                    <ListItem>Sent</ListItem>
                    <ListItem>Drafts</ListItem>
                    <ListItem>Trash</ListItem>
                  </List>
                </TabPanel>

                <TabPanel value="modal" active={tab}>
                  <Button onClick={() => setModalOpen(true)}>Open modal</Button>
                  <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Hello">
                    <Text>Modal content. Click ✕ or outside to close.</Text>
                  </Modal>
                </TabPanel>
              </Tabs>

              <nav>
                <Link href="/about">About →</Link>
              </nav>
            </Stack>
          )}

          {section === 'forms' && (
            <Stack gap={16} style={{ maxWidth: '480px' }}>
              <Text as="h1" size={28} weight="bold">
                Forms
              </Text>
              <Card>
                <Stack gap={14}>
                  <Stack gap={4}>
                    <Text size={12} weight="medium" color="#666">
                      Name
                    </Text>
                    <Input
                      value={name}
                      onInput={(e) => setName((e.target as HTMLInputElement).value)}
                    />
                  </Stack>

                  <Stack gap={4}>
                    <Text size={12} weight="medium" color="#666">
                      Note
                    </Text>
                    <Textarea
                      value={note}
                      rows={3}
                      onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
                    />
                  </Stack>

                  <Switch
                    checked={notify}
                    onChange={setNotify}
                    label="Send a notification on submit"
                  />

                  <Checkbox checked={agree} onChange={setAgree} label="I agree to the terms" />

                  <Stack gap={6}>
                    <Text size={12} weight="medium" color="#666">
                      Theme color
                    </Text>
                    <Row gap={12}>
                      <Radio
                        value="purple"
                        groupValue={color}
                        groupChange={setColor}
                        label="Purple"
                      />
                      <Radio
                        value="blue"
                        groupValue={color}
                        groupChange={setColor}
                        label="Blue"
                      />
                      <Radio
                        value="pink"
                        groupValue={color}
                        groupChange={setColor}
                        label="Pink"
                      />
                    </Row>
                  </Stack>

                  <Row gap={8} justify="end">
                    <Button
                      disabled={!agree}
                      onClick={() => {
                        if (notify) notification({ title: name, body: `${color}; ${note}` })
                      }}
                    >
                      Submit
                    </Button>
                  </Row>
                </Stack>
              </Card>
            </Stack>
          )}

          {section === 'overlay' && (
            <Stack gap={20} style={{ maxWidth: '520px' }}>
              <Text as="h1" size={28} weight="bold">
                Overlay
              </Text>

              <Stack gap={8}>
                <Text weight="medium">Tooltip</Text>
                <Row gap={12}>
                  <Tooltip text="Top tooltip">
                    <Button variant="secondary">Hover top</Button>
                  </Tooltip>
                  <Tooltip text="Bottom tooltip" position="bottom">
                    <Button variant="secondary">Hover bottom</Button>
                  </Tooltip>
                </Row>
              </Stack>

              <Stack gap={8}>
                <Text weight="medium">Context menu (right-click)</Text>
                <ContextMenu
                  items={[
                    {
                      label: 'Copy',
                      onClick: () => clipboard.write(`Right-clicked: ${name}`),
                    },
                    {
                      label: 'Notify',
                      onClick: () => notification({ title: 'From menu', body: name }),
                    },
                    { type: 'separator' },
                    { label: 'Disabled item', disabled: true },
                    {
                      label: 'Delete',
                      danger: true,
                      onClick: () => setName(''),
                    },
                  ]}
                >
                  <Card padding={32}>
                    <Text>Right-click anywhere in this card</Text>
                  </Card>
                </ContextMenu>
              </Stack>
            </Stack>
          )}

          {section === 'feedback' && (
            <Stack gap={24} style={{ maxWidth: '520px' }}>
              <Text as="h1" size={28} weight="bold">
                Feedback
              </Text>

              <Stack gap={8}>
                <Text weight="medium">Badge</Text>
                <Row gap={8} wrap>
                  <Badge>New</Badge>
                  <Badge variant="secondary">Beta</Badge>
                  <Badge variant="success">Active</Badge>
                  <Badge variant="danger">3</Badge>
                  <Badge variant="neutral">Done</Badge>
                  <Badge variant="primary" dot />
                  <Badge variant="danger" dot />
                </Row>
              </Stack>

              <Stack gap={8}>
                <Text weight="medium">Avatar</Text>
                <Row gap={12} align="center">
                  <Avatar name="Ichi" size={24} />
                  <Avatar name="Murasaki" size={32} />
                  <Avatar name="Hono" size={40} />
                  <Avatar name="Tauri" size={56} />
                </Row>
              </Stack>

              <Stack gap={8}>
                <Text weight="medium">Spinner</Text>
                <Row gap={12} align="center">
                  <Spinner size={14} />
                  <Spinner size={20} />
                  <Spinner size={28} />
                  <Button
                    loading={loading}
                    onClick={() => {
                      setLoading(true)
                      setTimeout(() => setLoading(false), 1500)
                    }}
                  >
                    {loading ? 'Saving…' : 'Save (1.5s)'}
                  </Button>
                </Row>
              </Stack>

              <Stack gap={8}>
                <Text weight="medium">Progress</Text>
                <Progress value={progress} />
                <Text size={12} color="#888">
                  Indeterminate:
                </Text>
                <Progress indeterminate />
              </Stack>

              <Stack gap={8}>
                <Text weight="medium">Toast</Text>
                <Row gap={8} wrap>
                  <Button onClick={() => toast.show({ title: 'Hello', body: name })}>
                    Default
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      toast.show({ title: 'Saved', body: 'Your changes are saved.', variant: 'success' })
                    }
                  >
                    Success
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      toast.show({
                        title: 'Failed',
                        body: 'Network unreachable.',
                        variant: 'danger',
                      })
                    }
                  >
                    Danger
                  </Button>
                </Row>
              </Stack>
            </Stack>
          )}

          {section === 'native' && (
            <Stack gap={16}>
              <Text as="h1" size={28} weight="bold">
                Native APIs
              </Text>
              <Row gap={8} wrap>
                <Button onClick={() => notification({ title: 'Hello', body: name })}>
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
                <Button variant="ghost" onClick={() => win.toggleMaximize()}>
                  🟢 Toggle max
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    const id = await win.open({
                      title: 'About — new window',
                      url: '/about',
                      width: 540,
                      height: 360,
                    })
                    toast.show({ title: 'Opened', body: `window id: ${id}` })
                  }}
                >
                  🪟 New window
                </Button>
              </Row>
              {filePath && (
                <Text size={12} color="#888">
                  Last picked: <code>{filePath}</code>
                </Text>
              )}
            </Stack>
          )}
        </Pane>
      </Row>
    </View>
  )
}
