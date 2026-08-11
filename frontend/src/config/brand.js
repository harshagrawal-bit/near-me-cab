/**
 * Single source of truth for brand identity.
 *
 * To rebrand the whole application, change the values here (or set the
 * matching VITE_BRAND_* variables). No component hard-codes the name.
 */

const env = import.meta.env

const NAME = env.VITE_BRAND_NAME || 'NearMe Cab'

export const brand = {
  name: NAME,
  tagline: env.VITE_BRAND_TAGLINE || 'A cab, near you.',
  legalName: env.VITE_BRAND_LEGAL_NAME || 'NearMe Cab',
  supportPhone: env.VITE_BRAND_SUPPORT_PHONE || '9000000000',
  supportEmail: env.VITE_BRAND_SUPPORT_EMAIL || 'support@nearmecab.in',

  /**
   * Splits the wordmark on the first space so the two halves can be styled
   * differently — "NearMe" plain, "Cab" reversed out of a red chip, matching
   * the mark. A single-word brand simply leaves `trail` empty.
   */
  wordmark: {
    get lead() {
      return NAME.split(' ')[0]
    },
    get trail() {
      return NAME.split(' ').slice(1).join(' ')
    },
  },

  /** Copy shown to signed-out visitors on the sign-in screen. */
  marketing: {
    headline: 'Outstation cabs, airport transfers and local trips.',
    subhead:
      'Clean cars, verified drivers and fares agreed up front. No surge pricing, no surprises at the drop.',
    points: [
      'Fixed fares published before you book',
      'Verified drivers with documents on file',
      'Live status from request to drop-off',
    ],
  },
}

export const currency = {
  code: 'INR',
  symbol: '₹',
  locale: 'en-IN',
}

export default brand
