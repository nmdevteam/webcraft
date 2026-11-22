import { useState } from 'react'
import { Boxes, Eye, EyeOff, Sparkles } from 'lucide-react'
import { api, jsonBody, type User } from '../api'
import { useAuthStore } from '../store/auth'
import { Button, Input } from './ui'

export function AuthScreen() {
  const [creating, setCreating] = useState(false)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setSession = useAuthStore((s) => s.setSession)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    try {
      if (creating) {
        const name = String(data.get('name') ?? '').trim()
        await api('/users', { method: 'POST', body: jsonBody({ email, password, name }) })
      }
      const result = await api<{ token: string; user: User }>('/users/login', { method: 'POST', body: jsonBody({ email, password }) })
      if (!result.token || !result.user) throw new Error('The CMS did not return a session. Check the service setup.')
      setSession(result.token, result.user)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in.') }
    finally { setBusy(false) }
  }
  return <main className="auth-shell">
    <aside className="auth-story"><div className="brand-lockup"><span className="brand-mark"><Boxes size={22}/></span><b>webcraft</b></div><div className="auth-story-copy"><span className="eyebrow"><Sparkles size={14}/> YOUR IDEAS, BUILT VISUALLY</span><h1>Make space for<br/><em>good ideas.</em></h1><p>A local-first visual website builder. Your projects stay on your machine and in your own database.</p></div><div className="auth-story-foot"><span>Payload CMS · PostgreSQL · React</span><span>Local by design</span></div></aside>
    <section className="auth-panel"><form className="auth-form" onSubmit={submit}><div className="mobile-brand brand-lockup"><span className="brand-mark"><Boxes size={20}/></span><b>webcraft</b></div><span className="eyebrow">{creating ? 'FIRST-TIME SETUP' : 'WELCOME BACK'}</span><h2>{creating ? 'Create your owner account' : 'Sign in to WebCraft'}</h2><p className="muted">{creating ? 'This local account owns your projects and is created only once.' : 'Use the owner account for this local installation.'}</p>
      {creating && <label className="field-label">Your name<Input required name="name" autoComplete="name" maxLength={120} placeholder="Nadeem"/></label>}
      <label className="field-label">Email address<Input required name="email" type="email" autoComplete="email" maxLength={254} placeholder="you@example.com"/></label>
      <label className="field-label">Password<span className="password-row"><Input required name="password" type={visible ? 'text' : 'password'} autoComplete={creating ? 'new-password' : 'current-password'} minLength={10} maxLength={128} placeholder="At least 10 characters"/><button className="password-toggle" type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
      {error && <div className="inline-error" role="alert">{error}</div>}
      <Button variant="primary" type="submit" busy={busy} className="wide">{creating ? 'Create local account' : 'Sign in'}</Button>
      <button type="button" className="text-button" onClick={() => { setCreating(!creating); setError('') }}>{creating ? 'Already have an owner account? Sign in' : 'First time here? Create the owner account'}</button>
      <div className="auth-note">The first account is the sole owner. The CMS binds to localhost and project records are owner-scoped.</div>
    </form></section>
  </main>
}
