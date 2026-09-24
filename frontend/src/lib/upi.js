/**
 * UPI deep links, so an admin can pay a driver from their phone in one tap.
 *
 * `upi://pay?...` is the standard intent every UPI app registers for, so it
 * opens the chooser — PhonePe, GPay, Paytm, a bank app — with the payee and
 * amount already filled in. The operator only confirms and enters their PIN.
 *
 * Important limitation, and the reason the driver form asks for a UPI ID:
 * a deep link can only address a **UPI ID**. There is no way to construct one
 * from an account number and IFSC — paying to a bank account has to be done
 * inside the banking app by hand. So a driver who gives only bank details
 * cannot be paid this way, and the UI has to say so rather than opening an
 * app that cannot complete the payment.
 */

/** Is there enough here to build a working link? */
export function canPayByUpi(bank) {
  return Boolean(bank?.upi_id && /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(bank.upi_id))
}

/**
 * Build the intent URL.
 *
 * @param {object} bank    the driver's payout details
 * @param {number} amount  rupees
 * @param {string} note    shown in the UPI app's remarks field
 */
export function buildUpiLink(bank, amount, note) {
  if (!canPayByUpi(bank)) return null
  const params = new URLSearchParams({
    pa: bank.upi_id,
    pn: bank.account_name || 'Driver',
    cu: 'INR',
  })
  // Amount is optional in the spec; omitting it lets the operator type one
  // rather than being blocked by a zero.
  if (Number(amount) > 0) params.set('am', Number(amount).toFixed(2))
  if (note) params.set('tn', String(note).slice(0, 50))
  return `upi://pay?${params.toString()}`
}

/** Copy helper that degrades quietly on browsers without clipboard access. */
export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(String(value))
    return true
  } catch {
    return false
  }
}
