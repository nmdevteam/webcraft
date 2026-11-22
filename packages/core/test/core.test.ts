import { describe, expect, it } from 'vitest'
import { PageDataSchema, ProjectSettingsSchema, responsiveStyleCss, validateTree } from '../src/schema'
import { templateById } from '../src/templates'
import { generateSource } from '../src/exporter'

const home = () => ({ title: 'Home', slug: 'home', isHome: true, nodes: templateById('business').nodes })

describe('WebCraft canonical page model', () => {
  it('validates the starter template tree', () => {
    expect(validateTree(templateById('business').nodes).length).toBeGreaterThan(0)
  })
  it('rejects active script and data URLs', () => {
    const page = { title: 'Home', slug: 'home', isHome: true, nodes: [{ id: 'link1', type: 'link', props: { text: 'click', href: 'javascript:alert(1)' }, style: {}, children: [] }] }
    expect(() => PageDataSchema.parse(page)).toThrow()
    const dataUrl = { ...page, nodes: [{ ...page.nodes[0], props: { text: 'x', href: 'data:text/html,hi' } }] }
    expect(() => PageDataSchema.parse(dataUrl)).toThrow()
  })
  it('rejects unsafe CSS and duplicated node identifiers', () => {
    const unsafe = [{ id: 'a', type: 'paragraph', props: { text: 'x' }, style: { color: 'url(javascript:alert(1))' }, children: [] }]
    expect(() => validateTree(unsafe)).toThrow()
    const duplicate = [
      { id: 'same', type: 'paragraph', props: {}, style: {}, children: [] },
      { id: 'same', type: 'heading', props: {}, style: {}, children: [] },
    ]
    expect(() => validateTree(duplicate)).toThrow(/Duplicate component ID/)
  })
  it('caps tree size', () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, type: 'text', props: {}, style: {}, children: [] }))
    expect(() => validateTree(tooMany)).toThrow()
  })
  it('rejects markup in the website language setting', () => {
    expect(() => ProjectSettingsSchema.parse({ language: 'en" onload="alert(1)' })).toThrow()
  })
  it('validates ordered mobile and tablet breakpoints and blocks executable custom CSS', () => {
    expect(ProjectSettingsSchema.parse({ breakpoints: { mobile: 520, tablet: 960 } }).breakpoints).toEqual({ mobile: 520, tablet: 960 })
    expect(() => ProjectSettingsSchema.parse({ breakpoints: { mobile: 900, tablet: 800 } })).toThrow(/smaller/)
    expect(() => ProjectSettingsSchema.parse({ customCss: '@import url(https://evil.invalid/x.css);' })).toThrow()
    expect(() => ProjectSettingsSchema.parse({ customCss: '.x{background:url(javascript:alert(1))}' })).toThrow()
  })
  it('generates tablet and mobile overrides only from validated style values', () => {
    const nodes = validateTree([{ id: 'responsive', type: 'section', props: {}, style: { responsive: { tablet: { color: '#112233' }, mobile: { gridColumns: 2, padding: '1rem' } } }, children: [] }])
    const css = responsiveStyleCss(nodes, { tablet: 900, mobile: 600 })
    expect(css).toContain('@media(max-width:900px)')
    expect(css).toContain('@media(max-width:600px)')
    expect(css).toContain('[data-node-id="responsive"]{color:#112233}')
    expect(css).toContain('grid-template-columns:repeat(2, minmax(0, 1fr))')
  })
})

describe('standalone source generator', () => {
  it('generates a Vite React TypeScript project with no CMS dependency', () => {
    const files = generateSource({ name: 'Northstar', settings: {}, pages: [home()] })
    expect(files['package.json']?.content).toContain('vite')
    expect(files['src/App.tsx']?.content).toContain('Routes')
    expect(files['src/pages/home.tsx']?.content).toContain('SiteRenderer')
    expect(files['README.md']?.content).toContain('npm run build')
    expect(Object.keys(files)).not.toContain('.env')
    expect(Object.keys(files)).not.toContain('payload.config.ts')
  })
  it('serializes user text as JSON data and relies on React text escaping', () => {
    const page = { title: 'Home', slug: 'home', isHome: true, nodes: [{ id: 'headline', type: 'heading' as const, props: { text: '<script>alert(1)</script>' }, style: {}, children: [] }] }
    const files = generateSource({ name: 'Test', settings: {}, pages: [page] })
    const data = JSON.parse(files['src/site.json']!.content)
    expect(data.pages[0].nodes[0].props.text).toBe('<script>alert(1)</script>')
    expect(files['src/components/SiteRenderer.tsx']!.content).not.toContain('dangerouslySetInnerHTML')
  })
  it('copies an uploaded image to public assets and rewrites its project-local URL', () => {
    const page = { title: 'Home', slug: 'home', isHome: true, nodes: [{ id: 'image', type: 'image' as const, props: { src: '/media/mark.png?width=320', alt: 'Mark' }, style: {}, children: [] }] }
    const files = generateSource({ name: 'Site', settings: {}, pages: [page] }, [{ filename: 'mark.png', contentBase64: 'aGVsbG8=' }])
    expect(files['public/assets/mark.png']).toEqual({ content: 'aGVsbG8=', encoding: 'base64' })
    expect(JSON.parse(files['src/site.json']!.content).pages[0].nodes[0].props.src).toBe('/assets/mark.png')
  })
  it('rewrites selected logo and favicon assets and escapes custom metadata', () => {
    const files = generateSource({ name: 'Site', settings: { title: 'A <Site>', logoPath: '/media/brand.png', faviconPath: '/media/favicon.webp', customMetaTags: [{ attribute: 'property', key: 'og:title', content: 'A "title" & <site>' }], customCss: '.wc-site-brand{padding:1rem}' }, pages: [home()] }, [
      { filename: 'brand.png', contentBase64: 'aGVsbG8=' }, { filename: 'favicon.webp', contentBase64: 'aGVsbG8=' },
    ])
    const site = JSON.parse(files['src/site.json']!.content)
    expect(site.settings.logoPath).toBe('/assets/brand.png')
    expect(site.settings.faviconPath).toBe('/assets/favicon.webp')
    expect(files['index.html']!.content).toContain('href="/assets/favicon.webp"')
    expect(files['index.html']!.content).toContain('A &quot;title&quot; &amp; &lt;site&gt;')
    expect(files['index.html']!.content).toContain('A &lt;Site&gt;')
    expect(files['src/styles.css']!.content).toContain('.wc-site-brand{padding:1rem}')
    expect(files['src/components/SiteRenderer.tsx']!.content).toContain('wc-site-brand')
  })
  it('refuses exports with unresolved project-local image references', () => {
    const page = { title: 'Home', slug: 'home', isHome: true, nodes: [{ id: 'image', type: 'image' as const, props: { src: '/media/missing.png' }, style: {}, children: [] }] }
    expect(() => generateSource({ name: 'Site', settings: {}, pages: [page] })).toThrow(/unavailable for export/)
  })
  it('rejects unsafe asset names and duplicate page slugs', () => {
    expect(() => generateSource({ name: 'Test', settings: {}, pages: [home()] }, [{ filename: '../escape.png', contentBase64: 'aGVsbG8=' }])).toThrow(/filename/)
    expect(() => generateSource({ name: 'Test', settings: {}, pages: [home(), { ...home(), title: 'Also home' }] })).toThrow(/Duplicate page slug/)
  })
})
