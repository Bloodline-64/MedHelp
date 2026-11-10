import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { ResultCard } from '../components/ResultCard'
import { useToast } from '../components/Toast'
import { getPassphrase, getSyncConfig, sendBackupEmail, syncReady } from '../lib/backup'
import type { HistoryEntry } from '../lib/history'
import { cloudReady, syncNow } from '../lib/supabase'
import { kindLabel, modeLabel } from '../types'

function when(ts: number): string {
  const date = new Date(ts)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  return date.toLocaleString(undefined, options)
}

async function copy(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = value
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function HistoryScreen({
  entries,
  onDelete,
  onClear,
  onScan,
}: {
  entries: HistoryEntry[]
  onDelete: (id: string) => void
  onClear: () => void
  onScan: () => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState<HistoryEntry | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((entry) => {
      const result = entry.result
      return [result.title, result.summary, result.transcription, ...result.findings, ...result.advice]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  }, [entries, query])

  const share = async (entry: HistoryEntry) => {
    const result = entry.result
    const text = [result.title, '', result.summary, '', ...result.advice.map((item) => `• ${item}`)].join('\n')
    if (navigator.share) {
      try {
        await navigator.share({ title: result.title, text })
        return
      } catch {
        // Fall through to copy.
      }
    }
    const ok = await copy(text)
    toast(ok ? 'Copied to clipboard.' : 'Copy failed.', ok ? 'success' : 'error')
  }

  const backup = async () => {
    try {
      const config = getSyncConfig()
      if (!syncReady(config)) {
        toast('Set up email backup in Settings first.', 'error')
        return
      }
      const passphrase = config.encrypt ? getPassphrase() : ''
      if (config.encrypt && !passphrase) {
        toast('Enter your backup passphrase in Settings → Email backup first.', 'error')
        return
      }
      const result = await sendBackupEmail(entries, config, passphrase)
      toast(`Backup emailed — ${result.entries} scan${result.entries === 1 ? '' : 's'}.`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Backup failed.', 'error')
    }
  }

  const syncCloud = async () => {
    try {
      const result = await syncNow()
      toast(`Synced — ${result.total} scan${result.total === 1 ? '' : 's'}.`, 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Cloud sync failed.', 'error')
    }
  }

  const cloud = cloudReady()
  const email = syncReady()

  return (
    <div className="screen historyScreen">
      <header className="pageHead">
        <div>
          <h1>History</h1>
          <p>{entries.length === 0 ? 'Your scans will appear here.' : `${entries.length} saved scan${entries.length === 1 ? '' : 's'} on this device.`}</p>
        </div>
        {entries.length > 0 ? (
          <div className="headActions">
            {cloud ? (
              <button type="button" className="iconBtn" onClick={() => void syncCloud()} aria-label="Sync with Supabase">
                <Icon name="refresh" size={18} />
              </button>
            ) : null}
            {email ? (
              <button type="button" className="iconBtn" onClick={() => void backup()} aria-label="Email a backup">
                <Icon name="send" size={18} />
              </button>
            ) : null}
            <button
              type="button"
              className="iconBtn"
              onClick={() => {
                if (window.confirm('Delete all saved scans from this device?')) {
                  onClear()
                  setOpen(null)
                  toast('History cleared.', 'success')
                }
              }}
              aria-label="Clear all history"
            >
              <Icon name="trash" size={19} />
            </button>
          </div>
        ) : null}
      </header>

      {entries.length > 0 ? (
        <div className="searchBox">
          <Icon name="scan" size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search scans, text or advice…"
            aria-label="Search history"
          />
          {query ? (
            <button type="button" className="iconBtn iconBtn--small" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="x" size={16} />
            </button>
          ) : null}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="emptyState">
          <span className="emptyState__icon">
            <Icon name="history" size={30} />
          </span>
          <h2>No scans yet</h2>
          <p>Scan an injury, a letter, a label or an object and the result will be saved here — privately, on this device.</p>
          <button type="button" className="btn btn--primary" onClick={onScan}>
            <Icon name="camera" size={18} /> Start a scan
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="empty-note">No scans match “{query}”.</p>
      ) : (
        <ul className="historyList">
          {filtered.map((entry) => (
            <li key={entry.result.id} className="historyItem">
              <button type="button" className="historyItem__main" onClick={() => setOpen(entry)}>
                {entry.thumb ? (
                  <img className="historyItem__thumb" src={entry.thumb} alt="" />
                ) : (
                  <span className="historyItem__thumb historyItem__thumb--text">
                    <Icon name="text" size={20} />
                  </span>
                )}
                <span className="historyItem__body">
                  <span className="historyItem__top">
                    <span className="historyItem__title">{entry.result.title}</span>
                    <span className="historyItem__time">{when(entry.result.at)}</span>
                  </span>
                  <span className="historyItem__summary">{entry.result.summary || entry.result.transcription.slice(0, 120)}</span>
                  <span className="historyItem__tags">
                    <span className={`badge badge--kind badge--${entry.result.urgency}`}>
                      {kindLabel(entry.result.kind)}
                    </span>
                    <span className="historyItem__mode">{modeLabel(entry.result.mode)}</span>
                  </span>
                </span>
                <Icon name="chevron" size={17} className="historyItem__chevron" />
              </button>
              <button
                type="button"
                className="historyItem__delete"
                onClick={() => {
                  onDelete(entry.result.id)
                  if (open?.result.id === entry.result.id) setOpen(null)
                  toast('Scan deleted.', 'success')
                }}
                aria-label={`Delete ${entry.result.title}`}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-label={open.result.title}>
          <div className="sheet__bar">
            <button type="button" className="iconBtn" onClick={() => setOpen(null)} aria-label="Close">
              <Icon name="arrowLeft" size={20} />
            </button>
            <span className="sheet__label">{when(open.result.at)}</span>
            <div className="resultTop__spacer" />
            <button
              type="button"
              className="iconBtn"
              onClick={async () => {
                const ok = await copy(open.result.transcription || open.result.summary)
                toast(ok ? 'Copied.' : 'Copy failed.', ok ? 'success' : 'error')
              }}
              aria-label="Copy text"
            >
              <Icon name="copy" size={18} />
            </button>
            <button type="button" className="iconBtn" onClick={() => void share(open)} aria-label="Share">
              <Icon name="share" size={18} />
            </button>
          </div>
          <div className="sheet__body">
            <ResultCard result={open.result} thumb={open.thumb} />
          </div>
          <div className="sheet__actions">
            <button type="button" className="btn btn--primary" onClick={onScan}>
              <Icon name="plus" size={18} /> New scan
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
