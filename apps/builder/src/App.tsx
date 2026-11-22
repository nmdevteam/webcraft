import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { AuthScreen } from './components/AuthScreen'
import { useAuthStore } from './store/auth'

const Dashboard = lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })))
const Editor = lazy(() => import('./components/Editor').then((module) => ({ default: module.Editor })))
const Preview = lazy(() => import('./components/Preview').then((module) => ({ default: module.Preview })))
const Settings = lazy(() => import('./components/Settings').then((module) => ({ default: module.Settings })))
const Marketplace = lazy(() => import('./components/Marketplace').then((module) => ({ default: module.Marketplace })))

export default function App() {
  const { token, user, setSession, clear } = useAuthStore()
  const [checking, setChecking] = useState(Boolean(token))
  useEffect(() => {
    if (!token) { setChecking(false); return }
    api<{ user: typeof user }>('/users/me').then((result) => { if (result.user) setSession(token, result.user as NonNullable<typeof user>); else clear() }).catch(() => clear()).finally(() => setChecking(false))
  }, [])
  if (checking) return <div className="boot-screen"><div className="loader-mark">W</div><span>Starting your workspace…</span></div>
  if (!token || !user) return <AuthScreen />
  return <Suspense fallback={<div className="boot-screen"><div className="loader-mark">W</div><span>Loading workspace…</span></div>}>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/editor/:projectId" element={<Editor />} />
      <Route path="/preview/:projectId" element={<Preview />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/marketplace" element={<Marketplace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
}
