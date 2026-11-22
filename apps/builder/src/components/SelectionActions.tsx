import { Copy, Trash2 } from 'lucide-react'
import { Button } from './ui'

type SelectionActionsProps = {
  count: number
  onCopy: () => void
  onDuplicate: () => void
  onDelete: () => void
}

export function SelectionActions({ count, onCopy, onDuplicate, onDelete }: SelectionActionsProps) {
  if (count < 1) return null

  return <div className="selection-actions" role="group" aria-label="Selected component actions">
    <span aria-live="polite">{count} selected</span>
    <Button size="sm" variant="ghost" onClick={onCopy} aria-label={`Copy ${count} selected component${count === 1 ? '' : 's'}`}><Copy size={14}/>Copy</Button>
    <Button size="sm" variant="ghost" onClick={onDuplicate} aria-label={`Duplicate ${count} selected component${count === 1 ? '' : 's'}`}><Copy size={14}/>Duplicate</Button>
    <Button size="sm" variant="danger" onClick={onDelete} aria-label={`Delete ${count} selected component${count === 1 ? '' : 's'}`}><Trash2 size={14}/>Delete</Button>
  </div>
}
