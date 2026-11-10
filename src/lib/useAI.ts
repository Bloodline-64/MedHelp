import { useEffect, useState } from 'react'
import { AI_EVENT, getAIState, type AIState } from './ai'

/** Re-renders when AI settings change or the browser goes online/offline. */
export function useAIState(): AIState {
  const [state, setState] = useState<AIState>(getAIState)

  useEffect(() => {
    const update = () => setState(getAIState())
    window.addEventListener(AI_EVENT, update)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(AI_EVENT, update)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener('storage', update)
    }
  }, [])

  return state
}
