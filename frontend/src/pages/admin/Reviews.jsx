import { useState } from 'react'
import { useApi, useListState } from '@/hooks/useApi'
import { reviewService } from '@/services'
import { formatShortDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import Button from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import Pagination from '@/components/ui/Pagination'
import { Field, Select } from '@/components/ui/Field'
import { ConfirmDialog } from '@/components/ui/Modal'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconStar, IconStarFilled, IconTrash } from '@/components/ui/Icons'
import { useToast } from '@/components/ui/Toast'

export default function AdminReviews() {
  const toast = useToast()
  const { page, setPage, filters, setFilters } = useListState({})
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, refetch } = useApi(
    () => reviewService.list({ ...filters, page, page_size: 20 }),
    [filters, page],
  )

  const moderate = async (review, isPublished) => {
    try {
      await reviewService.moderate(review.id, { is_published: isPublished })
      toast.success(isPublished ? 'Review published.' : 'Review hidden.')
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await reviewService.remove(deleting.id)
      toast.success('Review deleted.')
      setDeleting(null)
      refetch()
    } catch (caught) {
      toast.error(caught.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reviews"
        description="Customer ratings for completed trips. Hide anything inappropriate."
      />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Visibility" htmlFor="published" className="w-48">
            <Select
              id="published"
              value={filters.is_published === undefined ? '' : String(filters.is_published)}
              placeholder="All reviews"
              onChange={(event) =>
                setFilters({
                  is_published:
                    event.target.value === '' ? undefined : event.target.value === 'true',
                })
              }
            >
              <option value="true">Published</option>
              <option value="false">Hidden</option>
            </Select>
          </Field>
          <Field label="Minimum rating" htmlFor="minRating" className="w-48">
            <Select
              id="minRating"
              value={filters.min_rating || ''}
              placeholder="Any rating"
              onChange={(event) =>
                setFilters({ min_rating: event.target.value || undefined })
              }
            >
              {[5, 4, 3, 2, 1].map((rating) => (
                <option key={rating} value={rating}>
                  {rating} star{rating > 1 ? 's' : ''} and above
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      {loading ? (
        <SkeletonList count={4} lines={2} />
      ) : error ? (
        <ErrorState title="Could not load reviews" error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <EmptyState
          icon={<IconStar />}
          title="No reviews yet"
          description="Reviews appear here after customers rate completed trips."
        />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((review) => (
              <Card key={review.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-0.5">
                        {Array.from({ length: 5 }).map((_, index) =>
                          index < review.rating ? (
                            <IconStarFilled key={index} className="h-4 w-4 text-warning-600" />
                          ) : (
                            <IconStar key={index} className="h-4 w-4 text-ink-200" />
                          ),
                        )}
                      </div>
                      <Badge tone={review.is_published ? 'success' : 'neutral'}>
                        {review.is_published ? 'Published' : 'Hidden'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-ink-800">
                      {review.comment || (
                        <span className="italic text-ink-400">No comment left.</span>
                      )}
                    </p>
                    <p className="mt-2 text-xs text-ink-500">
                      {review.customer_name}
                      {review.driver_name ? ` · driver ${review.driver_name}` : ''} ·{' '}
                      <span className="font-mono">{review.booking_reference}</span> ·{' '}
                      {formatShortDateTime(review.created_at)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => moderate(review, !review.is_published)}
                    >
                      {review.is_published ? 'Hide' : 'Publish'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setDeleting(review)}
                      className="rounded-md p-2 text-ink-500 hover:bg-danger-50 hover:text-danger-600"
                      aria-label="Delete review"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Pagination
            page={data.page}
            pages={data.pages}
            total={data.total}
            pageSize={data.page_size}
            onPageChange={setPage}
          />
        </>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        title="Delete this review?"
        message="The review will be removed permanently. Hiding it is usually the better option."
        confirmLabel="Delete review"
      />
    </div>
  )
}
