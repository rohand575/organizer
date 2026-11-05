/**
 * Notes data layer: note/folder types, durable writes, and folder operations.
 *
 * On iOS we run Firestore with a memory-only cache (see lib/firebase.ts), so a
 * write made offline lives only in memory — if the PWA is killed before it
 * reconnects, the edit is gone. Notes are long-form and often dictated, so every
 * note write is also recorded in a small localStorage outbox and cleared once
 * the server acknowledges it. Anything still in the outbox on the next launch is
 * replayed. New notes get their id up front (newNoteId) so a replay is an
 * idempotent setDoc, never a duplicate.
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { Doc } from '../../lib/useCollection'

export interface NoteDoc extends Doc {
  title: string
  body: string
  color: string
  pinned: boolean
  folderId?: string | null
  archived?: boolean
  updatedAt?: unknown
  createdAt?: unknown
}

export interface FolderDoc extends Doc {
  name: string
  createdAt?: unknown
}

/** The user-editable part of a note. */
export interface NoteFields {
  title: string
  body: string
  color: string
  pinned: boolean
  folderId: string | null
  archived: boolean
}

/** Everything needed to put a deleted note back exactly where it was. */
export interface NoteSnapshot {
  id: string
  fields: NoteFields
  updatedAt?: unknown
  createdAt?: unknown
}

export const NOTE_COLORS = ['#FFFFFF', '#FEF3C7', '#DCFCE7', '#DBEAFE', '#FCE7F3', '#EDE9FE', '#FFEDD5']

export function fieldsOf(n: NoteDoc): NoteFields {
  return {
    title: n.title ?? '',
    body: n.body ?? '',
    color: n.color ?? '#FFFFFF',
    pinned: Boolean(n.pinned),
    folderId: n.folderId ?? null,
    archived: Boolean(n.archived),
  }
}

export function sameFields(a: NoteFields, b: NoteFields): boolean {
  return (
    a.title === b.title &&
    a.body === b.body &&
    a.color === b.color &&
    a.pinned === b.pinned &&
    a.folderId === b.folderId &&
    a.archived === b.archived
  )
}

export function isBlank(f: Pick<NoteFields, 'title' | 'body'>): boolean {
  return !f.title.trim() && !f.body.trim()
}

// --- Timestamps --------------------------------------------------------------
// Docs seeded from the localStorage mirror carry timestamps as plain
// { seconds, nanoseconds } objects, and a pending serverTimestamp() reads back
// as null, so accept all three shapes.

export function toMillis(v: unknown): number | null {
  if (v && typeof (v as Timestamp).toMillis === 'function') return (v as Timestamp).toMillis()
  const o = v as { seconds?: unknown; nanoseconds?: unknown } | null
  if (o && typeof o.seconds === 'number')
    return o.seconds * 1000 + (typeof o.nanoseconds === 'number' ? o.nanoseconds / 1e6 : 0)
  return null
}

function toTimestamp(v: unknown) {
  const ms = toMillis(v)
  return ms == null ? serverTimestamp() : Timestamp.fromMillis(ms)
}

export function relativeTime(ms: number | null, now = Date.now()): string {
  if (ms == null) return 'just now'
  const s = Math.max(0, (now - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 2 * 86400) return 'yesterday'
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

// --- Outbox ------------------------------------------------------------------

type OutboxEntry =
  | {
      op: 'save'
      fields: NoteFields
      /** Bump updatedAt (moves the note to the top). False for checkbox ticks. */
      touch: boolean
      /** The doc may not exist on the server yet, so replaying should create it. */
      isNew: boolean
      /** Explicit timestamps when restoring a deleted note. */
      stamps?: { updatedAt?: unknown; createdAt?: unknown }
      at: number
    }
  | { op: 'delete'; at: number }

type Outbox = Record<string, OutboxEntry>

const outboxKey = (uid: string) => `organizer_note_outbox:${uid}`
const draftKey = (uid: string) => `organizer_note_draft:${uid}`

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full/unavailable — the Firestore write still goes through.
  }
}

function putEntry(uid: string, id: string, entry: OutboxEntry): void {
  const box = readJSON<Outbox>(outboxKey(uid)) ?? {}
  box[id] = entry
  writeJSON(outboxKey(uid), box)
}

/** Drop the entry once acknowledged — unless a newer write has replaced it. */
function ackEntry(uid: string, id: string, at: number): void {
  const box = readJSON<Outbox>(outboxKey(uid))
  if (!box || box[id]?.at !== at) return
  delete box[id]
  writeJSON(outboxKey(uid), Object.keys(box).length ? box : null)
}

function noteRef(uid: string, id: string) {
  return doc(db!, 'users', uid, 'notes', id)
}

function send(uid: string, id: string, entry: OutboxEntry): void {
  let p: Promise<void>
  if (entry.op === 'delete') {
    p = deleteDoc(noteRef(uid, id))
  } else {
    const data: DocumentData = { ...entry.fields }
    if (entry.stamps) {
      data.updatedAt = toTimestamp(entry.stamps.updatedAt)
      data.createdAt = toTimestamp(entry.stamps.createdAt)
    } else {
      if (entry.touch) data.updatedAt = serverTimestamp()
      if (entry.isNew) data.createdAt = serverTimestamp()
    }
    p = setDoc(noteRef(uid, id), data, { merge: true })
  }
  // Offline, the promise only settles on reconnect; the outbox covers the gap.
  p.then(() => ackEntry(uid, id, entry.at)).catch(() => {})
}

/** A fresh doc id, so creating a note is an idempotent setDoc. */
export function newNoteId(uid: string): string {
  return doc(collection(db!, 'users', uid, 'notes')).id
}

/** Fire-and-forget: applies locally at once and never blocks the UI on the network. */
export function saveNote(
  uid: string,
  id: string,
  fields: NoteFields,
  opts: { touch?: boolean; isNew?: boolean } = {},
): void {
  const entry: OutboxEntry = {
    op: 'save',
    fields,
    touch: opts.touch ?? true,
    isNew: opts.isNew ?? false,
    at: Date.now(),
  }
  putEntry(uid, id, entry)
  send(uid, id, entry)
}

export function deleteNote(uid: string, id: string): void {
  const entry: OutboxEntry = { op: 'delete', at: Date.now() }
  putEntry(uid, id, entry)
  send(uid, id, entry)
}

/** Undo a delete: re-create the note with its original id and timestamps. */
export function restoreNote(uid: string, snap: NoteSnapshot): void {
  const entry: OutboxEntry = {
    op: 'save',
    fields: snap.fields,
    touch: false,
    isNew: true,
    stamps: { updatedAt: snap.updatedAt, createdAt: snap.createdAt },
    at: Date.now(),
  }
  putEntry(uid, snap.id, entry)
  send(uid, snap.id, entry)
}

// --- Editor draft ------------------------------------------------------------
// The open editor autosaves here as you type. Normally it's cleared on close; if
// it's still present at launch, the app died mid-edit and the draft is saved.

export interface NoteDraft {
  id: string
  isNew: boolean
  fields: NoteFields
  at: number
}

export function writeDraft(uid: string, draft: NoteDraft): void {
  writeJSON(draftKey(uid), draft)
}

export function clearDraft(uid: string): void {
  writeJSON(draftKey(uid), null)
}

// --- Replay ------------------------------------------------------------------

/**
 * Resolve with the server's notes once a snapshot comes from the server (not
 * the cache), or null if that doesn't happen in time. Waiting for this matters
 * on iOS: writing into an empty memory cache before it has synced would emit a
 * partial snapshot (just the replayed note) and clobber the offline mirror.
 */
function serverNotes(uid: string, ms = 20_000): Promise<Map<string, DocumentData> | null> {
  return new Promise((resolve) => {
    let unsub = () => {}
    const finish = (v: Map<string, DocumentData> | null) => {
      clearTimeout(timer)
      unsub()
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), ms)
    unsub = onSnapshot(
      collection(db!, 'users', uid, 'notes'),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.metadata.fromCache) finish(new Map(snap.docs.map((d) => [d.id, d.data()])))
      },
      () => finish(null),
    )
  })
}

let replaying = false

/**
 * Re-send note writes that were never acknowledged (e.g. made offline on iOS
 * before the app was killed). With `promoteDraft`, also save an editor draft
 * left behind by a crash. A write is skipped when the server copy is newer —
 * either it already landed, or the note was edited elsewhere since.
 */
export async function replayNoteOutbox(uid: string, opts: { promoteDraft?: boolean } = {}) {
  if (!db || replaying) return
  const box = readJSON<Outbox>(outboxKey(uid)) ?? {}
  const draft = opts.promoteDraft ? readJSON<NoteDraft>(draftKey(uid)) : null
  if (!Object.keys(box).length && !draft) return

  replaying = true
  try {
    const server = await serverNotes(uid)
    if (!server) return // still offline — try again on the next 'online' event
    const serverMs = (noteId: string) => toMillis(server.get(noteId)?.updatedAt)

    for (const [noteId, entry] of Object.entries(box)) {
      const exists = server.has(noteId)
      const newer = (serverMs(noteId) ?? 0) > entry.at
      const stale =
        entry.op === 'delete' ? !exists || newer : exists ? newer : !entry.isNew // deleted elsewhere
      if (stale) ackEntry(uid, noteId, entry.at)
      else send(uid, noteId, entry)
    }

    if (draft) {
      // Only clear it if the user hasn't opened the editor again meanwhile.
      const current = readJSON<NoteDraft>(draftKey(uid))
      if (current?.at === draft.at) clearDraft(uid)
      const exists = server.has(draft.id)
      const newer = (serverMs(draft.id) ?? 0) > draft.at
      const unchanged =
        exists && sameFields(draft.fields, fieldsOf({ id: draft.id, ...server.get(draft.id) } as NoteDoc))
      const keep = !isBlank(draft.fields) && !newer && !unchanged && (exists || draft.isNew)
      if (keep) saveNote(uid, draft.id, draft.fields, { isNew: !exists })
    }
  } finally {
    replaying = false
  }
}

// --- Folders -----------------------------------------------------------------

export function createFolder(uid: string, name: string): string {
  const ref = doc(collection(db!, 'users', uid, 'noteFolders'))
  setDoc(ref, { name, createdAt: serverTimestamp() }).catch(() => {})
  return ref.id
}

export function renameFolder(uid: string, folderId: string, name: string): void {
  updateDoc(doc(db!, 'users', uid, 'noteFolders', folderId), { name }).catch(() => {})
}

/** Delete a folder, moving its notes (archived ones too) back out to Notes. */
export function deleteFolder(uid: string, folderId: string, noteIds: string[]): void {
  const batch = writeBatch(db!)
  for (const noteId of noteIds) batch.update(noteRef(uid, noteId), { folderId: null })
  batch.delete(doc(db!, 'users', uid, 'noteFolders', folderId))
  batch.commit().catch(() => {})
}
