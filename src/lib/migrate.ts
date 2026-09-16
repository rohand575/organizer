/**
 * One-time data migrations that run client-side on sign-in. Each migration is
 * idempotent and guarded by a per-user localStorage flag so it runs at most
 * once per device, and is safe to re-run (it never deletes source data).
 */
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from './firebase'

/**
 * The tasks collection was originally named `todos`. Copy any existing docs from
 * `users/{uid}/todos` into `users/{uid}/tasks`, preserving document ids so
 * ordering, reminders, and calendar links carry over. The old `todos` docs are
 * left untouched — nothing is destroyed if this fails partway.
 */
export async function migrateTodosToTasks(uid: string): Promise<void> {
  if (!db) return
  const flag = `tasks_migrated_${uid}`
  try {
    if (localStorage.getItem(flag) === '1') return
  } catch {
    return // no storage (private mode) — skip rather than risk repeated copies
  }

  try {
    const oldSnap = await getDocs(collection(db, 'users', uid, 'todos'))
    if (!oldSnap.empty) {
      await Promise.all(
        oldSnap.docs.map((d) =>
          // merge so re-running never clobbers edits already made under `tasks`.
          setDoc(doc(db!, 'users', uid, 'tasks', d.id), d.data(), { merge: true }),
        ),
      )
    }
    localStorage.setItem(flag, '1')
  } catch {
    // Leave the flag unset so the migration retries on the next load.
  }
}
