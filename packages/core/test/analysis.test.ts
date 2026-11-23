import { describe, expect, it } from 'vitest'
import { analyzeWebsite } from '../src/analysis'
import { generateSource, type ExportPage, type GeneratedFile } from '../src/exporter'
import { ProjectSettingsSchema } from '../src/schema'

const textNode = (id: string, type: string, text: string, extra: Record<string, unknown> = {}) => ({ id, type, props: { text, ...extra }, style: {}, children: [] })
const page = (title: string, slug: string, nodes: any[], data: Record<string, unknown> = {}) => ({ title, slug, isHome: slug === 'home', nodes, ...data })

function build(settings: Record<string, unknown>, pages: ExportPage[], assets: { filename: string; contentBase64: string }[] = []) {
  const files = generateSource({ name: 'Audit site', settings, pages }, assets)
  const exported = JSON.parse(files['src/site.json']!.content)
  return { files, exported, report: analyzeWebsite({ projectName: 'Audit site', settings, pages: exported.pages, files }) }
}

describe('SEO settings and generated metadata', () => {
  it('defaults new SEO settings for older saved projects and rejects unsafe origins or invalid structured data', () => {
    const defaults = ProjectSettingsSchema.parse({})
    expect(defaults.siteUrl).toBe('')
    expect(defaults.socialImagePath).toBe('')
    expect(defaults.structuredData).toBe('')
    expect(() => ProjectSettingsSchema.parse({ siteUrl: 'javascript:alert(1)' })).toThrow()
    expect(() => ProjectSettingsSchema.parse({ siteUrl: 'https://user@example.com' })).toThrow()
    expect(() => ProjectSettingsSchema.parse({ siteUrl: 'https://example.com/path' })).toThrow()
    expect(() => ProjectSettingsSchema.parse({ structuredData: '{bad json' })).toThrow(/valid JSON/)
    expect(() => ProjectSettingsSchema.parse({ structuredData: JSON.stringify({ '@context': 'https://evil.example', '@type': 'Organization' }) })).toThrow(/schema.org/)
  })

  it('emits verified canonical/social metadata, an absolute sitemap, robots directive, and safely escaped JSON-LD', () => {
    const settings = {
      title: 'Audit site', description: 'A project-level description that can be used when a page has no specific summary.',
      siteUrl: 'https://example.com', socialImagePath: '/media/social.png',
      structuredData: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: '</script><script>alert(1)</script>' }),
    }
    const pages = [
      page('Home page', 'home', [textNode('home-h1', 'heading', 'Welcome', { level: 1 })], { seoTitle: 'Welcome to Example', seoDescription: 'A detailed home page description that explains exactly what visitors will find on this site.' }),
      page('About page', 'about', [textNode('about-h1', 'heading', 'About us', { level: 1 })], { seoTitle: 'About Example', seoDescription: 'Learn about the people, values, and history behind the Example website and what makes the team different.' }),
    ] as ExportPage[]
    const { files, report } = build(settings, pages, [{ filename: 'social.png', contentBase64: 'aGVsbG8=' }])
    const html = files['index.html']!.content
    expect(html).toContain('<link rel="canonical" href="https://example.com/"/>')
    expect(html).toContain('property="og:title" content="Welcome to Example"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain('property="og:image" content="https://example.com/assets/social.png"')
    expect(html).toContain('application/ld+json')
    expect(html).not.toContain('</script><script>alert(1)</script>')
    expect(html).toContain('\\u003c/script\\u003e')
    expect(files['sitemap.xml']!.content).toContain('<loc>https://example.com/</loc>')
    expect(files['sitemap.xml']!.content).toContain('<loc>https://example.com/about</loc>')
    expect(files['robots.txt']!.content).toContain('Sitemap: https://example.com/sitemap.xml')
    expect(files['src/App.tsx']!.content).toContain('function HeadMetadata()')
    expect(files['src/App.tsx']!.content).toContain('setCanonical(canonical)')
    expect(files['src/App.tsx']!.content).toContain("pathname.replace(/\\/+$/,'')")
    expect(report.seo.metrics.canonicalOriginConfigured).toBe(true)
    expect(report.seo.metrics.sitemapGenerated).toBe(true)
    expect(report.seo.metrics.structuredDataConfigured).toBe(true)
    expect(report.seo.findings.some((finding) => finding.code === 'SEO_CLIENT_RENDERED_METADATA')).toBe(true)
    expect(report.seo.findings.some((finding) => finding.severity === 'error')).toBe(false)
  })

  it('does not fabricate a canonical URL or sitemap when the public origin is unknown', () => {
    const { files, report } = build({}, [page('Home', 'home', [textNode('heading', 'heading', 'Home', { level: 1 })]) as ExportPage])
    expect(files['index.html']!.content).not.toContain('rel="canonical"')
    expect(files['sitemap.xml']).toBeUndefined()
    expect(files['robots.txt']!.content).not.toContain('Sitemap:')
    expect(report.seo.findings.some((finding) => finding.code === 'SEO_PUBLIC_ORIGIN_MISSING')).toBe(true)
  })

  it('preserves custom metadata overrides without duplicating generated defaults', () => {
    const { files } = build({ customMetaTags: [{ attribute: 'property', key: 'og:title', content: 'Manual title' }] }, [page('Home', 'home', [textNode('heading', 'heading', 'Home', { level: 1 })]) as ExportPage])
    const html = files['index.html']!.content
    expect(html.match(/property="og:title"/g)).toHaveLength(1)
    expect(html).toContain('property="og:title" content="Manual title"')
    expect(files['src/App.tsx']!.content).toContain('tag.key.toLowerCase()===key')
  })
})

describe('static performance and accessibility measurements', () => {
  it('reports actual generated source and decoded asset byte counts without claiming runtime metrics', () => {
    const pages = [page('Home', 'home', [textNode('heading', 'heading', 'Home', { level: 1 })]) as ExportPage]
    const asset = 'aGVsbG8='
    const { files, report } = build({}, pages, [{ filename: 'tiny.png', contentBase64: asset }])
    const textBytes = Object.entries(files).filter(([, file]) => file.encoding === 'utf-8').reduce((sum, [, file]) => sum + new TextEncoder().encode(file.content).byteLength, 0)
    expect(report.performance.metrics.generatedTextSourceBytes).toBe(textBytes)
    expect(report.performance.metrics.generatedAssetBytes).toBe(5)
    expect(report.performance.metrics.generatedFiles).toBe(Object.keys(files).length)
    expect(report.performance.metrics.generatedJavaScriptTypeScriptSourceBytes).toBeGreaterThan(0)
    expect(report.performance.findings.some((finding) => finding.code === 'PERF_IMAGE_LAZY_LOADING')).toBe(true)
    expect(report.performance.unavailable.join(' ')).toMatch(/Lighthouse/)
    expect(report.performance.unavailable.join(' ')).toMatch(/Core Web Vitals/)
    expect(report.performance.unavailable.join(' ')).toMatch(/field data from deployed users/)
    expect(report.performance.metrics.productionBuildMeasured).toBe(false)
    expect(report.performance.metrics).not.toHaveProperty('lighthouseScore')
    expect(report.performance.metrics).not.toHaveProperty('lcp')
  })

  it('reports supplied production build artifact measurements without turning them into browser scores', () => {
    const pages = [page('Home', 'home', [textNode('heading', 'heading', 'Home', { level: 1 })]) as ExportPage]
    const { files, exported } = build({}, pages)
    const report = analyzeWebsite({
      projectName: 'Audit site',
      settings: {},
      pages: exported.pages,
      files,
      productionArtifacts: {
        productionBuildMs: 3210,
        outputFileCount: 5,
        outputTotalBytes: 180_000,
        javascriptBundleBytes: 120_000,
        cssBundleBytes: 12_000,
        htmlBytes: 1_000,
        otherAssetBytes: 47_000,
        gzipTextAssetBytes: 40_000,
        gzipJavaScriptBytes: 30_000,
        gzipCssBytes: 3_000,
        gzipHtmlBytes: 700,
      },
    })
    expect(report.performance.metrics.productionBuildMeasured).toBe(true)
    expect(report.performance.metrics.outputTotalBytes).toBe(180_000)
    expect(report.performance.metrics.gzipJavaScriptBytes).toBe(30_000)
    expect(report.performance.metrics).not.toHaveProperty('lighthouseScore')
    expect(report.performance.unavailable.join(' ')).toMatch(/Actual transfer sizes can differ/)
    expect(report.performance.unavailable.join(' ')).toMatch(/Field CWV require real field data/)
  })

  it('flags measured large image assets and emits only static source-level CSS observations', () => {
    const largeBase64 = 'A'.repeat(Math.ceil((1.1 * 1024 * 1024) * 4 / 3))
    const { report } = build({}, [page('Home', 'home', [textNode('heading', 'heading', 'Home', { level: 1 })]) as ExportPage], [{ filename: 'large.webp', contentBase64: largeBase64 }])
    expect(report.performance.findings.some((finding) => finding.code === 'PERF_IMAGE_ASSET_LARGE')).toBe(true)
    expect(report.performance.findings.some((finding) => finding.code === 'PERF_UNUSED_GENERATED_CSS_RULES')).toBe(true)
  })

  it('finds missing alt/name/heading structure and low contrast from resolvable saved colors', () => {
    const pages = [page('Home', 'home', [
      textNode('h2', 'heading', 'Start here', { level: 2 }),
      { id: 'image', type: 'image', props: { src: 'https://images.example/test.png', alt: '' }, style: {}, children: [] },
      { id: 'blank-link', type: 'link', props: { text: '', href: '#' }, style: {}, children: [] },
      { id: 'spacer-link', type: 'link', props: { text: '', href: '/about' }, style: {}, children: [{ id: 'link-spacer', type: 'spacer', props: { text: '' }, style: {}, children: [] }] },
      { id: 'low-text', type: 'paragraph', props: { text: 'Low contrast text' }, style: { color: '#999999', backgroundColor: '#ffffff' }, children: [] },
    ]) as ExportPage]
    const { report } = build({}, pages)
    const codes = report.accessibility.findings.map((finding) => finding.code)
    expect(codes).toContain('ACCESSIBILITY_PAGE_WITHOUT_H1')
    expect(codes).toContain('ACCESSIBILITY_IMAGE_ALT_MISSING')
    expect(codes).toContain('ACCESSIBILITY_LINK_NAME_MISSING')
    expect(report.accessibility.findings.filter((finding) => finding.code === 'ACCESSIBILITY_LINK_NAME_MISSING').map((finding) => finding.nodeId)).toContain('spacer-link')
    expect(codes).toContain('ACCESSIBILITY_LINK_PLACEHOLDER')
    expect(codes).toContain('ACCESSIBILITY_CONTRAST_LOW')
    expect(report.accessibility.metrics.contrastPairsAnalyzed).toBeGreaterThan(0)
    expect(report.seo.findings.some((finding) => finding.code === 'SEO_NO_H1')).toBe(true)
  })

  it('uses inherited parent backgrounds when evaluating nested text contrast', () => {
    const nested = { ...textNode('nested-copy', 'paragraph', 'Text inside a dark panel'), style: { color: '#777777' } }
    const panel = { id: 'dark-panel', type: 'container', props: { text: '' }, style: { backgroundColor: '#000000' }, children: [nested] }
    const { report } = build({}, [page('Home', 'home', [panel]) as ExportPage])
    expect(report.accessibility.findings.filter((finding) => finding.code === 'ACCESSIBILITY_CONTRAST_LOW' && finding.nodeId === 'nested-copy')).toEqual([])
    expect(report.accessibility.metrics.contrastPairsAnalyzed).toBeGreaterThan(0)
  })

  it('discloses skipped contrast checks when project custom CSS can override modeled colors', () => {
    const { report } = build({ customCss: '.wc-site{color:#111;background:linear-gradient(#fff,#000)}' }, [page('Home', 'home', [textNode('p', 'paragraph', 'Text')]) as ExportPage])
    expect(report.accessibility.metrics.contrastPairsAnalyzed).toBe(0)
    expect(report.accessibility.metrics.contrastPairsNotAnalyzed).toBeGreaterThan(0)
    expect(report.accessibility.unavailable.join(' ')).toMatch(/contrast findings are skipped/)
  })
})
