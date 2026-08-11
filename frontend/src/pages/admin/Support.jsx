import { useApi, useListState } from '@/hooks/useApi'
import { supportService } from '@/services'
import { formatPhone, formatShortDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import Pagination from '@/components/ui/Pagination'
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconInbox, IconPhone } from '@/components/ui/Icons'

export default function AdminSupport() {
  const { page, setPage } = useListState({})
  const { data, loading, error, refetch } = useApi(
    () => supportService.allRequests({ page, page_size: 20 }),
    [page],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Support inbox"
        description="Messages from customers and drivers. Reply by phone or email."
      />

      {loading ? (
        <SkeletonList count={4} lines={2} />
      ) : error ? (
        <ErrorState title="Could not load support messages" error={error} onRetry={refetch} />
      ) : !data?.items?.length ? (
        <EmptyState
          icon={<IconInbox />}
          title="Inbox is empty"
          description="Messages sent from the support screen land here."
        />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink-900">{item.subject}</p>
                      <Badge tone="neutral">{item.user_role}</Badge>
                      {item.booking_id && (
                        <span className="font-mono text-xs text-ink-500">{item.booking_id}</span>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700">
                      {item.message}
                    </p>
                    <p className="mt-2 text-xs text-ink-500">
                      {item.user_name} · {item.contact_email} ·{' '}
                      {formatShortDateTime(item.created_at)}
                    </p>
                  </div>
                  {item.contact_phone && (
                    <a
                      href={`tel:${item.contact_phone}`}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
                    >
                      <IconPhone className="h-4 w-4" />
                      {formatPhone(item.contact_phone)}
                    </a>
                  )}
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
    </div>
  )
}
