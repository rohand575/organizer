import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import './styles/index.css'

// Restore a deep-link path captured by the GitHub Pages 404.html SPA fallback.
const redirectPath = sessionStorage.getItem('redirectPath')
if (redirectPath) {
  sessionStorage.removeItem('redirectPath')
  if (redirectPath !== window.location.pathname) {
    window.history.replaceState(null, '', redirectPath)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
