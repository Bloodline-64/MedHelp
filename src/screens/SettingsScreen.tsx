import { useEffect, useState, type FormEvent } from 'react'
import { CloudSyncCard } from '../components/CloudSyncCard'
import { Icon } from '../components/Icon'
import { SyncCard } from '../components/SyncCard'
import { ThemeCard } from '../components/ThemeCard'
import { useToast } from '../components/Toast'
import {
  AI_DEFAULT_BASE,
  AI_DEFAULT_MODEL,
  AI_MODEL_SUGGESTIONS,
  aiErrorMessage,
  clearAISettings,
  getAIConfig,
  listAIModels,
  saveAIConfig,
  testAIConnection,
} from '../lib/ai'
import { maybeAutoSync } from '../lib/supabase'
import { useAIState } from '../lib/useAI'

export function SettingsScreen({
  onInstalled,
  installAvailable,
}: {
  onInstalled?: () => void
  installAvailable?: boolean
}) {
  const ai = useAIState()
  const { toast } = useToast()

  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(AI_DEFAULT_MODEL)
  const [baseUrl, setBaseUrl] = useState(AI_DEFAULT_BASE)
  const [vision, setVision] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [listing, setListing] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null)

  useEffect(() => {
    const config = getAIConfig()
    setApiKey(config.apiKey)
    setModel(config.model)
    setBaseUrl(config.baseUrl)
    setVision(config.vision)
  }, [])

  const reloadFromBackup = () => {
    const config = getAIConfig()
    setApiKey(config.apiKey)
    setModel(config.model)
    setBaseUrl(config.baseUrl)
    setVision(config.vision)
    setModels([])
    setStatus({ tone: 'ok', text: 'Backup restored. The Gemini key and settings above are now active.' })
  }

  const formConfig = () => ({
    enabled: true,
    apiKey: apiKey.trim(),
    model: model.trim() || AI_DEFAULT_MODEL,
    baseUrl: baseUrl.trim() || AI_DEFAULT_BASE,
    vision,
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    const saved = saveAIConfig(formConfig())
    setSaving(false)
    if (!saved.ok) {
      setStatus({ tone: 'error', text: saved.error })
      return
    }
    setStatus({ tone: 'ok', text: 'Settings saved. Scans will use these settings immediately.' })
    toast('AI settings saved.', 'success')
    // Keep the encrypted cloud copy in step when auto-sync is on.
    maybeAutoSync()
  }

  const onTest = async () => {
    setTesting(true)
    setStatus({ tone: 'info', text: 'Testing the connection…' })
    try {
      await testAIConnection(formConfig())
      setStatus({ tone: 'ok', text: 'Connection works. The key and model are valid.' })
    } catch (caught) {
      setStatus({ tone: 'error', text: aiErrorMessage(caught) })
    } finally {
      setTesting(false)
    }
  }

  const onListModels = async () => {
    setListing(true)
    setStatus({ tone: 'info', text: 'Asking Google which models this key can use…' })
    try {
      const found = await listAIModels(formConfig())
      setModels(found)
      setStatus({
        tone: found.length > 0 ? 'ok' : 'error',
        text:
          found.length > 0
            ? `Found ${found.length} models. Pick one below or keep “${model}”.`
            : 'The key returned no usable Gemini models.',
      })
    } catch (caught) {
      setStatus({ tone: 'error', text: aiErrorMessage(caught) })
    } finally {
      setListing(false)
    }
  }

  const onClear = () => {
    if (!window.confirm('Remove the API key and AI settings from this browser?')) return
    clearAISettings()
    setApiKey('')
    setModel(AI_DEFAULT_MODEL)
    setBaseUrl(AI_DEFAULT_BASE)
    setVision(true)
    setModels([])
    setStatus({ tone: 'info', text: 'AI settings removed. Local OCR and pasted text still work.' })
    toast('AI settings removed.', 'success')
  }

  return (
    <div className="screen settingsScreen">
      <header className="pageHead">
        <div>
          <h1>Settings</h1>
          <p>Connect Gemini once, and this browser remembers it.</p>
        </div>
      </header>

      <div className={`statusCard ${ai.ready ? 'statusCard--ok' : 'statusCard--warn'}`}>
        <span className="statusCard__icon">
          <Icon name={ai.ready ? 'check' : 'spark'} size={20} />
        </span>
        <div>
          <strong>{ai.ready ? 'AI is ready' : ai.configured ? 'AI is configured but not available' : 'AI is not connected yet'}</strong>
          <p>
            {ai.ready
              ? `Using ${ai.model}${ai.vision ? ' with camera vision' : ' (vision is off)'}.`
              : ai.configured
                ? ai.online
                  ? 'Turn AI on and check your key below.'
                  : 'You are offline. Local OCR still works for text scans.'
                : 'Add a free Gemini API key to analyse injuries, objects and images. Without a key you can still scan text offline.'}
          </p>
        </div>
      </div>

      <ThemeCard />

      <form className="settingsForm" onSubmit={onSubmit}>
        <section className="card">
          <h2 className="card__title">
            <Icon name="spark" size={18} /> Gemini API key
          </h2>
          <label className="field">
            <span>API key</span>
            <div className="field__row">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="AIza…"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="iconBtn"
                onClick={() => setShowKey((shown) => !shown)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
              >
                <Icon name="eye" size={18} />
              </button>
            </div>
          </label>
          <p className="field__help">
            Get a free key at{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener">
              aistudio.google.com/apikey <Icon name="external" size={12} />
            </a>
            . The key is stored only in this browser and is sent directly to Google. Do not use a shared or public
            computer.
          </p>

          <label className="checkRow">
            <input type="checkbox" checked={vision} onChange={(event) => setVision(event.target.checked)} />
            <span>
              <strong>Camera vision</strong>
              <small>Allow images to be analysed. Turn off to use text-only features.</small>
            </span>
          </label>
        </section>

        <section className="card">
          <h2 className="card__title">
            <Icon name="settings" size={18} /> Model
          </h2>
          <label className="field">
            <span>Model ID</span>
            <div className="field__row">
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                list="model-options"
                spellCheck={false}
              />
              <button type="button" className="btn btn--soft" onClick={() => void onListModels()} disabled={listing}>
                {listing ? 'Finding…' : 'Find models'}
              </button>
            </div>
            <datalist id="model-options">
              {(models.length > 0 ? models : AI_MODEL_SUGGESTIONS).map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </label>
          {models.length > 0 ? (
            <label className="field">
              <span>Available models</span>
              <select value={models.includes(model) ? model : ''} onChange={(event) => setModel(event.target.value)}>
                <option value="">Choose a model…</option>
                {models.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="field__help">
            <code>gemini-3.6-flash</code> is a good balance of speed and vision accuracy. Switch to{' '}
            <code>gemini-3.5-flash-lite</code> if you hit free-tier limits.
          </p>

          <details className="advanced">
            <summary>Advanced endpoint</summary>
            <label className="field">
              <span>API base URL</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                spellCheck={false}
                placeholder={AI_DEFAULT_BASE}
              />
            </label>
            <p className="field__help">
              Keep the default for Gemini. Any OpenAI-compatible endpoint with vision support can be used instead.
            </p>
          </details>
        </section>

        {status ? <div className={`statusLine statusLine--${status.tone}`}>{status.text}</div> : null}

        <div className="settingsActions">
          <button type="submit" className="btn btn--primary" disabled={saving || !apiKey.trim()}>
            <Icon name="check" size={18} /> {saving ? 'Saving…' : 'Save settings'}
          </button>
          <button type="button" className="btn btn--soft" onClick={() => void onTest()} disabled={testing || !apiKey.trim()}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="btn btn--ghost btn--danger" onClick={onClear} disabled={!ai.configured}>
            Remove key
          </button>
        </div>
      </form>

      <CloudSyncCard onRestored={reloadFromBackup} />

      <details className="advanced emailBackup">
        <summary>Email a backup instead (EmailJS)</summary>
        <SyncCard onRestored={reloadFromBackup} />
      </details>

      {installAvailable ? (
        <section className="card card--compact">
          <h2 className="card__title">
            <Icon name="download" size={18} /> Install the app
          </h2>
          <p className="field__help">Add Scan &amp; Help to your home screen so it opens full-screen and works offline.</p>
          <button type="button" className="btn btn--soft" onClick={onInstalled}>
            Install on this device
          </button>
        </section>
      ) : null}

      <section className="card card--compact">
        <h2 className="card__title">
          <Icon name="shield" size={18} /> Privacy and safety
        </h2>
        <ul className="legalList">
          <li>Photos are sent only to the AI provider you configure. Nothing is uploaded to a Scan &amp; Help server.</li>
          <li>History and settings are stored in this browser. Clearing browser data removes them unless you use cloud sync or a backup file.</li>
          <li>
            Cloud sync stores one row per account in your own Supabase project. It is compressed and encrypted with your
            sync passphrase before upload, so neither Supabase nor anyone else can read your scans or Gemini API key.
          </li>
          <li>Email backups are sent by EmailJS. They are encrypted in this browser first; turn encryption off only if you accept that the email contains your API key.</li>
          <li>Results are AI guidance, not medical or professional advice. For emergencies, call your local emergency number.</li>
          <li>Do not rely on plant, mushroom or food identification from a photo alone.</li>
        </ul>
      </section>
    </div>
  )
}
