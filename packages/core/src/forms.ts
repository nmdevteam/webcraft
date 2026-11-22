import { z } from 'zod'

export const FORM_FIELD_TYPES = ['text', 'email', 'password', 'number', 'textarea', 'select', 'radio', 'checkbox', 'date', 'file', 'submit'] as const
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

const FormOptionSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
}).strict()

const safePattern = z.string().max(100).refine((value) => {
  if (/\\[1-9]|\(\?[=!<]|\(\?>|\(\?<|\)\s*[+*{]/.test(value)) return false
  try { new RegExp(value, 'u'); return true } catch { return false }
}, 'Use a simple regular expression without backreferences or lookarounds')

export const FormFieldSchema = z.object({
  id: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(FORM_FIELD_TYPES),
  name: z.string().min(1).max(40).regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  label: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().default(false),
  options: z.array(FormOptionSchema).max(30).default([]),
  minLength: z.number().int().min(0).max(10_000).optional(),
  maxLength: z.number().int().min(1).max(10_000).optional(),
  min: z.union([z.number().finite(), z.string().max(32)]).optional(),
  max: z.union([z.number().finite(), z.string().max(32)]).optional(),
  step: z.number().finite().positive().max(1_000_000).optional(),
  pattern: safePattern.optional(),
  accept: z.string().max(200).refine((value) => /^(?:\.[A-Za-z0-9]{1,12}|[A-Za-z0-9.+*-]+\/[A-Za-z0-9.+*-]+)(?:\s*,\s*(?:\.[A-Za-z0-9]{1,12}|[A-Za-z0-9.+*-]+\/[A-Za-z0-9.+*-]+))*$/.test(value), 'Enter comma-separated MIME types or file extensions').optional(),
  multiple: z.boolean().default(false),
  maxFileSizeBytes: z.number().int().min(1).max(10_000_000).optional(),
  defaultValue: z.string().max(1_000).optional(),
}).strict().superRefine((field, ctx) => {
  const choice = ['select', 'radio', 'checkbox'].includes(field.type)
  if (choice && field.options.length === 0) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Choice fields need at least one option.' })
  if (!choice && field.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Options are only allowed on choice fields.' })
  const optionValues = field.options.map((item) => item.value)
  if (new Set(optionValues).size !== optionValues.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Choice values must be unique.' })
  const textLike = ['text', 'email', 'password', 'textarea'].includes(field.type)
  if (!textLike && (field.minLength !== undefined || field.maxLength !== undefined || field.pattern !== undefined)) ctx.addIssue({ code: 'custom', message: 'Length and pattern constraints only apply to text fields.' })
  if (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) ctx.addIssue({ code: 'custom', path: ['maxLength'], message: 'Maximum length must be greater than or equal to minimum length.' })
  if (!['number', 'date'].includes(field.type) && (field.min !== undefined || field.max !== undefined || field.step !== undefined)) ctx.addIssue({ code: 'custom', message: 'Minimum, maximum, and step constraints only apply to number or date fields.' })
  if (field.type === 'number' && typeof field.min === 'number' && typeof field.max === 'number' && field.min > field.max) ctx.addIssue({ code: 'custom', path: ['max'], message: 'Maximum must be greater than or equal to minimum.' })
  if (field.type === 'date') {
    for (const [name, value] of [['min', field.min], ['max', field.max]] as const) {
      if (value !== undefined && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) ctx.addIssue({ code: 'custom', path: [name], message: 'Date constraints must use YYYY-MM-DD.' })
    }
    if (typeof field.min === 'string' && typeof field.max === 'string' && field.min > field.max) ctx.addIssue({ code: 'custom', path: ['max'], message: 'Maximum date must not precede minimum date.' })
  }
  if (field.type !== 'file' && (field.accept !== undefined || field.multiple || field.maxFileSizeBytes !== undefined)) ctx.addIssue({ code: 'custom', message: 'File constraints only apply to file fields.' })
  if (field.type !== 'submit' && !field.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Field names are required.' })
  if (field.type === 'submit' && field.required) ctx.addIssue({ code: 'custom', path: ['required'], message: 'Submit controls cannot be required.' })
  if (['password', 'file', 'submit'].includes(field.type) && field.defaultValue !== undefined) ctx.addIssue({ code: 'custom', path: ['defaultValue'], message: 'Password, file, and submit fields cannot have a default value.' })
  if (['radio', 'select'].includes(field.type) && field.defaultValue !== undefined && !optionValues.includes(field.defaultValue)) ctx.addIssue({ code: 'custom', path: ['defaultValue'], message: 'The default value must match one of the configured options.' })
  if (field.type === 'checkbox' && field.defaultValue !== undefined && !optionValues.includes(field.defaultValue)) ctx.addIssue({ code: 'custom', path: ['defaultValue'], message: 'The default value must match one of the configured options.' })
})
export type FormField = z.infer<typeof FormFieldSchema>

const safeEndpoint = z.string().max(500).refine((value) => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\\') || /[\r\n]/.test(trimmed)) return false
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return !/[?#]/.test(trimmed)
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash
  } catch { return false }
}, 'Use an HTTPS endpoint or a same-origin path, without credentials, query parameters, or fragments')

export const FormConfigSchema = z.object({
  submissionMode: z.enum(['frontend-only', 'external']).default('frontend-only'),
  endpointUrl: safeEndpoint.optional(),
  successMessage: z.string().max(300).default('Thanks — your response was submitted.'),
  errorMessage: z.string().max(300).default('We could not submit your response. Please try again.'),
  fields: z.array(FormFieldSchema).min(1).max(50),
}).strict().superRefine((config, ctx) => {
  if (config.submissionMode === 'external' && !config.endpointUrl?.trim()) ctx.addIssue({ code: 'custom', path: ['endpointUrl'], message: 'Configure an HTTPS or same-origin endpoint before enabling submissions.' })
  if (config.submissionMode === 'external' && config.endpointUrl && !safeEndpoint.safeParse(config.endpointUrl).success) ctx.addIssue({ code: 'custom', path: ['endpointUrl'], message: 'The submission endpoint is not safe.' })
  const ids = config.fields.map((field) => field.id)
  const names = config.fields.filter((field) => field.type !== 'submit').map((field) => field.name)
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Form field IDs must be unique.' })
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Form field names must be unique.' })
  if (config.fields.filter((field) => field.type === 'submit').length !== 1) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'A form must have exactly one submit button.' })
})
export type FormConfig = z.infer<typeof FormConfigSchema>

export function createDefaultFormConfig(title = 'Contact us'): FormConfig {
  return FormConfigSchema.parse({
    submissionMode: 'frontend-only',
    successMessage: 'Thanks — your response was submitted.',
    errorMessage: 'We could not submit your response. Please try again.',
    fields: [
      { id: 'name', type: 'text', name: 'name', label: 'Your name', required: true },
      { id: 'email', type: 'email', name: 'email', label: 'Email address', placeholder: 'you@example.com', required: true },
      { id: 'message', type: 'textarea', name: 'message', label: 'Message', required: true, maxLength: 2000 },
      { id: 'submit', type: 'submit', name: 'submit', label: title === 'Newsletter' ? 'Subscribe' : 'Send message' },
    ],
  })
}
