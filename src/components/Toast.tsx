import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

type ToastKind = 'success' | 'warn' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastApi>({ toast: () => undefined })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

const ICONS: Record<ToastKind, 'check' | 'alert' | 'info'> = {
  success: 'check',
  warn: 'alert',
  error: 'alert',
  info: 'info',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++
    setItems((current) => [...current.slice(-2), { id, message, kind }])
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id))
    }, kind === 'error' ? 6000 : 3800)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast--${item.kind}`}>
            <Icon name={ICONS[item.kind]} size={17} />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
