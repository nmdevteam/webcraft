import { AnimationSchema, type AnimationConfig } from '@webcraft/core/animation'
import type { BuilderNode } from '@webcraft/core/schema'

type Props = { node: BuilderNode; onChange: (value: AnimationConfig | undefined) => void; onError?: (message: string) => void }
export function AnimationBuilder({ node, onChange, onError }: Props) {
  const current = AnimationSchema.safeParse(node.animation)
  const value = current.success ? current.data : AnimationSchema.parse({ enabled: false })
  const update = (patch: Partial<AnimationConfig>) => {
    const result = AnimationSchema.safeParse({ ...value, ...patch })
    if (!result.success) { onError?.(result.error.issues[0]?.message ?? 'Animation settings are invalid.'); return }
    onChange(result.data)
  }
  const toggleBreakpoint = (breakpoint: 'tablet' | 'mobile', checked: boolean) => {
    const disabledOn = checked ? [...new Set([...value.disabledOn, breakpoint])] : value.disabledOn.filter((item) => item !== breakpoint)
    update({ disabledOn })
  }
  return <section className="inspector-section animation-builder">
    <span className="inspector-label">CSS ANIMATION</span>
    <label className="form-builder-required"><input type="checkbox" checked={value.enabled} onChange={(event) => onChange(event.target.checked ? AnimationSchema.parse({ ...value, enabled: true }) : AnimationSchema.parse({ ...value, enabled: false }))}/>Enable animation</label>
    <p className="form-builder-note">Exported CSS honors reduced-motion preferences. Animations are disabled on the editor canvas.</p>
    {value.enabled && <>
      <label className="field-label">Trigger<select className="input" value={value.trigger} onChange={(event) => update({ trigger: event.target.value as AnimationConfig['trigger'] })}><option value="entrance">On page load</option><option value="scroll">When scrolled into view</option><option value="hover">On hover</option><option value="exit">On link navigation</option></select></label>
      <label className="field-label">Effect<select className="input" value={value.effect} onChange={(event) => update({ effect: event.target.value as AnimationConfig['effect'] })}><option value="fade">Fade</option><option value="slide">Slide</option><option value="scale">Scale</option><option value="rotate">Rotate</option></select></label>
      {value.effect === 'slide' && <><label className="field-label">Direction<select className="input" value={value.direction} onChange={(event) => update({ direction: event.target.value as AnimationConfig['direction'] })}>{(['up', 'down', 'left', 'right'] as const).map((direction) => <option key={direction} value={direction}>{direction}</option>)}</select></label><label className="field-label">Distance (px)<input className="input" type="number" min={0} max={200} value={value.distancePx} onChange={(event) => update({ distancePx: Number(event.target.value) })}/></label></>}
      {value.effect === 'scale' && <label className="field-label">Starting scale<input className="input" type="number" min={0.1} max={2} step={0.1} value={value.scaleFrom} onChange={(event) => update({ scaleFrom: Number(event.target.value) })}/></label>}
      {value.effect === 'rotate' && <label className="field-label">Starting rotation (°)<input className="input" type="number" min={-180} max={180} value={value.rotationFrom} onChange={(event) => update({ rotationFrom: Number(event.target.value) })}/></label>}
      <label className="field-label">Duration (ms)<input className="input" type="number" min={0} max={5000} value={value.durationMs} onChange={(event) => update({ durationMs: Number(event.target.value) })}/></label>
      <label className="field-label">Delay (ms)<input className="input" type="number" min={0} max={10000} value={value.delayMs} onChange={(event) => update({ delayMs: Number(event.target.value) })}/></label>
      <label className="field-label">Easing<select className="input" value={value.easing} onChange={(event) => update({ easing: event.target.value as AnimationConfig['easing'] })}>{(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const).map((easing) => <option key={easing} value={easing}>{easing}</option>)}</select></label>
      {value.trigger === 'scroll' && <label className="form-builder-required"><input type="checkbox" checked={value.once} onChange={(event) => update({ once: event.target.checked })}/>Animate only once</label>}
      <div className="form-builder-breakpoints"><span className="field-label">Disable at widths</span><label className="form-builder-required"><input type="checkbox" checked={value.disabledOn.includes('tablet')} onChange={(event) => toggleBreakpoint('tablet', event.target.checked)}/>Tablet</label><label className="form-builder-required"><input type="checkbox" checked={value.disabledOn.includes('mobile')} onChange={(event) => toggleBreakpoint('mobile', event.target.checked)}/>Mobile</label></div>
    </>}
  </section>
}
