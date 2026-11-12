import type { Confidence, ScanKind, ScanMode, ScanResult, Urgency } from '../types'
import { SCAN_MODES } from '../types'

/**
 * Shared AI layer for Scan & Help.
 *
 * The Gemini key is stored in this browser only (localStorage) and is sent
 * directly to Google's OpenAI-compatible endpoint. There is no app backend.
 */

export const AI_CONFIG_KEY = 'sh.ai.config.v1'
export const AI_EVENT = 'sh-ai-change'

export const AI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
export const AI_DEFAULT_MODEL = 'gemini-3.6-flash'
export const AI_MODEL_SUGGESTIONS = [
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
]

export interface AIConfig {
  enabled: boolean
  apiKey: string
  model: string
  baseUrl: string
  vision: boolean
}

export interface AIState {
  configured: boolean
  enabled: boolean
  ready: boolean
  vision: boolean
  online: boolean
  model: string
}

export type AIErrorKind =
  | 'config'
  | 'auth'
  | 'quota'
  | 'model'
  | 'network'
  | 'timeout'
  | 'server'
  | 'parse'
  | 'image'

export class AIClientError extends Error {
  kind: AIErrorKind

  constructor(message: string, kind: AIErrorKind) {
    super(message)
    this.name = 'AIClientError'
    this.kind = kind
  }
}

export type AIResult = { ok: true } | { ok: false; error: string }

interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | AIContentPart[]
}

interface AIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

interface ChatOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

const MAX_CONTEXT = 14_000
const MAX_IMAGE_EDGE = 2000
const MAX_RAW_IMAGE_BYTES = 2_500_000

const DEFAULT_CONFIG: AIConfig = {
  enabled: true,
  apiKey: '',
  model: AI_DEFAULT_MODEL,
  baseUrl: AI_DEFAULT_BASE,
  vision: true,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function online(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AI_EVENT))
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}…`
}

function normalizeBaseUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.hash = ''
    url.search = ''
    const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
    return `${url.origin}${path}`
  } catch {
    return null
  }
}

const LEGACY_GEMINI_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-pro-preview',
])

function readConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return { ...DEFAULT_CONFIG }
    const baseUrl =
      typeof value.baseUrl === 'string' && normalizeBaseUrl(value.baseUrl)
        ? normalizeBaseUrl(value.baseUrl)!
        : AI_DEFAULT_BASE
    let model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : AI_DEFAULT_MODEL
    if (baseUrl === AI_DEFAULT_BASE && LEGACY_GEMINI_MODELS.has(model)) model = AI_DEFAULT_MODEL
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_CONFIG.enabled,
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
      model,
      baseUrl,
      vision: typeof value.vision === 'boolean' ? value.vision : true,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

function writeConfig(config: AIConfig): void {
  try {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // Storage full or blocked; settings still work for this session.
  }
}

export function getAIConfig(): AIConfig {
  return readConfig()
}

export function getAIState(): AIState {
  const config = readConfig()
  const configured = Boolean(config.apiKey.trim())
  return {
    configured,
    enabled: config.enabled,
    ready: configured && config.enabled && online(),
    vision: config.vision,
    online: online(),
    model: config.model,
  }
}

export function isAIReady(): boolean {
  return getAIState().ready
}

export function saveAIConfig(patch: Partial<AIConfig>): AIResult {
  const current = readConfig()
  const next: AIConfig = {
    ...current,
    ...patch,
    apiKey: (patch.apiKey ?? current.apiKey).trim(),
    model: (patch.model ?? current.model).trim(),
  }
  const baseUrl = normalizeBaseUrl(patch.baseUrl ?? current.baseUrl)
  if (!baseUrl) {
    return {
      ok: false,
      error: 'Enter a valid API base URL, for example https://generativelanguage.googleapis.com/v1beta/openai',
    }
  }
  if (!next.model) return { ok: false, error: 'Enter a model ID, for example gemini-3.6-flash.' }
  if (!next.apiKey) return { ok: false, error: 'Paste your Gemini API key first.' }
  writeConfig({ ...next, baseUrl })
  emit()
  return { ok: true }
}

export function clearAISettings(): void {
  try {
    localStorage.removeItem(AI_CONFIG_KEY)
  } catch {
    // Nothing else to do.
  }
  emit()
}

/** Writes AI settings from a backup without requiring the key to be re-typed. */
export function restoreAIConfig(value: Partial<AIConfig>): void {
  const current = readConfig()
  const baseUrl = typeof value.baseUrl === 'string' ? normalizeBaseUrl(value.baseUrl) : null
  const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : current.model
  writeConfig({
    enabled: typeof value.enabled === 'boolean' ? value.enabled : current.enabled,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : current.apiKey,
    model,
    baseUrl: baseUrl ?? current.baseUrl,
    vision: typeof value.vision === 'boolean' ? value.vision : current.vision,
  })
  emit()
}

export function aiErrorMessage(error: unknown): string {
  if (error instanceof AIClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'The AI request failed. Check your connection and AI settings.'
}

function extractContent(payload: unknown): string {
  if (!isRecord(payload)) return ''
  const choices = payload.choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0]
  if (!isRecord(first)) return ''
  const message = first.message
  if (!isRecord(message)) return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('')
  }
  return ''
}

async function providerError(response: Response, config: AIConfig): Promise<AIClientError> {
  let detail = ''
  try {
    const body: unknown = await response.json()
    // Gemini's OpenAI-compatible endpoint wraps errors in an array.
    const record = Array.isArray(body) ? body.find(isRecord) : body
    if (isRecord(record)) {
      const error = record.error
      if (isRecord(error) && typeof error.message === 'string') detail = error.message
      else if (typeof record.message === 'string') detail = record.message
    }
  } catch {
    // Body was not JSON.
  }

  const lower = detail.toLowerCase()
  if (response.status === 400 && /(api[_\s-]?key|invalid.*key)/i.test(lower)) {
    return new AIClientError('The AI service rejected the API key. Check it in Settings.', 'auth')
  }
  if (response.status === 401 || response.status === 403) {
    return new AIClientError('The AI service rejected the API key. Check it in Settings.', 'auth')
  }
  if (response.status === 404) {
    const endpoint = `${normalizeBaseUrl(config.baseUrl) ?? AI_DEFAULT_BASE}/chat/completions`
    return new AIClientError(
      [
        'The AI model or endpoint was not found.',
        detail ? `Google said: ${truncate(detail, 240)}` : '',
        `Model: “${config.model}” · Endpoint: ${endpoint}`,
        'Use “Find available models” in Settings and pick one from the list.',
      ]
        .filter(Boolean)
        .join(' '),
      'model',
    )
  }
  if (response.status === 429) {
    return new AIClientError('The AI free-tier limit was reached. Wait a minute and try again.', 'quota')
  }
  if (response.status >= 500) {
    const overloaded = response.status === 502 || response.status === 503 || response.status === 504
    return new AIClientError(
      overloaded
        ? `Google's AI service is temporarily overloaded (HTTP ${response.status}). It was retried automatically. Wait a minute, or switch to a lighter model such as gemini-3.5-flash-lite.`
        : 'The AI service is temporarily unavailable. Try again shortly.',
      'server',
    )
  }
  return new AIClientError(
    detail
      ? `The AI service rejected the request: ${truncate(detail, 180)}`
      : `The AI service returned HTTP ${response.status}.`,
    'server',
  )
}

async function requestChat(messages: AIMessage[], config: AIConfig, options: ChatOptions = {}): Promise<string> {
  const apiKey = config.apiKey.trim()
  if (config.enabled === false) {
    throw new AIClientError('AI is turned off. Enable it in Settings.', 'config')
  }
  if (!apiKey) {
    throw new AIClientError('Add a Gemini API key in Settings to use AI features.', 'config')
  }
  if (!online()) {
    throw new AIClientError('AI needs a connection. Local OCR and pasted text still work offline.', 'network')
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl) ?? AI_DEFAULT_BASE
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 90_000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const timedOut = () =>
    new AIClientError(
      `The AI request timed out after ${Math.round(timeoutMs / 1000)} seconds. ${config.model || AI_DEFAULT_MODEL} may be busy — try again, switch to gemini-3.5-flash-lite, or use local OCR for text.`,
      'timeout',
    )

  try {
    const transient = new Set([502, 503, 504])
    let response: Response | null = null
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model || AI_DEFAULT_MODEL,
            messages,
            temperature: options.temperature ?? 0.2,
            max_tokens: options.maxTokens ?? 4096,
          }),
        })
      } catch {
        if (controller.signal.aborted) throw timedOut()
        throw new AIClientError('Could not reach the AI service. Check your connection and API base URL.', 'network')
      }
      if (response.ok || !transient.has(response.status) || attempt === 2) break
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)))
    }

    if (!response) {
      throw new AIClientError('Could not reach the AI service. Check your connection and API base URL.', 'network')
    }
    if (!response.ok) throw await providerError(response, config)

    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      if (controller.signal.aborted) throw timedOut()
      throw new AIClientError('The AI returned an unreadable response. Try again.', 'parse')
    }

    const content = extractContent(payload).trim()
    if (!content) throw new AIClientError('The AI returned an empty response. Try again.', 'parse')
    return content
  } finally {
    clearTimeout(timeout)
  }
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new AIClientError('That image could not be read.', 'image'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new AIClientError('That image could not be decoded.', 'image'))
    image.src = dataUrl
  })
}

/** Converts an image to a data URL, shrinking very large photos for the API. */
export async function imageToDataUrl(blob: Blob): Promise<string> {
  const original = await readAsDataUrl(blob)
  if (!original) throw new AIClientError('That image is empty.', 'image')

  try {
    const image = await loadImage(original)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    const longest = Math.max(width, height)
    if (!longest || (longest <= MAX_IMAGE_EDGE && blob.size <= MAX_RAW_IMAGE_BYTES)) return original

    const scale = Math.min(1, MAX_IMAGE_EDGE / longest)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return original
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    return original
  }
}

/** Creates a small JPEG thumbnail for the local history list. */
export async function makeThumb(blob: Blob, maxEdge = 280): Promise<string | undefined> {
  try {
    const dataUrl = await readAsDataUrl(blob)
    const image = await loadImage(dataUrl)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!width || !height) return undefined
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.62)
  } catch {
    return undefined
  }
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function listOf(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, max)
}

const KINDS: ScanKind[] = ['injury', 'text', 'document', 'medicine', 'object', 'plant', 'food', 'other']
const URGENCIES: Urgency[] = ['emergency', 'urgent', 'soon', 'self-care', 'unknown']
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low']

const MODE_FOCUS: Record<ScanMode, string> = {
  auto: [
    'Work out what the image shows and what the person most needs.',
    'If it shows a body part, wound, rash, bite, burn or eye, analyse it as an injury/health photo.',
    'If it shows writing, a label, a letter or a screen, analyse it as text or a document.',
    'If it shows an object, plant, animal or food, identify it.',
    'Set kind to the closest match.',
  ].join(' '),
  text: [
    'Transcribe the text as accurately as you can, then explain what it says, what matters most, and what action it asks for.',
    'Preserve names, numbers, amounts, dates, phone numbers and addresses exactly.',
    'If it is a foreign language, give the transcription first and then a translation in the summary.',
  ].join(' '),
  injury: [
    'This is a photo of a body part, wound, rash, bite, burn or other skin problem.',
    'Describe ONLY what is visibly apparent: location, approximate size, colour, swelling, bleeding, edges, discharge.',
    'Give practical, widely accepted first-aid steps a non-medical person can safely follow.',
    'List clear red flags that mean the person must get urgent or emergency care.',
    'Do NOT name a disease or give a diagnosis. Say plainly that only a clinician can diagnose.',
    'Set kind to "injury" and urgency to emergency, urgent, soon, self-care or unknown.',
  ].join(' '),
  object: [
    'Identify the object, plant, animal or food as specifically as the photo allows.',
    'Give useful, safe facts and any warnings (toxic look-alikes, choking hazards, allergies, electrical or chemical hazards).',
    'Never claim certainty about a plant, mushroom or wild food. If it could be dangerous, say so first.',
  ].join(' '),
  medicine: [
    'Read the medicine label exactly: name, strength, form, dose, directions, warnings, batch and expiry.',
    'Summarise what the medicine is commonly used for in one plain sentence.',
    'Do NOT recommend a dose or a dose change. Do NOT say it is safe for this person.',
    'Flag allergy, interaction and overdose warnings, and say to confirm with a pharmacist or doctor.',
    'Set kind to "medicine".',
  ].join(' '),
  document: [
    'Explain what this document is, who it is from, and what it wants.',
    'Extract every date, deadline, amount, reference number and required action exactly.',
    'Give a short, ordered action checklist. Flag late fees, penalties or deadlines that are close.',
    'Set kind to "document".',
  ].join(' '),
}

const SCAN_SYSTEM = [
  'You are Scan & Help, a careful visual analysis assistant used on a phone or computer.',
  'The user takes or uploads a photo, or pastes text. Give clear, practical help in plain language.',
  '',
  'Return ONLY one JSON object, with no markdown fences and no commentary, using exactly this schema:',
  '{"kind":"injury|text|document|medicine|object|plant|food|other","title":"short label","transcription":"verbatim visible text","summary":"2-4 sentences of plain-language help","findings":["what is visible or detected"],"advice":["concrete next steps"],"redFlags":["warning signs needing urgent help"],"urgency":"emergency|urgent|soon|self-care|unknown","confidence":"high|medium|low","followUpQuestions":["optional useful question"]}',
  '',
  'Rules:',
  '- Be honest. If the image is blurry, dark, cropped or ambiguous, set confidence to low and say what is unclear.',
  '- transcription must be every readable character exactly, with line breaks as \\n. Write [unclear] for unreadable regions. Use "" when there is no text.',
  '- findings: 0 to 6 short bullets describing only what you can actually see or read. Maximum about 25 words each.',
  '- advice: 0 to 6 short bullets, most important first. For injuries these must be safe first-aid steps.',
  '- redFlags: 0 to 6 short bullets; use [] when none apply. Never omit a genuinely urgent warning sign.',
  '- followUpQuestions: 0 to 3 short questions the user may want to ask next. Use [] if not useful.',
  '- Do not use markdown, headings, tables or code fences inside any field. Do not mention the JSON schema.',
  '- Never invent text, objects, people, brands or medical facts that are not visible or well established.',
  '- Protect privacy: do not repeat ID numbers, card numbers or addresses beyond what is needed for the advice.',
  '- Never identify a person by name or try to recognise a face.',
  '',
  'Safety:',
  '- You are not a doctor, pharmacist or emergency service. Never diagnose, never prescribe, never give a dose.',
  '- For a possible emergency, put the emergency warning first in summary and set urgency to "emergency".',
  '- For plants, mushrooms and wild food, assume it could be dangerous unless you are certain; say so first.',
].join('\n')

function modeName(mode: ScanMode): string {
  return SCAN_MODES.find((entry) => entry.id === mode)?.label ?? 'Smart scan'
}

function defaultTitle(mode: ScanMode): string {
  const map: Record<ScanMode, string> = {
    auto: 'Scan result',
    text: 'Scanned text',
    injury: 'Injury check',
    object: 'Object scan',
    medicine: 'Medicine label',
    document: 'Document scan',
  }
  return map[mode]
}

function modeToKind(mode: ScanMode): ScanKind {
  if (mode === 'auto') return 'other'
  return mode === 'object' ? 'object' : mode
}

function normalizeResult(parsed: unknown, mode: ScanMode, model: string): ScanResult {
  if (!isRecord(parsed)) {
    // Be resilient if the model ignores the JSON instruction.
    const raw = typeof parsed === 'string' ? parsed.trim() : ''
    return {
      id: uid('scan'),
      at: Date.now(),
      mode,
      kind: modeToKind(mode),
      title: truncate(raw.split(/\r?\n/).find((line) => line.trim()) ?? defaultTitle(mode), 90),
      transcription: raw,
      summary: raw ? '' : 'The AI returned an unexpected response. Try the scan again.',
      findings: [],
      advice: [],
      redFlags: [],
      urgency: 'unknown',
      confidence: 'low',
      followUpQuestions: [],
      model,
    }
  }

  const kind = KINDS.includes(parsed.kind as ScanKind) ? (parsed.kind as ScanKind) : modeToKind(mode)
  const urgency = URGENCIES.includes(parsed.urgency as Urgency) ? (parsed.urgency as Urgency) : 'unknown'
  const confidence = CONFIDENCES.includes(parsed.confidence as Confidence)
    ? (parsed.confidence as Confidence)
    : 'medium'

  return {
    id: uid('scan'),
    at: Date.now(),
    mode,
    kind,
    title: truncate(textOf(parsed.title) || defaultTitle(mode), 90),
    transcription: textOf(parsed.transcription).slice(0, 20_000),
    summary: textOf(parsed.summary).slice(0, 2_000),
    findings: listOf(parsed.findings, 6),
    advice: listOf(parsed.advice, 6),
    redFlags: listOf(parsed.redFlags, 6),
    urgency,
    confidence,
    followUpQuestions: listOf(parsed.followUpQuestions, 3),
    model,
  }
}

function buildScanMessages(mode: ScanMode, imageDataUrl?: string, pastedText?: string): AIMessage[] {
  const focus = MODE_FOCUS[mode]
  const intro = pastedText
    ? `Analyse the pasted text below as: ${modeName(mode)}.`
    : `Analyse the attached image as: ${modeName(mode)}.`

  const parts: AIContentPart[] = [{ type: 'text', text: intro }]
  if (imageDataUrl) parts.push({ type: 'image_url', image_url: { url: imageDataUrl } })
  if (pastedText) parts.push({ type: 'text', text: `Pasted text:\n"""\n${truncate(pastedText, 12_000)}\n"""` })

  return [
    { role: 'system', content: `${SCAN_SYSTEM}\n\nTask focus for this scan:\n${focus}` },
    { role: 'user', content: parts },
  ]
}

export async function analyzeImage(
  blob: Blob,
  mode: ScanMode,
  config: AIConfig = getAIConfig(),
): Promise<ScanResult> {
  if (!config.vision) throw new AIClientError('Vision is turned off in Settings.', 'config')
  const dataUrl = await imageToDataUrl(blob)
  const raw = await requestChat(buildScanMessages(mode, dataUrl), config, {
    temperature: 0.15,
    maxTokens: 4096,
    timeoutMs: 120_000,
  })
  return normalizeResult(extractJson(raw), mode, config.model)
}

export async function analyzeText(
  value: string,
  mode: ScanMode,
  config: AIConfig = getAIConfig(),
): Promise<ScanResult> {
  const clean = value.trim()
  if (!clean) throw new AIClientError('There is no text to analyse.', 'config')
  const raw = await requestChat(buildScanMessages(mode, undefined, clean), config, {
    temperature: 0.2,
    maxTokens: 4096,
    timeoutMs: 120_000,
  })
  return normalizeResult(extractJson(raw), mode, config.model)
}

const FOLLOW_UP_SYSTEM = [
  'You are Scan & Help answering a follow-up question about a scan you already analysed.',
  'Answer directly, in plain text, using short paragraphs and lines beginning with "• " for lists.',
  'Do not use markdown headings, tables or code fences.',
  'Stay consistent with the scan result and transcription supplied. If the answer is not visible in the scan, say so.',
  'You are not a doctor, pharmacist or emergency service. Never diagnose, prescribe or give a specific dose.',
  'For possible emergencies, tell the person to contact emergency services first.',
  'Keep answers under about 180 words unless the user asks for more detail.',
].join('\n')

export function askAboutScan(
  question: string,
  result: ScanResult,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  config: AIConfig = getAIConfig(),
): Promise<string> {
  const context = [
    `Kind: ${result.kind}`,
    `Title: ${result.title}`,
    `Urgency: ${result.urgency}`,
    `Summary: ${result.summary}`,
    result.findings.length ? `Findings: ${result.findings.map((entry) => `• ${entry}`).join(' ')}` : '',
    result.advice.length ? `Advice given: ${result.advice.map((entry) => `• ${entry}`).join(' ')}` : '',
    result.redFlags.length ? `Red flags listed: ${result.redFlags.map((entry) => `• ${entry}`).join(' ')}` : '',
    result.transcription ? `Transcription:\n${truncate(result.transcription, 8_000)}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const messages: AIMessage[] = [
    { role: 'system', content: `${FOLLOW_UP_SYSTEM}\n\nScan result:\n---\n${context}\n---` },
    ...history.slice(-6).map((entry) => ({ role: entry.role, content: entry.content })),
    { role: 'user', content: question.trim() },
  ]

  return requestChat(messages, config, { temperature: 0.3, maxTokens: 1200, timeoutMs: 90_000 })
}

export interface AskTurn {
  role: 'user' | 'assistant'
  content: string
}

const ASK_SYSTEM = [
  'You are Scan & Help, a careful everyday assistant used on a phone or computer.',
  'The user asks a question, optionally with a photo attached. Answer directly in plain language.',
  '',
  'Format:',
  '- Use short paragraphs. Keep sentences easy to scan.',
  '- For lists, start each line with "• " and keep each item to one line where possible.',
  '- Do not use markdown headings, tables, links or code fences.',
  '- Lead with the answer, then the reasoning or steps. Keep it under about 220 words unless the user asks for more detail.',
  '- End with one short, useful follow-up question only when it genuinely helps.',
  '',
  'Accuracy and safety:',
  '- If an image is attached, describe only what is visible. Say plainly when something is blurry, cropped or unclear.',
  '- Never invent text, objects, brands, people or medical facts.',
  '- You are not a doctor, pharmacist, lawyer or emergency service. Never diagnose, prescribe, give a dose or claim legal certainty.',
  '- For possible emergencies, tell the person to contact their local emergency number first.',
  '- For medicines, tell the person to confirm with a pharmacist or doctor.',
  '- For plants, mushrooms and wild food, say it cannot be identified with certainty from a photo and must not be eaten.',
  '- Protect privacy: do not identify people by name or face, and do not repeat ID, card or account numbers unless essential.',
  '- If the request is ambiguous, ask one short clarifying question instead of guessing.',
].join('\n')

/** Answers a general question, optionally with an image and earlier conversation turns. */
export async function askAssistant(
  question: string,
  options: { image?: Blob; history?: AskTurn[]; config?: AIConfig } = {},
): Promise<string> {
  const config = options.config ?? getAIConfig()
  const clean = question.trim()
  if (!clean && !options.image) {
    throw new AIClientError('Type a question or attach a photo first.', 'config')
  }

  const history = (options.history ?? [])
    .filter((turn) => turn.content.trim())
    .slice(-8)
    .map((turn) => ({ role: turn.role, content: truncate(turn.content, 4_000) }))

  const messages: AIMessage[] = [{ role: 'system', content: ASK_SYSTEM }]
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content })
  }

  if (options.image) {
    if (!config.vision) throw new AIClientError('Vision is turned off in Settings.', 'config')
    const dataUrl = await imageToDataUrl(options.image)
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: clean || 'What is in this image? Tell me what matters and what to do next.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    })
  } else {
    messages.push({ role: 'user', content: clean })
  }

  return requestChat(messages, config, { temperature: 0.35, maxTokens: 1_600, timeoutMs: 90_000 })
}

export async function testAIConnection(config: AIConfig): Promise<string> {
  return requestChat(
    [
      { role: 'system', content: 'Reply with exactly: OK' },
      { role: 'user', content: 'Connection test' },
    ],
    config,
    { temperature: 0, maxTokens: 8, timeoutMs: 30_000 },
  )
}

/** Lists the chat-capable Gemini model IDs the key can actually use. */
export async function listAIModels(config: AIConfig): Promise<string[]> {
  const apiKey = config.apiKey.trim()
  if (!apiKey) throw new AIClientError('Paste your Gemini API key first.', 'config')
  if (!online()) throw new AIClientError('AI needs a connection to list models.', 'network')

  const baseUrl = normalizeBaseUrl(config.baseUrl) ?? AI_DEFAULT_BASE
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) {
        throw new AIClientError('Listing models timed out. Check your connection and try again.', 'timeout')
      }
      throw new AIClientError('Could not reach the AI service. Check your connection and API base URL.', 'network')
    }

    if (!response.ok) throw await providerError(response, config)

    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      throw new AIClientError('The AI returned an unreadable model list.', 'parse')
    }
    if (!isRecord(payload) || !Array.isArray(payload.data)) return []

    return [
      ...new Set(
        payload.data
          .map((entry) => (isRecord(entry) && typeof entry.id === 'string' ? entry.id.trim() : ''))
          .filter(Boolean)
          .map((id) => id.replace(/^models\//, ''))
          .filter((id) => /gemini/i.test(id) && !/embedding|image|tts|audio|veo/i.test(id)),
      ),
    ].sort((a, b) => a.localeCompare(b))
  } finally {
    clearTimeout(timeout)
  }
}

export { truncate }
