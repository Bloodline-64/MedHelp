import type { AIConfig } from './ai'
import { getAIConfig, restoreAIConfig } from './ai'
import type { HistoryEntry } from './history'
import { loadHistory, mergeHistory, replaceHistoryEntries } from './history'

/**
 * Email backup / "sync" for Scan & Help.
 *
 * A static site cannot send mail by itself, so this uses EmailJS
 * (https://www.emailjs.com) with the user's own free account. The backup is
 * compressed in the browser and, by default, encrypted with a passphrase the
 * user chooses before it ever leaves the device.
 */

export const SYNC_CONFIG_KEY = 'sh.sync.config.v1'
export const SYNC_LAST_KEY = 'sh.sync.last.v1'

const PASS_KEY = 'sh.sync.pass'
const PASS_REMEMBER_KEY = 'sh.sync.pass.keep'
const TOKEN_PREFIX = 'SHB1:'
const MAX_EMAIL_CHARS = 44_000
const MAX_ENTRIES = 40

export interface SyncConfig {
  auto: boolean
  email: string
  serviceId: string
  templateId: string
  publicKey: string
  encrypt: boolean
}

const DEFAULT_SYNC: SyncConfig = {
  auto: false,
  email: '',
  serviceId: '',
  templateId: '',
  publicKey: '',
  encrypt: true,
}

export interface BackupFile {
  app: 'scan-and-help'
  version: 1
  exportedAt: number
  ai: AIConfig | null
  sync: SyncConfig | null
  history: HistoryEntry[]
  trimmed?: number
}

export interface SendResult {
  at: number
  entries: number
  trimmed: number
}

export interface RestoreResult {
  total: number
  ai: boolean
  sync: boolean
  exportedAt: number
}

export type RestoreMode = 'merge' | 'replace'

export class BackupPassphraseError extends Error {
  constructor() {
    super('This backup is encrypted. Enter the passphrase that was used when it was created.')
    this.name = 'BackupPassphraseError'
  }
}

interface Envelope {
  v: 1
  z: boolean
  enc: boolean
  s?: string
  i?: string
  d: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function online(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function entryOf(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) return null
  const result = value.result
  if (!isRecord(result) || typeof result.id !== 'string' || typeof result.title !== 'string') return null
  return {
    result: result as unknown as HistoryEntry['result'],
    thumb: typeof value.thumb === 'string' ? value.thumb : undefined,
  }
}

/* ------------------------------------------------------------------ config */

export function getSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_SYNC }
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return { ...DEFAULT_SYNC }
    return {
      auto: value.auto === true,
      email: typeof value.email === 'string' ? value.email.trim() : '',
      serviceId: typeof value.serviceId === 'string' ? value.serviceId.trim() : '',
      templateId: typeof value.templateId === 'string' ? value.templateId.trim() : '',
      publicKey: typeof value.publicKey === 'string' ? value.publicKey.trim() : '',
      encrypt: value.encrypt !== false,
    }
  } catch {
    return { ...DEFAULT_SYNC }
  }
}

export function saveSyncConfig(patch: Partial<SyncConfig>): SyncConfig {
  const next: SyncConfig = { ...getSyncConfig(), ...patch }
  next.email = next.email.trim()
  next.serviceId = next.serviceId.trim()
  next.templateId = next.templateId.trim()
  next.publicKey = next.publicKey.trim()
  try {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(next))
  } catch {
    // Storage full or blocked; the settings still work for this session.
  }
  return next
}

export function clearSyncConfig(): void {
  try {
    localStorage.removeItem(SYNC_CONFIG_KEY)
    localStorage.removeItem(SYNC_LAST_KEY)
  } catch {
    // Nothing else to do.
  }
}

export function syncReady(config: SyncConfig = getSyncConfig()): boolean {
  return Boolean(
    config.email &&
      config.serviceId &&
      config.templateId &&
      config.publicKey &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email),
  )
}

export function getLastSync(): number {
  try {
    const raw = localStorage.getItem(SYNC_LAST_KEY)
    const value = raw ? Number(raw) : 0
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function setLastSync(at: number): void {
  try {
    localStorage.setItem(SYNC_LAST_KEY, String(at))
  } catch {
    // Not important.
  }
}

/* -------------------------------------------------------------- passphrase */

export function setPassphrase(value: string, remember = false): void {
  const clean = value.trim()
  try {
    if (clean) sessionStorage.setItem(PASS_KEY, clean)
    else sessionStorage.removeItem(PASS_KEY)
    if (clean && remember) localStorage.setItem(PASS_REMEMBER_KEY, clean)
    else localStorage.removeItem(PASS_REMEMBER_KEY)
  } catch {
    // Session storage can be blocked; the passphrase then only lives in the form.
  }
}

export function getPassphrase(): string {
  try {
    return localStorage.getItem(PASS_REMEMBER_KEY) ?? sessionStorage.getItem(PASS_KEY) ?? ''
  } catch {
    return ''
  }
}

export function isPassphraseRemembered(): boolean {
  try {
    return Boolean(localStorage.getItem(PASS_REMEMBER_KEY))
  } catch {
    return false
  }
}

export function clearPassphrase(): void {
  try {
    sessionStorage.removeItem(PASS_KEY)
    localStorage.removeItem(PASS_REMEMBER_KEY)
  } catch {
    // Nothing else to do.
  }
}

/* ----------------------------------------------------------- bytes helpers */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function encodeBase64Url(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return new TextDecoder().decode(base64ToBytes(padded + '='.repeat((4 - (padded.length % 4)) % 4)))
}

async function gzip(bytes: Uint8Array): Promise<{ data: Uint8Array; z: boolean }> {
  if (typeof CompressionStream === 'undefined') return { data: bytes, z: false }
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
    const data = new Uint8Array(await new Response(stream).arrayBuffer())
    return { data, z: true }
  } catch {
    return { data: bytes, z: false }
  }
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 150_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encrypt(bytes: Uint8Array, passphrase: string): Promise<{ data: Uint8Array; salt: string; iv: string }> {
  if (!crypto?.subtle) throw new Error('Encryption needs HTTPS. Open the app on its https:// address or localhost.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource))
  return { data, salt: bytesToBase64(salt), iv: bytesToBase64(iv) }
}

async function decrypt(data: Uint8Array, passphrase: string, salt: string, iv: string): Promise<Uint8Array> {
  const key = await deriveKey(passphrase, base64ToBytes(salt))
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource }, key, data as BufferSource),
    )
  } catch {
    throw new Error('The passphrase is wrong, or this backup is damaged.')
  }
}

/* ---------------------------------------------------------------- encoding */

function normalizeBackup(value: unknown): BackupFile {
  if (!isRecord(value) || !Array.isArray(value.history)) {
    throw new Error('That does not look like a Scan & Help backup.')
  }
  const history = value.history
    .map(entryOf)
    .filter((entry): entry is HistoryEntry => entry !== null)
    .sort((a, b) => b.result.at - a.result.at)
    .slice(0, MAX_ENTRIES)

  const ai = isRecord(value.ai) ? (value.ai as unknown as AIConfig) : null
  const sync = isRecord(value.sync) ? (value.sync as unknown as SyncConfig) : null

  return {
    app: 'scan-and-help',
    version: 1,
    exportedAt: typeof value.exportedAt === 'number' ? value.exportedAt : Date.now(),
    ai,
    sync,
    history,
    trimmed: typeof value.trimmed === 'number' ? value.trimmed : undefined,
  }
}

export function makeBackup(entries: HistoryEntry[], options: { thumbs?: boolean; trimmed?: number } = {}): BackupFile {
  return {
    app: 'scan-and-help',
    version: 1,
    exportedAt: Date.now(),
    ai: getAIConfig(),
    sync: getSyncConfig(),
    history: entries.slice(0, MAX_ENTRIES).map((entry) => ({
      result: entry.result,
      thumb: options.thumbs === false ? undefined : entry.thumb,
    })),
    trimmed: options.trimmed,
  }
}

function parseEnvelope(text: string): Envelope | null {
  if (!text.startsWith(TOKEN_PREFIX)) return null
  try {
    const value: unknown = JSON.parse(decodeBase64Url(text.slice(TOKEN_PREFIX.length)))
    if (!isRecord(value) || value.v !== 1 || typeof value.d !== 'string') return null
    return {
      v: 1,
      z: value.z === true,
      enc: value.enc === true,
      s: typeof value.s === 'string' ? value.s : undefined,
      i: typeof value.i === 'string' ? value.i : undefined,
      d: value.d,
    }
  } catch {
    return null
  }
}

export function isEncryptedBackup(text: string): boolean {
  return parseEnvelope(text.trim())?.enc === true
}

/** Serializes a backup into one copy-pasteable code. */
export async function encodeBackup(file: BackupFile, passphrase?: string): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(file))
  const packed = await gzip(raw)
  let data = packed.data
  let envelope: Envelope = { v: 1, z: packed.z, enc: false, d: bytesToBase64(data) }
  if (passphrase) {
    const encrypted = await encrypt(data, passphrase)
    data = encrypted.data
    envelope = { v: 1, z: packed.z, enc: true, s: encrypted.salt, i: encrypted.iv, d: bytesToBase64(data) }
  }
  return TOKEN_PREFIX + encodeBase64Url(JSON.stringify(envelope))
}

/** Reads a backup code or the JSON text of a downloaded backup file. */
export async function decodeBackup(text: string, passphrase = ''): Promise<BackupFile> {
  const clean = text.trim()
  if (!clean) throw new Error('The backup is empty.')

  const envelope = parseEnvelope(clean)
  let json = clean
  if (envelope) {
    let bytes = base64ToBytes(envelope.d)
    if (envelope.enc) {
      if (!passphrase) throw new BackupPassphraseError()
      if (!envelope.s || !envelope.i) throw new Error('This backup is damaged (missing encryption data).')
      bytes = await decrypt(bytes, passphrase, envelope.s, envelope.i)
    }
    if (envelope.z) {
      try {
        bytes = await gunzip(bytes)
      } catch {
        throw new Error('This backup is damaged and could not be unpacked.')
      }
    }
    json = new TextDecoder().decode(bytes)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('That backup code is not valid. Copy the whole code, including the SHB1: start.')
  }
  return normalizeBackup(parsed)
}

/* ------------------------------------------------------------------ email */

function formatWhen(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function buildEmail(entries: HistoryEntry[], config: SyncConfig, passphrase: string): Promise<{
  message: string
  subject: string
  entries: number
  trimmed: number
}> {
  let history = entries.slice(0, MAX_ENTRIES)
  const now = Date.now()

  const build = async (count: number) => {
    const file = makeBackup(history, { thumbs: false, trimmed: entries.length - count })
    const token = await encodeBackup(file, config.encrypt ? passphrase : undefined)
    const lines = [
      'Scan & Help backup',
      '',
      `Saved: ${formatWhen(now)}`,
      `Scans in this backup: ${count}`,
      entries.length > count ? `Left on the device: ${entries.length - count} older scan(s)` : '',
      '',
      config.encrypt
        ? 'This backup is encrypted. To restore it: Scan & Help → Settings → Email backup → Restore, paste the code below and enter your passphrase.'
        : 'This backup is NOT encrypted. It contains your Gemini API key — keep this email private.',
      '',
      '----- backup code (keep everything below this line) -----',
      token,
      '----- end of backup code -----',
    ]
    return { token, message: lines.join('\n') }
  }

  let result = await build(history.length)
  while (result.token.length > MAX_EMAIL_CHARS && history.length > 1) {
    history = history.slice(0, Math.max(1, Math.floor(history.length * 0.8)))
    result = await build(history.length)
  }
  if (result.token.length > MAX_EMAIL_CHARS) {
    throw new Error(
      'This backup is too large for EmailJS (50 KB limit), even after compression. Delete a few scans or use “Download backup file” instead.',
    )
  }

  return {
    message: result.message,
    subject: `Scan & Help backup — ${formatWhen(now)}`,
    entries: history.length,
    trimmed: entries.length - history.length,
  }
}

/** Sends the full history + settings to the user's email through EmailJS. */
export async function sendBackupEmail(
  entries: HistoryEntry[] = loadHistory(),
  config: SyncConfig = getSyncConfig(),
  passphrase: string = getPassphrase(),
): Promise<SendResult> {
  if (!online()) throw new Error('You are offline. Connect to the internet to email a backup.')
  if (!entries.length) throw new Error('There are no scans to back up yet.')
  if (!syncReady(config)) {
    throw new Error('Fill in your email and the three EmailJS values in Settings first.')
  }
  if (config.encrypt && !passphrase.trim()) {
    throw new Error('Enter a backup passphrase, or turn off encryption (not recommended).')
  }

  const email = await buildEmail(entries, config, passphrase.trim())

  let response: Response
  try {
    response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: config.serviceId,
        template_id: config.templateId,
        user_id: config.publicKey,
        template_params: {
          to_email: config.email,
          subject: email.subject,
          message: email.message,
          entries: String(email.entries),
          exported_at: formatWhen(Date.now()),
        },
      }),
    })
  } catch {
    throw new Error('Could not reach EmailJS. Check your connection and try again.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).trim()
    } catch {
      // Ignore an unreadable error body.
    }
    throw new Error(
      `EmailJS rejected the backup (HTTP ${response.status})${detail ? `: ${detail.slice(0, 160)}` : ''}. Check the service ID, template ID and public key.`,
    )
  }

  const at = Date.now()
  setLastSync(at)
  return { at, entries: email.entries, trimmed: email.trimmed }
}

/** Best-effort send used automatically after a scan. Never blocks the UI. */
export async function maybeAutoSync(entries: HistoryEntry[]): Promise<void> {
  const config = getSyncConfig()
  if (!config.auto || !syncReady(config)) return
  const passphrase = config.encrypt ? getPassphrase() : ''
  if (config.encrypt && !passphrase) return
  try {
    await sendBackupEmail(entries, config, passphrase)
  } catch {
    // Automatic backups must never interrupt scanning.
  }
}

/* ---------------------------------------------------------------- restore */

export async function restoreBackup(
  text: string,
  passphrase: string,
  mode: RestoreMode,
): Promise<RestoreResult> {
  const file = await decodeBackup(text, passphrase.trim())

  if (file.ai && typeof file.ai.apiKey === 'string' && file.ai.apiKey.trim()) {
    restoreAIConfig(file.ai)
  }
  if (file.sync) saveSyncConfig(file.sync)

  const next = mode === 'replace' ? replaceHistoryEntries(file.history) : mergeHistory(file.history)

  return {
    total: next.length,
    ai: Boolean(file.ai?.apiKey),
    sync: Boolean(file.sync),
    exportedAt: file.exportedAt,
  }
}

/* --------------------------------------------------------------- download */

export function downloadBackup(entries: HistoryEntry[] = loadHistory()): void {
  if (!entries.length) throw new Error('There are no scans to back up yet.')
  const file = makeBackup(entries)
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `scan-help-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
