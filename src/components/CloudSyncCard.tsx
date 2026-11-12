import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import {
  BackupPassphraseError,
  downloadBackup,
  getPassphrase,
  isPassphraseRemembered,
  restoreBackup,
  setPassphrase,
  type RestoreMode,
} from '../lib/backup'
import { loadHistory } from '../lib/history'
import {
  SYNC_SQL,
  cloudReady,
  getCloudConfig,
  getCloudLastSync,
  getCloudUser,
  saveCloudConfig,
  sendPasswordReset,
  signInCloud,
  signOutCloud,
  signUpCloud,
  syncNow,
  type CloudConfig,
  type CloudUser,
} from '../lib/supabase'

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'
}

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type AuthMode = 'signin' | 'signup'

export function CloudSyncCard({ onRestored }: { onRestored?: () => void }) {
  const { toast } = useToast()

  const [config, setConfig] = useState<CloudConfig>(getCloudConfig)
  const [passphrase, setPassphraseValue] = useState(getPassphrase)
  const [remember, setRemember] = useState(isPassphraseRemembered)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMode, setAuthMode] = useState<AuthMode>('signin')
  const [user, setUser] = useState<CloudUser | null | undefined>(undefined)
  const [busy, setBusy] = useState<'' | 'auth' | 'sync' | 'restore'>('')
  const [status, setStatus] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [lastSync, setLastSync] = useState(getCloudLastSync)
  const [restoreText, setRestoreText] = useState('')
  const [mode, setMode] = useState<RestoreMode>('merge')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let alive = true
    void getCloudUser().then((value) => {
      if (alive) setUser(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const update = (patch: Partial<CloudConfig>) => setConfig((current) => ({ ...current, ...patch }))

  const persist = (): CloudConfig => {
    const saved = saveCloudConfig(config)
    setConfig(saved)
    setPassphrase(passphrase, remember)
    return saved
  }

  const onSaveConnection = () => {
    const saved = persist()
    if (!cloudReady(saved)) {
      setStatus({ tone: 'error', text: 'Enter your project URL (https://xxxx.supabase.co) and the publishable / anon key.' })
      return
    }
    setStatus({ tone: 'ok', text: 'Supabase connection saved in this browser.' })
    toast('Cloud connection saved.', 'success')
    void getCloudUser().then(setUser)
  }

  const runSync = async (quiet = false): Promise<void> => {
    const saved = persist()
    if (!cloudReady(saved)) {
      setStatus({ tone: 'error', text: 'Add your Supabase project URL and anon key first.' })
      return
    }
    const account = user ?? (await getCloudUser())
    if (!account) {
      setStatus({ tone: 'error', text: 'Sign in to cloud sync first.' })
      return
    }
    if (!user) setUser(account)
    if (!passphrase.trim()) {
      setStatus({ tone: 'error', text: 'Choose a sync passphrase. It encrypts the backup before it is uploaded.' })
      return
    }
    if (!quiet) {
      setBusy('sync')
      setStatus({ tone: 'info', text: 'Syncing with Supabase…' })
    }
    try {
      const result = await syncNow()
      setLastSync(result.at)
      setStatus({
        tone: 'ok',
        text: `Synced — ${result.total} scan${result.total === 1 ? '' : 's'} on this account${
          result.device ? ` (last written from ${result.device})` : ''
        }.`,
      })
      toast('Cloud sync complete.', 'success')
      onRestored?.()
    } catch (error) {
      setStatus({ tone: 'error', text: errorText(error) })
    } finally {
      if (!quiet) setBusy('')
    }
  }

  const onAuth = async () => {
    const saved = persist()
    if (!cloudReady(saved)) {
      setStatus({ tone: 'error', text: 'Add your Supabase project URL and anon key first.' })
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus({ tone: 'error', text: 'Enter the email address for your sync account.' })
      return
    }
    if (password.length < 6) {
      setStatus({ tone: 'error', text: 'Use a password with at least 6 characters.' })
      return
    }

    setBusy('auth')
    setStatus({ tone: 'info', text: authMode === 'signup' ? 'Creating your account…' : 'Signing in…' })
    try {
      if (authMode === 'signup') {
        const result = await signUpCloud(email, password)
        if (result.needsConfirm) {
          setStatus({
            tone: 'info',
            text: 'Account created. Open the confirmation link Supabase emailed you, then sign in here.',
          })
          setAuthMode('signin')
          setBusy('')
          return
        }
      } else {
        await signInCloud(email, password)
      }
      const account = await getCloudUser()
      setUser(account)
      setPassword('')
      setStatus({ tone: 'ok', text: `Signed in as ${account?.email ?? email.trim()}.` })
      toast('Signed in to cloud sync.', 'success')
      if (passphrase.trim()) await runSync(true)
      else {
        setStatus({
          tone: 'info',
          text: 'Signed in. Now set a sync passphrase below and press “Sync now” — the first device uploads its history.',
        })
      }
    } catch (error) {
      setStatus({ tone: 'error', text: errorText(error) })
    } finally {
      setBusy('')
    }
  }

  const onSignOut = async () => {
    setBusy('auth')
    await signOutCloud()
    setUser(null)
    setBusy('')
    setStatus({ tone: 'info', text: 'Signed out. Your scans stay on this device and in your Supabase project.' })
  }

  const onForgot = async () => {
    if (!email.trim()) {
      setStatus({ tone: 'error', text: 'Type your account email first, then press “Forgot password”.' })
      return
    }
    try {
      persist()
      await sendPasswordReset(email)
      setStatus({ tone: 'ok', text: 'Password reset email sent. Open the link, set a new password, then sign in.' })
    } catch (error) {
      setStatus({ tone: 'error', text: errorText(error) })
    }
  }

  const onCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SYNC_SQL)
      toast('Setup SQL copied.', 'success')
    } catch {
      setStatus({ tone: 'error', text: 'Could not copy automatically. Select the SQL below and copy it manually.' })
    }
  }

  const onDownload = () => {
    try {
      downloadBackup(loadHistory())
      setStatus({ tone: 'ok', text: 'Backup file downloaded. Keep it somewhere safe.' })
      toast('Backup file downloaded.', 'success')
    } catch (error) {
      setStatus({ tone: 'error', text: errorText(error) })
    }
  }

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      setRestoreText(await file.text())
      setStatus({ tone: 'info', text: `Loaded ${file.name}. Press “Restore backup” below.` })
    } catch {
      setStatus({ tone: 'error', text: 'That file could not be read.' })
    }
  }

  const onRestore = async () => {
    if (!restoreText.trim()) {
      setStatus({ tone: 'error', text: 'Paste a backup code, or choose a backup file first.' })
      return
    }
    setBusy('restore')
    setStatus({ tone: 'info', text: 'Reading the backup…' })
    try {
      const result = await restoreBackup(restoreText, passphrase, mode)
      setRestoreText('')
      setStatus({
        tone: 'ok',
        text: `Restored ${result.total} scan${result.total === 1 ? '' : 's'}${
          result.ai ? ', your Gemini API key and AI settings' : ''
        }.${result.sync ? ' Email backup settings were restored too.' : ''}`,
      })
      toast('Backup restored.', 'success')
      onRestored?.()
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof BackupPassphraseError ? error.message : errorText(error),
      })
    } finally {
      setBusy('')
    }
  }

  const signedIn = Boolean(user)

  return (
    <section className="card">
      <h2 className="card__title">
        <Icon name="shield" size={18} /> Cloud sync (Supabase)
      </h2>
      <p className="field__help">
        Keep the same scans, settings and Gemini API key on every device. The app talks straight to your own free
        Supabase project; there is no Scan &amp; Help server. Everything is compressed and encrypted with your sync
        passphrase before it is uploaded, so Supabase only stores unreadable data.
      </p>

      <div className="fieldGrid">
        <label className="field">
          <span>Project URL</span>
          <input
            value={config.url}
            onChange={(event) => update({ url: event.target.value })}
            placeholder="https://yourproject.supabase.co"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Publishable / anon key</span>
          <input
            value={config.anonKey}
            onChange={(event) => update({ anonKey: event.target.value })}
            placeholder="sb_publishable_… or eyJhbGciOi…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="settingsActions">
        <button type="button" className="btn btn--soft" onClick={onSaveConnection}>
          Save connection
        </button>
        <a
          className="btn btn--ghost"
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer noopener"
        >
          Open Supabase <Icon name="external" size={14} />
        </a>
      </div>

      <details className="advanced">
        <summary>Supabase setup (one time)</summary>
        <ol className="legalList legalList--ordered">
          <li>
            Create a free project at{' '}
            <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer noopener">
              supabase.com <Icon name="external" size={12} />
            </a>
            . In <strong>Project Settings → API</strong>, copy the <strong>Project URL</strong> and the{' '}
            <strong>publishable / anon key</strong> into the fields above.
          </li>
          <li>
            Open <strong>SQL Editor → New query</strong>, paste the SQL below and press <strong>Run</strong>. This
            creates the sync table and locks it so each account can only read its own row.
          </li>
          <li>
            Optional but simplest: <strong>Authentication → Sign In / Providers → Email</strong> and turn off{' '}
            <strong>Confirm email</strong>. Then an account works immediately after signing up. If you leave it on,
            open the confirmation link first.
          </li>
          <li>Come back here, create an account below, choose a sync passphrase and press “Sync now”.</li>
        </ol>
        <pre className="sqlBlock">
          <code>{SYNC_SQL}</code>
        </pre>
        <button type="button" className="btn btn--soft" onClick={() => void onCopySql()}>
          <Icon name="copy" size={16} /> Copy SQL
        </button>
      </details>

      {signedIn ? (
        <div className="accountRow">
          <span className="accountEmail">
            <Icon name="check" size={13} /> {user?.email}
          </span>
          <button type="button" className="btn btn--ghost" onClick={() => void onSignOut()} disabled={busy !== ''}>
            Sign out
          </button>
        </div>
      ) : (
        <div className="authBox">
          <div className="authToggle" role="tablist" aria-label="Sync account">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'signin'}
              className={`authToggle__btn ${authMode === 'signin' ? 'is-active' : ''}`}
              onClick={() => setAuthMode('signin')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'signup'}
              className={`authToggle__btn ${authMode === 'signup' ? 'is-active' : ''}`}
              onClick={() => setAuthMode('signup')}
            >
              Create account
            </button>
          </div>
          <div className="fieldGrid">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={authMode === 'signup' ? 'At least 6 characters' : 'Your sync account password'}
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              />
            </label>
          </div>
          <div className="settingsActions">
            <button type="button" className="btn btn--primary" onClick={() => void onAuth()} disabled={busy !== ''}>
              <Icon name="shield" size={17} />{' '}
              {busy === 'auth' ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            {authMode === 'signin' ? (
              <button type="button" className="btn btn--ghost" onClick={() => void onForgot()}>
                Forgot password
              </button>
            ) : null}
          </div>
          <p className="field__help">
            This account lives in your Supabase project, not in Scan &amp; Help. Any email works — it is only used for
            signing in.
          </p>
        </div>
      )}

      <div className="fieldGrid">
        <label className="field">
          <span>Sync passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphraseValue(event.target.value)}
            placeholder="Used to encrypt everything"
            autoComplete="new-password"
            spellCheck={false}
          />
        </label>
      </div>

      <label className="checkRow">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        <span>
          <strong>Remember the passphrase on this device</strong>
          <small>
            Lets background sync run after you reopen the app. It is stored in this browser only — leave this off on a
            shared device.
          </small>
        </span>
      </label>

      <label className="checkRow">
        <input type="checkbox" checked={config.auto} onChange={(event) => update({ auto: event.target.checked })} />
        <span>
          <strong>Sync automatically</strong>
          <small>
            Uploads after each scan and checks for changes from your other devices when the app opens or comes back
            into view.
          </small>
        </span>
      </label>

      <div className="settingsActions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void runSync()}
          disabled={busy !== '' || !signedIn}
        >
          <Icon name="refresh" size={17} /> {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </button>
        <button type="button" className="btn btn--soft" onClick={() => void onDownload()}>
          <Icon name="download" size={17} /> Download file
        </button>
      </div>

      {lastSync ? (
        <p className="field__help">
          Last cloud sync: {when(lastSync)}
          {!passphrase ? ' — enter the passphrase to sync again.' : ''}
        </p>
      ) : null}

      {status ? <div className={`statusLine statusLine--${status.tone}`}>{status.text}</div> : null}

      <details className="advanced">
        <summary>Restore from a file or backup code</summary>
        <label className="field">
          <span>Backup code or file</span>
          <textarea
            value={restoreText}
            onChange={(event) => setRestoreText(event.target.value)}
            rows={4}
            placeholder="Paste an SHB1: code, or load a backup file…"
            spellCheck={false}
          />
        </label>
        <div className="settingsActions">
          <button type="button" className="btn btn--soft" onClick={() => fileRef.current?.click()}>
            <Icon name="doc" size={17} /> Choose file
          </button>
          <select
            className="selectInline"
            value={mode}
            onChange={(event) => setMode(event.target.value as RestoreMode)}
            aria-label="Restore mode"
          >
            <option value="merge">Merge with this device</option>
            <option value="replace">Replace this device</option>
          </select>
          <button type="button" className="btn btn--primary" onClick={() => void onRestore()} disabled={busy !== ''}>
            {busy === 'restore' ? 'Restoring…' : 'Restore backup'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          onChange={(event) => void onPickFile(event)}
          hidden
        />
        <p className="field__help">
          Restoring also brings back your Gemini API key, model, endpoint and email backup settings. Merge keeps scans
          made on this device; replace makes this device match the backup.
        </p>
      </details>
    </section>
  )
}
