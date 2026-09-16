import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { orderBy, useCollection, type Doc } from '../../lib/useCollection'
import { randomTaskColor } from '../../lib/commands'
import { deleteEvent } from '../../lib/calendar'
import { Checkbox } from '../../components/Checkbox'
import { IconButton } from '../../components/IconButton'
import { AddBar } from '../../components/AddBar'
import { EmptyState } from '../../components/EmptyState'
import { CheckCircleIcon, ClockIcon, TrashIcon } from '../../components/icons'
import { TaskEditor } from './TaskEditor'

export interface Task extends Doc {
  text: string
  done: boolean
  order: number
  color?: string
  remindAt?: string | null
  calendarEventId?: string | null
  createdAt?: unknown
}

function formatReminder(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function TasksPage() {
  const { docs, loading, add, update, remove } = useCollection<Task>('tasks', orderBy('order', 'asc'))
  const [editing, setEditing] = useState<Task | null>(null)

  const active = docs.filter((t) => !t.done)
  const done = docs.filter((t) => t.done)

  const addTask = (text: string) => {
    const minOrder = docs.reduce((m, t) => Math.min(m, t.order ?? 0), 0)
    add({
      text,
      done: false,
      order: minOrder - 1,
      color: randomTaskColor(),
      remindAt: null,
      calendarEventId: null,
    })
  }

  // Deleting or completing a task also removes its calendar event (best-effort).
  const deleteTask = (task: Task) => {
    if (task.calendarEventId) deleteEvent(task.calendarEventId).catch(() => {})
    remove(task.id)
  }

  const toggleDone = (task: Task) => {
    if (!task.done && task.calendarEventId) {
      deleteEvent(task.calendarEventId).catch(() => {})
      update(task.id, { done: true, calendarEventId: null })
    } else {
      update(task.id, { done: !task.done })
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <AddBar placeholder="Add a task…" onAdd={addTask} />

      {!loading && docs.length === 0 && (
        <EmptyState
          icon={<CheckCircleIcon className="h-7 w-7" />}
          title="Nothing to do — yet"
          subtitle="Add a task above, or hold the mic and say it. Tap a task to set a reminder."
        />
      )}

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {active.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onEdit={() => setEditing(task)}
              onToggle={() => toggleDone(task)}
              onDelete={() => deleteTask(task)}
            />
          ))}
        </AnimatePresence>
      </div>

      {done.length > 0 && (
        <div className="pt-4">
          <div className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
            Completed · {done.length}
          </div>
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onEdit={() => setEditing(task)}
                  onToggle={() => update(task.id, { done: !task.done })}
                  onDelete={() => remove(task.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      <AnimatePresence>
        {editing && (
          <TaskEditor
            task={editing}
            onClose={() => setEditing(null)}
            onUpdate={update}
            onDelete={() => {
              deleteTask(editing)
              setEditing(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function TaskRow({
  task,
  onEdit,
  onToggle,
  onDelete,
}: {
  task: Task
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className="card group flex items-center gap-3 px-4 py-3"
    >
      <Checkbox checked={task.done} accent={task.color} onChange={onToggle} />
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span
          className={`block truncate text-[15px] transition-colors ${
            task.done ? 'text-subtle line-through' : 'text-ink'
          }`}
        >
          {task.text}
        </span>
        {task.remindAt && !task.done && (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-subtle">
            <ClockIcon className="h-3.5 w-3.5" />
            {formatReminder(task.remindAt)}
          </span>
        )}
      </button>
      <IconButton onClick={onDelete} aria-label="Delete" className="opacity-0 group-hover:opacity-100">
        <TrashIcon className="h-4 w-4" />
      </IconButton>
    </motion.div>
  )
}
