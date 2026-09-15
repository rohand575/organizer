import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { orderBy, useCollection, type Doc } from '../../lib/useCollection'
import { Checkbox } from '../../components/Checkbox'
import { IconButton } from '../../components/IconButton'
import { AddBar } from '../../components/AddBar'
import { EmptyState } from '../../components/EmptyState'
import { CheckCircleIcon, TrashIcon } from '../../components/icons'

interface Todo extends Doc {
  text: string
  done: boolean
  order: number
  createdAt?: unknown
}

export function TodosPage() {
  const { docs, loading, add, update, remove } = useCollection<Todo>('todos', orderBy('order', 'asc'))
  const [editingId, setEditingId] = useState<string | null>(null)

  const active = docs.filter((t) => !t.done)
  const done = docs.filter((t) => t.done)

  const addTodo = (text: string) => {
    const minOrder = docs.reduce((m, t) => Math.min(m, t.order ?? 0), 0)
    add({ text, done: false, order: minOrder - 1 })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <AddBar placeholder="Add a task…" onAdd={addTodo} />

      {!loading && docs.length === 0 && (
        <EmptyState
          icon={<CheckCircleIcon className="h-7 w-7" />}
          title="Nothing to do — yet"
          subtitle="Add your first task above. It syncs instantly across your devices."
        />
      )}

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {active.map((todo) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              editing={editingId === todo.id}
              onEdit={() => setEditingId(todo.id)}
              onCommit={(text) => {
                setEditingId(null)
                if (text.trim() && text !== todo.text) update(todo.id, { text: text.trim() })
              }}
              onToggle={() => update(todo.id, { done: !todo.done })}
              onDelete={() => remove(todo.id)}
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
              {done.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  editing={false}
                  onEdit={() => {}}
                  onCommit={() => {}}
                  onToggle={() => update(todo.id, { done: !todo.done })}
                  onDelete={() => remove(todo.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  )
}

function TodoRow({
  todo,
  editing,
  onEdit,
  onCommit,
  onToggle,
  onDelete,
}: {
  todo: Todo
  editing: boolean
  onEdit: () => void
  onCommit: (text: string) => void
  onToggle: () => void
  onDelete: () => void
}) {
  const [text, setText] = useState(todo.text)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className="card group flex items-center gap-3 px-4 py-3"
    >
      <Checkbox checked={todo.done} onChange={onToggle} />
      {editing ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onCommit(text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(text)
            if (e.key === 'Escape') onCommit(todo.text)
          }}
          className="w-full bg-transparent text-[15px] outline-none"
        />
      ) : (
        <button
          onClick={onEdit}
          className={`flex-1 text-left text-[15px] transition-colors ${
            todo.done ? 'text-subtle line-through' : 'text-ink'
          }`}
        >
          {todo.text}
        </button>
      )}
      <IconButton
        onClick={onDelete}
        aria-label="Delete"
        className="opacity-0 group-hover:opacity-100"
      >
        <TrashIcon className="h-4 w-4" />
      </IconButton>
    </motion.div>
  )
}
