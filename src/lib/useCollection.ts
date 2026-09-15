import { useEffect, useMemo, useState } from 'react'
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

/**
 * Live-subscribes to a user-scoped subcollection: users/{uid}/{path}.
 * Returns the docs plus CRUD helpers. Works offline via Firestore cache.
 */
export function useCollection<T extends Doc>(path: string, ...constraints: QueryConstraint[]) {
  const { user } = useAuth()
  const [docs, setDocs] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  const colRef = useMemo(
    () => (user && db ? collection(db, 'users', user.uid, path) : null),
    [user, path],
  )

  useEffect(() => {
    if (!colRef) return
    const q = query(colRef, ...constraints)
    const unsub = onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as T[])
      setLoading(false)
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colRef])

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

  return { docs, loading, add, update, set, remove }
}

export { orderBy, serverTimestamp }
