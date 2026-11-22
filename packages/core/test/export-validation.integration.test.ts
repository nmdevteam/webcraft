import { describe, expect, it } from 'vitest'
import { generateSource } from '../src/exporter'
import { validateGeneratedSource } from '../../../apps/cms/src/lib/export-validation'
import { createDefaultDesignSystem } from '../src/design-system'

describe('standalone export production validation', () => {
  it('installs the generated app safely and runs its production build', async () => {
    const files = generateSource({
      name: 'WebCraft export smoke test',
      settings: { title: 'Preview test', description: 'Generated-site integration', logoPath: '/media/logo.png', faviconPath: '/media/favicon.png', customCss: '.wc-site-brand{padding:1rem}', customMetaTags: [{ attribute: 'property', key: 'og:title', content: 'Preview test' }], breakpoints: { mobile: 560, tablet: 920 }, designSystem: createDefaultDesignSystem('#993355', 'Georgia') },
      pages: [{
        title: 'Home',
        slug: 'home',
        isHome: true,
        nodes: [{ id: 'heading', type: 'heading', props: { text: 'Hello from WebCraft', level: 3 }, style: { color: 'var(--wc-color-primary)', padding: 'var(--wc-spacing-md)', responsive: { tablet: { fontSize: '2rem' }, mobile: { gridColumns: 2 } } }, children: [] }],
      }],
    }, [{ filename: 'logo.png', contentBase64: 'aGVsbG8=' }, { filename: 'favicon.png', contentBase64: 'aGVsbG8=' }])
    expect(files['index.html']?.content).toContain('og:title')
    expect(files['src/styles.css']?.content).toContain('.wc-site-brand{padding:1rem}')
    expect(files['src/styles.css']?.content).toContain('--wc-color-primary:#993355')
    expect(files['src/styles.css']?.content).toContain('--wc-spacing-md:1rem')
    expect(files['src/components/SiteRenderer.tsx']?.content).toContain('wc-heading-level-')
    expect(JSON.parse(files['src/site.json']!.content).settings.logoPath).toBe('/assets/logo.png')
    const result = await validateGeneratedSource(files)
    expect(result.valid).toBe(true)
    expect(result.fileCount).toBeGreaterThan(5)
  }, 300_000)
})
