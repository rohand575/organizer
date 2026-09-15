import { Navigate, Route, Routes } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { AppShell } from './components/AppShell'
import { Login } from './routes/Login'
import { TodosPage } from './features/todos/TodosPage'
import { ListsPage } from './features/lists/ListsPage'
import { NotesPage } from './features/notes/NotesPage'

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

  if (loading) return <Spinner />
  if (!user || !configured) return <Login />

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/todos" element={<Page><TodosPage /></Page>} />
          <Route path="/lists" element={<Page><ListsPage /></Page>} />
          <Route path="/notes" element={<Page><NotesPage /></Page>} />
          <Route path="*" element={<Navigate to="/todos" replace />} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  )
}
