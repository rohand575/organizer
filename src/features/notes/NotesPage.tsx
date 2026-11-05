import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../../auth/AuthProvider'
import { orderBy, useCollection } from '../../lib/useCollection'
import { EmptyState } from '../../components/EmptyState'
import { IconButton } from '../../components/IconButton'
import {
  ArchiveIcon,
  ChevronIcon,
  FolderIcon,
  NoteIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from '../../components/icons'
import { ConfirmDialog, NameDialog } from './Dialogs'
import { NoteEditor } from './NoteEditor'
import { NoteBody, toggleCheck } from './noteFormat'
import {
  createFolder,
  deleteFolder,
  deleteNote,
  fieldsOf,
  newNoteId,
  renameFolder,
  restoreNote,
  saveNote,
  type FolderDoc,
  type NoteDoc,
  type NoteSnapshot,
} from './notes'

interface Snack {
  key: number
  text: string
  undo?: () => void
}

type Dialog = 'new-folder' | 'rename-folder' | 'delete-folder' | null

/**
 * Three views share this page:
 *   /notes              notes not in any folder, plus the folder tiles
 *   /notes/f/:folderId  just that folder's notes
 *   /notes/archive      archived notes from everywhere
 */
export function NotesPage({ archive = false }: { archive?: boolean }) {
  const { user } = useAuth()
  const uid = user?.uid ?? ''
  const { folderId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { docs: notes, loading } = useCollection<NoteDoc>('notes', orderBy('updatedAt', 'desc'))
  const { docs: folderDocs, loading: foldersLoading } = useCollection<FolderDoc>('noteFolders')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ id: string; note: NoteDoc | null } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [snack, setSnack] = useState<Snack | null>(null)

  const folders = useMemo(
    () => [...folderDocs].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })),
    [folderDocs],
  )
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders])
  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined
  const isRoot = !archive && !folderId

  // A note whose folder no longer exists (deleted on another device mid-move)
  // shows at the root rather than vanishing.
  const inRoot = (n: NoteDoc) => !n.folderId || (!foldersLoading && !folderIds.has(n.folderId))
  const active = notes.filter((n) => !n.archived)
  const archivedCount = notes.length - active.length

  const scope = archive
    ? notes.filter((n) => n.archived)
    : folderId
      ? active.filter((n) => n.folderId === folderId)
      : active.filter(inRoot)

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const searching = terms.length > 0
  // Searching from the top level looks inside folders too.
  const results = searching
    ? (isRoot ? active : scope).filter((n) => {
        const hay = `${n.title ?? ''}\n${n.body ?? ''}`.toLowerCase()
        return terms.every((t) => hay.includes(t))
      })
    : []

  const counts = new Map<string, number>()
  for (const n of active) if (n.folderId) counts.set(n.folderId, (counts.get(n.folderId) ?? 0) + 1)

  useEffect(() => {
    if (!snack) return
    const t = setTimeout(() => setSnack(null), 5000)
    return () => clearTimeout(t)
  }, [snack])

  const notify = (text: string, undo?: () => void) => setSnack({ key: Date.now(), text, undo })

  const removeWithUndo = (snap: NoteSnapshot, label: string) => {
    deleteNote(uid, snap.id)
    notify(label, () => restoreNote(uid, snap))
  }

  const onArchived = (snap: NoteSnapshot) => {
    const { archived } = snap.fields
    notify(archived ? 'Note archived' : 'Note unarchived', () =>
      saveNote(uid, snap.id, { ...snap.fields, archived: !archived }, { touch: false }),
    )
  }

  // Ticking a box on a card is a quick check-off, not an edit: don't bump the
  // note to the top while your finger is on it.
  const tick = (note: NoteDoc, line: number) =>
    saveNote(uid, note.id, { ...fieldsOf(note), body: toggleCheck(note.body ?? '', line) }, { touch: false })

  const goBack = () => {
    // Pop history when we navigated here in-app; otherwise (deep link) go up.
    if (location.key !== 'default') navigate(-1)
    else navigate('/notes', { replace: true })
  }

  if (folderId && !foldersLoading && !folder) return <Navigate to="/notes" replace />

  const folderNameOf = (n: NoteDoc) => (n.folderId ? folders.find((f) => f.id === n.folderId)?.name : undefined)
  const openNote = (note: NoteDoc) => setEditing({ id: note.id, note })
  const pinned = scope.filter((n) => n.pinned)
  const others = scope.filter((n) => !n.pinned)

  return (
    <div className="mx-auto max-w-3xl">
      {/* Sub-header for folder and archive views */}
      {!isRoot && (
        <div className="mb-3 flex items-center gap-1">
          <IconButton onClick={goBack} aria-label="Back to Notes" className="-ml-2">
            <ChevronIcon className="h-5 w-5 rotate-180" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-tight">{archive ? 'Archive' : folder?.name}</h2>
            <p className="text-xs text-subtle">
              {scope.length} {scope.length === 1 ? 'note' : 'notes'}
            </p>
          </div>
          {folder && (
            <>
              <IconButton onClick={() => setDialog('rename-folder')} aria-label="Rename folder">
                <PencilIcon className="h-5 w-5" />
              </IconButton>
              <IconButton onClick={() => setDialog('delete-folder')} aria-label="Delete folder">
                <TrashIcon className="h-5 w-5" />
              </IconButton>
            </>
          )}
        </div>
      )}

      <SearchBar
        value={query}
        onChange={setQuery}
        placeholder={archive ? 'Search archive' : folder ? `Search in ${folder.name}` : 'Search notes'}
      />

      {searching ? (
        <>
          <SectionLabel>
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </SectionLabel>
          {results.length === 0 ? (
            <p className="py-10 text-center text-sm text-subtle">No notes match “{query.trim()}”.</p>
          ) : (
            <Masonry
              notes={results}
              onOpen={openNote}
              onTick={tick}
              folderLabel={isRoot ? folderNameOf : undefined}
            />
          )}
        </>
      ) : (
        <>
          {isRoot && (
            <FolderRow
              folders={folders}
              counts={counts}
              archivedCount={archivedCount}
              onNewFolder={() => setDialog('new-folder')}
            />
          )}

          {!loading && scope.length === 0 && (
            isRoot && (folders.length > 0 || active.length > 0) ? (
              <p className="py-10 text-center text-sm text-subtle">Notes that aren’t in a folder show up here.</p>
            ) : (
              <EmptyState
                icon={archive ? <ArchiveIcon className="h-7 w-7" /> : folder ? <FolderIcon className="h-7 w-7" /> : <NoteIcon className="h-7 w-7" />}
                title={archive ? 'No archived notes' : folder ? 'This folder is empty' : 'No notes yet'}
                subtitle={
                  archive
                    ? 'Archive a note to tuck it away without deleting it.'
                    : folder
                      ? `Tap the + button to add a note to ${folder.name}.`
                      : 'Capture a thought. Tap the + button to create your first note.'
                }
              />
            )
          )}

          {pinned.length > 0 && !archive && (
            <>
              <SectionLabel>Pinned</SectionLabel>
              <Masonry notes={pinned} onOpen={openNote} onTick={tick} />
              {others.length > 0 && <SectionLabel>Others</SectionLabel>}
            </>
          )}
          <Masonry notes={archive ? scope : others} onOpen={openNote} onTick={tick} />
        </>
      )}

      {/* Floating add button */}
      {!archive && (
        <button
          onClick={() => uid && setEditing({ id: newNoteId(uid), note: null })}
          aria-label="New note"
          className="press fixed right-5 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-white shadow-float bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-8"
        >
          <PlusIcon className="h-7 w-7" />
        </button>
      )}

      <AnimatePresence>
        {editing && (
          <NoteEditor
            key={editing.id}
            noteId={editing.id}
            note={editing.note}
            folders={folders}
            defaultFolderId={folderId ?? null}
            onClose={() => setEditing(null)}
            onRemove={removeWithUndo}
            onArchived={onArchived}
            notify={(text) => notify(text)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dialog === 'new-folder' && (
          <NameDialog
            title="New folder"
            confirmLabel="Create"
            onSubmit={(name) => createFolder(uid, name)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'rename-folder' && folder && (
          <NameDialog
            title="Rename folder"
            initial={folder.name}
            confirmLabel="Save"
            onSubmit={(name) => name !== folder.name && renameFolder(uid, folder.id, name)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'delete-folder' && folder && (
          <ConfirmDialog
            title={`Delete “${folder.name}”?`}
            message={
              scope.length
                ? `The ${scope.length === 1 ? 'note' : `${scope.length} notes`} inside will move to Notes.`
                : 'This folder is empty.'
            }
            confirmLabel="Delete"
            onConfirm={() => {
              const ids = notes.filter((n) => n.folderId === folder.id).map((n) => n.id)
              deleteFolder(uid, folder.id, ids)
              navigate('/notes', { replace: true })
            }}
            onClose={() => setDialog(null)}
          />
        )}
      </AnimatePresence>

      <Snackbar snack={snack} onDismiss={() => setSnack(null)} />
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-subtle">
      {children}
    </div>
  )
}

function SearchBar({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative mb-1">
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-subtle" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        placeholder={placeholder}
        enterKeyHint="search"
        aria-label={placeholder}
        className="w-full rounded-xl bg-black/[0.05] py-2.5 pl-10 pr-10 text-[15px] outline-none transition-colors placeholder:text-subtle focus:bg-surface focus:shadow-card"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-subtle hover:bg-black/5"
        >
          <XIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function FolderRow({
  folders,
  counts,
  archivedCount,
  onNewFolder,
}: {
  folders: FolderDoc[]
  counts: Map<string, number>
  archivedCount: number
  onNewFolder: () => void
}) {
  const tile = 'press flex w-32 shrink-0 flex-col gap-2 rounded-2xl p-3 text-left'
  return (
    <div className="no-scrollbar -mx-5 flex gap-2.5 overflow-x-auto px-5 pb-2 pt-3 md:mx-0 md:px-0">
      {folders.map((f) => (
        <Link key={f.id} to={`/notes/f/${f.id}`} className={`${tile} card`}>
          <FolderIcon className="h-5 w-5 text-accent" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ink">{f.name}</div>
            <div className="text-xs tabular-nums text-subtle">{counts.get(f.id) ?? 0}</div>
          </div>
        </Link>
      ))}
      <button type="button" onClick={onNewFolder} className={`${tile} border border-dashed border-black/15 text-subtle hover:bg-black/[0.03]`}>
        <PlusIcon className="h-5 w-5" />
        <div className="text-[14px] font-medium">New folder</div>
      </button>
      {archivedCount > 0 && (
        <Link to="/notes/archive" className={`${tile} text-subtle hover:bg-black/[0.03]`}>
          <ArchiveIcon className="h-5 w-5" />
          <div className="min-w-0">
            <div className="text-[14px] font-medium">Archive</div>
            <div className="text-xs tabular-nums">{archivedCount}</div>
          </div>
        </Link>
      )}
    </div>
  )
}

// --- Masonry -----------------------------------------------------------------

function useColumnCount(): number {
  const query = '(min-width: 768px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide ? 3 : 2
}

/** Rough card height so columns balance without measuring the DOM. */
function estimateHeight(n: NoteDoc): number {
  let lines = 0
  for (const l of (n.body ?? '').split('\n').slice(0, 14)) lines += Math.max(1, Math.ceil(l.length / 26))
  return 40 + (n.title ? 26 : 0) + Math.min(lines, 12) * 22
}

/**
 * Fills columns left to right, each note into the currently shortest column,
 * so the newest notes run across the top row. (CSS columns fill top to bottom,
 * which put the newest notes down the left edge.)
 */
function Masonry({
  notes,
  onOpen,
  onTick,
  folderLabel,
}: {
  notes: NoteDoc[]
  onOpen: (n: NoteDoc) => void
  onTick: (n: NoteDoc, line: number) => void
  folderLabel?: (n: NoteDoc) => string | undefined
}) {
  const count = useColumnCount()
  const columns = useMemo(() => {
    const cols: NoteDoc[][] = Array.from({ length: count }, () => [])
    const heights = new Array<number>(count).fill(0)
    for (const n of notes) {
      const i = heights.indexOf(Math.min(...heights))
      cols[i].push(n)
      heights[i] += estimateHeight(n)
    }
    return cols
  }, [notes, count])

  if (notes.length === 0) return null
  return (
    <div className="flex items-start gap-3 pb-3">
      {columns.map((col, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
          {col.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onOpen={() => onOpen(note)}
              onTick={(line) => onTick(note, line)}
              folder={folderLabel?.(note)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function NoteCard({
  note,
  onOpen,
  onTick,
  folder,
}: {
  note: NoteDoc
  onOpen: () => void
  onTick: (line: number) => void
  folder?: string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [note.body])

  return (
    // A div, not a <button>: the card holds its own buttons (checkboxes) and links.
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
      style={{ backgroundColor: note.color }}
      className="block w-full cursor-pointer rounded-2xl border border-black/[0.04] p-4 text-left shadow-card outline-none transition-transform duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent"
    >
      {(note.title || note.pinned) && (
        <div className="mb-1 flex items-start justify-between gap-2">
          {note.title && <h3 className="min-w-0 break-words text-[15px] font-semibold leading-snug text-ink">{note.title}</h3>}
          {note.pinned && <PinIcon className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-subtle" />}
        </div>
      )}
      {note.body && (
        <div
          ref={bodyRef}
          className="max-h-[17rem] overflow-hidden"
          style={
            clipped
              ? {
                  maskImage: 'linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent)',
                  WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent)',
                }
              : undefined
          }
        >
          <NoteBody body={note.body} compact maxLines={40} onToggle={onTick} />
        </div>
      )}
      {folder && (
        <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-subtle">
          <FolderIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">{folder}</span>
        </div>
      )}
    </motion.div>
  )
}

function Snackbar({ snack, onDismiss }: { snack: Snack | null; onDismiss: () => void }) {
  return (
    // Sits above the + button on phones; above the editor (z-50) everywhere.
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-5 bottom-[calc(10rem+env(safe-area-inset-bottom))] md:bottom-8">
      <AnimatePresence>
        {snack && (
          <motion.div
            key={snack.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="pointer-events-auto flex max-w-full items-center gap-4 rounded-2xl bg-ink py-3 pl-4 pr-2 text-sm text-white shadow-float"
          >
            <span className="truncate">{snack.text}</span>
            {snack.undo ? (
              <button
                type="button"
                onClick={() => {
                  snack.undo?.()
                  onDismiss()
                }}
                className="press rounded-lg px-2.5 py-1 font-semibold text-[#64D2FF] hover:bg-white/10"
              >
                Undo
              </button>
            ) : (
              <span className="w-1" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
