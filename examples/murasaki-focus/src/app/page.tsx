import { useEffect, useMemo, useState } from 'react'
import { ContextMenuTrigger, useContextMenu } from 'murasaki'
import type { Metadata } from 'murasaki'
import { Bell, Check, Circle, Pause, Play, RotateCcw } from 'lucide-react'

export const metadata: Metadata = { title: 'Murasaki Focus' }

type Task = { id: number; label: string; done: boolean }
const initialTasks: Task[] = [
  { id: 1, label: 'Write release notes', done: false },
  { id: 2, label: 'Test the installer', done: false },
  { id: 3, label: 'Publish the demo', done: false },
]

export default function FocusPage() {
  const [seconds, setSeconds] = useState(() => Number(localStorage.getItem('murasaki-showcase:focus-seconds') ?? 1500))
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<'focus' | 'break'>('focus')
  const [session, setSession] = useState(2)
  const [tasks, setTasks] = useState<Task[]>(() => {
    try { return JSON.parse(localStorage.getItem('murasaki-showcase:focus-tasks') ?? 'null') ?? initialTasks } catch { return initialTasks }
  })
  const [selectedTask, setSelectedTask] = useState(1)

  const reset = () => {
    setRunning(false)
    setSeconds(mode === 'focus' ? 1500 : 300)
  }
  const toggle = () => setRunning((value) => !value)

  useContextMenu('focus-timer', [
    { label: running ? 'Pause timer' : 'Start timer', shortcut: 'space', action: toggle },
    { label: 'Reset timer', action: reset },
  ])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setSeconds((value) => {
        if (value > 0) return value - 1
        setRunning(false)
        setSession((current) => current === 4 ? 1 : current + 1)
        return mode === 'focus' ? 1500 : 300
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running, mode])

  useEffect(() => {
    localStorage.setItem('murasaki-showcase:focus-seconds', String(seconds))
  }, [seconds])

  useEffect(() => {
    localStorage.setItem('murasaki-showcase:focus-tasks', JSON.stringify(tasks))
  }, [tasks])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const time = useMemo(() => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`, [seconds])
  const setTimerMode = (next: 'focus' | 'break') => {
    setMode(next)
    setRunning(false)
    setSeconds(next === 'focus' ? 1500 : 300)
  }

  const toggleTask = (id: number) => setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done } : task))

  return (
    <main className="focus-app">
      <aside className="focus-sidebar">
        <div className="focus-brand"><span className="pixel-butterfly" aria-hidden>✵</span><strong>Murasaki Focus</strong></div>
        <h2>Today</h2>
        <div className="task-list">
          {tasks.map((task) => (
            <button key={task.id} className={`task-row ${task.id === selectedTask ? 'is-selected' : ''} ${task.done ? 'is-done' : ''}`} onClick={() => setSelectedTask(task.id)} onDoubleClick={() => toggleTask(task.id)}>
              <span onClick={(event) => { event.stopPropagation(); toggleTask(task.id) }}>{task.done ? <Check size={18} /> : <Circle size={18} />}</span>
              {task.label}
            </button>
          ))}
        </div>
        <div className="notification-state"><Bell size={16} /> Completion cue ready</div>
      </aside>

      <ContextMenuTrigger id="focus-timer">
        <section className="timer-stage">
          <div className="timer-mark" aria-hidden>✵</div>
          <div className="mode-tabs">
            <button className={mode === 'focus' ? 'is-active' : ''} onClick={() => setTimerMode('focus')}>Focus</button>
            <button className={mode === 'break' ? 'is-active' : ''} onClick={() => setTimerMode('break')}>Short break</button>
          </div>
          <div className="timer-value" aria-live="polite">{time}</div>
          <p className="timer-task">{tasks.find((task) => task.id === selectedTask)?.label}</p>
          <div className="timer-actions">
            <button className="primary-control" onClick={toggle}>{running ? <Pause size={19} /> : <Play size={19} />}{running ? 'Pause' : 'Start'}</button>
            <button className="secondary-control" onClick={reset}><RotateCcw size={19} /> Reset</button>
          </div>
          <div className="session-progress">
            <span>Session {session} of 4</span>
            <div>{[1, 2, 3, 4].map((index) => <i key={index} className={index <= session ? 'is-complete' : ''} />)}</div>
          </div>
          <div className="shortcut-hint"><kbd>Space</kbd> Start / Pause</div>
          <p className="native-hint">Right-click the timer for a native OS menu.</p>
        </section>
      </ContextMenuTrigger>
    </main>
  )
}
