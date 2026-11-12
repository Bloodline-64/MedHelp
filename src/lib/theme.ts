import { useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_KEY = 'sh.theme.v1'
export const THEME_EVENT = 'sh-theme-change'

const META_LIGHT = '#f2f5fa'
const META_DARK = '#070c15'

let transitionTimer: number | undefined

export function getThemeChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    // Storage can be blocked; fall back to the device setting.
  }
  return 'system'
}

function prefersLight(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return prefersLight() ? 'light' : 'dark'
  return choice
}

function apply(choice: ThemeChoice, animate = false): ResolvedTheme {
  if (typeof document === 'undefined') return 'dark'
  const resolved = resolveTheme(choice)
  const root = document.documentElement

  if (animate) {
    root.classList.add('theme-transition')
    if (transitionTimer) window.clearTimeout(transitionTimer)
    transitionTimer = window.setTimeout(() => {
      root.classList.remove('theme-transition')
      transitionTimer = undefined
    }, 420)
  }

  root.dataset.theme = resolved
  root.dataset.themeChoice = choice
  root.style.colorScheme = resolved

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'light' ? META_LIGHT : META_DARK)

  const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
  if (apple) apple.setAttribute('content', resolved === 'light' ? 'default' : 'black-translucent')

  return resolved
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    // The choice still applies for this session.
  }
  apply(choice, true)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_EVENT, { detail: choice }))
  }
}

/** Applies the saved theme and keeps "device default" in sync with the OS. */
export function initTheme(): () => void {
  apply(getThemeChoice())

  let query: MediaQueryList | null = null
  const onChange = () => {
    if (getThemeChoice() === 'system') apply('system')
  }

  try {
    query = window.matchMedia('(prefers-color-scheme: light)')
    query.addEventListener('change', onChange)
  } catch {
    // Older browsers simply keep the theme they started with.
  }

  return () => {
    try {
      query?.removeEventListener('change', onChange)
    } catch {
      // Nothing else to do.
    }
  }
}

export function useTheme(): {
  choice: ThemeChoice
  resolved: ResolvedTheme
  setChoice: (choice: ThemeChoice) => void
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(getThemeChoice)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getThemeChoice()))

  useEffect(() => {
    const sync = () => {
      const next = getThemeChoice()
      setChoiceState(next)
      setResolved(resolveTheme(next))
    }
    window.addEventListener(THEME_EVENT, sync)

    let query: MediaQueryList | null = null
    try {
      query = window.matchMedia('(prefers-color-scheme: light)')
      query.addEventListener('change', sync)
    } catch {
      // Ignore.
    }

    return () => {
      window.removeEventListener(THEME_EVENT, sync)
      try {
        query?.removeEventListener('change', sync)
      } catch {
        // Ignore.
      }
    }
  }, [])

  return { choice, resolved, setChoice: setThemeChoice }
}
