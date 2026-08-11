/**
 * Display metadata mirroring the backend's domain vocabulary
 * (`backend/app/models/enums.py`). Labels and tones only — the backend
 * remains the authority on which transitions are legal.
 */

export const ROLES = {
  CUSTOMER: 'customer',
  DRIVER: 'driver',
  ADMIN: 'admin',
}

export const BOOKING_STATUS = {
  REQUESTED: 'requested',
  CONFIRMED: 'confirmed',
  DRIVER_ASSIGNED: 'driver_assigned',
  ACCEPTED: 'accepted',
  DRIVER_ARRIVING: 'driver_arriving',
  PICKED_UP: 'picked_up',
  TRIP_STARTED: 'trip_started',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

export const BOOKING_STATUS_META = {
  requested: { label: 'Requested', tone: 'neutral' },
  awaiting_payment: { label: 'Awaiting Advance', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  driver_assigned: { label: 'Driver Assigned', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'info' },
  driver_arriving: { label: 'Driver Arriving', tone: 'warning' },
  picked_up: { label: 'Picked Up', tone: 'warning' },
  trip_started: { label: 'Trip Started', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

/**
 * The six milestones a customer sees. Each maps to one or more backend
 * statuses so the sub-states (accepted, picked_up) show as detail rather
 * than cluttering the timeline.
 */
export const CUSTOMER_TIMELINE = [
  { key: 'requested', label: 'Requested', statuses: ['requested'] },
  { key: 'awaiting_payment', label: 'Pay Advance', statuses: ['awaiting_payment'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['confirmed'] },
  {
    key: 'driver_assigned',
    label: 'Driver Assigned',
    statuses: ['driver_assigned', 'accepted'],
  },
  {
    key: 'driver_arriving',
    label: 'Driver Arriving',
    statuses: ['driver_arriving', 'picked_up'],
  },
  { key: 'trip_started', label: 'Trip Started', statuses: ['trip_started'] },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
]

/** Ordered actions a driver can take, with confirmation copy for each. */
export const DRIVER_ACTIONS = [
  {
    from: 'driver_assigned',
    to: 'accepted',
    label: 'Accept this trip',
    confirm: 'Accept this trip? The customer will be told you are on it.',
    tone: 'primary',
  },
  {
    from: 'accepted',
    to: 'driver_arriving',
    label: "I'm on the way",
    confirm: 'Mark yourself as heading to the pickup point?',
    tone: 'primary',
  },
  {
    from: 'driver_arriving',
    to: 'picked_up',
    label: 'Customer picked up',
    confirm: 'Confirm the customer is in the vehicle?',
    tone: 'primary',
  },
  {
    from: 'picked_up',
    to: 'trip_started',
    label: 'Start trip',
    confirm: 'Start the trip now?',
    tone: 'primary',
  },
  {
    from: 'trip_started',
    to: 'completed',
    label: 'Complete trip',
    confirm: 'Complete this trip? This cannot be undone.',
    tone: 'success',
  },
]

export const TRIP_TYPES = [
  { value: 'one_way', label: 'One Way', hint: 'Drop only' },
  { value: 'round_trip', label: 'Round Trip', hint: 'Return included' },
  { value: 'local', label: 'Local', hint: 'Hourly package' },
  { value: 'airport', label: 'Airport Transfer', hint: 'To or from airport' },
]

export const PAYMENT_STATUS_META = {
  pending: { label: 'Pending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  partially_paid: { label: 'Partially Paid', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  cash: { label: 'Cash on Trip', tone: 'info' },
}

export const VEHICLE_STATUS_META = {
  available: { label: 'Available', tone: 'success' },
  assigned: { label: 'Assigned', tone: 'info' },
  on_trip: { label: 'On Trip', tone: 'warning' },
  maintenance: { label: 'Maintenance', tone: 'danger' },
  inactive: { label: 'Inactive', tone: 'neutral' },
}

export const DOCUMENT_STATUS_META = {
  verified: { label: 'Verified', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
}

export const VERIFICATION_STATUS_META = {
  verified: { label: 'Verified', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

export const ACCOUNT_STATUS_META = {
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspended', tone: 'danger' },
  inactive: { label: 'Inactive', tone: 'neutral' },
}

export const BOOKING_BUCKETS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

/** Terminal states — no further action is possible. */
export const TERMINAL_STATUSES = ['completed', 'cancelled']

/** Statuses in which a customer may still cancel. */
export const CUSTOMER_CANCELLABLE = [
  'requested',
  'confirmed',
  'driver_assigned',
  'accepted',
]
