import type { ScanResult } from '../types'

const HISTORY_KEY = 'sh.history.v1'
const MAX_ENTRIES = 40
export const HISTORY_EVENT = 'sh-history-change'

export interface HistoryEntry {
  result: ScanResult
  thumb?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toEntry(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) return null
  const result = value.result
  if (!isRecord(result) || typeof result.id !== 'string' || typeof result.title !== 'string') return null
  return {
    result: result as unknown as ScanResult,
    thumb: typeof value.thumb === 'string' ? value.thumb : undefined,
  }
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(toEntry)
      .filter((entry): entry is HistoryEntry => entry !== null)
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function writeHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // History is a convenience; a full or blocked storage must not break scans.
  }
}

export function loadHistory(): HistoryEntry[] {
  return readHistory()
}

export function addHistoryEntry(entry: HistoryEntry): HistoryEntry[] {
  const entries = readHistory().filter((existing) => existing.result.id !== entry.result.id)
  const next = [entry, ...entries].slice(0, MAX_ENTRIES)
  writeHistory(next)
  return next
}

export function removeHistoryEntry(id: string): HistoryEntry[] {
  const next = readHistory().filter((entry) => entry.result.id !== id)
  writeHistory(next)
  return next
}

export function clearHistory(): HistoryEntry[] {
  writeHistory([])
  return []
}

/** Adds entries restored from a backup without losing scans made since. */
export function mergeHistory(incoming: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>()
  for (const entry of readHistory()) byId.set(entry.result.id, entry)
  for (const entry of incoming) {
    // Existing local entries win; they are at least as fresh as the backup.
    if (!byId.has(entry.result.id)) byId.set(entry.result.id, entry)
  }
  const next = [...byId.values()].sort((a, b) => b.result.at - a.result.at).slice(0, MAX_ENTRIES)
  writeHistory(next)
  notifyHistoryChanged()
  return next
}

/** Replaces local history with the contents of a backup. */
export function replaceHistoryEntries(incoming: HistoryEntry[]): HistoryEntry[] {
  const next = incoming
    .map(toEntry)
    .filter((entry): entry is HistoryEntry => entry !== null)
    .sort((a, b) => b.result.at - a.result.at)
    .slice(0, MAX_ENTRIES)
  writeHistory(next)
  notifyHistoryChanged()
  return next
}

export function notifyHistoryChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HISTORY_EVENT))
}
