import { describe, expect, it } from 'vitest'
import { PageDataSchema, PageUndoHistorySchema, ProjectSettingsSchema, ProjectVersionSnapshotSchema, responsiveStyleCss, styleDeclarations, validateTree } from '../src/schema'
import { templateById } from '../src/templates'
import { generateSource } from '../src/exporter'
import { createDefaultDesignSystem, DesignSystemSchema, designSystemCss, safeDesignSystemCss } from '../src/design-system'
import { ComponentPackageSchema, MarketplacePackageSchema, TemplatePackageSchema, missingDesignTokens, packageCompatibilityError, packageForJsonExport } from '../src/marketplace'

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

describe('project version history validation', () => {
  it('defaults automatic snapshots to 15 minutes and accepts a safe disabled setting', () => {
    expect(ProjectSettingsSchema.parse({}).historyIntervalMinutes).toBe(15)
    expect(ProjectSettingsSchema.parse({ historyIntervalMinutes: 0 }).historyIntervalMinutes).toBe(0)
    expect(() => ProjectSettingsSchema.parse({ historyIntervalMinutes: 1.5 })).toThrow()
    expect(() => ProjectSettingsSchema.parse({ historyIntervalMinutes: 1441 })).toThrow()
  })

  it('validates persistent undo/redo trees and applies bounded stack lengths', () => {
    const history = PageUndoHistorySchema.parse({ past: [[]], future: [[]] })
    expect(history.past).toEqual([[]])
    expect(() => PageUndoHistorySchema.parse({ past: Array.from({ length: 41 }, () => []), future: [] })).toThrow()
    expect(() => PageUndoHistorySchema.parse({ past: [[{ id: 'bad id', type: 'paragraph', props: {}, style: {}, children: [] }]], future: [] })).toThrow()
    const largeTree = Array.from({ length: 10 }, (_, index) => ({ id: `large-${index}`, type: 'paragraph' as const, props: { text: 'x'.repeat(2000) }, style: {}, children: [] }))
    expect(() => PageUndoHistorySchema.parse({ past: Array.from({ length: 40 }, () => largeTree), future: [] })).toThrow(/storage limit/)
  })

  it('validates recoverable project snapshots and rejects duplicate slugs and unsafe content', () => {
    const snapshot = {
      project: { name: 'Site', category: 'Business', templateId: 'business', settings: {} },
      pages: [{ sourceId: 'page-1', title: 'Home', slug: 'home', isHome: true, nodes: [] }],
    }
    expect(ProjectVersionSnapshotSchema.parse(snapshot).pages[0]?.slug).toBe('home')
    expect(() => ProjectVersionSnapshotSchema.parse({ ...snapshot, pages: [...snapshot.pages, { ...snapshot.pages[0], sourceId: 'page-2' }] })).toThrow(/unique/)
    expect(() => ProjectVersionSnapshotSchema.parse({ ...snapshot, pages: [{ ...snapshot.pages[0], nodes: [{ id: 'script', type: 'link', props: { href: 'javascript:alert(1)' }, style: {}, children: [] }] }] })).toThrow()
    expect(() => ProjectVersionSnapshotSchema.parse({ ...snapshot, pages: [...snapshot.pages, { sourceId: 'page-2', title: 'Other', slug: 'other', isHome: true, nodes: [] }] })).toThrow(/homepage/)
  })
})

describe('project design system', () => {
  it('normalizes legacy settings into a project-scoped system without changing brand choices', () => {
    const settings = ProjectSettingsSchema.parse({ primaryColor: '#123456', fontFamily: 'Georgia' })
    expect(settings.primaryColor).toBe('#123456')
    expect(settings.fontFamily).toBe('Georgia')
    expect(settings.designSystem?.palettes[0]?.tokens.find((token) => token.id === 'primary')?.value).toBe('#123456')
    expect(settings.designSystem?.typography.bodyFontFamily).toBe('Georgia')
    expect(settings.designSystem?.typography.presets.h3.fontWeight).toBe(650)
    expect(ProjectSettingsSchema.parse({ primaryColor: 'hsl(210 50% 40%)' }).primaryColor).toBe('hsl(210 50% 40%)')
  })

  it('keeps live preview CSS safe while a manager field contains an incomplete value', () => {
    const draft = createDefaultDesignSystem()
    draft.spacingTokens[0]!.value = ''
    expect(safeDesignSystemCss(draft)).toBe('')
  })

  it('lets starter buttons, cards, and navigation inherit the global design system', () => {
    const nodes = templateById('business').nodes
    const nav = nodes.find((node) => node.id === 'nav')!
    const heroButton = nodes.find((node) => node.id === 'hero')!.children.find((node) => node.id === 'hero-button')!
    const featureCard = nodes.find((node) => node.id === 'features')!.children.find((node) => node.id === 'feature-1')!
    expect(nav.style).toEqual({})
    expect(heroButton.style).toEqual({})
    expect(featureCard.style).toEqual({})
  })

  it('rejects duplicate and unsafe tokens and enforces bounded collections and weight steps', () => {
    const defaults = createDefaultDesignSystem()
    const duplicate = structuredClone(defaults)
    duplicate.palettes[0]!.tokens[1]!.id = duplicate.palettes[0]!.tokens[0]!.id
    expect(() => DesignSystemSchema.parse(duplicate)).toThrow(/unique/)

    const unsafe = structuredClone(defaults)
    unsafe.globalStyles.button.boxShadow = '0; color:red'
    expect(() => DesignSystemSchema.parse(unsafe)).toThrow(/prohibited/)

    const invalidColor = structuredClone(defaults)
    invalidColor.palettes[0]!.tokens[0]!.value = 'url(javascript:alert(1))'
    expect(() => DesignSystemSchema.parse(invalidColor)).toThrow()

    const invalidId = structuredClone(defaults)
    invalidId.palettes[0]!.tokens[0]!.id = 'Invalid_ID'
    expect(() => DesignSystemSchema.parse(invalidId)).toThrow()

    const longName = structuredClone(defaults)
    longName.palettes[0]!.tokens[0]!.name = 'x'.repeat(49)
    expect(() => DesignSystemSchema.parse(longName)).toThrow()

    const tooManyColors = structuredClone(defaults)
    tooManyColors.palettes[0]!.tokens = Array.from({ length: 33 }, (_, index) => ({ id: `color-${index}`, name: `Color ${index}`, value: '#112233' }))
    expect(() => DesignSystemSchema.parse(tooManyColors)).toThrow()

    const invalidWeight = structuredClone(defaults)
    invalidWeight.typography.presets.h3.fontWeight = 675
    expect(() => DesignSystemSchema.parse(invalidWeight)).toThrow()

    const excessive = structuredClone(defaults)
    excessive.spacingTokens = Array.from({ length: 33 }, (_, index) => ({ id: `space-${index}`, name: `Space ${index}`, value: '1rem' }))
    expect(() => DesignSystemSchema.parse(excessive)).toThrow()

    const excessivePalettes = structuredClone(defaults)
    excessivePalettes.palettes = Array.from({ length: 13 }, (_, index) => ({ ...defaults.palettes[0]!, id: `palette-${index}`, name: `Palette ${index}` }))
    expect(() => DesignSystemSchema.parse(excessivePalettes)).toThrow()
  })

  it('emits shared variables and keeps element token references valid in preview and exported CSS', () => {
    const system = createDefaultDesignSystem('#aa2244', 'Arial')
    system.spacingTokens.find((token) => token.id === 'md')!.value = '1.25rem'
    const css = designSystemCss(system)
    expect(css).toContain('--wc-color-primary:#aa2244')
    expect(css).toContain('--wc-primary:var(--wc-color-primary)')
    expect(css).toContain('--wc-spacing-md:1.25rem')
    expect(css).toContain('.wc-heading-level-3{font-family:var(--wc-typography-heading-font-family)')

    const style = { color: 'var(--wc-color-primary)', padding: 'var(--wc-spacing-md)', width: 'var(--wc-size-container-md)' }
    const nodes = validateTree([{ id: 'token-heading', type: 'heading', props: { text: 'Tokenized', level: 3 }, style, children: [] }])
    expect(styleDeclarations(nodes[0]!.style)).toContain('color:var(--wc-color-primary)')
    const customCss = '.wc-site{background:#010203}'
    const files = generateSource({ name: 'Tokens', settings: { designSystem: system, customCss }, pages: [{ title: 'Home', slug: 'home', isHome: true, nodes }] })
    const exportedCss = files['src/styles.css']!.content
    expect(exportedCss).toContain('--wc-color-primary:#aa2244')
    expect(exportedCss).toContain('--wc-spacing-md:1.25rem')
    expect(exportedCss.lastIndexOf(customCss)).toBeGreaterThan(exportedCss.indexOf('.wc-site{min-height:100%'))
    expect(files['src/components/SiteRenderer.tsx']!.content).toContain('className="wc-site"')
    expect(files['src/components/SiteRenderer.tsx']!.content).toContain('wc-heading-level-')
    expect(JSON.parse(files['src/site.json']!.content).pages[0].nodes[0].style.color).toBe('var(--wc-color-primary)')
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

describe('marketplace package validation', () => {
  const componentPackage = (): any => ({
    format: 'webcraft', formatVersion: 1, packageId: 'hero-pack', type: 'component', name: 'Hero block', description: 'A safe structured hero.', version: '1.0.0',
    category: 'Hero sections', components: [{ id: 'hero', name: 'Hero', nodes: [{ id: 'hero-node', type: 'hero', props: { text: 'Welcome' }, style: {}, children: [] }] }], assets: [],
  })
  const templatePackage = (): any => ({
    format: 'webcraft', formatVersion: 1, packageId: 'starter-site', type: 'template', name: 'Starter site', description: 'One-page start.', version: '1.0.0', category: 'Business',
    settings: {}, pages: [{ title: 'Home', slug: 'home', isHome: true, nodes: [] }], assets: [],
  })

  it('validates and round-trips strict component packages with format compatibility defaults', () => {
    const parsed = ComponentPackageSchema.parse(componentPackage())
    expect(parsed.compatibility.minBuilderVersion).toBe('0.1.0')
    expect(MarketplacePackageSchema.parse(JSON.parse(packageForJsonExport(parsed))).type).toBe('component')
    expect(() => ComponentPackageSchema.parse({ ...componentPackage(), executable: 'alert(1)' })).toThrow()
    expect(() => ComponentPackageSchema.parse({ ...componentPackage(), version: 'latest' })).toThrow()
  })

  it('tracks media references with query strings and fragments in component trees and template CSS', () => {
    const asset = { filename: 'mark.png', mimeType: 'image/png', contentBase64: 'iVBORw0KGgo=' }
    const template = templatePackage()
    template.settings = { customCss: ".hero{background-image:url('/media/mark.png?width=320#hero')}" }
    expect(() => TemplatePackageSchema.parse(template)).toThrow(/missing from the package/)
    template.assets = [asset]
    expect(TemplatePackageSchema.parse(template).assets).toHaveLength(1)

    const component = componentPackage()
    component.components[0]!.nodes[0]!.props.src = '/media/mark.png?width=320#hero'
    expect(() => ComponentPackageSchema.parse(component)).toThrow(/missing from the package/)
    component.assets = [asset]
    expect(ComponentPackageSchema.parse(component).assets).toHaveLength(1)
  })

  it('rejects unsafe component trees and media references that are missing from package assets', () => {
    const unsafe = componentPackage()
    unsafe.components[0]!.nodes[0]!.props.href = 'javascript:alert(1)'
    expect(() => ComponentPackageSchema.parse(unsafe)).toThrow()

    const missingAsset = componentPackage()
    missingAsset.components[0]!.nodes[0] = { id: 'hero-image', type: 'image', props: { src: '/media/missing.png', alt: 'Example' }, style: {}, children: [] }
    expect(() => ComponentPackageSchema.parse(missingAsset)).toThrow(/missing from the package/)
  })

  it('requires exactly one homepage and validates the full settings and page tree in a template package', () => {
    expect(TemplatePackageSchema.parse(templatePackage()).settings.designSystem).toBeDefined()
    const duplicateHome = templatePackage()
    duplicateHome.pages.push({ title: 'Second home', slug: 'about', isHome: true, nodes: [] })
    expect(() => TemplatePackageSchema.parse(duplicateHome)).toThrow(/exactly one homepage/)
    const missingCssAsset = templatePackage()
    missingCssAsset.settings.customCss = 'body{background:url("/media/missing.png")}'
    expect(() => TemplatePackageSchema.parse(missingCssAsset)).toThrow(/missing from the package/)
  })

  it('checks package format compatibility and project token requirements', () => {
    const parsed = ComponentPackageSchema.parse({ ...componentPackage(), compatibility: { minBuilderVersion: '0.2.0' } })
    expect(packageCompatibilityError(parsed)).toMatch(/requires WebCraft 0.2.0/)

    const nodes = [{ id: 'token-node', type: 'heading' as const, props: {}, style: { color: 'var(--wc-color-custom)', padding: 'var(--wc-spacing-huge)' }, children: [] }]
    expect(missingDesignTokens(nodes, {}).map((token) => `${token.group}:${token.id}`)).toEqual(['color:custom', 'spacing:huge'])
    expect(missingDesignTokens(nodes, { designSystem: createDefaultDesignSystem() })).toEqual([{ group: 'color', id: 'custom' }, { group: 'spacing', id: 'huge' }])
  })

  it('rejects asset MIME/extension mismatches and invalid base64', () => {
    const pkg = componentPackage()
    pkg.assets = [{ filename: 'mark.png', mimeType: 'image/jpeg', contentBase64: 'aGVsbG8=' }]
    expect(() => ComponentPackageSchema.parse(pkg)).toThrow(/MIME type does not match/)
    pkg.assets = [{ filename: 'mark.png', mimeType: 'image/png', contentBase64: 'not base64!' }]
    expect(() => ComponentPackageSchema.parse(pkg)).toThrow(/valid base64/)
  })

  it('checks embedded raster image signatures against the declared MIME type', () => {
    const pkg = componentPackage()
    pkg.components[0]!.nodes[0] = { id: 'hero-image', type: 'image', props: { src: '/media/mark.png', alt: 'Mark' }, style: {}, children: [] }
    pkg.assets = [{ filename: 'mark.png', mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC' }]
    expect(ComponentPackageSchema.parse(pkg).assets).toHaveLength(1)
    pkg.assets[0]!.contentBase64 = 'aGVsbG8='
    expect(() => ComponentPackageSchema.parse(pkg)).toThrow(/image bytes do not match/)
  })
})
