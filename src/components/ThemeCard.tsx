import { Icon, type IconName } from './Icon'
import { useTheme, type ThemeChoice } from '../lib/theme'

const OPTIONS: Array<{ id: ThemeChoice; label: string; hint: string; icon: IconName }> = [
  { id: 'light', label: 'Light', hint: 'Bright surfaces', icon: 'sun' },
  { id: 'dark', label: 'Dark', hint: 'Easy at night', icon: 'moon' },
  { id: 'system', label: 'Device', hint: 'Follows your phone', icon: 'monitor' },
]

export function ThemeCard() {
  const { choice, resolved, setChoice } = useTheme()

  return (
    <section className="card themeCard">
      <h2 className="card__title">
        <Icon name={resolved === 'light' ? 'sun' : 'moon'} size={18} /> Appearance
      </h2>
      <div className="themeChoice" role="radiogroup" aria-label="Theme">
        {OPTIONS.map((option) => {
          const active = choice === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`themeOption${active ? ' is-active' : ''}`}
              data-preview={option.id === 'system' ? resolved : option.id}
              onClick={() => setChoice(option.id)}
            >
              <span className="themeOption__preview" aria-hidden="true">
                <span className="themeOption__bar" />
                <span className="themeOption__line" />
                <span className="themeOption__line themeOption__line--short" />
              </span>
              <span className="themeOption__text">
                <span className="themeOption__label">
                  <Icon name={option.icon} size={14} /> {option.label}
                </span>
                <span className="themeOption__hint">{option.hint}</span>
              </span>
              <span className="themeOption__check" aria-hidden="true">
                <Icon name="check" size={12} strokeWidth={2.6} />
              </span>
            </button>
          )
        })}
      </div>
      <p className="field__help">
        {choice === 'system'
          ? `Following your device, currently ${resolved}.`
          : `Always ${choice}, whatever your device is set to.`}{' '}
        Your choice stays on this device.
      </p>
    </section>
  )
}
