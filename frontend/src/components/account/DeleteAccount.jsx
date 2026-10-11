import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/auth/AuthContext'
import { userService } from '@/services'
import Button from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Alert } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

/**
 * Closing an account, for customers and drivers alike.
 *
 * Reachable from the profile screen because the Play Store requires an in-app
 * route to deletion, and because burying it would be the wrong answer anyway.
 *
 * Blockers are fetched and shown before the button is ever pressed — being
 * told halfway through that you owe money is worse than being told at the top.
 */
export default function DeleteAccount() {
  const toast = useToast()
  const { logout } = useAuth()
  const { data: check, loading } = useApi(() => userService.deletionCheck(), [])
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')
  const [deleting, setDeleting] = useState(false)

  const blockers = check?.blockers || []
  const canDelete = Boolean(check?.can_delete)

  const submit = async () => {
    if (confirmText.trim().toUpperCase() !== 'DELETE') {
      toast.error('Type DELETE to confirm.')
      return
    }
    setDeleting(true)
    try {
      await userService.deleteAccount({ reason: reason.trim() || undefined })
      toast.success('Your account has been closed.')
      await logout()
    } catch (err) {
      toast.error(err?.message || 'Could not close the account.')
      setDeleting(false)
    }
  }

  if (loading) return null

  return (
    <>
      <Card>
        <CardHeader
          title="Close my account"
          description="Permanently removes your profile from the app."
        />
        <CardBody>
          {blockers.length > 0 ? (
            <Alert tone="warning" title="Not just yet">
              <ul className="mt-1 space-y-1">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <p className="text-sm text-ink-600">
              Your name, phone number and saved addresses are removed. Trip and payment
              records are kept, because we are required to hold them for tax and
              accounting.
            </p>
          )}

          <Button
            variant="danger-outline"
            className="mt-4"
            disabled={!canDelete}
            onClick={() => setOpen(true)}
          >
            Close my account
          </Button>
        </CardBody>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Close your account?"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={deleting}>
              Keep my account
            </Button>
            <Button variant="danger" loading={deleting} onClick={submit}>
              Close permanently
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Alert tone="danger">
            You will be signed out and will not be able to sign in again with this
            account.
          </Alert>

          <Field label="Why are you leaving? (optional)" htmlFor="delReason">
            <Textarea
              id="delReason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>

          <Field label="Type DELETE to confirm" htmlFor="delConfirm">
            <Input
              id="delConfirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="DELETE"
            />
          </Field>
        </div>
      </Modal>
    </>
  )
}
