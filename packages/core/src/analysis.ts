import type { BuilderNode, ProjectSettings } from './schema'
import { ProjectSettingsSchema } from './schema'
import type { ExportPage, GeneratedFile } from './exporter'

type AnalysisCategory = 'seo' | 'performance' | 'accessibility'
export type AnalysisSeverity = 'error' | 'warning' | 'info'
export type AnalysisFinding = {
  code: string
  category: AnalysisCategory
  severity: AnalysisSeverity
  message: string
  recommendation: string
  pageSlug?: string
  pageTitle?: string
  nodeId?: string
  evidence?: string
}
export type AnalysisSection = {
  findings: AnalysisFinding[]
  summary: { errors: number; warnings: number; info: number }
  metrics: Record<string, number | string | boolean>
  unavailable: string[]
}
export type WebsiteAnalysisReport = {
  version: 1
  mode: 'static-generated-source'
  projectName: string
  pageCount: number
  generatedFileCount: number
  seo: AnalysisSection
  performance: AnalysisSection
  accessibility: AnalysisSection
}
export type WebsiteAnalysisInput = {
  projectName: string
  settings: unknown
  pages: ExportPage[]
  files: Record<string, GeneratedFile>
  productionArtifacts?: Record<string, number>
}

const MAX_FINDINGS_PER_CATEGORY = 300
const MiB = 1024 * 1024
const textBytes = (value: string) => new TextEncoder().encode(value).byteLength
const base64Bytes = (value: string) => Math.max(0, Math.floor(value.length * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0))
const effectiveTitle = (page: ExportPage, settings: ProjectSettings) => (page.seoTitle?.trim() || (page.isHome ? settings.title.trim() : page.title.trim()) || settings.title.trim()).slice(0, 120)
const effectiveDescription = (page: ExportPage, settings: ProjectSettings) => (page.seoDescription?.trim() || settings.description.trim()).slice(0, 300)

function makeSection(category: AnalysisCategory, metrics: Record<string, number | string | boolean>, unavailable: string[]) {
  const findings: AnalysisFinding[] = []
  let omitted = 0
  return {
    metrics,
    add(input: Omit<AnalysisFinding, 'category'>) {
      if (findings.length >= MAX_FINDINGS_PER_CATEGORY) { omitted += 1; return }
      findings.push({ ...input, category })
    },
    finish(): AnalysisSection {
      if (omitted) findings.push({ category, code: `${category.toUpperCase()}_FINDINGS_TRUNCATED`, severity: 'info', message: `${omitted} additional findings were omitted to keep this report bounded.`, recommendation: 'Fix the highest-priority findings first, then run the analysis again.' })
      return {
        findings,
        summary: {
          errors: findings.filter((finding) => finding.severity === 'error').length,
          warnings: findings.filter((finding) => finding.severity === 'warning').length,
          info: findings.filter((finding) => finding.severity === 'info').length,
        },
        metrics,
        unavailable,
      }
    },
  }
}

function flattenNodes(nodes: BuilderNode[], out: BuilderNode[] = []): BuilderNode[] {
  for (const node of nodes) { out.push(node); flattenNodes(node.children, out) }
  return out
}
function routeFor(page: ExportPage, homeSlug: string) { return page.slug === homeSlug ? '/' : `/${page.slug}` }
function internalPageTarget(href: string, pages: ExportPage[], homeSlug: string): ExportPage | undefined {
  if (!href.startsWith('/') || href.startsWith('//')) return undefined
  let path = ''
  try { path = new URL(href, 'https://webcraft.invalid').pathname } catch { return undefined }
  if (path === '/') return pages.find((page) => page.slug === homeSlug)
  if (path.endsWith('/')) path = path.slice(0, -1)
  const slug = path.slice(1)
  return pages.find((page) => page.slug === slug && routeFor(page, homeSlug) === path)
}
function isInternalPath(href: string) { return href.startsWith('/') && !href.startsWith('//') }
function nodeText(node: BuilderNode): string { return typeof node.props.text === 'string' ? node.props.text.trim() : '' }
function hasAccessibleContent(node: BuilderNode): boolean {
  if (node.type === 'image') return Boolean(node.props.alt?.trim())
  if (node.type === 'icon') return true
  if (nodeText(node)) return true
  return node.children.some(hasAccessibleContent)
}
function aggregatePages(pages: ExportPage[]) {
  return pages.map((page) => ({ page, nodes: flattenNodes(page.nodes) }))
}

export function analyzeWebsite(input: WebsiteAnalysisInput): WebsiteAnalysisReport {
  if (!input.projectName.trim() || input.projectName.length > 120) throw new Error('Analysis project name is invalid')
  if (!Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > 100) throw new Error('Analysis requires 1–100 validated pages')
  const settings = ProjectSettingsSchema.parse(input.settings ?? {})
  const pages = input.pages
  const files = input.files
  const home = pages.find((page) => page.isHome) ?? pages[0]!
  const flattened = aggregatePages(pages)
  const allNodes = flattened.flatMap((entry) => entry.nodes)
  const sourceFiles = Object.entries(files).filter(([path, file]) => file.encoding === 'utf-8' && !path.startsWith('public/assets/'))
  const assetFiles = Object.entries(files).filter(([path, file]) => path.startsWith('public/assets/') && file.encoding === 'base64')
  const sourceBytes = sourceFiles.reduce((sum, [, file]) => sum + textBytes(file.content), 0)
  const assetBytes = assetFiles.reduce((sum, [, file]) => sum + base64Bytes(file.content), 0)
  const jsSourceBytes = sourceFiles.filter(([path]) => /\.(?:tsx?|jsx?)$/i.test(path)).reduce((sum, [, file]) => sum + textBytes(file.content), 0)
  const cssSourceBytes = sourceFiles.filter(([path]) => path.endsWith('.css')).reduce((sum, [, file]) => sum + textBytes(file.content), 0)
  const css = files['src/styles.css']?.content ?? ''
  const html = files['index.html']?.content ?? ''
  const robots = files['robots.txt']?.content ?? ''
  const sitemap = files['sitemap.xml']?.content ?? ''

  const seo = makeSection('seo', {
    pages: pages.length,
    pagesWithPageTitle: pages.filter((page) => Boolean(effectiveTitle(page, settings))).length,
    pagesWithEffectiveDescription: pages.filter((page) => Boolean(effectiveDescription(page, settings))).length,
    canonicalOriginConfigured: Boolean(settings.siteUrl),
    canonicalLinkGenerated: /<link\s+rel="canonical"\s+href=/i.test(html),
    sitemapGenerated: Boolean(sitemap),
    robotsFileGenerated: Boolean(robots),
    structuredDataConfigured: Boolean(settings.structuredData.trim()),
    openGraphTagsGenerated: /property="og:title"/i.test(html) && /property="og:description"/i.test(html),
    twitterCardGenerated: /name="twitter:card"/i.test(html),
  }, [
    'This output is a client-rendered single-page application. Page-specific titles, descriptions, canonical URLs, and social tags are updated after JavaScript hydrates; this report does not test search-engine rendering or crawler behavior.',
    'Search ranking, indexing, rich-result eligibility, backlinks, and search-console status are not available from project data.',
    'Structured data is a project-level JSON-LD object only; page-specific schema is not inferred from page content.',
  ])

  const effectiveTitles = new Map<string, ExportPage[]>()
  const effectiveDescriptions = new Map<string, ExportPage[]>()
  for (const { page, nodes } of flattened) {
    const title = effectiveTitle(page, settings)
    const description = effectiveDescription(page, settings)
    const normalizedTitle = title.toLocaleLowerCase()
    const normalizedDescription = description.toLocaleLowerCase()
    if (title) effectiveTitles.set(normalizedTitle, [...(effectiveTitles.get(normalizedTitle) ?? []), page])
    if (description) effectiveDescriptions.set(normalizedDescription, [...(effectiveDescriptions.get(normalizedDescription) ?? []), page])
    if (!title) seo.add({ code: 'SEO_TITLE_MISSING', severity: 'error', pageSlug: page.slug, pageTitle: page.title, message: 'This page has no effective title for its search and browser metadata.', recommendation: 'Add a page SEO title or a project website title.' })
    else if (title.length > 60) seo.add({ code: 'SEO_TITLE_LONG', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, evidence: `${title.length} characters`, message: 'The effective page title is longer than the common 50–60 character display guideline.', recommendation: 'Shorten the page SEO title while keeping its main topic and brand.' })
    if (!description) seo.add({ code: 'SEO_DESCRIPTION_MISSING', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, message: 'This page has no effective meta description.', recommendation: 'Add a concise page description or a project-wide fallback description.' })
    else if (description.length > 160) seo.add({ code: 'SEO_DESCRIPTION_LONG', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, evidence: `${description.length} characters`, message: 'The effective page description is longer than the common 150–160 character display guideline.', recommendation: 'Trim the description to its most useful summary.' })
    else if (description.length < 50) seo.add({ code: 'SEO_DESCRIPTION_SHORT', severity: 'info', pageSlug: page.slug, pageTitle: page.title, evidence: `${description.length} characters`, message: 'The effective page description is short compared with common search-snippet guidance.', recommendation: 'Consider adding a little more specific context, without padding it with keywords.' })
    if (page.slug.length > 50) seo.add({ code: 'SEO_SLUG_LONG', severity: 'info', pageSlug: page.slug, pageTitle: page.title, evidence: `${page.slug.length} characters`, message: 'This page URL slug is longer than 50 characters.', recommendation: 'Consider a shorter, descriptive slug if it does not break existing links.' })
    const headings = nodes.filter((node) => node.type === 'heading')
    const h1Count = headings.filter((node) => (node.props.level ?? 2) === 1).length
    if (h1Count === 0) seo.add({ code: 'SEO_NO_H1', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, message: 'No explicit H1 heading is present in the page component tree.', recommendation: 'Add one clear H1 that describes the page’s main topic.' })
    if (h1Count > 1) seo.add({ code: 'SEO_MULTIPLE_H1', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, evidence: `${h1Count} H1 headings`, message: 'This page contains more than one H1 heading.', recommendation: 'Use one primary H1 and use H2–H6 for subordinate sections.' })
    for (const node of nodes) {
      if (node.type !== 'link' && node.type !== 'button') continue
      const href = node.props.href?.trim() ?? ''
      if (!href || href === '#' || href.startsWith('//')) {
        seo.add({ code: 'SEO_LINK_TARGET_MISSING', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, nodeId: node.id, message: 'This link has no usable destination in the generated site.', recommendation: 'Set a valid URL, local page path, mailto, or telephone link.' })
      } else if (isInternalPath(href) && !internalPageTarget(href, pages, home.slug) && !/^\/(?:#|\?)/.test(href)) {
        seo.add({ code: 'SEO_INTERNAL_LINK_TARGET_UNKNOWN', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, nodeId: node.id, evidence: href.slice(0, 180), message: 'This internal link does not match a generated page route.', recommendation: 'Correct the path or create the target page. In-page anchors are not resolved by this static check.' })
      }
    }
  }
  for (const group of effectiveTitles.values()) if (group.length > 1) for (const page of group.slice(1)) seo.add({ code: 'SEO_DUPLICATE_TITLE', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, message: 'This page shares its effective title with another page.', recommendation: 'Give each page a distinct, descriptive SEO title.' })
  for (const group of effectiveDescriptions.values()) if (group.length > 1) for (const page of group.slice(1)) seo.add({ code: 'SEO_DUPLICATE_DESCRIPTION', severity: 'info', pageSlug: page.slug, pageTitle: page.title, message: 'This page shares its effective description with another page.', recommendation: 'Use a page-specific description when the pages cover different content.' })
  if (!settings.siteUrl) seo.add({ code: 'SEO_PUBLIC_ORIGIN_MISSING', severity: 'warning', message: 'No public site origin is configured, so absolute canonical URLs and an absolute-URL sitemap cannot be generated.', recommendation: 'Set the live HTTP(S) site origin in Website Settings after you know the public domain.' })
  else {
    if (!/<link\s+rel="canonical"\s+href=/i.test(html)) seo.add({ code: 'SEO_CANONICAL_NOT_FOUND', severity: 'error', message: 'The generated HTML is missing its configured canonical link.', recommendation: 'Regenerate the site after confirming the public site origin is saved.' })
    if (!sitemap) seo.add({ code: 'SEO_SITEMAP_NOT_FOUND', severity: 'error', message: 'No sitemap.xml was found in generated source.', recommendation: 'Regenerate the site with a valid public site origin.' })
    else if (!sitemap.includes(settings.siteUrl)) seo.add({ code: 'SEO_SITEMAP_ORIGIN_MISMATCH', severity: 'error', message: 'The generated sitemap does not contain the configured public origin.', recommendation: 'Check the public site origin and regenerate the site.' })
    if (!robots.includes('Sitemap:')) seo.add({ code: 'SEO_ROBOTS_SITEMAP_MISSING', severity: 'warning', message: 'robots.txt does not point crawlers to the generated sitemap.', recommendation: 'Regenerate the site after saving the public site origin.' })
  }
  if (!robots) seo.add({ code: 'SEO_ROBOTS_NOT_FOUND', severity: 'warning', message: 'No robots.txt file was found in generated source.', recommendation: 'Regenerate the site so the standard robots.txt file is included.' })
  if (!settings.socialImagePath) seo.add({ code: 'SEO_SOCIAL_IMAGE_MISSING', severity: 'warning', message: 'No social sharing image is selected for Open Graph and Twitter previews.', recommendation: 'Choose a suitable project image in Website Settings; it will be emitted as an absolute social image when the public origin is configured.' })
  if (!settings.structuredData.trim()) seo.add({ code: 'SEO_STRUCTURED_DATA_NOT_CONFIGURED', severity: 'info', message: 'No JSON-LD structured data is configured.', recommendation: 'If the site represents eligible content or an organization, add an accurate schema.org object in Website Settings; do not add schema that does not match the visible site.' })
  else if (!html.includes('application/ld+json')) seo.add({ code: 'SEO_STRUCTURED_DATA_NOT_EMITTED', severity: 'error', message: 'Structured data is configured but was not found in generated HTML.', recommendation: 'Regenerate the site and verify its JSON-LD output.' })
  if (!/name="twitter:card"/i.test(html)) seo.add({ code: 'SEO_TWITTER_CARD_MISSING', severity: 'error', message: 'The generated HTML has no Twitter Card declaration.', recommendation: 'Regenerate the site so the standard card metadata is included.' })
  if (!/property="og:title"/i.test(html) || !/property="og:description"/i.test(html)) seo.add({ code: 'SEO_OPEN_GRAPH_INCOMPLETE', severity: 'warning', message: 'The generated HTML is missing default Open Graph title or description tags.', recommendation: 'Regenerate the site and confirm no custom metadata has replaced these defaults.' })
  seo.add({ code: 'SEO_CLIENT_RENDERED_METADATA', severity: 'info', message: 'Per-page metadata is updated in the browser after the generated React application hydrates.', recommendation: 'If reliable no-JavaScript crawler previews are required, use a prerendering or server-rendering deployment pipeline.' })

  const largestAssets = assetFiles.map(([path, file]) => ({ path, bytes: base64Bytes(file.content) })).sort((a, b) => b.bytes - a.bytes)
  const imageNodes = allNodes.filter((node) => node.type === 'image')
  const remoteImageNodes = imageNodes.filter((node) => /^https?:\/\//i.test(node.props.src ?? '')).length
  const performance = makeSection('performance', {
    generatedFiles: Object.keys(files).length,
    generatedTextSourceBytes: sourceBytes,
    generatedAssetBytes: assetBytes,
    generatedSourceAndAssetBytes: sourceBytes + assetBytes,
    generatedJavaScriptTypeScriptSourceBytes: jsSourceBytes,
    generatedCssSourceBytes: cssSourceBytes,
    imageAssets: assetFiles.length,
    imageNodes: imageNodes.length,
    remoteImageNodes,
    oversizedImageAssets: largestAssets.filter((asset) => asset.bytes > MiB).length,
    customCssBytes: textBytes(settings.customCss),
    productionBuildMeasured: Boolean(input.productionArtifacts),
    ...(input.productionArtifacts ?? {}),
  }, [
    'No Lighthouse or other browser-based lab audit is run, so this report does not contain a Lighthouse score or lab CWV values.',
    'Core Web Vitals (LCP, INP, CLS), FCP, TTFB, real-device behavior, network waterfalls, and cache behavior are not measured. Field CWV require real field data from deployed users; they are not inferred from source or build files.',
    'The reported gzip sizes are computed from local production build files. Actual transfer sizes can differ based on deployment compression, CDN settings, headers, and content negotiation.',
    ...(input.productionArtifacts ? [] : ['Production bundle output and compressed artifact sizes were not measured for this report.']),
    'Browser rendering, route navigation, and render-blocking behavior after Vite production bundling are not simulated.',
  ])
  const productionArtifacts = input.productionArtifacts
  if (productionArtifacts?.javascriptBundleBytes !== undefined && productionArtifacts.javascriptBundleBytes > 500 * 1024) {
    performance.add({ code: 'PERF_PRODUCTION_JS_BUNDLE_LARGE', severity: 'warning', evidence: `${formatBytes(productionArtifacts.javascriptBundleBytes)} across generated JavaScript bundles`, message: 'The generated production JavaScript bundles exceed 500 KiB before transfer compression.', recommendation: 'Review the generated bundle and project features; split or remove code only if you maintain the exported site build.' })
  }
  if (productionArtifacts?.gzipJavaScriptBytes !== undefined && productionArtifacts.gzipJavaScriptBytes > 200 * 1024) {
    performance.add({ code: 'PERF_GZIP_JS_BUNDLE_LARGE', severity: 'warning', evidence: `${formatBytes(productionArtifacts.gzipJavaScriptBytes)} measured with gzip`, message: 'The generated JavaScript bundles exceed 200 KiB when individually gzip-compressed.', recommendation: 'Review the production bundle and consider reducing code or loading non-critical features later in the exported site.' })
  }
  for (const asset of largestAssets.filter((item) => item.bytes > MiB)) performance.add({ code: 'PERF_IMAGE_ASSET_LARGE', severity: 'warning', evidence: `${asset.path.replace(/^public\//, '')} · ${formatBytes(asset.bytes)}`, message: 'This generated image asset is larger than 1 MiB.', recommendation: 'Resize it to the display dimensions and compress it or export a modern WebP image before uploading.' })
  if (assetBytes > 3 * MiB) performance.add({ code: 'PERF_TOTAL_IMAGE_BYTES_HIGH', severity: 'warning', evidence: formatBytes(assetBytes), message: 'The generated project contains more than 3 MiB of image files.', recommendation: 'Review image dimensions and formats, then remove or compress assets that are not needed.' })
  if (textBytes(settings.customCss) > 8 * 1024) performance.add({ code: 'PERF_CUSTOM_CSS_LARGE', severity: 'info', evidence: `${textBytes(settings.customCss)} bytes`, message: 'Custom CSS is larger than 8 KiB.', recommendation: 'Remove obsolete rules and consolidate repeated declarations.' })
  if (remoteImageNodes) performance.add({ code: 'PERF_REMOTE_IMAGES', severity: 'info', evidence: `${remoteImageNodes} image component(s)`, message: 'Some image components depend on external hosts and are not included in the generated assets.', recommendation: 'Self-host images when availability, privacy, or consistent loading performance matters.' })
  const optionalSelectors = [
    { selector: '.wc-node.wc-button', used: allNodes.some((node) => node.type === 'button') || allNodes.some((node) => node.type === 'contact-form' || node.type === 'newsletter') },
    { selector: '.wc-node.wc-link', used: allNodes.some((node) => node.type === 'link') },
    { selector: '.wc-node.wc-card', used: allNodes.some((node) => node.type === 'card') },
    { selector: '.wc-node.wc-navbar', used: allNodes.some((node) => node.type === 'navbar') },
    { selector: '.wc-node input', used: allNodes.some((node) => node.type === 'contact-form' || node.type === 'newsletter') },
    ...[1, 2, 3, 4, 5, 6].map((level) => ({ selector: `.wc-node.wc-heading-level-${level}`, used: allNodes.some((node) => node.type === 'heading' && (node.props.level ?? 2) === level) })),
  ]
  const unusedSelectors = optionalSelectors.filter((item) => !item.used && css.includes(item.selector)).map((item) => item.selector)
  if (unusedSelectors.length) performance.add({ code: 'PERF_UNUSED_GENERATED_CSS_RULES', severity: 'info', evidence: unusedSelectors.join(', '), message: `${unusedSelectors.length} known generated component or heading style rule(s) have no matching component in the saved pages.`, recommendation: 'This is an estimate for WebCraft-generated selectors only; custom CSS is not tree-shaken. Remove unused design rules only if you maintain the exported source yourself.' })
  if (!/loading="lazy"/.test(files['src/components/SiteRenderer.tsx']?.content ?? '')) performance.add({ code: 'PERF_IMAGE_LAZY_LOADING_NOT_FOUND', severity: 'warning', message: 'The generated image renderer does not declare lazy loading.', recommendation: 'Regenerate the site with the current renderer or add loading="lazy" for below-the-fold images.' })
  else performance.add({ code: 'PERF_IMAGE_LAZY_LOADING', severity: 'info', evidence: 'Generated image nodes use loading="lazy".', message: 'The generated renderer requests image lazy loading.', recommendation: 'Keep important above-the-fold images in mind; this static analysis cannot determine image position or loading priority.' })
  if (!files['src/App.tsx']?.content.includes('react-router-dom')) performance.add({ code: 'PERF_ROUTER_SOURCE_NOT_FOUND', severity: 'warning', message: 'The generated route source was not found in the expected location.', recommendation: 'Regenerate the site and rerun the analysis.' })

  const accessibility = makeSection('accessibility', {
    pages: pages.length,
    imageComponents: imageNodes.length,
    imagesWithNonemptyAlt: imageNodes.filter((node) => Boolean(node.props.alt?.trim())).length,
    headingComponents: allNodes.filter((node) => node.type === 'heading').length,
    builtInForms: allNodes.filter((node) => node.type === 'contact-form' || node.type === 'newsletter').length,
    contrastPairsAnalyzed: 0,
    contrastPairsNotAnalyzed: 0,
  }, [
    'Keyboard order, focus visibility in a browser, interactive behavior, screen-reader output, and assistive-technology compatibility require runtime/manual testing.',
    'Custom ARIA attributes and arbitrary custom HTML are not represented in the current page model, so their validity cannot be checked.',
    'Built-in contact/newsletter forms can be inspected, but external form integrations and browser validation states are not modeled.',
    settings.customCss.trim() ? 'Project custom CSS is present; it can override generated or inline colors, so contrast findings are skipped for this report.' : 'Contrast analysis covers only colors that can be resolved from saved node styles and the active design-system palette; gradients, alpha blending, browser styles, and color changes introduced outside this project model are not evaluated.',
  ])
  let pagesWithoutH1 = 0
  let skippedHeadingLevels = 0
  let emptyHeadings = 0
  let imagesWithoutAlt = 0
  let emptyLinks = 0
  for (const { page, nodes } of flattened) {
    const headings = nodes.filter((node) => node.type === 'heading')
    const h1Count = headings.filter((node) => (node.props.level ?? 2) === 1).length
    if (!h1Count) pagesWithoutH1 += 1
    let previousLevel = 0
    for (const node of headings) {
      const level = node.props.level ?? 2
      if (previousLevel && level > previousLevel + 1) {
        skippedHeadingLevels += 1
        accessibility.add({ code: 'ACCESSIBILITY_HEADING_LEVEL_SKIPPED', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, nodeId: node.id, evidence: `H${previousLevel} → H${level}`, message: 'The heading sequence skips one or more levels.', recommendation: 'Use heading levels in order to reflect the page structure, not visual size.' })
      }
      previousLevel = level
      if (!nodeText(node)) {
        emptyHeadings += 1
        accessibility.add({ code: 'ACCESSIBILITY_EMPTY_HEADING', severity: 'error', pageSlug: page.slug, pageTitle: page.title, nodeId: node.id, evidence: `H${level}`, message: 'This heading has no readable text.', recommendation: 'Add a short heading that describes the section.' })
      }
    }
    for (const node of nodes) {
      if (node.type === 'image') {
        if (!node.props.alt?.trim()) {
          imagesWithoutAlt += 1
          accessibility.add({ code: 'ACCESSIBILITY_IMAGE_ALT_MISSING', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, nodeId: node.id, message: 'This image has blank alternative text; the analyzer cannot tell whether it is informative or decorative.', recommendation: 'Add concise alt text for informative images. Leave alt blank only when the image is decorative and conveys no information.' })
        }
      }
      if (node.type === 'link' || node.type === 'button') {
        const href = node.props.href?.trim() ?? ''
        if (!nodeText(node) && !node.children.some(hasAccessibleContent)) {
          emptyLinks += 1
          accessibility.add({ code: 'ACCESSIBILITY_LINK_NAME_MISSING', severity: 'error', pageSlug: page.slug, pageTitle: page.title, nodeId: node.id, message: 'This generated link has no visible text or child content to provide an accessible name.', recommendation: 'Add descriptive link text; do not use a bare symbol without an accessible label.' })
        }
        if (!href || href === '#') accessibility.add({ code: node.type === 'button' ? 'ACCESSIBILITY_BUTTON_NO_DESTINATION' : 'ACCESSIBILITY_LINK_PLACEHOLDER', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, nodeId: node.id, message: node.type === 'button' ? 'This Button component is rendered as a link and currently points to #.' : 'This link currently points to # and does not take users to meaningful content.', recommendation: 'Set a real destination. For actions that do not navigate, the current page model does not provide an action-handler button.' })
      }
    }
  }
  if (pagesWithoutH1) accessibility.add({ code: 'ACCESSIBILITY_PAGE_WITHOUT_H1', severity: 'warning', evidence: `${pagesWithoutH1} of ${pages.length} page(s)`, message: 'One or more pages have no explicit H1 heading.', recommendation: 'Add one clear H1 heading per page, followed by logically nested section headings.' })
  const contrast = inspectContrast(settings, pages.map((page) => ({ page, nodes: page.nodes })), accessibility)
  accessibility.metrics.contrastPairsAnalyzed = contrast.analyzed
  accessibility.metrics.contrastPairsNotAnalyzed = contrast.notAnalyzed
  accessibility.metrics.pagesWithoutH1 = pagesWithoutH1
  accessibility.metrics.headingLevelsSkipped = skippedHeadingLevels
  accessibility.metrics.emptyHeadings = emptyHeadings
  accessibility.metrics.imagesWithoutAlt = imagesWithoutAlt
  accessibility.metrics.linksWithoutVisibleName = emptyLinks

  return {
    version: 1,
    mode: 'static-generated-source',
    projectName: input.projectName,
    pageCount: pages.length,
    generatedFileCount: Object.keys(files).length,
    seo: seo.finish(),
    performance: performance.finish(),
    accessibility: accessibility.finish(),
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MiB) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / MiB).toFixed(2)} MiB`
}

type RGB = [number, number, number]
function parseColor(value: string): RGB | null {
  const input = value.trim().toLowerCase()
  const hex = /^#([\da-f]{3,8})$/i.exec(input)?.[1]
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      if (hex.length === 4 && Number.parseInt(hex[3]!.repeat(2), 16) < 255) return null
      return [0, 1, 2].map((index) => Number.parseInt(hex[index]!.repeat(2), 16)) as RGB
    }
    if (hex.length === 6 || hex.length === 8) {
      if (hex.length === 8 && Number.parseInt(hex.slice(6), 16) < 255) return null
      return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as RGB
    }
    return null
  }
  const match = /^(rgb|rgba|hsl|hsla)\((.*)\)$/.exec(input)
  if (!match) return null
  const isHsl = match[1]!.startsWith('hsl')
  const raw = match[2]!.trim().replace(/,/g, ' ').replace(/\s*\/\s*/g, ' / ')
  const parts = raw.split(/\s+/)
  const slashAt = parts.indexOf('/')
  const alphaRaw = slashAt >= 0 ? parts[slashAt + 1] : parts.length === 4 ? parts[3] : undefined
  const components = parts.slice(0, slashAt >= 0 ? slashAt : 3)
  if (components.length !== 3) return null
  if (alphaRaw !== undefined) {
    const alpha = alphaRaw.endsWith('%') ? Number.parseFloat(alphaRaw) / 100 : Number.parseFloat(alphaRaw)
    if (!Number.isFinite(alpha) || alpha < 0.999) return null
  }
  if (isHsl) {
    const h = Number.parseFloat(components[0]!)
    const s = Number.parseFloat(components[1]!) / (components[1]!.endsWith('%') ? 100 : 1)
    const l = Number.parseFloat(components[2]!) / (components[2]!.endsWith('%') ? 100 : 1)
    if (![h, s, l].every(Number.isFinite) || s < 0 || s > 1 || l < 0 || l > 1 || !components[1]!.endsWith('%') || !components[2]!.endsWith('%')) return null
    const hue = ((h % 360) + 360) % 360 / 360
    const chroma = (1 - Math.abs(2 * l - 1)) * s
    const x = chroma * (1 - Math.abs((hue * 6) % 2 - 1))
    const m = l - chroma / 2
    const [r, g, b] = hue < 1 / 6 ? [chroma, x, 0] : hue < 2 / 6 ? [x, chroma, 0] : hue < 3 / 6 ? [0, chroma, x] : hue < 4 / 6 ? [0, x, chroma] : hue < 5 / 6 ? [x, 0, chroma] : [chroma, 0, x]
    return [r, g, b].map((channel) => Math.round((channel + m) * 255)) as RGB
  }
  const channels = components.map((channel) => {
    const parsed = Number.parseFloat(channel)
    return channel.endsWith('%') ? parsed * 2.55 : parsed
  })
  if (!channels.every(Number.isFinite) || channels.some((channel) => channel < 0 || channel > 255)) return null
  return channels.map(Math.round) as RGB
}
function luminance(rgb: RGB) {
  const linear = rgb.map((value) => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4 })
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}
function contrastRatio(foreground: RGB, background: RGB) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}
function kebab(value: string) { return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`) }
function resolveColor(value: string | undefined, variables: Record<string, string>, depth = 0): RGB | null {
  if (!value || depth > 6) return null
  const variable = /^var\(\s*(--[A-Za-z0-9_-]+)(?:\s*,\s*(.+))?\s*\)$/.exec(value.trim())
  if (variable) return resolveColor(variables[variable[1]!] ?? variable[2], variables, depth + 1)
  if (value.trim().toLowerCase() === 'transparent') return null
  return parseColor(value)
}
function fontSizePixels(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const match = /^([\d.]+)(px|rem|em)$/i.exec(value.trim())
  if (!match) return fallback
  const number = Number(match[1])
  return match[2]!.toLowerCase() === 'px' ? number : number * 16
}
function inspectContrast(settings: ProjectSettings, entries: { page: ExportPage; nodes: BuilderNode[] }[], section: ReturnType<typeof makeSection>) {
  const countCandidates = (nodes: BuilderNode[]): number => nodes.reduce((sum, node) => sum + (Boolean(nodeText(node)) || node.type === 'button' || node.type === 'link' ? 1 : 0) + countCandidates(node.children), 0)
  if (settings.customCss.trim()) return { analyzed: 0, notAnalyzed: entries.reduce((sum, entry) => sum + countCandidates(entry.nodes), 0) }
  const design = settings.designSystem!
  const palette = design.palettes.find((item) => item.id === design.activePaletteId)!
  const variables: Record<string, string> = {}
  for (const token of palette.tokens) variables[`--wc-color-${token.id}`] = token.value
  for (const [group, styles] of Object.entries(design.globalStyles)) for (const [key, value] of Object.entries(styles)) variables[`--wc-global-${group}-${kebab(key)}`] = value
  for (const [name, preset] of Object.entries(design.typography.presets)) variables[`--wc-typography-${name}-font-size`] = preset.fontSize
  const defaultForeground = resolveColor(variables['--wc-color-foreground'], variables)
  const defaultBackground = resolveColor(variables['--wc-color-background'], variables)
  let analyzed = 0
  let notAnalyzed = 0
  const check = (foreground: RGB | null, background: RGB | null, large: boolean, page: ExportPage, nodeId?: string, label?: string) => {
    if (!foreground || !background) { notAnalyzed += 1; return }
    analyzed += 1
    const ratio = contrastRatio(foreground, background)
    const threshold = large ? 3 : 4.5
    if (ratio + 0.01 < threshold) section.add({ code: 'ACCESSIBILITY_CONTRAST_LOW', severity: 'warning', pageSlug: page.slug, pageTitle: page.title, nodeId, evidence: `${label ? `${label}: ` : ''}${ratio.toFixed(2)}:1 contrast; target ${threshold}:1`, message: 'A modeled text/background color pair is below the WCAG AA contrast threshold.', recommendation: 'Choose a darker text color, a lighter background, or both, then check the rendered page manually.' })
  }
  const componentStyle = (type: string) => type === 'button' ? design.globalStyles.button : type === 'link' ? design.globalStyles.link : type === 'card' ? design.globalStyles.card : type === 'navbar' ? design.globalStyles.navigation : undefined
  const visit = (page: ExportPage, nodes: BuilderNode[], inheritedForeground: RGB | null, inheritedBackground: RGB | null) => {
    for (const node of nodes) {
      const global = componentStyle(node.type) as Record<string, string> | undefined
      const rawForeground = node.style.color ?? global?.color
      const rawBackground = node.style.backgroundColor ?? global?.backgroundColor
      const foreground = rawForeground === undefined ? inheritedForeground : resolveColor(rawForeground, variables)
      const isTransparent = rawBackground?.trim().toLowerCase() === 'transparent'
      const background = rawBackground === undefined || isTransparent
        ? inheritedBackground
        : resolveColor(rawBackground, variables)
      const text = nodeText(node)
      const hasRenderedText = Boolean(text) || node.type === 'button' || node.type === 'link'
      if (hasRenderedText && !['image', 'video', 'icon', 'divider', 'spacer'].includes(node.type)) {
        let size = fontSizePixels(node.style.fontSize, 16)
        let weight = Number(node.style.fontWeight ?? 400)
        if (node.type === 'heading') {
          const preset = design.typography.presets[`h${node.props.level ?? 2}` as keyof typeof design.typography.presets]
          size = fontSizePixels(node.style.fontSize ?? preset.fontSize, size)
          weight = Number(node.style.fontWeight ?? preset.fontWeight)
        }
        check(foreground, background, size >= 24 || (size >= 18.66 && weight >= 700), page, node.id, node.type)
      }
      visit(page, node.children, foreground, background)
    }
  }
  for (const { page, nodes } of entries) visit(page, nodes, defaultForeground, defaultBackground)
  if (notAnalyzed) section.add({ code: 'ACCESSIBILITY_CONTRAST_PARTIAL', severity: 'info', evidence: `${analyzed} resolvable pair(s), ${notAnalyzed} unresolved pair(s)`, message: 'Some text/background combinations could not be resolved from explicit colors or known design tokens.', recommendation: 'Check these combinations in the actual generated site, especially if styles use gradients, alpha colors, or external CSS.' })
  return { analyzed, notAnalyzed }
}
