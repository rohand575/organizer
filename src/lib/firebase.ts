import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import {
  initializeFirestore,
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

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig)
  // Offline-first: persistent IndexedDB cache with multi-tab support.
  // experimentalAutoDetectLongPolling: Firestore's default streaming transport
  // fails inside iOS standalone PWAs (and some proxies), which makes server
  // reads/writes hang. Auto-detect falls back to long-polling so it works there.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalAutoDetectLongPolling: true,
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
