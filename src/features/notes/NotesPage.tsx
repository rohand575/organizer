import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { orderBy, useCollection, serverTimestamp, type Doc } from '../../lib/useCollection'
import { EmptyState } from '../../components/EmptyState'
import { NoteIcon, PlusIcon, PinIcon } from '../../components/icons'
import { NoteEditor } from './NoteEditor'

export interface NoteDoc extends Doc {
  title: string
  body: string
  color: string
  pinned: boolean
  updatedAt?: unknown
}

export const NOTE_COLORS = ['#FFFFFF', '#FEF3C7', '#DCFCE7', '#DBEAFE', '#FCE7F3', '#EDE9FE', '#FFEDD5']

export function NotesPage() {
  const { docs, loading, add, update, remove } = useCollection<NoteDoc>(
    'notes',
    orderBy('updatedAt', 'desc'),
  )
  const [editing, setEditing] = useState<NoteDoc | 'new' | null>(null)

  const pinned = docs.filter((n) => n.pinned)
  const others = docs.filter((n) => !n.pinned)

  const save = async (data: { id?: string; title: string; body: string; color: string; pinned: boolean }) => {
    const payload = {
      title: data.title,
      body: data.body,
      color: data.color,
      pinned: data.pinned,
      updatedAt: serverTimestamp(),
    }
    if (data.id) await update(data.id, payload)
    else if (data.title || data.body) await add(payload)
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-3xl">
      {!loading && docs.length === 0 && (
        <EmptyState
          icon={<NoteIcon className="h-7 w-7" />}
          title="No notes yet"
          subtitle="Capture a thought. Tap the + button to create your first note."
        />
      )}

      {pinned.length > 0 && (
        <>
          <SectionLabel>Pinned</SectionLabel>
          <Masonry notes={pinned} onOpen={setEditing} />
          {others.length > 0 && <SectionLabel>Others</SectionLabel>}
        </>
      )}
      <Masonry notes={others} onOpen={setEditing} />

      {/* Floating add button */}
      <button
        onClick={() => setEditing('new')}
        aria-label="New note"
        className="press fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-white shadow-float md:bottom-8"
      >
        <PlusIcon className="h-7 w-7" />
      </button>

      <AnimatePresence>
        {editing && (
          <NoteEditor
            note={editing === 'new' ? null : editing}
            onSave={save}
            onDelete={editing !== 'new' ? () => { remove((editing as NoteDoc).id); setEditing(null) } : undefined}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-subtle">
      {children}
    </div>
  )
}

function Masonry({ notes, onOpen }: { notes: NoteDoc[]; onOpen: (n: NoteDoc) => void }) {
  return (
    <div className="columns-2 gap-3 md:columns-3 [&>*]:mb-3">
      {notes.map((note) => (
        <motion.button
          layout
          key={note.id}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={() => onOpen(note)}
          style={{ backgroundColor: note.color }}
          className="press block w-full break-inside-avoid rounded-2xl border border-black/[0.04] p-4 text-left shadow-card"
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            {note.title && (
              <h3 className="text-[15px] font-semibold leading-snug text-ink">{note.title}</h3>
            )}
            {note.pinned && <PinIcon className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />}
          </div>
          {note.body && (
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink/80 line-clamp-[12]">
              {note.body}
            </p>
          )}
        </motion.button>
      ))}
    </div>
  )
}
