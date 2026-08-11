import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'
import Button from './Button'

export default function Pagination({ page, pages, total, pageSize, onPageChange, className }) {
  if (!total) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-1 pt-3',
        className,
      )}
    >
      <p className="text-sm text-ink-500 tabular">
        Showing <span className="font-medium text-ink-700">{formatNumber(from)}</span>–
        <span className="font-medium text-ink-700">{formatNumber(to)}</span> of{' '}
        <span className="font-medium text-ink-700">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="px-1 text-sm text-ink-500 tabular">
          {page} / {pages || 1}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= (pages || 1)}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
