/**
 * Executes interpreted voice actions against Firestore, matching the exact
 * document shapes the pages use (order, colors, defaults). Writes go straight
 * through the SDK using the signed-in user's uid.
 */
import { addDoc, collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { Action } from './intent'
import { createEvent, isCalendarConnected } from './calendar'

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

async function addTodos(uid: string, tasks: NewTask[]) {
  const col = collection(db!, 'users', uid, 'todos')
  // Time-based order (negative → newest on top) avoids a blocking read of the
  // whole collection, which can hang on flaky connections.
  const base = Date.now()
  let i = 0
  for (const task of tasks) {
    const color = randomTaskColor()
    let calendarEventId: string | null = null
    if (task.remindAt && isCalendarConnected()) {
      try {
        calendarEventId = await createEvent({
          summary: task.text,
          startISO: task.remindAt,
          durationMin: REMINDER_DURATION_MIN,
          timeZone: TZ,
          colorId: calendarColorId(color),
        })
      } catch {
        // Non-fatal: the task is still saved without a calendar event.
      }
    }
    await committed(
      addDoc(col, {
        text: task.text,
        done: false,
        order: i - base, // earlier tasks sort above later ones, all above existing
        color,
        remindAt: task.remindAt ?? null,
        calendarEventId,
        createdAt: serverTimestamp(),
      }),
    )
    i += 1
  }
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
  const parts: string[] = []
  const newTasks: NewTask[] = []

  for (const action of actions) {
    if (action.type === 'add_todo') {
      newTasks.push({ text: action.text, remindAt: action.remindAt })
    } else if (action.type === 'add_list_items') {
      let list = matchList(lists, action.list)
      if (!list) {
        list = await createList(uid, action.list)
        lists.push(list)
      }
      await addListItems(uid, list.id, action.items)
      parts.push(
        `${action.items.length} item${action.items.length > 1 ? 's' : ''} to ${list.title}`,
      )
    } else if (action.type === 'add_note') {
      await addNote(uid, action.title, action.body)
      parts.push(`note${action.title ? ` “${action.title}”` : ''}`)
    }
  }

  if (newTasks.length) {
    await addTodos(uid, newTasks)
    const withReminder = newTasks.filter((t) => t.remindAt).length
    let label = `${newTasks.length} task${newTasks.length > 1 ? 's' : ''}`
    if (withReminder) label += isCalendarConnected() ? ' + calendar' : ' (reminder)'
    parts.unshift(label)
  }

  if (parts.length === 0) {
    const unknown = actions.find((a) => a.type === 'unknown') as
      | { type: 'unknown'; reason?: string }
      | undefined
    return { summary: unknown?.reason || "Didn't catch an action.", ok: false }
  }

  return { summary: `Added ${parts.join(' · ')}`, ok: true }
}
