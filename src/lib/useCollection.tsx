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
    const unsubs = Object.entries(MANAGED).map(([path, constraints]) => {
      const colRef = collection(db!, 'users', user.uid, path)
      const q = query(colRef, ...constraints)
      return onSnapshot(
        q,
        (snap) => {
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Doc[]
          setState((s) => ({ ...s, [path]: { docs, loading: false } }))
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
    if (managed || !colRef) return
    const q = query(colRef, ...constraints)
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLocalDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as T[])
        setLocalLoading(false)
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
