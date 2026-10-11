import { useRef, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { driverService, fleetService } from '@/services'
import { formatDate } from '@/lib/format'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { Alert, EmptyState, ErrorState, PageHeader } from '@/components/ui/States'
import { SkeletonList } from '@/components/ui/Loaders'
import { IconDocument } from '@/components/ui/Icons'
import Button from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { brand } from '@/config/brand'

export default function DriverDocuments() {
  const { data, loading, error, refetch } = useApi(() => driverService.myDocuments(), [])
  const [uploadOpen, setUploadOpen] = useState(false)

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

      <Button variant="brand" fullWidth onClick={() => setUploadOpen(true)}>
        Upload a document
      </Button>

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
        Uploading a document replaces any earlier copy of the same type and sends it back
        for checking. Stuck? Call{' '}
        <a href={`tel:${brand.supportPhone}`} className="font-medium text-brand-700">
          {brand.supportPhone}
        </a>
        .
      </p>

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false)
            refetch()
          }}
        />
      )}
    </div>
  )
}

const DOC_TYPES = [
  { value: 'licence', label: 'Driving licence' },
  { value: 'rc', label: 'Vehicle RC' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'permit', label: 'Permit' },
  { value: 'pollution', label: 'Pollution certificate' },
  { value: 'aadhaar', label: 'Aadhaar' },
]

function UploadModal({ onClose, onUploaded }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [type, setType] = useState('licence')
  const [number, setNumber] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [fileName, setFileName] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error('Choose a photo or PDF of the document.')
      return
    }
    // Checked here as well as on the server so a driver on a slow connection
    // is not left uploading 20 MB before being told no.
    if (file.size > 8 * 1024 * 1024) {
      toast.error('That file is over 8 MB. Try a photo instead of a scan.')
      return
    }

    const form = new FormData()
    form.append('file', file)
    form.append('type', type)
    if (number.trim()) form.append('number', number.trim())
    if (expiresOn) form.append('expires_on', expiresOn)

    setSaving(true)
    try {
      await fleetService.uploadDocument(form)
      toast.success('Uploaded. The office will check it shortly.')
      onUploaded()
    } catch (err) {
      toast.error(err?.message || 'Could not upload that file.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload a document"
      description="A clear photo is fine — it does not have to be a scan."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="brand" loading={saving} onClick={submit}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Document" htmlFor="docType">
          <Select id="docType" value={type} onChange={(e) => setType(e.target.value)}>
            {DOC_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Number (optional)" htmlFor="docNumber">
          <Input
            id="docNumber"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="MH1220190001234"
          />
        </Field>

        <Field label="Expires on (optional)" htmlFor="docExpiry">
          <Input
            id="docExpiry"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </Field>

        <Field label="File" htmlFor="docFile" hint="JPG, PNG or PDF, up to 8 MB.">
          <input
            id="docFile"
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            capture="environment"
            onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
            className="block w-full rounded-xl border border-ink-200 bg-white p-2.5 text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
          />
        </Field>
        {fileName && <p className="text-xs text-ink-500">Selected: {fileName}</p>}
      </div>
    </Modal>
  )
}
