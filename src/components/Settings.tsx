import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../auth/AuthProvider'
import {
  calendarConfigured,
  connectCalendar,
  disconnectCalendar,
  isCalendarConnected,
} from '../lib/calendar'
import { CalendarIcon, CheckIcon, XIcon } from './icons'
import { IconButton } from './IconButton'

export function Settings({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth()
  const [connected, setConnected] = useState(isCalendarConnected())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggleCalendar = async () => {
    setError('')
    if (connected) {
      disconnectCalendar()
      setConnected(false)
      return
    }
    setBusy(true)
    try {
      await connectCalendar()
      setConnected(true)
    } catch (e) {
      setError((e as Error).message || 'Could not connect. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center"
    >
      <motion.div
        initial={{ y: 40, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="safe-bottom flex w-full max-w-md flex-col rounded-t-3xl bg-surface shadow-float sm:rounded-3xl"
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-xl font-bold tracking-tight">Settings</h2>
          <IconButton onClick={onClose} aria-label="Close">
            <XIcon className="h-5 w-5" />
          </IconButton>
        </div>

        {/* Account */}
        <div className="flex items-center gap-3 px-5 pt-5">
          {user?.photoURL && <img src={user.photoURL} alt="" className="h-11 w-11 rounded-full" />}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{user?.displayName}</div>
            <div className="truncate text-xs text-subtle">{user?.email}</div>
          </div>
        </div>

        {/* Integrations */}
        <div className="px-5 pt-6">
          <div className="pb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
            Integrations
          </div>
          <div className="card flex items-center gap-3 px-4 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <CalendarIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">Google Calendar</div>
              <div className="text-xs text-subtle">
                {!calendarConfigured
                  ? 'Not available — no client ID configured.'
                  : connected
                    ? 'Connected · reminders become 45-min events'
                    : 'Turn task reminders into calendar events'}
              </div>
            </div>
            {calendarConfigured &&
              (connected ? (
                <button
                  onClick={toggleCalendar}
                  className="press flex items-center gap-1 rounded-full bg-[#34C759]/12 px-3 py-1.5 text-sm font-medium text-[#34C759]"
                >
                  <CheckIcon className="h-4 w-4" /> Connected
                </button>
              ) : (
                <button
                  onClick={toggleCalendar}
                  disabled={busy}
                  className="press rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? 'Connecting…' : 'Connect'}
                </button>
              ))}
          </div>
          {connected && (
            <button
              onClick={toggleCalendar}
              className="px-1 pt-2 text-xs text-subtle hover:text-[#FF375F]"
            >
              Disconnect Google Calendar
            </button>
          )}
          {error && <div className="px-1 pt-2 text-xs text-[#FF375F]">{error}</div>}
        </div>

        {/* Sign out */}
        <div className="px-5 pb-6 pt-6">
          <button
            onClick={signOut}
            className="press w-full rounded-2xl border border-hair py-3 text-[15px] font-medium text-[#FF375F] hover:bg-black/[0.02]"
          >
            Sign out
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
