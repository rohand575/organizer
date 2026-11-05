import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../../auth/AuthProvider'
import { IconButton } from '../../components/IconButton'
import {
  ArchiveIcon,
  ChecklistIcon,
  ChevronIcon,
  FolderIcon,
  ListIcon,
  MicIcon,
  PinIcon,
  ShareIcon,
  TrashIcon,
  UnarchiveIcon,
  XIcon,
} from '../../components/icons'
import { hasVoiceKeys, transcribe } from '../../lib/stt'
import { polishDictation } from '../../lib/intent'
import { useHoldToTalk } from '../../lib/useHoldToTalk'
import { useVisualViewport } from '../../lib/useVisualViewport'
import { NameDialog } from './Dialogs'
import { NoteBody, continueList, sourceOffsetAt, toggleCheck, toggleLines } from './noteFormat'
import {
  NOTE_COLORS,
  clearDraft,
  createFolder,
  fieldsOf,
  isBlank,
  relativeTime,
  sameFields,
  saveNote,
  toMillis,
  writeDraft,
  type FolderDoc,
  type NoteDoc,
  type NoteFields,
  type NoteSnapshot,
} from './notes'

const NEW_FOLDER = '__new__'

export function NoteEditor({
  noteId,
  note,
  folders,
  defaultFolderId,
  onClose,
  onRemove,
  onArchived,
  notify,
}: {
  noteId: string
  /** null when creating a new note. */
  note: NoteDoc | null
  folders: FolderDoc[]
  /** Folder a new note starts in (the folder being viewed). */
  defaultFolderId: string | null
  onClose: () => void
  /** Delete with an undo snackbar. */
  onRemove: (snap: NoteSnapshot, label: string) => void
  onArchived: (snap: NoteSnapshot) => void
  notify: (text: string) => void
}) {
  const { user } = useAuth()
  const uid = user?.uid ?? ''
  const [initial] = useState<NoteFields>(() =>
    note
      ? fieldsOf(note)
      : { title: '', body: '', color: '#FFFFFF', pinned: false, folderId: defaultFolderId, archived: false },
  )
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [color, setColor] = useState(initial.color)
  const [pinned, setPinned] = useState(initial.pinned)
  const [folderId, setFolderId] = useState(initial.folderId)
  const [naming, setNaming] = useState(false)
  // Existing notes open formatted (tickable boxes, live links); tap to edit.
  const [mode, setMode] = useState<'view' | 'edit'>(note && initial.body.trim() ? 'view' : 'edit')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dictation, setDictation] = useState<'idle' | 'working' | 'error'>('idle')
  const vv = useVisualViewport()

  // What's on the server (null = never saved). Compared against on close so an
  // untouched note isn't rewritten — that used to bump it to the top.
  const persisted = useRef<NoteFields | null>(note ? initial : null)
  const latest = useRef<NoteFields>(initial)
  latest.current = { title, body, color, pinned, folderId, archived: initial.archived }
  // Set once the note is saved/deleted/archived on close. The sheet stays
  // mounted through its exit animation; nothing may autosave after this.
  const closed = useRef(false)

  const snapshot = (fields: NoteFields): NoteSnapshot => ({
    id: noteId,
    fields,
    updatedAt: note?.updatedAt,
    createdAt: note?.createdAt,
  })

  // Autosave a local draft while typing so a crash or iOS killing the PWA
  // can't lose it (replayed on next launch — see replayNoteOutbox).
  useEffect(() => {
    if (!uid) return
    const t = setTimeout(() => {
      if (closed.current) return
      const f = latest.current
      const base = persisted.current
      if (base ? sameFields(f, base) : isBlank(f)) clearDraft(uid)
      else writeDraft(uid, { id: noteId, isNew: !base, fields: f, at: Date.now() })
    }, 500)
    return () => clearTimeout(t)
  }, [uid, noteId, title, body, color, pinned, folderId])

  // Save for real when the app is backgrounded — often the last chance on iOS.
  useEffect(() => {
    if (!uid) return
    const flush = () => {
      const f = latest.current
      const base = persisted.current
      if (closed.current || isBlank(f) || (base && sameFields(f, base))) return
      saveNote(uid, noteId, f, { isNew: !base })
      persisted.current = f
    }
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [uid, noteId])

  const finish = (patch: Partial<NoteFields> = {}) => {
    if (closed.current) return
    closed.current = true
    const f = { ...latest.current, ...patch }
    const base = persisted.current
    if (uid) clearDraft(uid)
    if (isBlank(f)) {
      // Clearing a saved note deletes it (with undo); a blank new one is dropped.
      if (base) onRemove(snapshot(base), 'Empty note deleted')
    } else if (!base || !sameFields(f, base)) {
      saveNote(uid, noteId, f, { isNew: !base })
    }
    onClose()
  }

  const remove = () => {
    if (closed.current) return
    closed.current = true
    if (uid) clearDraft(uid)
    const f = latest.current
    onRemove(snapshot(isBlank(f) ? persisted.current ?? f : f), 'Note deleted')
    onClose()
  }

  const toggleArchive = () => {
    const f = { ...latest.current, archived: !initial.archived }
    if (isBlank(f)) return finish()
    if (closed.current) return
    closed.current = true
    if (uid) clearDraft(uid)
    saveNote(uid, noteId, f, { isNew: !persisted.current })
    onArchived(snapshot(f))
    onClose()
  }

  const share = async () => {
    const text = [title.trim(), body.trim()].filter(Boolean).join('\n\n')
    if (!text) return
    if (navigator.share) {
      try {
        await navigator.share({ title: title.trim() || undefined, text })
        return
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        // Share unavailable for this content — fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      notify('Copied to clipboard')
    } catch {
      notify('Couldn’t copy this note')
    }
  }

  // Escape closes (and saves) on desktop.
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !naming) finishRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [naming])

  // Grow the textarea with its content; the sheet scrolls instead of the field,
  // so switching between view and edit doesn't change the sheet's height.
  useLayoutEffect(() => {
    const ta = bodyRef.current
    const sc = scrollRef.current
    if (!ta) return
    const top = sc?.scrollTop ?? 0
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
    if (sc) sc.scrollTop = top
  }, [body, mode])

  // Switch to the textarea synchronously, inside the tap, so iOS will open the
  // keyboard for the programmatic focus.
  const enterEdit = (caret: number) => {
    flushSync(() => setMode('edit'))
    const ta = bodyRef.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(caret, caret)
  }

  const onViewTap = (e: React.MouseEvent) => {
    const target = e.target as Element
    if (target.closest('a,button') || !viewRef.current) return
    enterEdit(sourceOffsetAt(e.clientX, e.clientY, target, viewRef.current, body.length))
  }

  // A tap on the empty space below the text should still start typing.
  const onScrollAreaTap = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    if (mode === 'view') enterEdit(body.length)
    else bodyRef.current?.focus()
  }

  // A textarea keeps its selection after blur, so this works even if the
  // title had focus.
  const applyToggle = (kind: 'check' | 'bullet') => {
    const ta = bodyRef.current
    const r = toggleLines(body, ta?.selectionStart ?? body.length, ta?.selectionEnd ?? body.length, kind)
    setBody(r.body)
    ta?.focus()
    requestAnimationFrame(() => ta?.setSelectionRange(r.selStart, r.selEnd))
  }

  const done = () => {
    bodyRef.current?.blur()
    if (body.trim()) setMode('view')
  }

  // Dictation goes in at the caret while editing; in view mode it's appended
  // as a new paragraph.
  const insertText = (text: string) => {
    const ta = mode === 'edit' ? bodyRef.current : null
    setBody((prev) => {
      if (!ta) return prev.trim() ? `${prev.replace(/\s+$/, '')}\n${text}` : text
      const start = ta.selectionStart ?? prev.length
      const end = ta.selectionEnd ?? prev.length
      const before = prev.slice(0, start)
      const after = prev.slice(end)
      const lead = before && !/\s$/.test(before) ? ' ' : ''
      const insert = lead + text
      requestAnimationFrame(() => {
        const pos = (before + insert).length
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
      return before + insert + after
    })
  }

  const { recording, bind } = useHoldToTalk({
    disabled: dictation === 'working',
    onResult: async (blob) => {
      setDictation('working')
      try {
        const raw = await transcribe(blob)
        if (raw) {
          const clean = await polishDictation(raw)
          insertText(clean)
        }
        setDictation('idle')
      } catch {
        setDictation('error')
        setTimeout(() => setDictation('idle'), 2500)
      }
    },
    onMicBlocked: () => {
      setDictation('error')
      setTimeout(() => setDictation('idle'), 2500)
    },
  })

  const folderName = folders.find((f) => f.id === folderId)?.name ?? 'Notes'
  const editedMs = note ? toMillis(note.updatedAt) : null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => finish()}
      style={{ top: vv.offsetTop, height: vv.height }}
      className="fixed left-0 right-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center"
    >
      <motion.div
        initial={{ y: 40, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: color, maxHeight: vv.height }}
        className="safe-bottom flex h-full w-full max-w-lg flex-col rounded-t-3xl shadow-float sm:h-auto sm:max-h-[85vh] sm:rounded-3xl"
      >
        {/* Header: folder + actions */}
        <div className="flex items-center gap-1 px-4 pt-4">
          <label className="press relative flex min-w-0 max-w-[50%] cursor-pointer items-center gap-1.5 rounded-full bg-black/[0.05] py-1.5 pl-2.5 pr-2 text-[13px] font-medium text-ink/70">
            <FolderIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{folderName}</span>
            <ChevronIcon className="h-3.5 w-3.5 shrink-0 rotate-90" />
            <select
              aria-label="Folder"
              value={folderId ?? ''}
              onChange={(e) => {
                const v = e.target.value
                if (v === NEW_FOLDER) setNaming(true)
                else setFolderId(v || null)
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              <option value="">Notes</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              <option value={NEW_FOLDER}>New folder…</option>
            </select>
          </label>
          <div className="flex-1" />
          <IconButton onClick={() => setPinned((p) => !p)} aria-label={pinned ? 'Unpin' : 'Pin'} aria-pressed={pinned}>
            <PinIcon className={`h-5 w-5 ${pinned ? 'text-accent' : ''}`} />
          </IconButton>
          <IconButton onClick={toggleArchive} aria-label={initial.archived ? 'Unarchive' : 'Archive'}>
            {initial.archived ? <UnarchiveIcon className="h-5 w-5" /> : <ArchiveIcon className="h-5 w-5" />}
          </IconButton>
          <IconButton onClick={share} aria-label="Share">
            <ShareIcon className="h-5 w-5" />
          </IconButton>
          <IconButton onClick={() => finish()} aria-label="Close">
            <XIcon className="h-5 w-5" />
          </IconButton>
        </div>

        <div
          ref={scrollRef}
          onClick={onScrollAreaTap}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-2 pt-2"
        >
          <input
            autoFocus={!note}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (mode === 'view') enterEdit(body.length)
              else bodyRef.current?.focus()
            }}
            placeholder="Title"
            className="w-full shrink-0 bg-transparent pb-2 text-xl font-semibold outline-none placeholder:text-ink/30"
          />
          {mode === 'view' ? (
            <div ref={viewRef} onClick={onViewTap} className="min-h-[8rem] cursor-text">
              <NoteBody body={body} onToggle={(i) => setBody((b) => toggleCheck(b, i))} />
            </div>
          ) : (
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => {
                const next = e.target.value
                const c = continueList(body, next, e.target.selectionStart)
                if (!c) return setBody(next)
                setBody(c.body)
                requestAnimationFrame(() => bodyRef.current?.setSelectionRange(c.selStart, c.selEnd))
              }}
              placeholder="Take a note…"
              rows={6}
              className="min-h-[8rem] w-full shrink-0 resize-none overflow-hidden bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-ink/30"
            />
          )}
          {note && (
            <div className="pointer-events-none mt-auto pt-3 text-right text-xs text-ink/40">
              Edited {relativeTime(editedMs)}
            </div>
          )}
        </div>

        {/* List tools while typing */}
        {mode === 'edit' && (
          <div className="flex items-center gap-1 px-3">
            <ToolButton label="Checklist" onClick={() => applyToggle('check')}>
              <ChecklistIcon className="h-5 w-5" />
            </ToolButton>
            <ToolButton label="Bulleted list" onClick={() => applyToggle('bullet')}>
              <ListIcon className="h-5 w-5" />
            </ToolButton>
            <div className="flex-1" />
            {note && body.trim() && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={done}
                className="press rounded-full px-3 py-1.5 text-sm font-semibold text-accent hover:bg-black/5"
              >
                Done
              </button>
            )}
          </div>
        )}

        {/* Color palette + dictation + delete */}
        <div className="flex items-center gap-2 px-5 pb-5 pt-2">
          <div className="flex flex-1 flex-wrap gap-2">
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                style={{ backgroundColor: c }}
                className={`h-7 w-7 rounded-full border transition-transform ${
                  color === c ? 'scale-110 border-accent' : 'border-black/10'
                }`}
              />
            ))}
          </div>
          {hasVoiceKeys && (
            <button
              aria-label="Hold to dictate"
              disabled={dictation === 'working'}
              draggable={false}
              style={{
                touchAction: 'none',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              }}
              {...bind}
              className={`press relative grid h-9 w-9 shrink-0 select-none place-items-center rounded-full transition-colors ${
                recording ? 'bg-[#FF375F] text-white' : 'text-subtle hover:text-accent'
              }`}
            >
              {dictation === 'working' ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-hair border-t-accent" />
              ) : (
                <MicIcon className="h-5 w-5" />
              )}
              {recording && <span className="absolute inset-0 animate-ping rounded-full bg-[#FF375F]/25" />}
            </button>
          )}
          {note && (
            <IconButton onClick={remove} aria-label="Delete note">
              <TrashIcon className="h-5 w-5" />
            </IconButton>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {naming && (
          <NameDialog
            title="New folder"
            confirmLabel="Create"
            onSubmit={(name) => uid && setFolderId(createFolder(uid, name))}
            onClose={() => setNaming(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** Toolbar button that doesn't steal focus (keeps the caret and keyboard). */
function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="press grid h-9 w-9 place-items-center rounded-full text-subtle hover:bg-black/5 active:bg-black/10"
    >
      {children}
    </button>
  )
}
