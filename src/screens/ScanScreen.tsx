import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { ResultCard } from '../components/ResultCard'
import { useToast } from '../components/Toast'
import {
  aiErrorMessage,
  analyzeImage,
  analyzeText,
  askAboutScan,
  makeThumb,
} from '../lib/ai'
import { describeOcrStatus, OcrUnavailableError, recognizeText } from '../lib/ocr'
import { useAIState } from '../lib/useAI'
import {
  SCAN_MODES,
  modeLabel,
  type ScanMode,
  type ScanResult,
} from '../types'
import type { HistoryEntry } from '../lib/history'

interface ScanImage {
  blob: Blob
  url: string
  name: string
}

type Engine = 'ai' | 'ocr' | null

const TEXT_MODES: ScanMode[] = ['auto', 'text', 'document']

function localId(): string {
  return `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const copied = document.execCommand('copy')
      area.remove()
      return copied
    } catch {
      return false
    }
  }
}

function shareText(result: ScanResult): string {
  const lines = [result.title, '', result.summary]
  if (result.findings.length > 0) lines.push('', 'What I can see:', ...result.findings.map((entry) => `• ${entry}`))
  if (result.advice.length > 0) lines.push('', 'What to do:', ...result.advice.map((entry, index) => `${index + 1}. ${entry}`))
  if (result.redFlags.length > 0) {
    lines.push('', 'Get help urgently if:', ...result.redFlags.map((entry) => `• ${entry}`))
  }
  lines.push('', 'Shared from Scan & Help. Not a diagnosis.')
  return lines.filter((line) => line !== undefined).join('\n')
}

function freeLocalResult(value: string, mode: ScanMode, note: string): ScanResult {
  return {
    id: localId(),
    at: Date.now(),
    mode,
    kind: mode === 'document' ? 'document' : 'text',
    title: mode === 'document' ? 'Document text (offline)' : 'Text found (offline)',
    transcription: value,
    summary: note,
    findings: [],
    advice: [],
    redFlags: [],
    urgency: 'unknown',
    confidence: 'medium',
    followUpQuestions: [],
    model: 'local OCR',
  }
}

export function ScanScreen({
  active,
  onOpenSettings,
  onSaved,
}: {
  active: boolean
  onOpenSettings: () => void
  onSaved: (entry: HistoryEntry) => void
}) {
  const ai = useAIState()
  const { toast } = useToast()

  const [mode, setMode] = useState<ScanMode>('auto')
  const [image, setImage] = useState<ScanImage | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [thumb, setThumb] = useState<string | undefined>(undefined)
  const [engine, setEngine] = useState<Engine>(null)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [rerunMode, setRerunMode] = useState<ScanMode>('auto')

  const [chat, setChat] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const busyRef = useRef(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const questionRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.url)
    }
  }, [image])

  useEffect(() => {
    if (!active) stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!cameraOn) return
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return
    video.srcObject = stream
    void video.play().catch(() => undefined)
  }, [cameraOn])

  useEffect(() => {
    if (!active) return
    const onPaste = (event: ClipboardEvent) => {
      if (busyRef.current) return
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            event.preventDefault()
            void loadBlob(file, `pasted-${Date.now()}.png`)
            return
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOn(true)
    } catch {
      toast('Camera access was blocked. Opening your photo app instead.', 'warn')
      cameraInputRef.current?.click()
    }
  }

  const capture = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0) {
      toast('The camera is not ready yet.', 'warn')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast('Could not capture that frame.', 'error')
          return
        }
        stopCamera()
        void loadBlob(blob, `capture-${Date.now()}.jpg`)
      },
      'image/jpeg',
      0.92,
    )
  }

  const persist = (scan: ScanResult, thumbUrl?: string) => {
    onSaved({ result: scan, thumb: thumbUrl })
  }

  const loadBlob = async (blob: Blob, name: string) => {
    if (busyRef.current) return
    if (blob.size > 25 * 1024 * 1024) {
      toast('That image is very large. Try one under 25 MB.', 'error')
      return
    }
    const next: ScanImage = { blob, url: URL.createObjectURL(blob), name }
    setImage((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return next
    })
    resetResult()
    stopCamera()
    setPasteOpen(false)
    await runScan(blob, mode)
  }

  const onFile = (file: File | undefined | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('That file is not an image.', 'error')
      return
    }
    void loadBlob(file, file.name)
  }

  const resetResult = () => {
    setResult(null)
    setThumb(undefined)
    setError(null)
    setNotice(null)
    setEngine(null)
    setPhase('')
    setProgress(0)
    setChat([])
    setQuestion('')
    setChatError(null)
  }

  const runScan = async (blob: Blob, scanMode: ScanMode) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    setResult(null)
    setThumb(undefined)
    setChat([])
    setChatError(null)
    setEngine(null)

    const thumbPromise = makeThumb(blob)
    const useAI = ai.ready && ai.vision
    let aiFailure = ''

    try {
      if (useAI) {
        setEngine('ai')
        setPhase('Analysing with AI')
        setProgress(0.35)
        try {
          const scan = await analyzeImage(blob, scanMode)
          const thumbUrl = await thumbPromise
          setResult(scan)
          setThumb(thumbUrl)
          setRerunMode(scanMode)
          setProgress(1)
          persist(scan, thumbUrl)
          setEngine('ai')
          toast('Scan complete. Saved to history.', 'success')
          return
        } catch (caught) {
          aiFailure = aiErrorMessage(caught)
          if (!TEXT_MODES.includes(scanMode)) {
            setError(aiFailure)
            return
          }
          setNotice(`${aiFailure} Falling back to local OCR for the text.`)
          setEngine('ocr')
        }
      } else if (!TEXT_MODES.includes(scanMode)) {
        setError(
          ai.configured
            ? 'AI is not available right now. This scan type needs AI vision — check your connection, or open Settings.'
            : 'This scan type needs a Gemini API key. Open Settings to add one — it takes about a minute.',
        )
        return
      }

      setEngine('ocr')
      setPhase('Starting offline OCR')
      setProgress(0)
      const text = await recognizeText(blob, (update) => {
        setPhase(describeOcrStatus(update.status))
        setProgress(update.progress)
      })
      const thumbUrl = await thumbPromise
      if (text.trim()) {
        const scan = freeLocalResult(
          text,
          scanMode,
          'Local OCR read this text on your device. Add a Gemini API key in Settings to get explanations, checks and next steps.',
        )
        setResult(scan)
        setThumb(thumbUrl)
        persist(scan, thumbUrl)
        toast('Text extracted offline. Review it before acting.', 'success')
      } else {
        setError('No readable text was found. Try a sharper, brighter photo, or paste the text instead.')
      }
    } catch (caught) {
      setError(
        caught instanceof OcrUnavailableError
          ? caught.message
          : aiFailure || 'The scan could not be completed. Try again, or paste the text instead.',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
      setPhase('')
    }
  }

  const runPaste = async (event: FormEvent) => {
    event.preventDefault()
    const clean = pasteText.trim()
    if (!clean || busyRef.current) return
    if (!ai.ready) {
      const scan = freeLocalResult(
        clean,
        mode,
        'Pasted text saved on this device. Add a Gemini API key in Settings to get explanations, checks and next steps.',
      )
      setResult(scan)
      setPasteOpen(false)
      persist(scan)
      toast('Text saved. Add an AI key to get help with it.', 'warn')
      return
    }

    busyRef.current = true
    setBusy(true)
    setPhase('Reading your text')
    setError(null)
    setNotice(null)
    setResult(null)
    setChat([])
    setEngine('ai')
    try {
      const scan = await analyzeText(clean, mode)
      setResult(scan)
      setRerunMode(mode)
      setPasteOpen(false)
      persist(scan)
      toast('Text analysed. Saved to history.', 'success')
    } catch (caught) {
      setError(aiErrorMessage(caught))
    } finally {
      busyRef.current = false
      setBusy(false)
      setPhase('')
    }
  }

  const sendQuestion = async (value?: string) => {
    const clean = (value ?? question).trim()
    if (!clean || asking || !result) return
    if (!ai.ready) {
      toast('Add a Gemini API key in Settings to ask follow-up questions.', 'warn')
      return
    }
    setAsking(true)
    setChatError(null)
    setQuestion('')
    const history = chat.map((entry) => ({ role: entry.role, content: entry.text }))
    setChat((current) => [...current, { role: 'user', text: clean }])
    try {
      const answer = await askAboutScan(clean, result, history)
      setChat((current) => [...current, { role: 'assistant', text: answer }])
    } catch (caught) {
      setChatError(aiErrorMessage(caught))
    } finally {
      setAsking(false)
    }
  }

  const copySummary = async () => {
    if (!result) return
    const copied = await copyText(shareText(result))
    toast(copied ? 'Summary copied.' : 'Copy failed. Select the text manually.', copied ? 'success' : 'error')
  }

  const shareSummary = async () => {
    if (!result) return
    const text = shareText(result)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Scan & Help result', text })
        return
      } catch {
        // User cancelled or sharing is unavailable; fall back to copy.
      }
    }
    const copied = await copyText(text)
    toast(copied ? 'Summary copied — paste it anywhere.' : 'Sharing is not available here.', copied ? 'success' : 'error')
  }

  const newScan = () => {
    setImage((previous) => {
      if (previous) URL.revokeObjectURL(previous.url)
      return null
    })
    resetResult()
    stopCamera()
    setPasteOpen(false)
    setPasteText('')
  }

  const rerun = () => {
    if (!image || busyRef.current) return
    setMode(rerunMode)
    resetResult()
    void runScan(image.blob, rerunMode)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    onFile(event.dataTransfer.files?.[0])
  }

  const aiPill = ai.configured ? (
    ai.ready ? (
      <span className="statusPill statusPill--ok">
        <span className="statusDot" /> AI ready · {ai.model}
      </span>
    ) : (
      <span className="statusPill statusPill--warn">
        <span className="statusDot" /> {ai.online ? 'AI off' : 'Offline — OCR only'}
      </span>
    )
  ) : (
    <button type="button" className="statusPill statusPill--warn" onClick={onOpenSettings}>
      <Icon name="spark" size={14} /> Add an API key to unlock AI
    </button>
  )

  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100)
  const modeInfo = SCAN_MODES.find((entry) => entry.id === mode) ?? SCAN_MODES[0]

  return (
    <div className="screen scanScreen">
      {cameraOn ? (
        <div className="camera">
          <video ref={videoRef} className="camera__video" playsInline muted />
          <div className="camera__frame" aria-hidden="true" />
          <div className="camera__top">
            <button type="button" className="iconBtn iconBtn--glass" onClick={stopCamera} aria-label="Close camera">
              <Icon name="x" size={22} />
            </button>
            <span className="camera__mode">{modeInfo.short}</span>
            <span className="camera__spacer" />
          </div>
          <p className="camera__hint">Fill the frame with what you want to scan and hold steady.</p>
          <div className="camera__bottom">
            <button type="button" className="shutter" onClick={capture} aria-label="Take photo">
              <span />
            </button>
          </div>
        </div>
      ) : null}

      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="visuallyHidden"
        onChange={(event) => {
          onFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="visuallyHidden"
        onChange={(event) => {
          onFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />

      {busy ? (
        <div className="scanning" role="status" aria-live="polite">
          {image ? <img src={image.url} alt="" className="scanning__image" /> : <div className="scanning__textArt" />}
          <div className="scanning__card">
            <div className="scanning__spinner" />
            <strong>{phase || 'Working'}</strong>
            <p>{engine === 'ocr' ? 'Reading your device — nothing is uploaded.' : 'Analysing the scan with AI.'}</p>
            <div className="bar">
              <div className="bar__fill" style={{ width: `${engine === 'ocr' ? Math.max(8, percent) : 45}%` }} />
            </div>
          </div>
        </div>
      ) : null}

      {!busy && !result && (
        <>
          <header className="hero">
            <div className="hero__badge">
              <Icon name="scan" size={15} /> Scan · understand · act
            </div>
            <h1>
              Point, scan,
              <br />
              get <span>help.</span>
            </h1>
            <p>Injuries, text, labels, documents, plants and objects — with clear next steps.</p>
            {aiPill}
          </header>

          <section className="block" aria-label="Scan type">
            <div className="block__head">
              <h2>What are you scanning?</h2>
            </div>
            <div className="modeGrid">
              {SCAN_MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`modeCard modeCard--${entry.tint}${mode === entry.id ? ' is-active' : ''}`}
                  onClick={() => setMode(entry.id)}
                  aria-pressed={mode === entry.id}
                >
                  <span className="modeCard__icon">
                    <Icon name={entry.icon as IconName} size={21} />
                  </span>
                  <span className="modeCard__label">{entry.label}</span>
                  <span className="modeCard__desc">{entry.description}</span>
                  {mode === entry.id ? (
                    <span className="modeCard__check">
                      <Icon name="check" size={13} strokeWidth={2.4} />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>

          <section className="block" aria-label="Start a scan">
            <div
              className={`dropzone${dragging ? ' is-dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <div className="dropzone__actions">
                <button type="button" className="btn btn--primary btn--lg" onClick={() => void startCamera()}>
                  <Icon name="camera" size={21} /> Open camera
                </button>
                <button type="button" className="btn btn--soft btn--lg" onClick={() => uploadRef.current?.click()}>
                  <Icon name="image" size={20} /> Upload photo
                </button>
              </div>
              <p className="dropzone__hint">…or drop an image here. You can also paste an image with Ctrl+V.</p>
            </div>

            <div className="pasteToggle">
              <button type="button" className="linkBtn" onClick={() => setPasteOpen((open) => !open)}>
                <Icon name="text" size={16} /> {pasteOpen ? 'Hide text box' : 'Paste text instead'}
              </button>
            </div>

            {pasteOpen ? (
              <form className="pasteBox" onSubmit={runPaste}>
                <label className="field">
                  <span>Paste or type the text</span>
                  <textarea
                    value={pasteText}
                    onChange={(event) => setPasteText(event.target.value)}
                    rows={6}
                    placeholder="Paste a letter, message, note or instructions here…"
                  />
                </label>
                <div className="pasteBox__actions">
                  <button type="submit" className="btn btn--primary" disabled={!pasteText.trim()}>
                    <Icon name="spark" size={17} /> Get help with this text
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setPasteOpen(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </section>

          <p className="privacy">
            <Icon name="shield" size={14} /> Photos go only to Google Gemini for analysis. Nothing is stored on a
            server; results stay in this browser.
          </p>
        </>
      )}

      {!busy && error ? (
        <section className="block">
          <div className="alertCard" role="alert">
            <span className="alertCard__icon">
              <Icon name="alert" size={20} />
            </span>
            <div>
              <h2>Scan could not finish</h2>
              <p>{error}</p>
            </div>
          </div>
          <div className="errorActions">
            {image ? (
              <button type="button" className="btn btn--primary" onClick={() => void runScan(image.blob, mode)}>
                <Icon name="refresh" size={17} /> Try again
              </button>
            ) : null}
            <button type="button" className="btn btn--soft" onClick={onOpenSettings}>
              <Icon name="settings" size={17} /> Open settings
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                newScan()
                setPasteOpen(true)
              }}
            >
              Paste text instead
            </button>
          </div>
        </section>
      ) : null}

      {!busy && result ? (
        <section className="resultWrap">
          <div className="resultTop">
            <button type="button" className="iconBtn" onClick={newScan} aria-label="Back to scanner">
              <Icon name="arrowLeft" size={20} />
            </button>
            <span className="badge badge--kind">
              {modeLabel(result.mode)} ·{' '}
              {engine === 'ocr' || result.model === 'local OCR' ? 'Offline OCR' : 'AI vision'}
            </span>
            <div className="resultTop__spacer" />
            <button type="button" className="iconBtn" onClick={() => void copySummary()} aria-label="Copy summary">
              <Icon name="copy" size={18} />
            </button>
            <button type="button" className="iconBtn" onClick={() => void shareSummary()} aria-label="Share summary">
              <Icon name="share" size={18} />
            </button>
          </div>

          {notice ? (
            <div className="notice">
              <Icon name="info" size={16} />
              <span>{notice}</span>
            </div>
          ) : null}

          <ResultCard result={result} thumb={thumb} />

          {result.followUpQuestions.length > 0 && ai.ready ? (
            <div className="suggestions">
              <span className="suggestions__label">Ask next</span>
              <div className="suggestions__row">
                {result.followUpQuestions.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className="chipBtn"
                    onClick={() => void sendQuestion(entry)}
                    disabled={asking}
                  >
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="chatCard">
            <div className="chatCard__head">
              <span className="chatCard__icon">
                <Icon name="spark" size={17} />
              </span>
              <div>
                <strong>Ask about this scan</strong>
                <p>{ai.ready ? 'Follow-up questions use the result above as context.' : 'Add an API key to ask questions.'}</p>
              </div>
            </div>

            {chat.length > 0 ? (
              <div className="chat" aria-live="polite">
                {chat.map((entry, index) => (
                  <div key={index} className={`chat__msg chat__msg--${entry.role}`}>
                    {entry.text}
                  </div>
                ))}
                {asking ? (
                  <div className="chat__msg chat__msg--assistant chat__typing">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : null}
              </div>
            ) : null}

            {chatError ? <div className="inlineError">{chatError}</div> : null}

            <form
              className="chatForm"
              onSubmit={(event) => {
                event.preventDefault()
                void sendQuestion()
              }}
            >
              <input
                ref={questionRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={ai.ready ? 'e.g. Is this getting worse? What should I watch for?' : 'Add an API key in Settings'}
                aria-label="Follow-up question"
                disabled={!ai.ready || asking}
              />
              <button
                type="submit"
                className="btn btn--primary btn--icon"
                disabled={!ai.ready || asking || !question.trim()}
                aria-label="Send question"
              >
                <Icon name="send" size={18} />
              </button>
            </form>
          </div>

          <div className="resultActions">
            {image ? (
              <>
                <select
                  className="select"
                  value={rerunMode}
                  onChange={(event) => setRerunMode(event.target.value as ScanMode)}
                  aria-label="Scan type for another analysis"
                >
                  {SCAN_MODES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn--soft" onClick={rerun}>
                  <Icon name="refresh" size={17} /> Analyse again
                </button>
              </>
            ) : null}
            <button type="button" className="btn btn--primary" onClick={newScan}>
              <Icon name="plus" size={18} /> New scan
            </button>
          </div>
        </section>
      ) : null}
    </div>
  )
}
