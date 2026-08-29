import { useCallback, useRef, useState } from 'react'

interface Toast {
  message: string
  undo?: () => void
}

/**
 * A short line about something that just happened, and a way back from it.
 *
 * Clearing a shortlist somebody spent an evening building is not worth a
 * confirmation dialog and is certainly not worth losing. The way out is offered
 * after the fact rather than demanded before it.
 */
export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const show = useCallback((message: string, undo?: () => void) => {
    clearTimeout(timer.current)
    setToast({ message, undo })
    timer.current = setTimeout(() => setToast(null), undo ? 8000 : 3500)
  }, [])

  const dismiss = useCallback(() => {
    clearTimeout(timer.current)
    setToast(null)
  }, [])

  return { toast, show, dismiss }
}

export function Toast({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
  if (!toast) return null
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          className="as-link"
          onClick={() => {
            toast.undo!()
            onDismiss()
          }}
        >
          Undo
        </button>
      )}
    </div>
  )
}
