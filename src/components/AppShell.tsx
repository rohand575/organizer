import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '../auth/AuthProvider'
import { CheckCircleIcon, ListIcon, NoteIcon } from './icons'
import { VoiceFab, VoiceToast, useVoiceCommand } from './VoiceControls'
import { Settings } from './Settings'

const tabs = [
  { to: '/tasks', label: 'Tasks', Icon: CheckCircleIcon },
  { to: '/lists', label: 'Lists', Icon: ListIcon },
  { to: '/notes', label: 'Notes', Icon: NoteIcon },
]

const titles: Record<string, string> = {
  '/tasks': 'Tasks',
  '/lists': 'Lists',
  '/notes': 'Notes',
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const title = titles[pathname] ?? 'Organizer'
  const voice = useVoiceCommand()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl md:gap-6 md:px-6">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col py-8 md:flex">
        <div className="px-3 text-2xl font-bold tracking-tight">Organizer</div>
        <nav className="mt-8 flex flex-col gap-1">
          {tabs.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `press flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${
                  isActive ? 'bg-accent-soft text-accent' : 'text-subtle hover:bg-black/5'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => setSettingsOpen(true)}
          className="press mt-auto flex items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-black/5"
        >
          {user?.photoURL && <img src={user.photoURL} alt="" className="h-8 w-8 rounded-full" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user?.displayName}</div>
            <div className="text-xs text-subtle">Settings</div>
          </div>
        </button>
      </aside>

      {/* Main column */}
      <div className="flex w-full flex-col pb-24 md:pb-8">
        {/* Mobile header */}
        <header className="glass safe-top sticky top-0 z-20 flex items-center justify-between px-5 py-3 md:hidden">
          <h1 className="text-[28px] font-bold tracking-tight">{title}</h1>
          {user?.photoURL && (
            <button onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <img src={user.photoURL} alt="" className="h-9 w-9 rounded-full" />
            </button>
          )}
        </header>

        {/* Desktop header */}
        <header className="hidden px-1 pb-4 pt-8 md:block">
          <h1 className="text-[34px] font-bold tracking-tight">{title}</h1>
        </header>

        <main className="flex-1 px-5 pt-2 md:px-1">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="glass safe-bottom fixed bottom-0 left-0 right-0 z-30 flex justify-around border-t border-hair px-2 pt-2 shadow-tab md:hidden">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 rounded-xl py-1 text-[11px] font-medium transition-colors ${
                isActive ? 'text-accent' : 'text-subtle'
              }`
            }
          >
            <Icon className="h-6 w-6" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Floating command mic (Tasks & Lists only) + shared status pill */}
      <VoiceFab voice={voice} />
      <VoiceToast voice={voice} />

      <AnimatePresence>
        {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      </AnimatePresence>
    </div>
  )
}
