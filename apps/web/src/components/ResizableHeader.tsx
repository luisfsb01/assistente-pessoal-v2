import { type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'

/**
 * Célula de cabeçalho (<th>) com largura controlada e uma alça na borda
 * direita para redimensionar por arraste. Usar dentro de uma tabela com
 * `table-layout: fixed`.
 */
export function ResizableHeader({
  width,
  onResizeStart,
  children,
  className = '',
}: {
  width: number
  onResizeStart: (e: ReactMouseEvent) => void
  children: ReactNode
  className?: string
}) {
  return (
    <th
      style={{ width }}
      className={`relative px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted select-none ${className}`}
    >
      <span className="block truncate pr-2">{children}</span>
      <span
        onMouseDown={onResizeStart}
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-brand-500/40"
        aria-hidden="true"
      />
    </th>
  )
}
