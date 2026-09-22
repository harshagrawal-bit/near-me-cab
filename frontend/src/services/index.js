/**
 * Resource services — one function per API endpoint.
 *
 * Components never call `fetch` or build URLs; they call these. That keeps
 * the API surface in one place when routes change.
 */

import api, { setAccessToken } from './apiClient'

/* ---------------------------------------------------------------- auth --- */

export const authService = {
  login: (payload) => api.post('/api/auth/login', payload),
  register: (payload) => api.post('/api/auth/register', payload),
  refresh: () => api.post('/api/auth/refresh'),
  logout: async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setAccessToken(null)
    }
  },
  changePassword: (payload) => api.post('/api/auth/change-password', payload),

  /** Which sign-in methods this server actually supports. Lets the UI hide a
   *  Google button that has no client id behind it. */
  providers: () => api.get('/api/auth/providers'),
  /** `credential` is the ID token from Google Identity Services. */
  google: (credential) => api.post('/api/auth/google', { credential }),
  driverSignup: (payload) => api.post('/api/auth/driver-signup', payload),
}

/* --------------------------------------------------------------- users --- */

export const userService = {
  me: () => api.get('/api/users/me'),
  updateProfile: (payload) => api.patch('/api/users/me', payload),
  appSettings: () => api.get('/api/users/me/settings'),
}

/* -------------------------------------------------------------- routes --- */

export const routeService = {
  list: (params) => api.get('/api/routes', { params }),
  popular: (limit = 6) => api.get('/api/routes/popular', { params: { limit } }),
  detail: (id) => api.get(`/api/routes/${id}`),
  vehicleClasses: () => api.get('/api/routes/vehicle-classes'),
  places: (q) => api.get('/api/routes/places', { params: { q } }),
  mapCapabilities: () => api.get('/api/routes/map-capabilities'),
  create: (payload) => api.post('/api/routes', payload),
  update: (id, payload) => api.patch(`/api/routes/${id}`, payload),
  remove: (id) => api.delete(`/api/routes/${id}`),
}

/* ------------------------------------------------------------- pricing --- */

export const pricingService = {
  quote: (payload) => api.post('/api/pricing/quote', payload),
  list: (routeId) => api.get('/api/pricing', { params: { route_id: routeId } }),
  upsert: (payload) => api.put('/api/pricing', payload),
  update: (id, payload) => api.patch(`/api/pricing/${id}`, payload),
  remove: (id) => api.delete(`/api/pricing/${id}`),
}

/* ------------------------------------------------------------ bookings --- */

export const bookingService = {
  create: (payload) => api.post('/api/bookings', payload),
  list: (params) => api.get('/api/bookings', { params }),
  summary: () => api.get('/api/bookings/summary'),
  detail: (id) => api.get(`/api/bookings/${id}`),
  cancel: (id, reason) => api.post(`/api/bookings/${id}/cancel`, { reason }),
  setStatus: (id, status, note) => api.post(`/api/bookings/${id}/status`, { status, note }),
  assignDriver: (id, payload) => api.post(`/api/bookings/${id}/assign-driver`, payload),
  overrideFare: (id, payload) => api.post(`/api/bookings/${id}/fare`, payload),
  recordPayment: (id, payload) => api.post(`/api/bookings/${id}/payments`, payload),
  setPaymentStatus: (id, payload) => api.post(`/api/bookings/${id}/payment-status`, payload),

  /** Admin confirms a car is free, which asks the customer for the advance. */
  confirmAvailability: (id) => api.post(`/api/bookings/${id}/confirm-availability`),
  /** Admin records the advance as received. No gateway behind this yet. */
  markAdvancePaid: (id) => api.post(`/api/bookings/${id}/advance-paid`),
}

/* ------------------------------------------------------------- drivers --- */

export const driverService = {
  pendingWithdrawals: () => api.get('/api/drivers/wallet/withdrawals/pending'),
  approveWithdrawal: (id, params) =>
    api.post(`/api/drivers/wallet/withdrawals/${id}/approve`, null, { params }),
  rejectWithdrawal: (id, params) =>
    api.post(`/api/drivers/wallet/withdrawals/${id}/reject`, null, { params }),
  me: () => api.get('/api/drivers/me'),
  updateMe: (payload) => api.patch('/api/drivers/me', payload),
  setAvailability: (isAvailable) =>
    api.post('/api/drivers/me/availability', { is_available: isAvailable }),
  myDocuments: () => api.get('/api/drivers/me/documents'),
  myEarnings: () => api.get('/api/drivers/me/earnings'),
  myDashboard: () => api.get('/api/drivers/me/dashboard'),

  list: (params) => api.get('/api/drivers', { params }),
  assignable: (vehicleType) =>
    api.get('/api/drivers/assignable', { params: { vehicle_type: vehicleType } }),
  create: (payload) => api.post('/api/drivers', payload),
  detail: (id) => api.get(`/api/drivers/${id}`),
  update: (id, payload) => api.patch(`/api/drivers/${id}`, payload),
  bookings: (id, params) => api.get(`/api/drivers/${id}/bookings`, { params }),
  earnings: (id) => api.get(`/api/drivers/${id}/earnings`),
  documents: (id) => api.get(`/api/drivers/${id}/documents`),

  wallet: (id, page = 1) => api.get(`/api/drivers/${id}/wallet`, { params: { page } }),
  topUpWallet: (id, payload) => api.post(`/api/drivers/${id}/wallet/topup`, payload),
  adjustWallet: (id, payload) => api.post(`/api/drivers/${id}/wallet/adjust`, payload),
}

/* --------------------------------------------------------------- fleet --- */

/** Everything a driver or fleet owner does for themselves. */
export const fleetService = {
  /** Ask for money back. An admin approves, which is what actually debits. */
  requestWithdrawal: (params) => api.post('/api/fleet/wallet/withdraw', null, { params }),
  withdrawals: () => api.get('/api/fleet/wallet/withdrawals'),
  wallet: () => api.get('/api/fleet/wallet'),
  transactions: (params) => api.get('/api/fleet/wallet/transactions', { params }),

  myDrivers: () => api.get('/api/fleet/drivers'),
  addDriver: (payload) => api.post('/api/fleet/drivers', payload),
  setDriverStatus: (id, active) =>
    api.patch(`/api/fleet/drivers/${id}/status`, null, { params: { active } }),

  myVehicles: () => api.get('/api/fleet/vehicles'),
  addVehicle: (payload) => api.post('/api/fleet/vehicles', payload),
  removeVehicle: (id) => api.delete(`/api/fleet/vehicles/${id}`),

  submitDocument: (payload) => api.post('/api/fleet/documents', payload),

  openBookings: () => api.get('/api/fleet/open-bookings'),
  acceptBooking: (id, payload) => api.post(`/api/fleet/open-bookings/${id}/accept`, payload),
}

/* ------------------------------------------------------------ vehicles --- */

export const vehicleService = {
  list: (params) => api.get('/api/vehicles', { params }),
  detail: (id) => api.get(`/api/vehicles/${id}`),
  create: (payload) => api.post('/api/vehicles', payload),
  update: (id, payload) => api.patch(`/api/vehicles/${id}`, payload),
  remove: (id) => api.delete(`/api/vehicles/${id}`),
}

/* ------------------------------------------------------------ payments --- */

export const paymentService = {
  list: (params) => api.get('/api/payments', { params }),
  methods: () => api.get('/api/payments/methods'),
  forBooking: (bookingId) => api.get(`/api/payments/booking/${bookingId}`),

  /** Open a Razorpay order. The server decides the amount for a fare; only a
   *  wallet top-up passes one, and it is range-checked server-side. */
  createOrder: (payload) => api.post('/api/payments/razorpay/order', payload),
  /** Confirm a checkout that just succeeded in the browser. The webhook is
   *  authoritative, so this is only the fast path for immediate feedback. */
  verifyCheckout: (payload) => api.post('/api/payments/razorpay/verify', payload),

  /** Refunds that were queued rather than sent — money owed to customers. */
  pendingRefunds: () => api.get('/api/payments/refunds/pending'),
  retryRefund: (id) => api.post(`/api/payments/refunds/${id}/retry`),
  settleRefund: (id, params) => api.post(`/api/payments/refunds/${id}/settle`, null, { params }),
}

/* ------------------------------------------------------------- coupons --- */

export const couponService = {
  offers: () => api.get('/api/coupons/offers'),
  validate: (code) => api.get(`/api/coupons/validate/${encodeURIComponent(code)}`),
  list: (params) => api.get('/api/coupons', { params }),
  create: (payload) => api.post('/api/coupons', payload),
  update: (id, payload) => api.patch(`/api/coupons/${id}`, payload),
  remove: (id) => api.delete(`/api/coupons/${id}`),
}

/* ------------------------------------------------------------- reviews --- */

export const reviewService = {
  create: (payload) => api.post('/api/reviews', payload),
  pending: () => api.get('/api/reviews/pending'),
  list: (params) => api.get('/api/reviews', { params }),
  moderate: (id, payload) => api.patch(`/api/reviews/${id}`, payload),
  remove: (id) => api.delete(`/api/reviews/${id}`),
}

/* ------------------------------------------------------- notifications --- */

export const notificationService = {
  list: (params) => api.get('/api/notifications', { params }),
  unreadCount: () => api.get('/api/notifications/unread-count'),
  markRead: (id) => api.post(`/api/notifications/${id}/read`),
  markAllRead: () => api.post('/api/notifications/read-all'),
}

/* ------------------------------------------------------------- support --- */

export const supportService = {
  contact: () => api.get('/api/support/contact'),
  submit: (payload) => api.post('/api/support/requests', payload),
  myRequests: (params) => api.get('/api/support/requests', { params }),
  allRequests: (params) => api.get('/api/support/admin/requests', { params }),
}

/* --------------------------------------------------------------- admin --- */

export const adminService = {
  dashboard: () => api.get('/api/admin/dashboard'),
  reports: (params) => api.get('/api/admin/reports', { params }),
  customers: (params) => api.get('/api/admin/customers', { params }),
  customerDetail: (id) => api.get(`/api/admin/customers/${id}`),
  customerBookings: (id, params) => api.get(`/api/admin/customers/${id}/bookings`, { params }),
  suspendCustomer: (id, payload) => api.post(`/api/admin/customers/${id}/suspend`, payload),
  settings: () => api.get('/api/admin/settings'),
  updateSettings: (payload) => api.patch('/api/admin/settings', payload),
}
