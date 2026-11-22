import { useState } from 'react'
import { ArrowRight, ChevronDown, ChevronUp } from 'lucide-react'
import type { AnalysisFinding, AnalysisSection, WebsiteAnalysisReport } from '@webcraft/core/analysis'
import { Button } from './ui'

type Props = {
  report: WebsiteAnalysisReport
  onClose: () => void
  onOpenPage: (finding: AnalysisFinding) => void
}
const labels = { seo: 'SEO', performance: 'Performance', accessibility: 'Accessibility' } as const
const formatBytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / (1024 * 1024)).toFixed(2)} MiB`
function metricLabel(value: string) { return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase()) }
function formatMetric(key: string, value: number | string | boolean) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number' && /Bytes$/.test(key)) return formatBytes(value)
  if (typeof value === 'number') return value.toLocaleString()
  return value
}
function IssueList({ section, onOpenPage }: { section: AnalysisSection; onOpenPage: (finding: AnalysisFinding) => void }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? section.findings : section.findings.slice(0, 60)
  return <>
    {section.findings.length === 0 ? <div className="analysis-empty">No static findings in this category.</div> : <div className="analysis-findings">{visible.map((finding, index) => <article className={`analysis-finding severity-${finding.severity}`} key={`${finding.code}-${finding.pageSlug ?? ''}-${finding.nodeId ?? ''}-${index}`}>
      <div className="analysis-finding-top"><span className={`analysis-severity severity-${finding.severity}`}>{finding.severity}</span><code>{finding.code}</code>{finding.pageTitle && <span className="analysis-location">{finding.pageTitle}{finding.nodeId ? ` · ${finding.nodeId}` : ''}</span>}</div>
      <p>{finding.message}</p>
      {finding.evidence && <small className="analysis-evidence">{finding.evidence}</small>}
      <div className="analysis-recommendation"><b>Suggested next step</b><span>{finding.recommendation}</span></div>
      {finding.pageSlug && <button className="analysis-open-page" type="button" onClick={() => onOpenPage(finding)}><span>Open page /{finding.pageSlug}</span><ArrowRight size={14}/></button>}
    </article>)}</div>}
    {section.findings.length > 60 && <button className="analysis-show-more" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? <>Show fewer <ChevronUp size={14}/></> : <>Show all {section.findings.length} findings <ChevronDown size={14}/></>}</button>}
  </>
}
function ReportSection({ name, section, onOpenPage }: { name: keyof typeof labels; section: AnalysisSection; onOpenPage: (finding: AnalysisFinding) => void }) {
  const { errors, warnings, info } = section.summary
  return <section className="analysis-section" aria-labelledby={`analysis-${name}`}>
    <div className="analysis-section-head"><div><h3 id={`analysis-${name}`}>{labels[name]}</h3><p>{errors} errors · {warnings} warnings · {info} notes</p></div><span className={`analysis-total ${errors ? 'has-errors' : warnings ? 'has-warnings' : ''}`}>{section.findings.length}</span></div>
    <div className="analysis-metrics">{Object.entries(section.metrics).map(([key, value]) => <div className="analysis-metric" key={key}><span>{metricLabel(key)}</span><b>{formatMetric(key, value)}</b></div>)}</div>
    <IssueList section={section} onOpenPage={onOpenPage}/>
    {section.unavailable.length > 0 && <details className="analysis-limitations"><summary>What this check cannot measure ({section.unavailable.length})</summary><ul>{section.unavailable.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
  </section>
}
export function AnalysisReportDialog({ report, onClose, onOpenPage }: Props) {
  const totalErrors = report.seo.summary.errors + report.performance.summary.errors + report.accessibility.summary.errors
  const totalWarnings = report.seo.summary.warnings + report.performance.summary.warnings + report.accessibility.summary.warnings
  return <div className="modal-backdrop analysis-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal-card analysis-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-title">
      <div className="modal-head"><span className="modal-icon">WC</span><button type="button" className="close-modal" onClick={onClose} aria-label="Close website analysis">×</button></div>
      <span className="eyebrow">WEBSITE ANALYSIS</span><h2 id="analysis-title">{report.projectName}</h2>
      <p className="analysis-intro">Static checks of {report.pageCount} saved page(s) and {report.generatedFileCount} generated file(s). No Lighthouse or Core Web Vitals scores are produced.</p>
      <div className="analysis-summary" role="status"><b>{totalErrors} errors</b><span>·</span><b>{totalWarnings} warnings</b><span>·</span><span>Saved project data, generated source, and image file bytes</span></div>
      <div className="analysis-sections"><ReportSection name="seo" section={report.seo} onOpenPage={onOpenPage}/><ReportSection name="performance" section={report.performance} onOpenPage={onOpenPage}/><ReportSection name="accessibility" section={report.accessibility} onOpenPage={onOpenPage}/></div>
      <div className="modal-actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
    </section>
  </div>
}
