import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type QueryConstraint,
} from 'firebase/firestore'
import { db } from './firebase'
import { useAuth } from '../auth/AuthProvider'

export interface Doc {
  id: string
  [key: string]: unknown
}

interface Cached {
  docs: Doc[]
  loading: boolean
}

// --- Offline snapshot mirror -------------------------------------------------
// iOS uses a memory-only Firestore cache (see firebase.ts) that's empty on every
// cold start, so opening the app offline showed blank lists. We mirror each
// collection's latest snapshot into localStorage — synchronous and reliable on
// iOS, unlike IndexedDB — and seed the UI from it on launch. The data is tiny
// (tasks, lists, notes, and each list's items), and the live listener overwrites
// it as soon as Firestore reconnects.
const CACHE_PREFIX = 'organizer_cache:'

function cacheKey(uid: string, path: string): string {
  return `${CACHE_PREFIX}${uid}:${path}`
}

function readCache(uid: string, path: string): Doc[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(uid, path))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Doc[]) : null
  } catch {
    return null
  }
}

function writeCache(uid: string, path: string, docs: Doc[]): void {
  try {
    localStorage.setItem(cacheKey(uid, path), JSON.stringify(docs))
  } catch {
    // Storage full or unavailable (e.g. private mode) — offline seeding just
    // won't be there; never let it break the actual write.
  }
}

// An empty snapshot that came only from the local cache (not the server) is the
// signature of iOS's memory cache on a cold start. Ignore it so it can't wipe
// the docs we just seeded from localStorage before the network responds.
function isStaleEmpty(snap: { metadata: { fromCache: boolean }; empty: boolean }): boolean {
  return snap.metadata.fromCache && snap.empty
}

// The top-level collections that back the three tabs. We keep a single live
// listener open for each for the WHOLE session (see CollectionsProvider) instead
// of subscribing per-page. On iOS we use Firestore's memory-only cache, and a
// tab switch unmounts the page — which would detach that page's listener and let
// the memory cache evict its docs, so the next visit started empty and had to
// re-fetch over long-polling (which sometimes never delivered, leaving the tab
// blank until a full reload). Keeping the listeners always-on fixes that and
// makes tab switches instant. The map value is the canonical ordering per path.
const MANAGED: Record<string, QueryConstraint[]> = {
  tasks: [orderBy('order', 'asc')],
  lists: [orderBy('order', 'asc')],
  notes: [orderBy('updatedAt', 'desc')],
}

const CollectionsContext = createContext<Record<string, Cached>>({})

/**
 * Mounts once (above the router) and holds a persistent Firestore listener for
 * each managed collection so their data survives tab switches.
 */
export function CollectionsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, setState] = useState<Record<string, Cached>>(() =>
    Object.fromEntries(Object.keys(MANAGED).map((p) => [p, { docs: [], loading: true }])),
  )

  useEffect(() => {
    if (!user || !db) return
    const uid = user.uid

    // Seed instantly from the last-synced snapshot so data shows even on an
    // offline cold start, before any listener has had a chance to fire.
    setState((s) => {
      const next = { ...s }
      for (const path of Object.keys(MANAGED)) {
        const cached = readCache(uid, path)
        if (cached) next[path] = { docs: cached, loading: false }
      }
      return next
    })

    const unsubs = Object.entries(MANAGED).map(([path, constraints]) => {
      const colRef = collection(db!, 'users', uid, path)
      const q = query(colRef, ...constraints)
      return onSnapshot(
        q,
        (snap) => {
          if (isStaleEmpty(snap)) return
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Doc[]
          setState((s) => ({ ...s, [path]: { docs, loading: false } }))
          writeCache(uid, path, docs)
        },
        () => {
          // Listen failed — drop the spinner so the UI isn't stuck; Firestore
          // retries the stream on its own and a later snapshot will refresh it.
          setState((s) => ({ ...s, [path]: { ...s[path], loading: false } }))
        },
      )
    })
    return () => unsubs.forEach((u) => u())
  }, [user])

  return <CollectionsContext.Provider value={state}>{children}</CollectionsContext.Provider>
}

/**
 * Live-subscribes to a user-scoped subcollection: users/{uid}/{path}.
 * Returns the docs plus CRUD helpers.
 *
 * For the three managed top-level collections the data comes from the always-on
 * CollectionsProvider (no per-mount listener). For any other path — e.g. a
 * list's nested `items` — it falls back to a local listener scoped to this hook.
 */
export function useCollection<T extends Doc>(path: string, ...constraints: QueryConstraint[]) {
  const { user } = useAuth()
  const managed = useContext(CollectionsContext)[path]

  const colRef = useMemo(
    () => (user && db ? collection(db, 'users', user.uid, path) : null),
    [user, path],
  )

  const [localDocs, setLocalDocs] = useState<T[]>([])
  const [localLoading, setLocalLoading] = useState(true)

  useEffect(() => {
    // Managed collections are handled by the provider; don't open a second listener.
    if (managed || !colRef || !user) return
    const uid = user.uid

    // Seed from the offline mirror first (e.g. a shopping list's items viewed
    // at the store with no signal), then let the live listener refresh it.
    const cached = readCache(uid, path)
    if (cached) {
      setLocalDocs(cached as T[])
      setLocalLoading(false)
    }

    const q = query(colRef, ...constraints)
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (isStaleEmpty(snap)) return
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as T[]
        setLocalDocs(docs)
        setLocalLoading(false)
        writeCache(uid, path, docs)
      },
      () => setLocalLoading(false),
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colRef, Boolean(managed)])

  const add = (data: Record<string, unknown>) => {
    if (!colRef) return Promise.reject(new Error('not signed in'))
    return addDoc(colRef, { ...data, createdAt: serverTimestamp() })
  }

  const update = (id: string, data: Record<string, unknown>) => {
    if (!colRef) return Promise.reject(new Error('not signed in'))
    return updateDoc(doc(colRef, id), data)
  }

  const set = (id: string, data: Record<string, unknown>) => {
    if (!colRef) return Promise.reject(new Error('not signed in'))
    return setDoc(doc(colRef, id), data, { merge: true })
  }

  const remove = (id: string) => {
    if (!colRef) return Promise.reject(new Error('not signed in'))
    return deleteDoc(doc(colRef, id))
  }

  const docs = managed ? (managed.docs as T[]) : localDocs
  const loading = managed ? managed.loading : localLoading

  return { docs, loading, add, update, set, remove }
}

export { orderBy, serverTimestamp }
