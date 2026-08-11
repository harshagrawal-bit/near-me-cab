import { cn } from '@/lib/cn'
import { SkeletonTable } from './Loaders'
import { EmptyState, ErrorState } from './States'

/**
 * Responsive data table.
 *
 * Desktop renders a real <table>. Below `lg` the same rows render as stacked
 * cards via each column's `card` hint, so admin screens stay usable on a
 * tablet or phone without a horizontal scroll bar.
 *
 * Column shape:
 *   { key, header, render(row), align, className, headerClassName,
 *     card: 'title' | 'meta' | 'aside' | 'hidden' }
 */
export default function DataTable({
  columns,
  rows,
  loading = false,
  error = null,
  onRetry,
  empty,
  getRowKey = (row, index) => row.id ?? index,
  onRowClick,
  className,
  dense = false,
}) {
  if (loading) return <SkeletonTable rows={6} columns={Math.min(columns.length, 6)} />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!rows?.length) {
    return (
      empty || (
        <EmptyState title="Nothing here yet" description="Records will appear as they are created." />
      )
    )
  }

  const titleColumns = columns.filter((column) => column.card === 'title')
  const asideColumns = columns.filter((column) => column.card === 'aside')
  const metaColumns = columns.filter(
    (column) => !column.card || column.card === 'meta',
  )

  return (
    <>
      {/* Desktop / laptop */}
      <div
        className={cn(
          'hidden overflow-hidden rounded-card border border-ink-200 bg-white shadow-card lg:block',
          className,
        )}
      >
        <div className="scrollbar-slim overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500',
                      column.align === 'right' && 'text-right',
                      column.align === 'center' && 'text-center',
                      column.headerClassName,
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row, index) => (
                <tr
                  key={getRowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-ink-50',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-4 align-middle text-ink-800',
                        dense ? 'py-2.5' : 'py-3.5',
                        column.align === 'right' && 'text-right',
                        column.align === 'center' && 'text-center',
                        column.className,
                      )}
                    >
                      {column.render ? column.render(row) : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile / tablet */}
      <div className={cn('space-y-2.5 lg:hidden', className)}>
        {rows.map((row, index) => (
          <div
            key={getRowKey(row, index)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={
              onRowClick
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onRowClick(row)
                    }
                  }
                : undefined
            }
            className={cn(
              'rounded-card border border-ink-200 bg-white p-4 shadow-card',
              onRowClick && 'cursor-pointer active:bg-ink-50',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                {titleColumns.map((column) => (
                  <div key={column.key} className="font-medium text-ink-900">
                    {column.render ? column.render(row) : row[column.key]}
                  </div>
                ))}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {asideColumns.map((column) => (
                  <div key={column.key}>
                    {column.render ? column.render(row) : row[column.key]}
                  </div>
                ))}
              </div>
            </div>
            {metaColumns.length > 0 && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-ink-100 pt-3">
                {metaColumns.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-2xs uppercase tracking-wide text-ink-400">
                      {column.header}
                    </dt>
                    <dd className="mt-0.5 truncate text-sm text-ink-800">
                      {column.render ? column.render(row) : row[column.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
