import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuth } from '../auth/AuthProvider'
import { GoogleIcon, CheckCircleIcon, ListIcon, NoteIcon } from '../components/icons'

export function Login() {
  const { signIn, configured } = useAuth()
  const [error, setError] = useState<string | null>(null)

  const handle = async () => {
    setError(null)
    try {
      await signIn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        className="w-full max-w-sm text-center"
      >
        <div className="mb-6 flex justify-center gap-2 text-accent">
          <CheckCircleIcon className="h-8 w-8" />
          <ListIcon className="h-8 w-8" />
          <NoteIcon className="h-8 w-8" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Organizer</h1>
        <p className="mt-3 text-[15px] text-subtle">
          To-dos, lists and notes — beautifully in sync across all your devices.
        </p>

        {configured ? (
          <button
            onClick={handle}
            className="press mt-10 flex w-full items-center justify-center gap-3 rounded-2xl bg-surface px-5 py-3.5 font-medium shadow-card"
          >
            <GoogleIcon className="h-5 w-5" />
            Continue with Google
          </button>
        ) : (
          <div className="mt-10 rounded-2xl bg-note-yellow px-5 py-4 text-sm text-ink/80">
            Firebase isn't configured yet. Copy <code>.env.example</code> to{' '}
            <code>.env</code> and add your Firebase keys to enable sign-in.
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </motion.div>
    </div>
  )
}
