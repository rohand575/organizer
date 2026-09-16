/**
 * Executes interpreted voice actions against Firestore, matching the exact
 * document shapes the pages use (order, colors, defaults). Writes go straight
 * through the SDK using the signed-in user's uid.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from './firebase'
import type { Action } from './intent'
import { createEvent, deleteEvent, isCalendarConnected, updateEvent } from './calendar'

const LIST_COLORS = ['#0A84FF', '#34C759', '#FF9500', '#FF375F', '#AF52DE', '#5AC8FA']

/** Vivid task colors, assigned at random so each task stands out differently. */
export const TASK_COLORS = ['#FF375F', '#0A84FF', '#34C759', '#FF9500', '#AF52DE', '#5AC8FA', '#FF9F0A', '#BF5AF2']

export function randomTaskColor(): string {
  return TASK_COLORS[Math.floor(Math.random() * TASK_COLORS.length)]
}

/** 45-minute default duration for reminder-backed calendar events. */
export const REMINDER_DURATION_MIN = 45

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

// Map each task hex color to the closest Google Calendar colorId (1..11) so the
// calendar event visually matches the task's dot. Since task colors are random,
// the events end up nicely varied (red, blue, green, orange, purple…).
const CALENDAR_COLOR_BY_HEX: Record<string, string> = {
  '#FF375F': '11', // Tomato (red)
  '#0A84FF': '7', // Peacock (blue)
  '#34C759': '2', // Sage (green)
  '#FF9500': '6', // Tangerine (orange)
  '#AF52DE': '3', // Grape (purple)
  '#5AC8FA': '7', // Peacock (light blue)
  '#FF9F0A': '5', // Banana (amber)
  '#BF5AF2': '3', // Grape (purple)
}

/** Google Calendar colorId for a task's hex color, if known. */
export function calendarColorId(hex?: string): string | undefined {
  return hex ? CALENDAR_COLOR_BY_HEX[hex] : undefined
}

export interface NewTask {
  text: string
  remindAt?: string
}

export interface ListRef {
  id: string
  title: string
}

/**
 * Resolve when a Firestore write is applied locally, without blocking on the
 * server acknowledgement — that ack can stall on flaky connections while the
 * write is already safe in the offline cache and will sync later.
 */
function committed(p: Promise<unknown>, ms = 4000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve()
    p.then(done, done)
    setTimeout(done, ms)
  })
}

/**
 * Read the user's list titles (for intent context + local matching). Bounded by
 * an 8s timeout — on some mobile browsers a Firestore read can stall, and this
 * must never block the voice pipeline. Falls back to an empty list.
 */
export async function loadLists(uid: string): Promise<ListRef[]> {
  if (!db) return []
  try {
    const snap = await Promise.race([
      getDocs(collection(db, 'users', uid, 'lists')),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ])
    if (!snap) return []
    return snap.docs.map((d) => ({ id: d.id, title: String((d.data() as { title?: unknown }).title ?? '') }))
  } catch {
    return []
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\blist\b/g, '').replace(/[^a-z0-9]/g, '').trim()

function matchList(lists: ListRef[], name: string): ListRef | undefined {
  const target = norm(name)
  if (!target) return undefined
  return (
    lists.find((l) => norm(l.title) === target) ??
    lists.find((l) => norm(l.title).includes(target) || target.includes(norm(l.title)))
  )
}

// Looser normalization for free-text items/tasks: keep word boundaries so
// spoken phrases match stored text on exact-or-contains.
const normText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Best fuzzy match of a spoken phrase against a set of text-bearing docs. */
function bestMatch<T extends { text: string }>(items: T[], spoken: string): T | undefined {
  const target = normText(spoken)
  if (!target) return undefined
  return (
    items.find((i) => normText(i.text) === target) ??
    items.find((i) => normText(i.text).includes(target) || target.includes(normText(i.text)))
  )
}

interface TaskRef {
  id: string
  text: string
  done: boolean
  color?: string
  calendarEventId: string | null
}

interface ItemRef {
  id: string
  text: string
  checked: boolean
}

/** Read current tasks for matching change requests. Bounded like loadLists. */
async function loadTasks(uid: string): Promise<TaskRef[]> {
  if (!db) return []
  try {
    const snap = await Promise.race([
      getDocs(collection(db, 'users', uid, 'tasks')),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ])
    if (!snap) return []
    return snap.docs.map((d) => {
      const data = d.data() as {
        text?: unknown
        done?: unknown
        color?: unknown
        calendarEventId?: unknown
      }
      return {
        id: d.id,
        text: String(data.text ?? ''),
        done: Boolean(data.done),
        color: typeof data.color === 'string' ? data.color : undefined,
        calendarEventId: typeof data.calendarEventId === 'string' ? data.calendarEventId : null,
      }
    })
  } catch {
    return []
  }
}

/** Read the items of one list, for check/remove matching. */
async function loadListItems(uid: string, listId: string): Promise<ItemRef[]> {
  if (!db) return []
  try {
    const snap = await Promise.race([
      getDocs(collection(db, 'users', uid, 'lists', listId, 'items')),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ])
    if (!snap) return []
    return snap.docs.map((d) => {
      const data = d.data() as { text?: unknown; checked?: unknown }
      return { id: d.id, text: String(data.text ?? ''), checked: Boolean(data.checked) }
    })
  } catch {
    return []
  }
}

async function completeTaskDoc(uid: string, t: TaskRef) {
  if (t.calendarEventId) deleteEvent(t.calendarEventId).catch(() => {})
  await committed(
    updateDoc(doc(db!, 'users', uid, 'tasks', t.id), { done: true, calendarEventId: null }),
  )
}

async function deleteTaskDoc(uid: string, t: TaskRef) {
  if (t.calendarEventId) deleteEvent(t.calendarEventId).catch(() => {})
  await committed(deleteDoc(doc(db!, 'users', uid, 'tasks', t.id)))
}

async function updateTaskDoc(
  uid: string,
  t: TaskRef,
  patch: { newText?: string; remindAt?: string | null },
) {
  const ref = doc(db!, 'users', uid, 'tasks', t.id)

  // Write the core change (text/time) first — never gated on the calendar call.
  const data: Record<string, unknown> = {}
  if (patch.newText) data.text = patch.newText
  if (patch.remindAt !== undefined) data.remindAt = patch.remindAt
  await committed(updateDoc(ref, data))

  // Sync the calendar in the background and patch the event id afterward.
  if (patch.remindAt === undefined || !isCalendarConnected()) return
  void (async () => {
    let calendarEventId = t.calendarEventId
    try {
      if (patch.remindAt) {
        const payload = {
          summary: patch.newText ?? t.text,
          startISO: patch.remindAt,
          durationMin: REMINDER_DURATION_MIN,
          timeZone: TZ,
          colorId: calendarColorId(t.color),
        }
        if (calendarEventId) {
          const ok = await updateEvent(calendarEventId, payload)
          if (!ok) calendarEventId = await createEvent(payload)
        } else {
          calendarEventId = await createEvent(payload)
        }
      } else if (calendarEventId) {
        await deleteEvent(calendarEventId)
        calendarEventId = null
      }
      if (calendarEventId !== t.calendarEventId) await updateDoc(ref, { calendarEventId })
    } catch {
      // Non-fatal — the task's text/time change already saved.
    }
  })()
}

async function setListItemsChecked(uid: string, listId: string, ids: string[], checked: boolean) {
  await committed(
    Promise.all(
      ids.map((id) => updateDoc(doc(db!, 'users', uid, 'lists', listId, 'items', id), { checked })),
    ),
  )
}

async function deleteListItemDocs(uid: string, listId: string, ids: string[]) {
  await committed(
    Promise.all(ids.map((id) => deleteDoc(doc(db!, 'users', uid, 'lists', listId, 'items', id)))),
  )
}

/**
 * Save tasks and return whether the write itself succeeded. The calendar event
 * is attached AFTER the task is written, never before.
 *
 * The previous version awaited a slow Google Calendar call before addDoc, all
 * inside committed()'s 4s cap. On iOS the cap would fire and report success while
 * the task write was still queued behind the calendar call — so "Added 1 task +
 * calendar" showed but nothing was ever written (worse if the PWA got suspended
 * mid-call). Now the task write is the only thing gating success; the calendar is
 * best-effort and patched in afterward.
 */
async function addTasks(uid: string, tasks: NewTask[]): Promise<boolean> {
  const col = collection(db!, 'users', uid, 'tasks')
  // Time-based order (negative → newest on top) avoids a blocking read of the
  // whole collection, which can hang on flaky connections.
  const base = Date.now()
  // Client-generated ids so we can patch each task with its calendar event later.
  const created = tasks.map((task, i) => ({
    ref: doc(col),
    task,
    color: randomTaskColor(),
    order: i - base, // earlier tasks sort above later ones, all above existing
  }))

  // Write the tasks first, concurrently. This applies to the local cache
  // immediately so they appear at once and the success we report is real.
  let ok = true
  await committed(
    Promise.all(
      created.map(({ ref, task, color, order }) =>
        setDoc(ref, {
          text: task.text,
          done: false,
          order,
          color,
          remindAt: task.remindAt ?? null,
          calendarEventId: null,
          createdAt: serverTimestamp(),
        }),
      ),
    ).catch(() => {
      ok = false
    }),
  )

  // Best-effort calendar sync, never awaited: attach the event id when Google
  // responds and patch the task. A failure here never affects the saved task.
  if (isCalendarConnected()) {
    for (const { ref, task, color } of created) {
      if (!task.remindAt) continue
      void createEvent({
        summary: task.text,
        startISO: task.remindAt,
        durationMin: REMINDER_DURATION_MIN,
        timeZone: TZ,
        colorId: calendarColorId(color),
      })
        .then((id) => (id ? updateDoc(ref, { calendarEventId: id }) : undefined))
        .catch(() => {
          /* keep the reminder without a calendar event */
        })
    }
  }

  return ok
}

let listColorSeed = Date.now()

async function createList(uid: string, title: string): Promise<ListRef> {
  const col = collection(db!, 'users', uid, 'lists')
  const color = LIST_COLORS[listColorSeed++ % LIST_COLORS.length]
  // Generate the id locally so we don't block on the server for the new list.
  const ref = doc(col)
  await committed(
    setDoc(ref, {
      title,
      color,
      order: -Date.now(), // newest on top, no collection read needed
      expanded: true,
      createdAt: serverTimestamp(),
    }),
  )
  return { id: ref.id, title }
}

async function addListItems(uid: string, listId: string, items: string[]) {
  const col = collection(db!, 'users', uid, 'lists', listId, 'items')
  // Positive, increasing order → items append at the bottom, no read required.
  const base = Date.now()
  await committed(
    Promise.all(
      items.map((text, i) => addDoc(col, { text, checked: false, order: base + i, createdAt: serverTimestamp() })),
    ),
  )
}

async function addNote(uid: string, title: string, body: string) {
  const col = collection(db!, 'users', uid, 'notes')
  await committed(
    addDoc(col, {
      title,
      body,
      color: '#FFFFFF',
      pinned: false,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
  )
}

export interface ExecResult {
  summary: string
  ok: boolean
}

/** Run all actions and return a short human summary for the toast. */
export async function executeActions(
  uid: string,
  actions: Action[],
  knownLists: ListRef[],
): Promise<ExecResult> {
  if (!db) return { summary: 'Not connected.', ok: false }

  const lists = [...knownLists]
  const done: string[] = [] // success phrases, each begins with a verb
  const missed: string[] = [] // targets we couldn't find
  const failed: string[] = [] // writes that actually errored
  const newTasks: NewTask[] = []

  // Current tasks are read once and only if a change (complete/delete/update) is
  // requested. Matched tasks are removed from the cache so two commands in the
  // same utterance don't both resolve to the same doc.
  let taskCache: TaskRef[] | null = null
  const takeTask = async (spoken: string, preferActive: boolean): Promise<TaskRef | undefined> => {
    taskCache ??= await loadTasks(uid)
    const pool = preferActive ? taskCache.filter((t) => !t.done) : taskCache
    const found = bestMatch(pool, spoken) ?? bestMatch(taskCache, spoken)
    if (found) taskCache = taskCache.filter((t) => t.id !== found.id)
    return found
  }

  for (const action of actions) {
    switch (action.type) {
      case 'add_task':
        newTasks.push({ text: action.text, remindAt: action.remindAt })
        break

      case 'complete_task': {
        const t = await takeTask(action.text, true)
        if (t) {
          await completeTaskDoc(uid, t)
          done.push(`completed “${t.text}”`)
        } else missed.push(`“${action.text}”`)
        break
      }

      case 'delete_task': {
        const t = await takeTask(action.text, false)
        if (t) {
          await deleteTaskDoc(uid, t)
          done.push(`deleted “${t.text}”`)
        } else missed.push(`“${action.text}”`)
        break
      }

      case 'update_task': {
        const t = await takeTask(action.text, false)
        if (t) {
          await updateTaskDoc(uid, t, { newText: action.newText, remindAt: action.remindAt })
          done.push(`updated “${action.newText ?? t.text}”`)
        } else missed.push(`“${action.text}”`)
        break
      }

      case 'add_list_items': {
        let list = matchList(lists, action.list)
        if (!list) {
          list = await createList(uid, action.list)
          lists.push(list)
        }
        await addListItems(uid, list.id, action.items)
        done.push(`added ${action.items.length} item${action.items.length > 1 ? 's' : ''} to ${list.title}`)
        break
      }

      case 'check_list_items':
      case 'delete_list_items': {
        const list = matchList(lists, action.list)
        if (!list) {
          missed.push(`${action.list} list`)
          break
        }
        const items = await loadListItems(uid, list.id)
        const ids = [
          ...new Set(
            action.items
              .map((name) => bestMatch(items, name)?.id)
              .filter((id): id is string => Boolean(id)),
          ),
        ]
        if (!ids.length) {
          missed.push(`those items in ${list.title}`)
          break
        }
        if (action.type === 'check_list_items') {
          await setListItemsChecked(uid, list.id, ids, true)
          done.push(`checked ${ids.length} in ${list.title}`)
        } else {
          await deleteListItemDocs(uid, list.id, ids)
          done.push(`removed ${ids.length} from ${list.title}`)
        }
        break
      }

      case 'add_note':
        await addNote(uid, action.title, action.body)
        done.push(`added note${action.title ? ` “${action.title}”` : ''}`)
        break
    }
  }

  if (newTasks.length) {
    const n = newTasks.length
    const saved = await addTasks(uid, newTasks)
    if (saved) {
      const withReminder = newTasks.filter((t) => t.remindAt).length
      let label = `added ${n} task${n > 1 ? 's' : ''}`
      if (withReminder) label += isCalendarConnected() ? ' + calendar' : ' (reminder)'
      done.unshift(label)
    } else {
      failed.unshift(`couldn't save ${n} task${n > 1 ? 's' : ''}`)
    }
  }

  if (done.length === 0) {
    if (failed.length) return { summary: capitalize(failed.join(' · ')), ok: false }
    if (missed.length) return { summary: `Couldn't find ${missed.join(', ')}`, ok: false }
    const unknown = actions.find((a) => a.type === 'unknown') as
      | { type: 'unknown'; reason?: string }
      | undefined
    return { summary: unknown?.reason || "Didn't catch an action.", ok: false }
  }

  let summary = done.join(' · ')
  if (missed.length) summary += ` · couldn't find ${missed.join(', ')}`
  if (failed.length) summary += ` · ${failed.join(' · ')}`
  return { summary: capitalize(summary), ok: failed.length === 0 }
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
