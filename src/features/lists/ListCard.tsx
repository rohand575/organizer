import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { orderBy, useCollection, type Doc } from '../../lib/useCollection'
import { Checkbox } from '../../components/Checkbox'
import { IconButton } from '../../components/IconButton'
import { ChevronIcon, TrashIcon, PlusIcon } from '../../components/icons'
import type { ListDoc } from './ListsPage'

interface Item extends Doc {
  text: string
  checked: boolean
  order: number
}

export function ListCard({
  list,
  onToggleExpand,
  onRename,
  onDelete,
}: {
  list: ListDoc
  onToggleExpand: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const { docs: items, add, update, remove } = useCollection<Item>(
    `lists/${list.id}/items`,
    orderBy('order', 'asc'),
  )
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(list.title)
  const [newItem, setNewItem] = useState('')

  const remaining = items.filter((i) => !i.checked).length

  const addItem = () => {
    const t = newItem.trim()
    if (!t) return
    const maxOrder = items.reduce((m, i) => Math.max(m, i.order ?? 0), 0)
    add({ text: t, checked: false, order: maxOrder + 1 })
    setNewItem('')
  }

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button
          onClick={onToggleExpand}
          className="press grid h-7 w-7 shrink-0 place-items-center rounded-full"
          style={{ backgroundColor: list.color + '1A', color: list.color }}
          aria-label={list.expanded ? 'Collapse' : 'Expand'}
        >
          <motion.span animate={{ rotate: list.expanded ? 90 : 0 }}>
            <ChevronIcon className="h-4 w-4" />
          </motion.span>
        </button>

        {renaming ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setRenaming(false)
              if (title.trim() && title !== list.title) onRename(title.trim())
              else setTitle(list.title)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="flex-1 bg-transparent text-[17px] font-semibold outline-none"
          />
        ) : (
          <button
            onClick={() => setRenaming(true)}
            className="flex-1 text-left text-[17px] font-semibold"
          >
            {list.title}
          </button>
        )}

        <span className="text-sm tabular-nums text-subtle">{remaining}</span>
        <IconButton onClick={onDelete} aria-label="Delete list">
          <TrashIcon className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Items */}
      <AnimatePresence initial={false}>
        {list.expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 border-t border-hair px-2 py-2">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.div
                    layout
                    key={item.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-black/[0.03]"
                  >
                    <Checkbox
                      checked={item.checked}
                      accent={list.color}
                      onChange={() => update(item.id, { checked: !item.checked })}
                    />
                    <span
                      className={`flex-1 text-[15px] ${
                        item.checked ? 'text-subtle line-through' : 'text-ink'
                      }`}
                    >
                      {item.text}
                    </span>
                    <IconButton
                      onClick={() => remove(item.id)}
                      aria-label="Remove item"
                      className="opacity-0 group-hover:opacity-100"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </IconButton>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Add item */}
              <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="grid h-6 w-6 place-items-center text-subtle">
                  <PlusIcon className="h-4 w-4" />
                </span>
                <input
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addItem()}
                  onBlur={addItem}
                  placeholder="Add item"
                  className="w-full bg-transparent text-[15px] outline-none placeholder:text-subtle/70"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
