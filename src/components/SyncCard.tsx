import { useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import {
  BackupPassphraseError,
  clearPassphrase,
  downloadBackup,
  getLastSync,
  getPassphrase,
  getSyncConfig,
  isPassphraseRemembered,
  restoreBackup,
  saveSyncConfig,
  sendBackupEmail,
  setPassphrase,
  syncReady,
  type RestoreMode,
  type SyncConfig,
} from '../lib/backup'
import { loadHistory } from '../lib/history'

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

export function SyncCard({ onRestored }: { onRestored?: () => void }) {
  const { toast } = useToast()
  const [config, setConfig] = useState<SyncConfig>(getSyncConfig)
  const [passphrase, setPassphraseValue] = useState(getPassphrase)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState<'' | 'send' | 'restore'>('')
  const [restoreText, setRestoreText] = useState('')
  const [mode, setMode] = useState<RestoreMode>('merge')
  const [lastSync, setLastSync] = useState(getLastSync)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const update = (patch: Partial<SyncConfig>) => setConfig((current) => ({ ...current, ...patch }))

  const persist = (): SyncConfig => {
    const saved = saveSyncConfig({ ...config, email: config.email.trim() })
    if (saved.encrypt) setPassphrase(passphrase.trim(), isPassphraseRemembered())
    else clearPassphrase()
    setConfig(saved)
    return saved
  }

  const onSave = () => {
    persist()
    setStatus({ tone: 'ok', text: 'Email backup settings saved in this browser.' })
    toast('Backup settings saved.', 'success')
  }

  const onSend = async () => {
    setBusy('send')
    setStatus({ tone: 'info', text: 'Packing, encrypting and sending your backup…' })
    try {
      const saved = persist()
      if (!syncReady(saved)) throw new Error('Add your email address and the three EmailJS values first.')
      if (saved.encrypt && !passphrase.trim()) throw new Error('Choose a backup passphrase, or turn encryption off.')
      const result = await sendBackupEmail(loadHistory(), saved, passphrase.trim())
      setLastSync(result.at)
      setStatus({
        tone: 'ok',
        text: `Backup emailed to ${saved.email} — ${result.entries} scan${result.entries === 1 ? '' : 's'}${
          result.trimmed ? ` (${result.trimmed} older scan${result.trimmed === 1 ? '' : 's'} stayed on this device)` : ''
        }.`,
      })
      toast('Backup emailed.', 'success')
    } catch (error) {
      setStatus({ tone: 'error', text: errorText(error) })
    } finally {
      setBusy('')
    }
  }

  const onDownload = () => {
    try {
      persist()
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
      setStatus({ tone: 'error', text: 'Paste the backup code from your email, or choose a backup file first.' })
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

  return (
    <section className="card">
      <h2 className="card__title">
        <Icon name="send" size={18} /> Email backup (EmailJS)
      </h2>
      <p className="field__help">
        Email yourself the full history and settings — including the Gemini API key — then restore them on any device.
        Backups are compressed and encrypted in this browser before they are sent. EmailJS delivers the message; there
        is still no Scan &amp; Help server.
      </p>

      <div className="fieldGrid">
        <label className="field">
          <span>Send to email</span>
          <input
            type="email"
            value={config.email}
            onChange={(event) => update({ email: event.target.value })}
            placeholder="you@example.com"
            autoComplete="email"
            spellCheck={false}
          />
        </label>

        <label className="field">
          <span>Backup passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphraseValue(event.target.value)}
            placeholder="Used to encrypt the backup"
            autoComplete="new-password"
            spellCheck={false}
          />
        </label>
      </div>

      <details className="advanced">
        <summary>EmailJS settings</summary>
        <label className="field">
          <span>Service ID</span>
          <input
            value={config.serviceId}
            onChange={(event) => update({ serviceId: event.target.value })}
            placeholder="service_xxxxxxx"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Template ID</span>
          <input
            value={config.templateId}
            onChange={(event) => update({ templateId: event.target.value })}
            placeholder="template_xxxxxxx"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Public key</span>
          <input
            value={config.publicKey}
            onChange={(event) => update({ publicKey: event.target.value })}
            placeholder="EmailJS public key"
            spellCheck={false}
          />
        </label>
      </details>

      <label className="checkRow">
        <input type="checkbox" checked={config.encrypt} onChange={(event) => update({ encrypt: event.target.checked })} />
        <span>
          <strong>Encrypt with my passphrase</strong>
          <small>Recommended. Without this, the email contains your Gemini API key in plain text.</small>
        </span>
      </label>

      <label className="checkRow">
        <input type="checkbox" checked={config.auto} onChange={(event) => update({ auto: event.target.checked })} />
        <span>
          <strong>Send automatically after every scan</strong>
          <small>
            One email per scan (EmailJS free plan: 200 emails a month). The passphrase is kept only for this browser
            session.
          </small>
        </span>
      </label>

      <div className="settingsActions">
        <button type="button" className="btn btn--primary" onClick={() => void onSend()} disabled={busy !== ''}>
          <Icon name="send" size={17} /> {busy === 'send' ? 'Sending…' : 'Send backup now'}
        </button>
        <button type="button" className="btn btn--soft" onClick={onSave}>
          Save settings
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDownload}>
          <Icon name="download" size={17} /> Download file
        </button>
      </div>

      {lastSync ? (
        <p className="field__help">
          Last emailed backup: {when(lastSync)}
          {config.encrypt && !passphrase ? ' — enter your passphrase again to send the next one.' : ''}
        </p>
      ) : null}

      {status ? <div className={`statusLine statusLine--${status.tone}`}>{status.text}</div> : null}

      <details className="advanced">
        <summary>Restore a backup</summary>
        <label className="field">
          <span>Backup code or file</span>
          <textarea
            value={restoreText}
            onChange={(event) => setRestoreText(event.target.value)}
            rows={4}
            placeholder="Paste the SHB1: code from your email, or load a backup file…"
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

      <details className="advanced">
        <summary>How to set up email sending</summary>
        <ol className="legalList legalList--ordered">
          <li>
            Create a free account at{' '}
            <a href="https://www.emailjs.com" target="_blank" rel="noreferrer noopener">
              emailjs.com <Icon name="external" size={12} />
            </a>{' '}
            and connect your email service (Gmail, Outlook, …). Copy its <strong>Service ID</strong>.
          </li>
          <li>
            Create an email template with <strong>To Email</strong> set to <code>{'{{to_email}}'}</code>, subject{' '}
            <code>{'Scan & Help backup {{exported_at}}'}</code> and content{' '}
            <code>{'<div style="white-space:pre-wrap">{{message}}</div>'}</code>. Copy its <strong>Template ID</strong>.
          </li>
          <li>
            Copy your <strong>Public Key</strong> from the EmailJS account page into the fields above.
          </li>
          <li>Press “Send backup now” once to test it. The email arrives with a restore code.</li>
        </ol>
        <p className="field__help">
          EmailJS receives the recipient address and the encrypted backup. If you turn encryption off, it also sees your
          API key. Free plan limit: 50 KB per message, so photos are not emailed — the text history and settings are.
        </p>
      </details>
    </section>
  )
}
