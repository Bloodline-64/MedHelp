import type { SupabaseClient } from '@supabase/supabase-js'
import type { AIConfig } from './ai'
import { restoreAIConfig } from './ai'
import {
  BackupPassphraseError,
  decodeBackup,
  encodeBackup,
  getPassphrase,
  makeBackup,
} from './backup'
import { loadHistory, mergeHistory } from './history'

/**
 * Cloud sync through the user's own Supabase project.
 *
 * The app stays static: the browser talks to Supabase directly with the
 * project URL and public (anon) key. The payload is the same gzipped,
 * AES-GCM encrypted backup that the email/file backup produces, so Supabase
 * never sees the Gemini API key or the scan text in readable form.
 */

export const CLOUD_CONFIG_KEY = 'sh.sb.config.v1'
export const CLOUD_EVENT = 'sh-cloud-change'
export const CLOUD_TABLE = 'sync_state'
export const MAX_CLOUD_CHARS = 2_000_000

const LAST_KEY = 'sh.sb.last.v1'
const SEEN_KEY = 'sh.sb.seen.v1'
const AUTO_DEBOUNCE = 1500

export const SYNC_SQL = `-- Run this once in Supabase → SQL Editor → New query
create table if not exists public.sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload text not null,
  updated_at timestamptz not null default now(),
  device text
);

alter table public.sync_state enable row level security;

drop policy if exists "read own sync" on public.sync_state;
drop policy if exists "insert own sync" on public.sync_state;
drop policy if exists "update own sync" on public.sync_state;
drop policy if exists "delete own sync" on public.sync_state;

create policy "read own sync" on public.sync_state
  for select using (auth.uid() = user_id);
create policy "insert own sync" on public.sync_state
  for insert with check (auth.uid() = user_id);
create policy "update own sync" on public.sync_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own sync" on public.sync_state
  for delete using (auth.uid() = user_id);`

export interface CloudConfig {
  url: string
  anonKey: string
  auto: boolean
}

const DEFAULT_CLOUD: CloudConfig = {
  url: '',
  anonKey: '',
  auto: true,
}

export interface CloudUser {
  id: string
  email: string
}

export interface PullResult {
  updatedAt: string
  device: string
  total: number
  changed: boolean
}

export interface PushResult {
  at: number
  total: number
  bytes: number
}

export interface SyncResult {
  at: number
  total: number
  remoteAt: string | null
  device: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLOUD_EVENT))
}

/* ------------------------------------------------------------------ config */

export function getCloudConfig(): CloudConfig {
  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_CLOUD }
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return { ...DEFAULT_CLOUD }
    return {
      url: typeof value.url === 'string' ? value.url.trim().replace(/\/+$/, '') : '',
      anonKey: typeof value.anonKey === 'string' ? value.anonKey.trim() : '',
      auto: value.auto !== false,
    }
  } catch {
    return { ...DEFAULT_CLOUD }
  }
}

export function saveCloudConfig(patch: Partial<CloudConfig>): CloudConfig {
  const current = getCloudConfig()
  const next: CloudConfig = { ...current, ...patch }
  next.url = next.url.trim().replace(/\/+$/, '')
  next.anonKey = next.anonKey.trim()
  try {
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(next))
  } catch {
    // Storage can be blocked; the settings still work for this session.
  }
  if (next.url !== current.url || next.anonKey !== current.anonKey) {
    resetClient()
  }
  if (next.url !== current.url) {
    // A session from another Supabase project is not valid here.
    try {
      localStorage.removeItem('sh.sb.auth')
      localStorage.removeItem(SEEN_KEY)
    } catch {
      // Nothing else to do.
    }
  }
  notify()
  return next
}

export function clearCloudConfig(): void {
  resetClient()
  try {
    localStorage.removeItem(CLOUD_CONFIG_KEY)
    localStorage.removeItem(LAST_KEY)
    localStorage.removeItem(SEEN_KEY)
  } catch {
    // Nothing else to do.
  }
  notify()
}

export function cloudReady(config: CloudConfig = getCloudConfig()): boolean {
  return Boolean(config.url && config.anonKey && /^https?:\/\/\S+$/i.test(config.url))
}

export function getCloudLastSync(): number {
  try {
    const value = Number(localStorage.getItem(LAST_KEY) ?? 0)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function setCloudLastSync(at: number): void {
  try {
    localStorage.setItem(LAST_KEY, String(at))
  } catch {
    // Not important.
  }
}

function getSeenRemote(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function setSeenRemote(at: string): void {
  try {
    if (at) localStorage.setItem(SEEN_KEY, at)
    else localStorage.removeItem(SEEN_KEY)
  } catch {
    // Not important.
  }
}

/* ------------------------------------------------------------------ client */

let client: SupabaseClient | null = null
let clientKey = ''

function resetClient(): void {
  client = null
  clientKey = ''
}

async function getClient(): Promise<SupabaseClient | null> {
  const config = getCloudConfig()
  if (!cloudReady(config)) return null
  const key = `${config.url}|${config.anonKey}`
  if (client && clientKey === key) return client
  const { createClient } = await import('@supabase/supabase-js')
  client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'sh.sb.auth',
    },
  })
  clientKey = key
  return client
}

async function requireClient(): Promise<SupabaseClient> {
  if (!cloudReady()) {
    throw new Error('Add your Supabase project URL and anon key in Settings → Cloud sync first.')
  }
  const created = await getClient()
  if (!created) throw new Error('Supabase is not configured.')
  return created
}

async function requireUser(created: SupabaseClient): Promise<CloudUser> {
  const { data, error } = await created.auth.getSession()
  if (error) throw friendly(error)
  const user = data.session?.user
  if (!user) throw new Error('Sign in to cloud sync first.')
  return { id: user.id, email: user.email ?? '' }
}

/** Current signed-in account, or null. Never throws for missing config. */
export async function getCloudUser(): Promise<CloudUser | null> {
  try {
    const created = await getClient()
    if (!created) return null
    const { data } = await created.auth.getSession()
    const user = data.session?.user
    return user ? { id: user.id, email: user.email ?? '' } : null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------- auth */

export async function signUpCloud(email: string, password: string): Promise<{ needsConfirm: boolean }> {
  const created = await requireClient()
  const { data, error } = await created.auth.signUp({ email: email.trim(), password })
  if (error) throw friendly(error)
  notify()
  return { needsConfirm: !data.session }
}

export async function signInCloud(email: string, password: string): Promise<void> {
  const created = await requireClient()
  const { error } = await created.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw friendly(error)
  notify()
}

export async function signOutCloud(): Promise<void> {
  const created = await getClient()
  if (created) {
    try {
      await created.auth.signOut()
    } catch {
      // Signing out locally still works if the network is down.
    }
  }
  try {
    localStorage.removeItem('sh.sb.auth')
  } catch {
    // Nothing else to do.
  }
  setSeenRemote('')
  notify()
}

export async function sendPasswordReset(email: string): Promise<void> {
  const created = await requireClient()
  const { error } = await created.auth.resetPasswordForEmail(email.trim())
  if (error) throw friendly(error)
}

/* -------------------------------------------------------------------- sync */

function friendly(error: unknown): Error {
  const message = (error as { message?: string })?.message ?? 'Supabase request failed.'
  if (/invalid login credentials/i.test(message)) return new Error('Wrong email or password.')
  if (/email not confirmed/i.test(message)) {
    return new Error('Confirm your email first — open the link Supabase sent you, then sign in.')
  }
  if (/password should be at least|weak.?password/i.test(message)) {
    return new Error('Use a password with at least 6 characters.')
  }
  if (/already registered|already been registered/i.test(message)) {
    return new Error('That email already has an account here. Sign in instead.')
  }
  if (/could not find the table|relation .* does not exist|schema cache/i.test(message)) {
    return new Error('The sync table is missing. Run the setup SQL from “Supabase setup” in your project.')
  }
  if (/row-level security|permission denied/i.test(message)) {
    return new Error('Supabase blocked the request. Re-run the setup SQL so the row-level security policies exist.')
  }
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return new Error('Could not reach Supabase. Check the project URL, the anon key and your connection.')
  }
  if (/jwt|api key/i.test(message) && /invalid|missing/i.test(message)) {
    return new Error('The anon key looks wrong. Copy the publishable / anon key from Supabase → Project Settings → API.')
  }
  return new Error(message)
}

function deviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : ''
  return os ? `${browser} on ${os}` : browser
}

/** Uploads the full encrypted history + settings to Supabase. */
export async function pushCloud(): Promise<PushResult> {
  const passphrase = getPassphrase()
  if (!passphrase) {
    throw new Error('Enter your sync passphrase. Cloud sync always encrypts the data, including the API key.')
  }
  const created = await requireClient()
  const user = await requireUser(created)

  let entries = loadHistory()
  let token = await encodeBackup(makeBackup(entries), passphrase)
  if (token.length > MAX_CLOUD_CHARS) {
    token = await encodeBackup(makeBackup(entries, { thumbs: false }), passphrase)
  }
  while (token.length > MAX_CLOUD_CHARS && entries.length > 1) {
    entries = entries.slice(0, Math.max(1, Math.floor(entries.length * 0.7)))
    token = await encodeBackup(makeBackup(entries, { thumbs: false }), passphrase)
  }
  if (token.length > MAX_CLOUD_CHARS) {
    throw new Error('Your history is too large to sync. Download a backup file, then delete a few scans.')
  }

  const at = new Date().toISOString()
  const { error } = await created
    .from(CLOUD_TABLE)
    .upsert(
      { user_id: user.id, payload: token, updated_at: at, device: deviceName() },
      { onConflict: 'user_id' },
    )
  if (error) throw friendly(error)

  const stamp = Date.now()
  setCloudLastSync(stamp)
  setSeenRemote(at)
  notify()
  return { at: stamp, total: entries.length, bytes: token.length }
}

/**
 * Downloads the encrypted snapshot and merges it into this device.
 * Returns null when nothing has been uploaded yet.
 */
export async function pullCloud(options: { force?: boolean } = {}): Promise<PullResult | null> {
  const passphrase = getPassphrase()
  if (!passphrase) {
    throw new Error('Enter your sync passphrase to read the cloud backup.')
  }
  const created = await requireClient()
  const user = await requireUser(created)

  const { data, error } = await created
    .from(CLOUD_TABLE)
    .select('payload, updated_at, device')
    .eq('user_id', user.id)
    .limit(1)
  if (error) throw friendly(error)

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row.payload !== 'string') return null

  const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : ''
  if (!options.force && updatedAt && updatedAt === getSeenRemote()) {
    return { updatedAt, device: typeof row.device === 'string' ? row.device : '', total: loadHistory().length, changed: false }
  }

  let file
  try {
    file = await decodeBackup(row.payload, passphrase)
  } catch (error) {
    if (error instanceof BackupPassphraseError) {
      throw new Error('The cloud backup is encrypted with a different passphrase. Use the passphrase from the device that uploaded it.')
    }
    if (error instanceof Error && /passphrase is wrong/i.test(error.message)) {
      throw new Error('That sync passphrase does not match the one used to upload this backup.')
    }
    throw error
  }

  const ai = file.ai as Partial<AIConfig> | null
  if (ai && typeof ai.apiKey === 'string' && ai.apiKey.trim()) restoreAIConfig(ai)

  const next = mergeHistory(file.history)
  setSeenRemote(updatedAt)
  setCloudLastSync(Date.now())
  notify()
  return {
    updatedAt,
    device: typeof row.device === 'string' ? row.device : '',
    total: next.length,
    changed: true,
  }
}

/** Pull first (so nothing from another device is lost), then push the union. */
export async function syncNow(): Promise<SyncResult> {
  const pulled = await pullCloud({ force: true })
  const pushed = await pushCloud()
  return {
    at: pushed.at,
    total: pushed.total,
    remoteAt: pulled?.updatedAt ?? null,
    device: pulled?.device ?? '',
  }
}

/* -------------------------------------------------------------- automation */

let autoTimer: number | undefined

/** Debounced background sync after a scan. Never blocks the UI. */
export function maybeAutoSync(): void {
  const config = getCloudConfig()
  if (!config.auto || !cloudReady(config) || !getPassphrase()) return
  if (typeof window === 'undefined') return
  if (autoTimer) window.clearTimeout(autoTimer)
  autoTimer = window.setTimeout(() => {
    autoTimer = undefined
    void syncNow().catch(() => undefined)
  }, AUTO_DEBOUNCE)
}

/**
 * Watches for app focus / connectivity and pulls changes made on other
 * devices. Returns a cleanup function.
 */
export function initCloudSync(): () => void {
  if (typeof window === 'undefined') return () => undefined

  const tick = () => {
    const config = getCloudConfig()
    if (!config.auto || !cloudReady(config) || !getPassphrase()) return
    if (typeof document !== 'undefined' && document.hidden) return
    void pullCloud().catch(() => undefined)
  }

  const onVisible = () => {
    if (typeof document === 'undefined' || !document.hidden) tick()
  }

  const interval = window.setInterval(tick, 60_000)
  const initial = window.setTimeout(tick, 1500)
  window.addEventListener('focus', onVisible)
  window.addEventListener('online', onVisible)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.clearInterval(interval)
    window.clearTimeout(initial)
    if (autoTimer) window.clearTimeout(autoTimer)
    window.removeEventListener('focus', onVisible)
    window.removeEventListener('online', onVisible)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
