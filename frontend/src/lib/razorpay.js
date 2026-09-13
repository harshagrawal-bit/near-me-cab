/**
 * Razorpay Checkout, wrapped so components never touch the SDK directly.
 *
 * Three things this hides:
 *
 *  1. The script is loaded on demand, once. Shipping it in the bundle would
 *     cost every visitor a request for something most of them never open.
 *  2. The amount always comes back from our own server. Nothing here lets a
 *     caller name a price for a fare — `amount` is only forwarded for a wallet
 *     top-up, where the driver genuinely chooses it and the server bounds it.
 *  3. A dismissed modal is a cancellation, not a failure. Showing someone a red
 *     error because they changed their mind is how a working flow reads broken.
 */

import { paymentService } from '@/services'
import { brand } from '@/config/brand'

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

/** Distinguishes "closed the sheet" from "the payment failed". */
export class PaymentCancelled extends Error {
  constructor() {
    super('Payment cancelled')
    this.name = 'PaymentCancelled'
    this.cancelled = true
  }
}

/**
 * Razorpay took the money but our confirmation call did not get through.
 * The webhook still will, so this is a "check back shortly", never a failure.
 */
export class PaymentUnconfirmed extends Error {
  constructor(paymentId) {
    super('Payment received, confirmation pending')
    this.name = 'PaymentUnconfirmed'
    this.pending = true
    this.paymentId = paymentId
  }
}

let scriptPromise = null

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = CHECKOUT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Allow a later retry rather than caching the failure forever.
      scriptPromise = null
      reject(new Error('Could not reach the payment provider. Check your connection.'))
    }
    document.body.appendChild(script)
  })
  return scriptPromise
}

/**
 * Run one payment end to end.
 *
 * @param {'advance'|'balance'|'wallet_topup'} purpose
 * @param {string} [bookingId] required for advance and balance
 * @param {number} [amount]    wallet top-up only
 * @param {string} [description] shown inside the Razorpay sheet
 * @returns {Promise<object>} the verification result once confirmed
 */
export async function startPayment({ purpose, bookingId, amount, description }) {
  const payload = { purpose }
  if (bookingId) payload.booking_id = bookingId
  if (purpose === 'wallet_topup' && amount != null) payload.amount = Number(amount)

  const order = await paymentService.createOrder(payload)
  await loadCheckout()

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: order.key_id,
      amount: order.amount_paise,
      currency: order.currency,
      order_id: order.order_id,
      name: brand.name,
      description: description || 'Payment',
      prefill: {
        name: order.name || '',
        email: order.email || '',
        contact: order.phone || '',
      },
      theme: { color: '#d81f26' },
      handler: async (response) => {
        try {
          resolve(await paymentService.verifyCheckout(response))
        } catch {
          // The money moved; only our confirmation round-trip failed. The
          // webhook is authoritative and will settle it server-side.
          reject(new PaymentUnconfirmed(response?.razorpay_payment_id))
        }
      },
      modal: {
        ondismiss: () => reject(new PaymentCancelled()),
      },
    })

    checkout.on('payment.failed', (event) => {
      reject(new Error(event?.error?.description || 'The payment did not go through.'))
    })

    checkout.open()
  })
}

export default startPayment
