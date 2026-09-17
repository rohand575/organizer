import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

/**
 * A small banner that tells the user when they're offline — and confirms when
 * the connection is back. Writes still go through Firestore's in-memory/queue
 * while offline and sync automatically on reconnect, so this is purely to set
 * expectations ("it saved, it'll show up once you're online") rather than to
 * block anything.
 */
export function NetworkStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [justReconnected, setJustReconnected] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const goOffline = () => {
      setOnline(false)
      setJustReconnected(false)
      if (timer) clearTimeout(timer)
    }
    const goOnline = () => {
      setOnline(true)
      setJustReconnected(true)
      timer = setTimeout(() => setJustReconnected(false), 2600)
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      if (timer) clearTimeout(timer)
    }
  }, [])

  const show = !online || justReconnected

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
          className="safe-top pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-2"
        >
          <div
            className={`pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium shadow-float ${
              online ? 'bg-[#34C759] text-white' : 'bg-ink text-white'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                online ? 'bg-white' : 'animate-pulse bg-[#FF9500]'
              }`}
            />
            {online
              ? 'Back online — syncing your changes'
              : "You're offline — changes save here and sync when you reconnect"}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
