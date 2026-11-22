import { describe, expect, it } from 'vitest'
import { generateSource } from '../src/exporter'
import { validateGeneratedSource } from '../../../apps/cms/src/lib/export-validation'

describe('standalone export production validation', () => {
  it('installs the generated app safely and runs its production build', async () => {
    const files = generateSource({
      name: 'WebCraft export smoke test',
      settings: { title: 'Preview test', description: 'Generated-site integration', logoPath: '/media/logo.png', faviconPath: '/media/favicon.png', customCss: '.wc-site-brand{padding:1rem}', customMetaTags: [{ attribute: 'property', key: 'og:title', content: 'Preview test' }], breakpoints: { mobile: 560, tablet: 920 } },
      pages: [{
        title: 'Home',
        slug: 'home',
        isHome: true,
        nodes: [{ id: 'heading', type: 'heading', props: { text: 'Hello from WebCraft' }, style: { responsive: { tablet: { fontSize: '2rem' }, mobile: { gridColumns: 2 } } }, children: [] }],
      }],
    }, [{ filename: 'logo.png', contentBase64: 'aGVsbG8=' }, { filename: 'favicon.png', contentBase64: 'aGVsbG8=' }])
    expect(files['index.html']?.content).toContain('og:title')
    expect(files['src/styles.css']?.content).toContain('.wc-site-brand{padding:1rem}')
    expect(JSON.parse(files['src/site.json']!.content).settings.logoPath).toBe('/assets/logo.png')
    const result = await validateGeneratedSource(files)
    expect(result.valid).toBe(true)
    expect(result.fileCount).toBeGreaterThan(5)
  }, 300_000)
})
