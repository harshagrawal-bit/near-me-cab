import { useApi } from '@/hooks/useApi'
import { driverService } from '@/services'
import { formatDate } from '@/lib/format'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconDocument } from '@/components/ui/Icons'
import { brand } from '@/config/brand'

export default function DriverDocuments() {
  const { data, loading, error, refetch } = useApi(() => driverService.myDocuments(), [])

  if (loading) return <SkeletonList count={3} lines={2} />
  if (error) return <ErrorState title="Could not load documents" error={error} onRetry={refetch} />

  const documents = data.documents || []
  const expired = documents.filter((doc) => doc.status === 'expired')
  const pending = documents.filter((doc) => doc.status === 'pending')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Documents"
        description="Keep these current to stay eligible for trips."
        action={<StatusBadge kind="verification" status={data.verification_status} />}
      />

      {expired.length > 0 && (
        <Alert tone="danger" title="Action needed">
          {expired.length === 1
            ? 'One of your documents has expired.'
            : `${expired.length} of your documents have expired.`}{' '}
          Send the updated copy to the operations team on {brand.supportPhone}.
        </Alert>
      )}

      {expired.length === 0 && pending.length > 0 && (
        <Alert tone="warning">
          {pending.length === 1 ? 'One document is' : `${pending.length} documents are`} awaiting
          verification by the operations team.
        </Alert>
      )}

      <Card>
        <CardHeader title="Licence" />
        <CardBody>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Licence number</dt>
              <dd className="font-mono font-medium text-ink-900">{data.licence_number}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-500">Expires</dt>
              <dd className="font-medium text-ink-900">{formatDate(data.licence_expiry)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Uploaded documents" />
        <CardBody>
          {documents.length === 0 ? (
            <EmptyState
              compact
              icon={<IconDocument />}
              title="No documents on file"
              description="The operations team will add these for you."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {documents.map((doc, index) => (
                <li
                  key={`${doc.type}-${index}`}
                  className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
                      <IconDocument className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-900">{doc.type}</p>
                      {doc.number && (
                        <p className="mt-0.5 font-mono text-xs text-ink-500">{doc.number}</p>
                      )}
                      {doc.expires_on && (
                        <p className="mt-0.5 text-xs text-ink-500">
                          Valid until {formatDate(doc.expires_on)}
                        </p>
                      )}
                    </div>
                  </div>
                  <StatusBadge kind="document" status={doc.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="px-1 text-xs text-ink-500">
        Documents are managed by the operations team. To update one, send the new copy to{' '}
        <a href={`tel:${brand.supportPhone}`} className="font-medium text-brand-700">
          {brand.supportPhone}
        </a>
        .
      </p>
    </div>
  )
}
