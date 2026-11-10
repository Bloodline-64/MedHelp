import type { ReactNode } from 'react'
import {
  URGENCY_LABEL,
  disclaimerFor,
  kindLabel,
  type ScanResult,
} from '../types'
import { Icon } from './Icon'
import type { IconName } from './Icon'

function Prose({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length <= 1) return <p className="prose">{text}</p>
  return (
    <div className="prose">
      {lines.map((line, index) =>
        /^([•\-*]|\d+[.)])\s+/.test(line) ? (
          <p key={index} className="prose__bullet">
            {line.replace(/^([•\-*]|\d+[.)])\s+/, '')}
          </p>
        ) : (
          <p key={index}>{line}</p>
        ),
      )}
    </div>
  )
}

function Section({
  icon,
  title,
  children,
  tone,
}: {
  icon: IconName
  title: string
  children: ReactNode
  tone?: 'danger' | 'ok'
}) {
  return (
    <section className={`result__section${tone ? ` result__section--${tone}` : ''}`}>
      <h3 className="result__heading">
        <Icon name={icon} size={17} />
        {title}
      </h3>
      {children}
    </section>
  )
}

export function ResultCard({ result, thumb }: { result: ScanResult; thumb?: string }) {
  const disclaimer = disclaimerFor(result)
  const urgent = result.urgency === 'emergency' || result.urgency === 'urgent'
  const hasBody =
    result.findings.length > 0 ||
    result.advice.length > 0 ||
    result.redFlags.length > 0 ||
    Boolean(result.transcription)

  return (
    <article className="result">
      <div className="result__hero">
        {thumb ? <img className="result__thumb" src={thumb} alt="" /> : null}
        <div className="result__heroText">
          <div className="result__badges">
            <span className="badge badge--kind">{kindLabel(result.kind)}</span>
            <span className={`badge badge--urgency badge--${result.urgency}`}>{URGENCY_LABEL[result.urgency]}</span>
          </div>
          <h2 className="result__title">{result.title}</h2>
          {result.summary ? <Prose text={result.summary} /> : null}
          <div className="result__meta">
            <span className={`dot dot--${result.confidence}`} />
            {result.confidence === 'high'
              ? 'High confidence'
              : result.confidence === 'low'
                ? 'Low confidence — check carefully'
                : 'Medium confidence'}
            {result.model ? <span className="result__model">· {result.model}</span> : null}
          </div>
        </div>
      </div>

      {urgent ? (
        <div className={`urgency-strip urgency-strip--${result.urgency}`} role="alert">
          <Icon name="alert" size={18} />
          <strong>{URGENCY_LABEL[result.urgency]}</strong>
        </div>
      ) : null}

      {result.findings.length > 0 ? (
        <Section icon="eye" title="What I can see">
          <ul className="result__list">
            {result.findings.map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {result.advice.length > 0 ? (
        <Section icon="check" title={result.kind === 'injury' ? 'First aid and next steps' : 'What to do'} tone="ok">
          <ol className="result__steps">
            {result.advice.map((entry, index) => (
              <li key={index}>
                <span className="result__stepNum">{index + 1}</span>
                <span>{entry}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {result.redFlags.length > 0 ? (
        <Section icon="alert" title="Get help urgently if" tone="danger">
          <ul className="result__list result__list--danger">
            {result.redFlags.map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {result.transcription ? (
        <Section icon="text" title="Text found">
          <pre className="result__text">{result.transcription}</pre>
        </Section>
      ) : null}

      {!hasBody && !result.summary ? (
        <p className="empty-note">The AI did not return usable detail. Try a sharper, brighter photo or a different mode.</p>
      ) : null}

      <div className={`disclaimer${result.kind === 'injury' || result.kind === 'medicine' ? ' disclaimer--strong' : ''}`}>
        <Icon name="shield" size={17} />
        <p>{disclaimer}</p>
      </div>
    </article>
  )
}
