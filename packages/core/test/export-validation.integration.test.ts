import { describe, expect, it } from 'vitest'
import { generateSource } from '../src/exporter'
import { validateGeneratedSource } from '../../../apps/cms/src/lib/export-validation'
import { createDefaultDesignSystem } from '../src/design-system'
import { createDefaultFormConfig, FormConfigSchema } from '../src/forms'
import { AnimationSchema } from '../src/animation'

describe('standalone export production validation', () => {
  it('rejects malformed and non-canonical base64 before running a build', async () => {
    await expect(validateGeneratedSource({ 'payload.bin': { content: '%%%%', encoding: 'base64' } })).rejects.toThrow('invalid base64')
    await expect(validateGeneratedSource({ 'payload.bin': { content: 'YQ', encoding: 'base64' } })).rejects.toThrow('invalid base64')
    await expect(validateGeneratedSource({ 'payload.bin': { content: 'YQ==\n', encoding: 'base64' } })).rejects.toThrow('invalid base64')
    await expect(validateGeneratedSource({ 'payload.bin': { content: 'YR==', encoding: 'base64' } })).rejects.toThrow('non-canonical base64')
  })

  it('rejects non-portable and case-colliding export paths', async () => {
    await expect(validateGeneratedSource({ 'public/CON.png': { content: 'x', encoding: 'utf-8' } })).rejects.toThrow('unsafe path')
    await expect(validateGeneratedSource({ 'public/Image.png': { content: 'x', encoding: 'utf-8' }, 'public/image.PNG': { content: 'y', encoding: 'utf-8' } })).rejects.toThrow('colliding file paths')
  })

  it('enforces both per-file and combined source caps', async () => {
    const overLimit = 'x'.repeat(8 * 1024 * 1024 + 1)
    await expect(validateGeneratedSource({ 'large.txt': { content: overLimit, encoding: 'utf-8' } })).rejects.toThrow('file that is too large')
    const chunk = 'x'.repeat(4 * 1024 * 1024)
    await expect(validateGeneratedSource({
      'one.txt': { content: chunk, encoding: 'utf-8' },
      'two.txt': { content: chunk, encoding: 'utf-8' },
      'three.txt': { content: 'x', encoding: 'utf-8' },
    })).rejects.toThrow('8 MB source limit')
  })

  it('installs the generated app safely and runs its production build', async () => {
    const files = generateSource({
      name: 'WebCraft export smoke test',
      settings: { title: 'Preview test', description: 'Generated-site integration', logoPath: '/media/logo.png', faviconPath: '/media/favicon.png', customCss: '.wc-site-brand{padding:1rem}', customMetaTags: [{ attribute: 'property', key: 'og:title', content: 'Preview test' }], breakpoints: { mobile: 560, tablet: 920 }, designSystem: createDefaultDesignSystem('#993355', 'Georgia'), pwa: { enabled: true, name: 'Preview PWA', shortName: 'Preview', icon192Path: '/media/icon.png', icon512Path: '/media/icon-large.webp', offlineFallback: true } },
      pages: [{
        title: 'Home',
        slug: 'home',
        isHome: true,
        nodes: [
          { id: 'heading', type: 'heading', props: { text: 'Hello from WebCraft', level: 3 }, style: { color: 'var(--wc-color-primary)', padding: 'var(--wc-spacing-md)', responsive: { tablet: { fontSize: '2rem' }, mobile: { gridColumns: 2 } } }, animation: AnimationSchema.parse({ enabled: true, trigger: 'entrance', effect: 'fade' }), children: [] },
          { id: 'form', type: 'form', props: { text: 'Contact', formConfig: FormConfigSchema.parse({ ...createDefaultFormConfig('Contact'), submissionMode: 'external', endpointUrl: '/api/contact' }) }, style: {}, children: [] },
        ],
      }],
    }, [{ filename: 'logo.png', contentBase64: 'aGVsbG8=' }, { filename: 'favicon.png', contentBase64: 'aGVsbG8=' }, { filename: 'icon.png', contentBase64: 'aGVsbG8=' }, { filename: 'icon-large.webp', contentBase64: 'aGVsbG8=' }])
    expect(files['index.html']?.content).toContain('og:title')
    expect(files['src/styles.css']?.content).toContain('.wc-site-brand{padding:1rem}')
    expect(files['src/styles.css']?.content).toContain('--wc-color-primary:#993355')
    expect(files['src/styles.css']?.content).toContain('--wc-spacing-md:1rem')
    expect(files['src/styles.css']?.content).toContain('prefers-reduced-motion:reduce')
    expect(files['src/components/SiteRenderer.tsx']?.content).toContain('wc-heading-level-')
    expect(files['src/components/FormRuntime.tsx']?.content).toContain("credentials:'omit'")
    expect(files['public/sw.js']?.content).toContain('MAX_ENTRIES = 150')
    expect(files['public/manifest.webmanifest']?.content).toContain('Preview PWA')
    expect(JSON.parse(files['src/site.json']!.content).settings.logoPath).toBe('/assets/logo.png')
    const result = await validateGeneratedSource(files)
    expect(result.valid).toBe(true)
    expect(result.fileCount).toBeGreaterThan(5)
    expect(result.productionArtifacts.outputFileCount).toBeGreaterThan(0)
    expect(result.productionArtifacts.outputTotalBytes).toBeGreaterThan(0)
    expect(result.productionArtifacts.javascriptBundleBytes).toBeGreaterThan(0)
    expect(result.productionArtifacts.gzipJavaScriptBytes).toBeGreaterThan(0)
    expect(result.productionArtifacts.gzipTextAssetBytes).toBeGreaterThan(0)
    expect(result.productionArtifacts.productionBuildMs).toBeGreaterThan(0)
  }, 300_000)
})
