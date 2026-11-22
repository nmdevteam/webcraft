import { useEffect, useState } from 'react'
import { SESSION_CHANGED_EVENT } from '../api'

type Props = { src: string; alt: string; className?: string; loading?: 'eager' | 'lazy' }

export function AuthenticatedImage({ src, alt, className, loading = 'lazy' }: Props) {
  const [displaySrc, setDisplaySrc] = useState('')
  const [sessionVersion, setSessionVersion] = useState(0)

  useEffect(() => {
    const onSessionChange = () => { setDisplaySrc(''); setSessionVersion((version) => version + 1) }
    window.addEventListener(SESSION_CHANGED_EVENT, onSessionChange)
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, onSessionChange)
  }, [])

  useEffect(() => {
    setDisplaySrc('')
    const match = /^\/media\/([A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:png|jpe?g|webp|gif))$/i.exec(src)
    if (!match) {
      setDisplaySrc(src)
      return
    }
    const token = sessionStorage.getItem('webcraft-session')
    if (!token) return
    const controller = new AbortController()
    let objectUrl = ''
    let active = true
    void fetch(`/api/assets/file/${encodeURIComponent(match[1]!)}`, {
      headers: { Authorization: `JWT ${token}` },
      cache: 'no-store',
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) throw new Error('Asset unavailable')
      return response.blob()
    }).then((blob) => {
      if (active) {
        objectUrl = URL.createObjectURL(blob)
        setDisplaySrc(objectUrl)
      }
    }).catch(() => {
      if (active) setDisplaySrc('')
    })
    return () => {
      active = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src, sessionVersion])

  return <img src={displaySrc || undefined} alt={alt} className={className} loading={loading} />
}
