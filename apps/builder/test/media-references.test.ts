import { describe, expect, it } from 'vitest'
import { replaceMediaReferences } from '../src/lib/media-references'

describe('media reference updates', () => {
  it('renames nested references while preserving unrelated values', () => {
    const input = { props: { src: '/media/old.png?width=320', srcSet: '/media/old.png 1x, /media/old.png 2x' }, children: [{ style: { background: 'url(/media/old.png)' } }], unrelated: '/media/old.png.backup', external: 'https://cdn.example/media/old.png', untouched: 3 }
    expect(replaceMediaReferences(input, '/media/old.png', '/media/new.png')).toEqual({
      props: { src: '/media/new.png?width=320', srcSet: '/media/new.png 1x, /media/new.png 2x' },
      children: [{ style: { background: 'url(/media/new.png)' } }],
      unrelated: '/media/old.png.backup',
      external: 'https://cdn.example/media/old.png',
      untouched: 3,
    })
  })

  it('clears a deleted path and its query/hash variants without touching similarly named assets', () => {
    const input = ['/media/image.png', '/media/image.png?width=320', '/media/image.png#preview', "url('/media/image.png?width=320')", '/media/image.png.backup', '/media/other.png']
    expect(replaceMediaReferences(input, '/media/image.png', '')).toEqual(['', '', '', "url('')", '/media/image.png.backup', '/media/other.png'])
  })
})
