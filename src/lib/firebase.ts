import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

// Only initialize when real config is present. With empty config Firebase throws
// at startup, which would blank the whole app — instead we render the setup screen.
let app: FirebaseApp | undefined
let db: Firestore | undefined
let auth: Auth | undefined
let googleProvider: GoogleAuthProvider | undefined

// iOS/iPadOS WebKit — especially inside a standalone (home-screen) PWA — has
// long-standing IndexedDB bugs: transactions can hang or silently fail after the
// app is backgrounded and resumed. That strands Firestore's persistent cache, so
// a write applies to nothing the UI can read — it looks "saved" but never shows.
// On Apple touch devices we use an in-memory cache instead: writes apply
// instantly in memory (so they appear immediately) and sync over the network,
// trading cross-session offline persistence for reliability. Everywhere else
// keeps the durable IndexedDB cache.
function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iPhone = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ reports as "MacIntel"; touch points distinguish it from a desktop Mac.
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iPhone || iPadOS
}

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  // experimentalForceLongPolling: Firestore's default streaming (fetch/WebChannel)
  // transport hangs inside iOS standalone PWAs. Auto-detect probing proved flaky
  // (it can even break in plain Safari), so we force long-polling — a slightly
  // chattier but rock-solid transport that works consistently everywhere.
  db = initializeFirestore(app, {
    localCache: isAppleTouchDevice()
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalForceLongPolling: true,
  })
  auth = getAuth(app)
  googleProvider = new GoogleAuthProvider()
} else if (import.meta.env.PROD) {
  // Surface the misconfiguration clearly in the console for production debugging.
  console.error(
    '[Organizer] Firebase is not configured. The VITE_FIREBASE_* environment ' +
      'variables were empty at build time. Check your GitHub Actions repository secrets.',
  )
}

export { app, db, auth, googleProvider }
