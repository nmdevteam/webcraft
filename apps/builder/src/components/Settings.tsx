import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, GitBranch, Link2, LockKeyhole, Plus, ShieldCheck, Unplug } from 'lucide-react'
import { api, jsonBody } from '../api'
import { Button, Input, Status } from './ui'

type Account = { connected: boolean; login: string | null }
type Repo = { id: number; name: string; fullName: string; private: boolean; url: string; defaultBranch?: string | null }
export function Settings() {
  const navigate = useNavigate()
  const [account, setAccount] = useState<Account>({ connected: false, login: null })
  const [repos, setRepos] = useState<Repo[]>([])
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function load() {
    try { const result = await api<Account>('/webcraft/github/account'); setAccount(result); if (result.connected) { const data = await api<{ repositories: Repo[] }>('/webcraft/github/repositories'); setRepos(data.repositories) } }
    catch { setAccount({ connected: false, login: null }) }
  }
  useEffect(() => { void load() }, [])
  async function connect(event: React.FormEvent) {
    event.preventDefault(); const form = event.currentTarget as HTMLFormElement; const value = new FormData(form).get('token')
    if (typeof value !== 'string' || !value) return
    setBusy(true); setError(''); setMessage('')
    try { const result = await api<Account>('/webcraft/github/connect', { method: 'POST', body: jsonBody({ token: value }) }); setAccount(result); setToken(''); form.reset(); setMessage(`Connected as ${result.login}. The token is encrypted locally and never returned to the browser.`); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not connect GitHub.') }
    finally { setBusy(false) }
  }
  async function createRepo(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try { const result = await api<{ repository: Repo }>('/webcraft/github/repositories', { method: 'POST', body: jsonBody({ name, private: isPrivate }) }); setRepos([result.repository, ...repos]); setName(''); setMessage(`Created ${result.repository.fullName}.`); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not create repository.') }
    finally { setBusy(false) }
  }
  async function disconnect() {
    setBusy(true); setError('')
    try { await api('/webcraft/github/disconnect', { method: 'POST', body: '{}' }); setAccount({ connected: false, login: null }); setRepos([]); setMessage('GitHub disconnected. The encrypted local token was removed.') }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not disconnect GitHub.') }
    finally { setBusy(false) }
  }
  return <div className="settings-page"><header className="settings-top"><Button variant="ghost" onClick={() => navigate('/')}><ArrowLeft size={16}/>Back to dashboard</Button><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>Settings</strong></div><span/></header><main className="settings-content"><span className="eyebrow">WORKSPACE PREFERENCES</span><h1>Settings</h1><p className="muted">Manage local integrations and how your projects are stored.</p>
    {error && <div className="inline-error" role="alert">{error}</div>}{message && <div className="inline-success">{message}</div>}
    <section className="settings-card"><div className="settings-card-head"><span className="settings-icon"><GitBranch size={20}/></span><div><h2>GitHub integration</h2><p>Push generated website projects to a repository you choose.</p></div>{account.connected ? <Status tone="success">Connected</Status> : <Status>Not connected</Status>}</div>
      {account.connected ? <div className="github-connected"><div className="connected-row"><div className="gh-avatar">{account.login?.slice(0,1).toUpperCase()}</div><div><b>{account.login}</b><small>GitHub account connected</small></div><Button variant="danger" size="sm" disabled={busy} onClick={() => void disconnect()}><Unplug size={14}/>Disconnect</Button></div><div className="repo-create"><div><b>Create a repository</b><small>Repositories created here are owned by {account.login}.</small></div><form onSubmit={createRepo}><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} pattern="[A-Za-z0-9._-]+" placeholder="repository-name"/><label className="checkbox-label"><input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)}/>Private</label><Button variant="primary" size="sm" busy={busy}><Plus size={14}/>Create repo</Button></form></div><div className="repo-list"><div className="repo-list-heading"><b>Your repositories</b><span>{repos.length} shown</span></div>{repos.length ? repos.map((repo) => <div className="repo-row" key={repo.id}><Link2 size={15}/><div><b>{repo.fullName}</b><small>{repo.defaultBranch || 'No default branch yet'}</small></div><Status>{repo.private ? 'Private' : 'Public'}</Status><a href={repo.url} target="_blank" rel="noreferrer">View</a></div>) : <div className="settings-empty">No repositories were returned for this token.</div>}</div></div> : <form className="connect-form" onSubmit={connect}><div className="connect-how"><span><LockKeyhole size={16}/></span><p>Use a GitHub fine-grained personal access token with <b>Metadata: read</b>, <b>Contents: read and write</b>, and <b>Administration: read and write</b> if you want to create repositories. The token is encrypted in a local file and is never sent to the browser after connection.</p></div><label className="field-label">GitHub token<Input name="token" type="password" autoComplete="off" required minLength={20} maxLength={500} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… or github_pat_…"/></label><Button variant="primary" busy={busy}><GitBranch size={16}/>Connect GitHub</Button><small className="security-note"><ShieldCheck size={14}/>Only this local server stores the token. Disconnect removes its encrypted file.</small></form>}
    </section><section className="settings-card"><div className="settings-card-head"><span className="settings-icon"><ShieldCheck size={20}/></span><div><h2>Local data</h2><p>WebCraft binds its services to localhost and persists projects in PostgreSQL.</p></div><Status tone="success">On this machine</Status></div><div className="local-data-grid"><div><b>CMS database</b><small>PostgreSQL · your local connection</small></div><div><b>Session security</b><small>Short-lived token kept in this browser tab</small></div><div><b>Project recovery</b><small>Local browser draft recovery for unsaved edits</small></div></div></section>
  </main></div>
}
