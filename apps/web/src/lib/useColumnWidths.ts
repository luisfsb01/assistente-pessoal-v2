import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

export type ColumnWidths = Record<string, number>

const MIN_WIDTH = 80

function loadWidths(storageKey: string, defaults: ColumnWidths): ColumnWidths {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as ColumnWidths
      // Mantém defaults para colunas novas ainda não persistidas
      return { ...defaults, ...parsed }
    }
  } catch {}
  return { ...defaults }
}

/**
 * Larguras de coluna ajustáveis por arraste, persistidas em localStorage.
 * `defaults` deve ser uma referência estável (const de módulo) para não
 * recriar os callbacks a cada render.
 */
export function useColumnWidths(defaults: ColumnWidths, storageKey: string) {
  const [widths, setWidths] = useState<ColumnWidths>(() => loadWidths(storageKey, defaults))
  const dragging = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const persist = useCallback(
    (next: ColumnWidths) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {}
    },
    [storageKey],
  )

  const startResize = useCallback(
    (key: string, e: ReactMouseEvent) => {
      e.preventDefault()
      dragging.current = {
        key,
        startX: e.clientX,
        startWidth: widths[key] ?? defaults[key] ?? MIN_WIDTH,
      }

      const onMove = (ev: MouseEvent) => {
        const d = dragging.current
        if (!d) return
        const w = Math.max(MIN_WIDTH, d.startWidth + (ev.clientX - d.startX))
        setWidths((prev) => ({ ...prev, [d.key]: w }))
      }
      const onUp = () => {
        dragging.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setWidths((prev) => {
          persist(prev)
          return prev
        })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [widths, defaults, persist],
  )

  const reset = useCallback(() => {
    setWidths({ ...defaults })
    try {
      localStorage.removeItem(storageKey)
    } catch {}
  }, [defaults, storageKey])

  return { widths, startResize, reset }
}
