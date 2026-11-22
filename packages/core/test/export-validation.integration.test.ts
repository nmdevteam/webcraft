import { describe, expect, it } from 'vitest'
import { generateSource } from '../src/exporter'
import { validateGeneratedSource } from '../../../apps/cms/src/lib/export-validation'

describe('standalone export production validation', () => {
  it('installs the generated app safely and runs its production build', async () => {
    const files = generateSource({
      name: 'WebCraft export smoke test',
      settings: {},
      pages: [{
        title: 'Home',
        slug: 'home',
        isHome: true,
        nodes: [{ id: 'heading', type: 'heading', props: { text: 'Hello from WebCraft' }, style: {}, children: [] }],
      }],
    })
    const result = await validateGeneratedSource(files)
    expect(result.valid).toBe(true)
    expect(result.fileCount).toBeGreaterThan(5)
  }, 300_000)
})
