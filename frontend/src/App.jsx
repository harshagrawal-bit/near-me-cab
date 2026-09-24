import { lazy, Suspense } from 'react'
import { legalService } from '@/services'
import { Navigate, Route, Routes } from 'react-router-dom'
import { homePathFor, useAuth } from '@/auth/AuthContext'
import ProtectedRoute from '@/auth/ProtectedRoute'
import { ROLES } from '@/lib/constants'
import { FullPageLoader } from '@/components/ui/Loaders'
import ErrorBoundary from '@/components/ErrorBoundary'
import ScrollToTop from '@/components/ScrollToTop'
import NotFound from '@/pages/NotFound'

import CustomerLayout from '@/layouts/CustomerLayout'
import DriverLayout from '@/layouts/DriverLayout'
import AdminLayout from '@/layouts/AdminLayout'

import Login from '@/pages/auth/Login'
import Register from '@/pages/auth/Register'
import DriverSignup from '@/pages/auth/DriverSignup'

// Customer
const PolicyPage = lazy(() => import('@/pages/legal/PolicyPage'))
const CustomerHome = lazy(() => import('@/pages/customer/Home'))
const SearchResults = lazy(() => import('@/pages/customer/SearchResults'))
const BookingForm = lazy(() => import('@/pages/customer/BookingForm'))
const MyBookings = lazy(() => import('@/pages/customer/MyBookings'))
const CustomerBookingDetail = lazy(() => import('@/pages/customer/BookingDetail'))
const CustomerProfile = lazy(() => import('@/pages/customer/Profile'))
const CustomerSupport = lazy(() => import('@/pages/customer/Support'))

// Driver
const DriverDashboard = lazy(() => import('@/pages/driver/Dashboard'))
const DriverTrips = lazy(() => import('@/pages/driver/Trips'))
const DriverTripDetail = lazy(() => import('@/pages/driver/TripDetail'))
const DriverEarnings = lazy(() => import('@/pages/driver/Earnings'))
const DriverDocuments = lazy(() => import('@/pages/driver/Documents'))
const DriverProfile = lazy(() => import('@/pages/driver/Profile'))
const DriverWallet = lazy(() => import('@/pages/driver/Wallet'))
const DriverVehicles = lazy(() => import('@/pages/driver/Vehicles'))
const DriverMyDrivers = lazy(() => import('@/pages/driver/MyDrivers'))
const DriverOpenTrips = lazy(() => import('@/pages/driver/OpenTrips'))

// Admin
const AdminDashboard = lazy(() => import('@/pages/admin/Dashboard'))
const AdminBookings = lazy(() => import('@/pages/admin/Bookings'))
const AdminBookingDetail = lazy(() => import('@/pages/admin/BookingDetail'))
const AdminDrivers = lazy(() => import('@/pages/admin/Drivers'))
const AdminDriverWallets = lazy(() => import('@/pages/admin/DriverWallets'))
const AdminDriverDetail = lazy(() => import('@/pages/admin/DriverDetail'))
const AdminCustomers = lazy(() => import('@/pages/admin/Customers'))
const AdminCustomerDetail = lazy(() => import('@/pages/admin/CustomerDetail'))
const AdminVehicles = lazy(() => import('@/pages/admin/Vehicles'))
const AdminRoutes = lazy(() => import('@/pages/admin/Routes'))
const AdminPricing = lazy(() => import('@/pages/admin/Pricing'))
const AdminPayments = lazy(() => import('@/pages/admin/Payments'))
const AdminOffers = lazy(() => import('@/pages/admin/Offers'))
const AdminReviews = lazy(() => import('@/pages/admin/Reviews'))
const AdminReports = lazy(() => import('@/pages/admin/Reports'))
const AdminSettings = lazy(() => import('@/pages/admin/Settings'))
const AdminSupport = lazy(() => import('@/pages/admin/Support'))

/** Sends a signed-in user to their role's home, or to sign-in. */
function RootRedirect() {
  const { isAuthenticated, role, initialising } = useAuth()
  if (initialising) return <FullPageLoader />
  return <Navigate to={isAuthenticated ? homePathFor(role) : '/login'} replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <ScrollToTop />
      <Suspense fallback={<FullPageLoader />}>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/driver-signup" element={<DriverSignup />} />

          {/* Public: reachable without an account, because someone deciding
              whether to sign up needs to read them first. */}
          <Route path="/privacy" element={<PolicyPage fetcher={legalService.privacy} />} />
          <Route path="/terms" element={<PolicyPage fetcher={legalService.terms} />} />
          <Route
            path="/driver-terms"
            element={<PolicyPage fetcher={legalService.vendorTerms} />}
          />

          {/* Customer */}
          <Route element={<ProtectedRoute allow={[ROLES.CUSTOMER]} />}>
            <Route path="/app" element={<CustomerLayout />}>
              <Route index element={<CustomerHome />} />
              <Route path="search" element={<SearchResults />} />
              <Route path="book" element={<BookingForm />} />
              <Route path="bookings" element={<MyBookings />} />
              <Route path="bookings/:bookingId" element={<CustomerBookingDetail />} />
              <Route path="profile" element={<CustomerProfile />} />
              <Route path="support" element={<CustomerSupport />} />
            </Route>
          </Route>

          {/* Driver */}
          <Route element={<ProtectedRoute allow={[ROLES.DRIVER]} />}>
            <Route path="/driver" element={<DriverLayout />}>
              <Route index element={<DriverDashboard />} />
              <Route path="open-trips" element={<DriverOpenTrips />} />
              <Route path="trips" element={<DriverTrips />} />
              <Route path="trips/:bookingId" element={<DriverTripDetail />} />
              <Route path="earnings" element={<DriverEarnings />} />
              <Route path="wallet" element={<DriverWallet />} />
              <Route path="vehicles" element={<DriverVehicles />} />
              <Route path="my-drivers" element={<DriverMyDrivers />} />
              <Route path="documents" element={<DriverDocuments />} />
              <Route path="profile" element={<DriverProfile />} />
            </Route>
          </Route>

          {/* Admin */}
          <Route element={<ProtectedRoute allow={[ROLES.ADMIN]} />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="bookings" element={<AdminBookings />} />
              <Route path="bookings/:bookingId" element={<AdminBookingDetail />} />
              <Route path="drivers" element={<AdminDrivers />} />
              <Route path="driver-wallets" element={<AdminDriverWallets />} />
              <Route path="drivers/:driverId" element={<AdminDriverDetail />} />
              <Route path="customers" element={<AdminCustomers />} />
              <Route path="customers/:customerId" element={<AdminCustomerDetail />} />
              <Route path="vehicles" element={<AdminVehicles />} />
              <Route path="routes" element={<AdminRoutes />} />
              <Route path="pricing" element={<AdminPricing />} />
              <Route path="payments" element={<AdminPayments />} />
              <Route path="offers" element={<AdminOffers />} />
              <Route path="reviews" element={<AdminReviews />} />
              <Route path="reports" element={<AdminReports />} />
              <Route path="support" element={<AdminSupport />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
