import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActionDialog, type DialogRequest } from '../src/components/ActionDialog'

const finish = vi.fn()
const cancel = vi.fn()

function renderDialog(request: DialogRequest) {
  return renderToStaticMarkup(<ActionDialog request={request} onFinish={finish} onCancel={cancel} />)
}

describe('accessible action dialogs', () => {
  it('renders a labelled modal with an associated text input', () => {
    const html = renderDialog({
      id: 1,
      kind: 'input',
      title: 'Rename website',
      description: 'Choose a descriptive name.',
      label: 'Website name',
      initialValue: 'Northstar',
      confirmLabel: 'Save name',
      maxLength: 120,
    })

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby="action-dialog-title"')
    expect(html).toContain('aria-describedby="action-dialog-description"')
    expect(html).toContain('Website name<input')
    expect(html).toContain('data-dialog-initial-focus="true"')
    expect(html).toContain('value="Northstar"')
    expect(html).toContain('Save name')
    expect(html).toContain('Cancel')
  })

  it('marks destructive confirmations clearly and leaves a cancel action available', () => {
    const html = renderDialog({
      id: 2,
      kind: 'confirm',
      title: 'Delete this website?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete website',
      destructive: true,
    })

    expect(html).toContain('Delete this website?')
    expect(html).toContain('This cannot be undone.')
    expect(html).toContain('btn-danger')
    expect(html).toContain('data-dialog-initial-focus="true"')
    expect(html).toContain('Cancel')
  })
})
