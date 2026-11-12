import { useCallback, useEffect, useState } from 'react'
import { Icon } from './components/Icon'
import { ToastProvider } from './components/Toast'
import { maybeAutoSync as maybeAutoBackup } from './lib/backup'
import { HISTORY_EVENT, addHistoryEntry, clearHistory, loadHistory, removeHistoryEntry } from './lib/history'
import { initCloudSync, maybeAutoSync as maybeAutoCloudSync } from './lib/supabase'
import { AskScreen } from './screens/AskScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { ScanScreen } from './screens/ScanScreen'
import { SettingsScreen } from './screens/SettingsScreen'

type Tab = 'scan' | 'ask' | 'history' | 'settings'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const TABS: Array<{ id: Tab; label: string; icon: 'scan' | 'spark' | 'history' | 'settings' }> = [
  { id: 'scan', label: 'Scan', icon: 'scan' },
  { id: 'ask', label: 'Ask', icon: 'spark' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('scan')
  const [entries, setEntries] = useState(loadHistory)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as InstallPromptEvent)
    }
    const onInstalled = () => setInstallEvent(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  useEffect(() => {
    const reload = () => setEntries(loadHistory())
    window.addEventListener(HISTORY_EVENT, reload)
    return () => window.removeEventListener(HISTORY_EVENT, reload)
  }, [])

  useEffect(() => initCloudSync(), [])

  const onSaved = useCallback((entry: Parameters<typeof addHistoryEntry>[0]) => {
    const next = addHistoryEntry(entry)
    setEntries(next)
    // Optional cloud and email backups; both are best-effort and never block the UI.
    maybeAutoCloudSync()
    void maybeAutoBackup(next)
  }, [])

  const install = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') setInstallEvent(null)
  }

  return (
    <ToastProvider>
      <div className="app">
        <header className="appBar">
          <button type="button" className="brand" onClick={() => setTab('scan')} aria-label="Scan & Help home">
            <span className="brand__mark">
              <Icon name="scan" size={19} strokeWidth={2.1} />
            </span>
            <span className="brand__name">
              Scan <em>&amp;</em> Help
            </span>
          </button>
          <span className={`netPill${online ? '' : ' netPill--off'}`}>
            <span className="netPill__dot" />
            {online ? 'Online' : 'Offline'}
          </span>
        </header>

        <main className="appMain">
          <div hidden={tab !== 'scan'}>
            <ScanScreen active={tab === 'scan'} onOpenSettings={() => setTab('settings')} onSaved={onSaved} />
          </div>
          {tab === 'ask' ? (
            <AskScreen onOpenSettings={() => setTab('settings')} onSaved={onSaved} />
          ) : null}
          {tab === 'history' ? (
            <HistoryScreen
              entries={entries}
              onDelete={(id) => setEntries(removeHistoryEntry(id))}
              onClear={() => setEntries(clearHistory())}
              onScan={() => setTab('scan')}
              onAsk={() => setTab('ask')}
            />
          ) : null}
          {tab === 'settings' ? (
            <SettingsScreen installAvailable={Boolean(installEvent)} onInstalled={() => void install()} />
          ) : null}
        </main>

        <nav className="tabBar" aria-label="Main">
          <div className="tabBar__brand" aria-hidden="true">
            <span className="brand__mark">
              <Icon name="scan" size={18} strokeWidth={2.1} />
            </span>
            <span className="tabBar__brandText">
              Scan <em>&amp;</em> Help
            </span>
          </div>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`tabBar__btn${tab === entry.id ? ' is-active' : ''}`}
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? 'page' : undefined}
            >
              <span className="tabBar__icon">
                <Icon name={entry.icon} size={21} />
                {entry.id === 'history' && entries.length > 0 ? (
                  <span className="tabBar__count">{entries.length > 9 ? '9+' : entries.length}</span>
                ) : null}
              </span>
              {entry.label}
            </button>
          ))}
          <div className="tabBar__foot">
            <span className={`tabBar__status${online ? '' : ' is-off'}`}>
              <span className="netPill__dot" />
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
        </nav>
      </div>
    </ToastProvider>
  )
}
