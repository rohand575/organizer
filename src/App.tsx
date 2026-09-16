import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { AppShell } from './components/AppShell'
import { Login } from './routes/Login'
import { TasksPage } from './features/tasks/TasksPage'
import { ListsPage } from './features/lists/ListsPage'
import { NotesPage } from './features/notes/NotesPage'
import { migrateTodosToTasks } from './lib/migrate'

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-hair border-t-accent" />
    </div>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  )
}

export default function App() {
  const { user, loading, configured } = useAuth()
  const location = useLocation()

  // One-time copy of legacy `todos` docs into the renamed `tasks` collection.
  useEffect(() => {
    if (user) void migrateTodosToTasks(user.uid)
  }, [user])

  if (loading) return <Spinner />
  if (!user || !configured) return <Login />

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/tasks" element={<Page><TasksPage /></Page>} />
          <Route path="/lists" element={<Page><ListsPage /></Page>} />
          <Route path="/notes" element={<Page><NotesPage /></Page>} />
          <Route path="*" element={<Navigate to="/tasks" replace />} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  )
}
