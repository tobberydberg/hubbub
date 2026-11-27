// What a server's AI offers (Nextcloud task processing): each task type says what it needs (its input
// shape), what it can also take (optional inputs, such as the model and the answer length with the
// OpenAI integration) and what it gives back. Hubbub builds its forms and settings from these, so it
// shows whatever the server has set up instead of a fixed list.

export interface Shape {
  name: string
  description: string
  /** Text, Number, Enum, Image, Audio, Video, File, ListOfText, ListOfImages, … */
  type: string
}

export interface EnumValue {
  name: string
  value: string
}

export interface TaskType {
  id: string
  name: string
  description?: string
  inputShape: Record<string, Shape>
  inputShapeEnumValues?: Record<string, EnumValue[]>
  inputShapeDefaults?: Record<string, unknown>
  optionalInputShape?: Record<string, Shape>
  optionalInputShapeEnumValues?: Record<string, EnumValue[]>
  optionalInputShapeDefaults?: Record<string, unknown>
  outputShape: Record<string, Shape>
  optionalOutputShape?: Record<string, Shape>
  /** Used by apps behind the scenes (the Assistant's chat, the agent), not offered to people */
  isInternal?: boolean
}

export type OptionValue = string | number

/** The task types as the server lists them, keyed by id, each with its id */
export function readTaskTypes(raw: unknown): Record<string, TaskType> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, TaskType> = {}
  for (const [id, t] of Object.entries(raw as Record<string, Omit<TaskType, 'id'>>)) {
    if (!t || typeof t !== 'object' || !t.inputShape) continue
    out[id] = {
      ...t,
      id,
      // Empty ones come as [] from PHP
      inputShape: asRecord(t.inputShape),
      inputShapeEnumValues: asRecord(t.inputShapeEnumValues),
      inputShapeDefaults: asRecord(t.inputShapeDefaults),
      optionalInputShape: asRecord(t.optionalInputShape),
      optionalInputShapeEnumValues: asRecord(t.optionalInputShapeEnumValues),
      optionalInputShapeDefaults: asRecord(t.optionalInputShapeDefaults),
      outputShape: asRecord(t.outputShape),
      optionalOutputShape: asRecord(t.optionalOutputShape)
    }
  }
  return out
}

function asRecord<T>(v: Record<string, T> | T[] | undefined | null): Record<string, T> {
  return v && !Array.isArray(v) && typeof v === 'object' ? v : {}
}

/** Kinds of task the Assistant's chat and agent run, which make no sense on their own */
const CHAT_ONLY = /(^|:)(chat|chatwithtools|multimodal-chatwithtools)$|contextagent|audio2audio:chat/

/** The task types to offer as tools, in the order the web Assistant shows the common ones */
export function toolTypes(types: Record<string, TaskType>): TaskType[] {
  const first = [
    'core:text2text',
    'core:text2text:summary',
    'core:text2text:headline',
    'core:text2text:topics',
    'core:text2text:proofread',
    'core:text2text:changetone',
    'core:text2text:improve',
    'core:contextwrite',
    'core:text2text:reformulation',
    'core:text2text:translate',
    'context_chat:context_chat',
    'core:text2image',
    'core:analyze-images',
    'core:image2text:ocr',
    'core:audio2text',
    'core:text2speech'
  ]
  const rank = (id: string): number => {
    const i = first.indexOf(id)
    return i === -1 ? first.length : i
  }
  return Object.values(types)
    .filter((t) => !t.isInternal && !CHAT_ONLY.test(t.id))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
}

export type ToolGroup = 'text' | 'images' | 'audio' | 'other'

export const GROUP_NAMES: Record<ToolGroup, string> = {
  text: 'Text',
  images: 'Images',
  audio: 'Audio and speech',
  other: 'Other'
}

const shapeTypes = (t: TaskType): string[] =>
  [...Object.values(t.inputShape), ...Object.values(t.outputShape)].map((s) => s.type)

/** Where a tool goes in the list: by what it takes and gives */
export function groupOf(t: TaskType): ToolGroup {
  const kinds = shapeTypes(t)
  if (kinds.some((k) => /Audio/.test(k))) return 'audio'
  if (kinds.some((k) => /Image/.test(k))) return 'images'
  if (kinds.every((k) => /^(Text|Enum|Number|ListOfText)$/.test(k))) return 'text'
  return 'other'
}

/** Whether a task type answers with text, which can be shown as it's written */
export const answersWithText = (t: TaskType | undefined): boolean =>
  !!t && Object.values(t.outputShape).some((s) => s.type === 'Text')

/** An input that's a file (one or several) */
export const isFileShape = (s: Shape): boolean => /^(ListOf)?(Image|Audio|Video|File)s?$/.test(s.type)
export const isListShape = (s: Shape): boolean => s.type.startsWith('ListOf')

export interface SharedOption {
  key: string
  name: string
  description: string
  type: 'Enum' | 'Number'
  /** For a choice: every value any task offers, in the order first seen */
  values: EnumValue[]
  /** The server's default, when the tasks agree on one */
  serverDefault?: OptionValue
  /** How many tasks take it */
  count: number
}

/**
 * The optional inputs that many tasks share (with the OpenAI integration: the model and the answer
 * length), which make sense as one setting for everything Hubbub asks. Inputs only one or two tasks
 * have (a voice, an image size) are left to those tasks' own forms.
 */
export function sharedOptions(types: Record<string, TaskType>, minimum = 3): SharedOption[] {
  const found = new Map<string, SharedOption & { defaults: Set<string> }>()
  for (const t of Object.values(types)) {
    if (t.isInternal) continue
    for (const [key, shape] of Object.entries(t.optionalInputShape ?? {})) {
      if (shape.type !== 'Enum' && shape.type !== 'Number') continue
      const o =
        found.get(key) ??
        ({
          key,
          name: shape.name,
          description: shape.description,
          type: shape.type,
          values: [],
          count: 0,
          defaults: new Set()
        } as SharedOption & { defaults: Set<string> })
      o.count++
      for (const v of t.optionalInputShapeEnumValues?.[key] ?? []) {
        if (!o.values.some((x) => x.value === v.value)) o.values.push(v)
      }
      const d = t.optionalInputShapeDefaults?.[key]
      if (typeof d === 'string' || typeof d === 'number') o.defaults.add(String(d))
      found.set(key, o)
    }
  }
  return [...found.values()]
    .filter((o) => o.count >= minimum && (o.type === 'Number' || o.values.length > 0))
    .map(({ defaults, ...o }) => {
      const [only] = [...defaults]
      const serverDefault = defaults.size === 1 ? (o.type === 'Number' ? Number(only) : only) : undefined
      return { ...o, serverDefault }
    })
}

/**
 * The input for a task with the settings chosen for everything (the model, the answer length) added,
 * where the task takes them: a model only when it's one the task offers, a number only when it's a
 * number. What the input already has wins.
 */
export function withOptions(
  type: TaskType | undefined,
  input: Record<string, unknown>,
  options: Record<string, OptionValue> | undefined
): Record<string, unknown> {
  if (!type || !options) return input
  const out = { ...input }
  for (const [key, shape] of Object.entries(type.optionalInputShape ?? {})) {
    const value = options[key]
    if (value === undefined || value === '' || key in out) continue
    if (shape.type === 'Enum') {
      if (type.optionalInputShapeEnumValues?.[key]?.some((v) => v.value === value)) out[key] = value
    } else if (shape.type === 'Number') {
      const n = Number(value)
      if (Number.isFinite(n) && n > 0) out[key] = n
    }
  }
  return out
}

/** "1st", "2nd", "3rd", "11th", … */
export function ordinal(n: number): string {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

export type TaskStage =
  { stage: 'scheduled'; position?: number; slow?: boolean } | { stage: 'running'; progress?: number }

/** What a task is doing, in words */
export function stageText(s: TaskStage | null | undefined): string {
  if (!s) return 'Starting…'
  if (s.stage === 'running') {
    return s.progress && s.progress > 0 && s.progress < 1
      ? `Working… ${Math.round(s.progress * 100)}%`
      : 'Working…'
  }
  const place = s.position ? ` (${ordinal(s.position)} in line)` : ''
  return `Waiting for the server’s AI${place}…`
}
