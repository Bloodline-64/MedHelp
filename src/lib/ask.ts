/**
 * Local conversation storage for the Ask screen.
 *
 * Everything stays in this browser. Images are kept only as small thumbnails
 * so a long conversation cannot exhaust localStorage.
 */

export interface AskMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
  /** Small preview of an attached image (user messages only). */
  thumb?: string
  model?: string
}

const ASK_KEY = 'sh.ask.v1'
const MAX_MESSAGES = 40
const MAX_TEXT = 8_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toMessage(value: unknown): AskMessage | null {
  if (!isRecord(value)) return null
  if (value.role !== 'user' && value.role !== 'assistant') return null
  if (typeof value.text !== 'string' || !value.text.trim()) return null
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `ask_${Date.now().toString(36)}`,
    role: value.role,
    text: value.text.slice(0, MAX_TEXT),
    at: typeof value.at === 'number' ? value.at : Date.now(),
    thumb: typeof value.thumb === 'string' ? value.thumb : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
  }
}

export function loadAskMessages(): AskMessage[] {
  try {
    const raw = localStorage.getItem(ASK_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(toMessage)
      .filter((entry): entry is AskMessage => entry !== null)
      .slice(-MAX_MESSAGES)
  } catch {
    return []
  }
}

export function saveAskMessages(messages: AskMessage[]): void {
  try {
    localStorage.setItem(ASK_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)))
  } catch {
    // A full or blocked storage must not break the conversation.
  }
}

export function clearAskMessages(): void {
  try {
    localStorage.removeItem(ASK_KEY)
  } catch {
    // Ignore blocked storage.
  }
}
