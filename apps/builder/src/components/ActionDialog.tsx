import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Pencil } from 'lucide-react'
import { Button, Input } from './ui'

export type TextDialogOptions = {
  title: string
  description?: string
  label: string
  initialValue: string
  placeholder?: string
  confirmLabel?: string
  maxLength?: number
}

export type ConfirmationDialogOptions = {
  title: string
  description: string
  confirmLabel?: string
  destructive?: boolean
}

export type DialogRequest =
  | ({ kind: 'input'; id: number } & TextDialogOptions)
  | ({ kind: 'confirm'; id: number } & ConfirmationDialogOptions)

type DialogResult = string | boolean | null

export function useActionDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const requestRef = useRef<DialogRequest | null>(null)
  const resolverRef = useRef<((result: DialogResult) => void) | null>(null)
  const sequenceRef = useRef(0)
  const openerRef = useRef<HTMLElement | null>(null)

  const captureOpener = useCallback(() => {
    if (requestRef.current || typeof document === 'undefined') return
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
  }, [])

  const finish = useCallback((result: DialogResult) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    requestRef.current = null
    setRequest(null)
  }, [])

  const cancel = useCallback(() => {
    finish(requestRef.current?.kind === 'confirm' ? false : null)
  }, [finish])

  const requestText = useCallback((options: TextDialogOptions) => new Promise<string | null>((resolve) => {
    captureOpener()
    resolverRef.current?.(null)
    const next: DialogRequest = { ...options, kind: 'input', id: ++sequenceRef.current }
    requestRef.current = next
    resolverRef.current = (result) => resolve(typeof result === 'string' ? result : null)
    setRequest(next)
  }), [captureOpener])

  const requestConfirmation = useCallback((options: ConfirmationDialogOptions) => new Promise<boolean>((resolve) => {
    captureOpener()
    resolverRef.current?.(false)
    const next: DialogRequest = { ...options, kind: 'confirm', id: ++sequenceRef.current }
    requestRef.current = next
    resolverRef.current = (result) => resolve(result === true)
    setRequest(next)
  }), [captureOpener])

  const actionDialog = request
    ? <ActionDialog key={request.id} request={request} onFinish={finish} onCancel={cancel} returnFocusTarget={openerRef.current} />
    : null

  return { requestText, requestConfirmation, actionDialog }
}

export function ActionDialog({ request, onFinish, onCancel, returnFocusTarget }: {
  request: DialogRequest
  onFinish: (result: DialogResult) => void
  onCancel: () => void
  returnFocusTarget?: HTMLElement | null
}) {
  const [value, setValue] = useState(request.kind === 'input' ? request.initialValue : '')
  const dialogRef = useRef<HTMLFormElement>(null)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    const dialog = dialogRef.current
    const initial = dialog?.querySelector<HTMLElement>('[data-dialog-initial-focus]') ?? dialog?.querySelector<HTMLElement>('input, button')
    initial?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
      } else if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault()
        focusable.at(-1)?.focus()
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault()
        focusable[0]?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus()
    }
  }, [returnFocusTarget])

  return <div className="modal-backdrop action-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <form ref={dialogRef} className="modal-card action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title" aria-describedby={request.description ? 'action-dialog-description' : undefined} onSubmit={(event) => {
      event.preventDefault()
      onFinish(request.kind === 'input' ? value : true)
    }}>
      <div className="modal-head"><span className="modal-icon">{request.kind === 'confirm' ? <AlertTriangle size={18} /> : <Pencil size={18} />}</span><button type="button" className="close-modal" aria-label="Close dialog" onClick={onCancel}>×</button></div>
      <span className="eyebrow">{request.kind === 'confirm' ? 'PLEASE CONFIRM' : 'EDIT DETAILS'}</span>
      <h2 id="action-dialog-title">{request.title}</h2>
      {request.description && <p id="action-dialog-description">{request.description}</p>}
      {request.kind === 'input' && <label className="field-label">{request.label}<Input autoFocus required maxLength={request.maxLength} data-dialog-initial-focus="true" value={value} placeholder={request.placeholder} onChange={(event) => setValue(event.target.value)} /></label>}
      <div className="modal-actions">
        <Button type="button" {...(request.kind === 'confirm' ? { 'data-dialog-initial-focus': 'true' } : {})} onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant={request.kind === 'confirm' && request.destructive ? 'danger' : 'primary'}>{request.confirmLabel || (request.kind === 'input' ? 'Save' : 'Continue')}</Button>
      </div>
    </form>
  </div>
}
