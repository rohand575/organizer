import { orderBy, useCollection, type Doc } from '../../lib/useCollection'
import { AddBar } from '../../components/AddBar'
import { EmptyState } from '../../components/EmptyState'
import { ListIcon } from '../../components/icons'
import { ListCard } from './ListCard'

export interface ListDoc extends Doc {
  title: string
  color: string
  expanded: boolean
  order: number
}

const LIST_COLORS = ['#0A84FF', '#34C759', '#FF9500', '#FF375F', '#AF52DE', '#5AC8FA']

export function ListsPage() {
  const { docs, loading, add, update, remove } = useCollection<ListDoc>(
    'lists',
    orderBy('order', 'asc'),
  )

  const addList = (title: string) => {
    const minOrder = docs.reduce((m, l) => Math.min(m, l.order ?? 0), 0)
    const color = LIST_COLORS[docs.length % LIST_COLORS.length]
    add({ title, color, expanded: true, order: minOrder - 1 })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <AddBar placeholder="New list (e.g. Groceries)…" onAdd={addList} />

      {!loading && docs.length === 0 && (
        <EmptyState
          icon={<ListIcon className="h-7 w-7" />}
          title="No lists yet"
          subtitle="Create a list like Groceries or Packing, then tap to add items with checkboxes."
        />
      )}

      <div className="space-y-3">
        {docs.map((list) => (
          <ListCard
            key={list.id}
            list={list}
            onToggleExpand={() => update(list.id, { expanded: !list.expanded })}
            onRename={(title) => update(list.id, { title })}
            onDelete={() => remove(list.id)}
          />
        ))}
      </div>
    </div>
  )
}
