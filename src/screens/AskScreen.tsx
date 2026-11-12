import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Icon } from '../components/Icon'
import { useToast } from '../components/Toast'
import { aiErrorMessage, askAssistant, makeThumb } from '../lib/ai'
import { clearAskMessages, loadAskMessages, saveAskMessages, type AskMessage } from '../lib/ask'
import type { HistoryEntry } from '../lib/history'
import { useAIState } from '../lib/useAI'
import type { ScanResult } from '../types'

interface AttachedImage {
  blob: Blob
  thumb?: string
  name: string
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: unknown) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function copyText(value: string): Promise<boolean> {
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
      const copied = document.execCommand('copy')
      area.remove()
      return copied
    } catch {
      return false
    }
  }
}

const PROMPTS = [
  'What should I do after a minor burn?',
  'How do I read a medicine label safely?',
  'Explain a confusing letter in plain English',
  'Make me a simple first-aid kit checklist',
]

function AnswerText({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return (
    <div className="askAnswer">
      {lines.map((line, index) => {
        if (/^[•\-*]\s+/.test(line)) {
          return (
            <p key={index} className="askAnswer__bullet">
              {line.replace(/^[•\-*]\s+/, '')}
            </p>
          )
        }
        if (/^\d+[.)]\s+/.test(line)) {
          return (
            <p key={index} className="askAnswer__step">
              {line}
            </p>
          )
        }
        return <p key={index}>{line}</p>
      })}
    </div>
  )
}

export function AskScreen({
  onOpenSettings,
  onSaved,
}: {
  onOpenSettings: () => void
  onSaved: (entry: HistoryEntry) => void
}) {
  const ai = useAIState()
  const { toast } = useToast()

  const [messages, setMessages] = useState<AskMessage[]>(loadAskMessages)
  const [question, setQuestion] = useState('')
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<string[]>([])

  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const micAvailable = Boolean(getSpeechRecognition())

  useEffect(() => {
    saveAskMessages(messages)
  }, [messages])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, busy])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`
  }, [question])

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel()
      recognitionRef.current?.stop()
    }
  }, [])

  const attach = async (file?: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('That file is not an image.', 'error')
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      toast('That image is very large. Try one under 25 MB.', 'error')
      return
    }
    const thumb = await makeThumb(file, 360)
    setImage({ blob: file, thumb, name: file.name || 'photo.jpg' })
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          event.preventDefault()
          void attach(file)
          return
        }
      }
    }
  }

  const send = async (value?: string) => {
    const clean = (value ?? question).trim()
    if (busy) return
    if (!clean && !image) return
    if (!ai.ready) {
      toast('Add a Gemini API key in Settings to ask questions.', 'warn')
      return
    }

    const userText = clean || 'What is in this photo? Tell me what matters and what to do next.'
    const attached = image
    const history = messages.map((entry) => ({ role: entry.role, content: entry.text }))

    window.speechSynthesis?.cancel()
    setSpeakingId(null)
    setError(null)
    setQuestion('')
    setImage(null)
    setBusy(true)
    setMessages((current) => [
      ...current,
      { id: uid('ask'), role: 'user', text: userText, at: Date.now(), thumb: attached?.thumb },
    ])

    try {
      const answer = await askAssistant(userText, { image: attached?.blob, history })
      setMessages((current) => [
        ...current,
        { id: uid('ask'), role: 'assistant', text: answer, at: Date.now(), model: ai.model },
      ])
    } catch (caught) {
      setError(aiErrorMessage(caught))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void send()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  const readAloud = (message: AskMessage) => {
    if (!('speechSynthesis' in window)) {
      toast('Reading aloud is not available in this browser.', 'warn')
      return
    }
    if (speakingId === message.id) {
      window.speechSynthesis.cancel()
      setSpeakingId(null)
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(message.text)
    utterance.lang = navigator.language || 'en-US'
    utterance.rate = 1.02
    utterance.onend = () => setSpeakingId((current) => (current === message.id ? null : current))
    utterance.onerror = () => setSpeakingId((current) => (current === message.id ? null : current))
    setSpeakingId(message.id)
    window.speechSynthesis.speak(utterance)
  }

  const toggleMic = () => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const Recognition = getSpeechRecognition()
    if (!Recognition) {
      toast('Voice input is not available in this browser.', 'warn')
      return
    }

    const recognition = new Recognition()
    recognition.lang = navigator.language || 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => {
      let transcript = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const entry = event.results[index]?.[0]?.transcript
        if (entry) transcript += entry
      }
      const clean = transcript.trim()
      if (clean) setQuestion((current) => (current ? `${current} ${clean}` : clean))
    }
    recognition.onerror = () => {
      setListening(false)
      toast('Voice input stopped. You can type instead.', 'warn')
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition

    try {
      recognition.start()
      setListening(true)
    } catch {
      setListening(false)
      toast('Voice input could not start. You can type instead.', 'error')
    }
  }

  const copyAnswer = async (text: string) => {
    const copied = await copyText(text)
    toast(copied ? 'Answer copied.' : 'Copy failed. Select the text manually.', copied ? 'success' : 'error')
  }

  const shareAnswer = async (text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Scan & Help answer', text })
        return
      } catch {
        // User cancelled or sharing is unavailable; fall back to copy.
      }
    }
    const copied = await copyText(text)
    toast(copied ? 'Answer copied — paste it anywhere.' : 'Sharing is not available here.', copied ? 'success' : 'error')
  }

  const saveAnswer = (message: AskMessage) => {
    const index = messages.findIndex((entry) => entry.id === message.id)
    const questionMessage = [...messages.slice(0, Math.max(0, index))]
      .reverse()
      .find((entry) => entry.role === 'user')
    const title = questionMessage?.text.trim() || 'Ask & Help answer'

    const result: ScanResult = {
      id: `ask_${message.id}`,
      at: Date.now(),
      mode: 'text',
      kind: 'other',
      source: 'ask',
      title: title.length > 90 ? `${title.slice(0, 89).trimEnd()}…` : title,
      transcription: '',
      summary: message.text.slice(0, 6_000),
      findings: [],
      advice: [],
      redFlags: [],
      urgency: 'unknown',
      confidence: 'medium',
      followUpQuestions: [],
      model: message.model || ai.model,
    }

    onSaved({ result })
    setSavedIds((current) => (current.includes(message.id) ? current : [...current, message.id]))
    toast('Answer saved to history.', 'success')
  }

  const clearChat = () => {
    if (!window.confirm('Clear this conversation from this device?')) return
    setMessages([])
    setError(null)
    setImage(null)
    setSavedIds([])
    clearAskMessages()
    window.speechSynthesis?.cancel()
    setSpeakingId(null)
    toast('Conversation cleared.', 'success')
  }

  const canSend = Boolean(ai.ready && (question.trim() || image) && !busy)

  return (
    <div className="screen askScreen">
      <header className="pageHead">
        <div>
          <h1>Ask</h1>
          <p>Ask anything, with or without a photo. Follow up in plain language.</p>
        </div>
        {messages.length > 0 ? (
          <div className="headActions">
            <button type="button" className="iconBtn" onClick={clearChat} aria-label="Clear conversation">
              <Icon name="trash" size={19} />
            </button>
          </div>
        ) : null}
      </header>

      {!ai.ready ? (
        <section className="askSetup">
          <span className="askSetup__icon">
            <Icon name="spark" size={20} />
          </span>
          <div className="askSetup__body">
            <strong>{ai.configured ? 'AI is not available right now' : 'Connect Gemini to ask questions'}</strong>
            <p>
              {ai.configured
                ? ai.online
                  ? 'Turn AI on and check your key in Settings.'
                  : 'You are offline. Reconnect to ask questions.'
                : 'Add a free API key once, then ask anything here. Scans still work without it.'}
            </p>
          </div>
          <button type="button" className="btn btn--soft" onClick={onOpenSettings}>
            <Icon name="settings" size={17} /> Settings
          </button>
        </section>
      ) : null}

      {messages.length === 0 ? (
        <section className="askIntro">
          <div className="askIntro__badge">
            <Icon name="spark" size={15} /> Ask · follow up · act
          </div>
          <h2>What do you need to know?</h2>
          <p>
            Type a question, paste an image with Ctrl+V, or attach a photo. The assistant keeps the conversation in
            context, so you can keep asking follow-ups.
          </p>
          <div className="askPrompts">
            {PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="chipBtn"
                onClick={() => {
                  setQuestion(prompt)
                  inputRef.current?.focus()
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <ol className="askChat" aria-live="polite">
          {messages.map((message) => (
            <li key={message.id} className={`askMsg askMsg--${message.role}`}>
              <div className="askMsg__bubble">
                {message.thumb ? <img className="askMsg__image" src={message.thumb} alt="Attached to this question" /> : null}
                {message.role === 'assistant' ? (
                  <AnswerText text={message.text} />
                ) : (
                  <p className="askMsg__text">{message.text}</p>
                )}
              </div>
              {message.role === 'assistant' ? (
                <div className="askMsg__actions">
                  <button
                    type="button"
                    onClick={() => readAloud(message)}
                    aria-label={speakingId === message.id ? 'Stop reading' : 'Read this answer aloud'}
                  >
                    <Icon name={speakingId === message.id ? 'stop' : 'volume'} size={14} />
                    {speakingId === message.id ? 'Stop' : 'Read'}
                  </button>
                  <button type="button" onClick={() => void copyAnswer(message.text)}>
                    <Icon name="copy" size={14} /> Copy
                  </button>
                  <button type="button" onClick={() => void shareAnswer(message.text)}>
                    <Icon name="share" size={14} /> Share
                  </button>
                  <button
                    type="button"
                    onClick={() => saveAnswer(message)}
                    disabled={savedIds.includes(message.id)}
                  >
                    <Icon name={savedIds.includes(message.id) ? 'check' : 'plus'} size={14} />
                    {savedIds.includes(message.id) ? 'Saved' : 'Save'}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
          {busy ? (
            <li className="askMsg askMsg--assistant">
              <div className="askMsg__bubble chat__typing">
                <span />
                <span />
                <span />
              </div>
            </li>
          ) : null}
        </ol>
      )}

      <div ref={endRef} />

      {error ? (
        <div className="inlineError askError" role="alert">
          <span>{error}</span>
          <button type="button" className="linkBtn" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      ) : null}

      <form className="askComposer" onSubmit={onSubmit}>
        {image ? (
          <div className="askAttach">
            {image.thumb ? (
              <img src={image.thumb} alt="" />
            ) : (
              <span className="askAttach__placeholder">
                <Icon name="image" size={18} />
              </span>
            )}
            <div className="askAttach__meta">
              <strong>{image.name}</strong>
              <span>Ready to send with your question</span>
            </div>
            <button type="button" className="iconBtn iconBtn--small" onClick={() => setImage(null)} aria-label="Remove photo">
              <Icon name="x" size={15} />
            </button>
          </div>
        ) : null}

        <div className="askComposer__row">
          <button type="button" className="iconBtn" onClick={() => fileRef.current?.click()} aria-label="Attach a photo" title="Attach a photo">
            <Icon name="image" size={19} />
          </button>
          {micAvailable ? (
            <button
              type="button"
              className={`iconBtn${listening ? ' is-listening' : ''}`}
              onClick={toggleMic}
              aria-label={listening ? 'Stop dictating' : 'Dictate a question'}
              title={listening ? 'Stop dictating' : 'Dictate a question'}
            >
              <Icon name="mic" size={19} />
            </button>
          ) : null}
          <textarea
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            placeholder={ai.ready ? 'Ask a question…' : 'Add a Gemini API key in Settings'}
            aria-label="Your question"
            maxLength={4_000}
          />
          <button type="submit" className="btn btn--primary btn--icon" disabled={!canSend} aria-label="Send question">
            <Icon name="send" size={18} />
          </button>
        </div>
        <p className="askComposer__hint">
          {ai.ready ? 'Enter to send · Shift+Enter for a new line' : 'Add a Gemini API key in Settings to send'}
        </p>
      </form>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="visuallyHidden"
        onChange={(event) => {
          void attach(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
