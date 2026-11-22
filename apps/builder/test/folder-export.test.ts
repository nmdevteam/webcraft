import { describe, expect, it } from 'vitest'
import { createFreshDirectory, type DirectoryHandle } from '../src/lib/folder-export'

function namedError(name: string) {
  return Object.assign(new Error(name), { name })
}

const unusedDirectory = {} as DirectoryHandle

function fakeParent(getDirectoryHandle: DirectoryHandle['getDirectoryHandle']): DirectoryHandle {
  return { getDirectoryHandle, getFileHandle: async () => { throw new Error('not used') } }
}

describe('createFreshDirectory', () => {
  it('skips a file and an existing directory before creating a suffixed folder', async () => {
    const parent = fakeParent(async (name, options) => {
      if (name === 'site' && !options?.create) throw namedError('TypeMismatchError')
      if (name === 'site-2' && !options?.create) return unusedDirectory
      if (name === 'site-3' && !options?.create) throw namedError('NotFoundError')
      if (name === 'site-3' && options?.create) return unusedDirectory
      throw namedError('UnexpectedError')
    })

    const result = await createFreshDirectory(parent, 'site')
    expect(result).toEqual({ name: 'site-3', handle: unusedDirectory })
  })

  it('retries if another file claims the path between lookup and creation', async () => {
    let raced = false
    const parent = fakeParent(async (name, options) => {
      if (name === 'site' && !options?.create) throw namedError('NotFoundError')
      if (name === 'site' && options?.create && !raced) {
        raced = true
        throw namedError('TypeMismatchError')
      }
      if (name === 'site-2' && !options?.create) throw namedError('NotFoundError')
      if (name === 'site-2' && options?.create) return unusedDirectory
      throw namedError('UnexpectedError')
    })

    const result = await createFreshDirectory(parent, 'site')
    expect(result).toEqual({ name: 'site-2', handle: unusedDirectory })
  })
})
