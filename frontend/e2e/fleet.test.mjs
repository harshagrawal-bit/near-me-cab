/**
 * Browser coverage for the fleet + advance flows.
 *
 * Drives one booking from customer request through the admin advance gate to a
 * fleet owner accepting it with a chosen car and driver — through the real UI,
 * against the real API. Any /api/ response >= 400 that is not an expected
 * signed-out 401 fails the run, so a page that silently renders an error state
 * cannot pass.
 */

import { chromium } from 'playwright-core'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173'
const ADMIN = { email: 'admin@localride.in', password: 'Admin@12345' }
const CUSTOMER = { email: 'aarti.joshi@example.com', password: 'Password@123' }

let passed = 0
let failed = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    failures.push(name)
    console.log(`  ✗ ${name} ${detail ? `— ${detail}` : ''}`)
  }
}

const stamp = Date.now()
const OWNER = {
  name: 'E2E Fleet Owner',
  email: `e2e-owner-${stamp}@nearmecab-test.com`,
  phone: `9${String(stamp).slice(-9)}`,
  password: 'Password@123',
  licence: `MH12E2E${String(stamp).slice(-5)}`,
  plate: `MH12ZZ${String(stamp).slice(-4)}`,
}

function futureDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function settled(page, timeout = 20000) {
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(
    () => {
      if (document.querySelectorAll('.skeleton').length > 0) return false
      const text = document.body.innerText || ''
      if (text.includes('Loading…') || text.includes('Checking your session')) return false
      return text.length > 100
    },
    { timeout },
  )
  await page.waitForLoadState('networkidle')
}

async function waitForText(page, text, timeout = 20000) {
  try {
    await page.waitForFunction(
      (needle) => (document.body.innerText || '').includes(needle),
      text,
      { timeout },
    )
  } catch (error) {
    // A bare "timed out waiting for X" tells you nothing about why. Print what
    // the page actually rendered so the failure is diagnosable from the log.
    const body = await page.evaluate(() => document.body.innerText).catch(() => '<unreadable>')
    console.log(`\n  !! waiting for "${text}" at ${page.url()}`)
    console.log(`  !! page shows: ${body.slice(0, 500).replace(/\n+/g, ' | ')}\n`)
    throw error
  }
}

async function login(page, { email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#email', { timeout: 20000 })
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.locator('button[type=submit]').first().click()
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 25000 })
  await settled(page)
}

function watchApi(page, label, sink) {
  page.on('response', (response) => {
    const url = response.url()
    if (!url.includes('/api/')) return
    const status = response.status()
    // A signed-out visitor legitimately gets 401 from the silent refresh.
    if (status === 401 && url.includes('/api/auth/refresh')) return
    if (status >= 400) {
      const line = `${label}: ${status} ${url.replace(BASE, '')}`
      sink.push(line)
      // Print immediately. Collecting these for a summary that a mid-run
      // failure never reaches is how a 429 stays invisible for an hour.
      console.log(`  ! ${line}`)
    }
  })
}

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const apiErrors = []

  // ---------------------------------------------------------------- owner ---
  console.log('\n[Driver signup]')
  const owner = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const op = await owner.newPage()
  watchApi(op, 'owner', apiErrors)

  await op.goto(`${BASE}/driver-signup`, { waitUntil: 'networkidle' })
  await op.waitForSelector('#name', { timeout: 20000 })
  await op.fill('#name', OWNER.name)
  await op.fill('#email', OWNER.email)
  await op.fill('#phone', OWNER.phone)
  await op.fill('#password', OWNER.password)
  await op.fill('#licence_number', OWNER.licence)
  await op.fill('#licence_expiry', futureDate(900))
  await op.locator('button[type=submit]').first().click()
  // NOT startsWith('/driver') — that also matches '/driver-signup', so it
  // returns before the form has even submitted and everything after races
  // against a signed-out page.
  await op.waitForFunction(
    () => location.pathname === '/driver' || location.pathname.startsWith('/driver/'),
    { timeout: 25000 },
  )
  await settled(op)
  check('driver signup lands in the driver app', op.url().includes('/driver'))

  await op.goto(`${BASE}/driver/wallet`, { waitUntil: 'networkidle' })
  await settled(op)
  // Wait for a string that only exists once the wallet call has resolved —
  // the page header alone is long enough to satisfy settled().
  await waitForText(op, 'Minimum')
  let text = await op.locator('body').innerText()
  check('new owner sees an empty wallet', /₹0/.test(text))
  check('wallet warns they cannot accept trips', text.includes('cannot accept trips'))
  check('wallet names the minimum', /800/.test(text))

  console.log('\n[Vehicles]')
  await op.goto(`${BASE}/driver/vehicles`, { waitUntil: 'networkidle' })
  await settled(op)
  await waitForText(op, 'No vehicles yet')
  check(
    'vehicles page shows the empty state',
    (await op.locator('body').innerText()).includes('No vehicles yet'),
  )

  await op.locator('button:has-text("Add vehicle")').first().click()
  await op.waitForSelector('#model', { timeout: 15000 })
  await op.fill('#model', 'Maruti Suzuki Dzire')
  await op.fill('#plate', OWNER.plate)
  await op.locator('button:has-text("Add vehicle")').last().click()
  await waitForText(op, OWNER.plate)
  check('vehicle added and listed', (await op.locator('body').innerText()).includes(OWNER.plate))

  console.log('\n[My drivers]')
  await op.goto(`${BASE}/driver/my-drivers`, { waitUntil: 'networkidle' })
  await settled(op)
  await waitForText(op, 'No drivers yet')
  await op.locator('button:has-text("Add driver")').first().click()
  await op.waitForSelector('#sdname', { timeout: 15000 })
  await op.fill('#sdname', 'E2E Employed Driver')
  await op.fill('#sdemail', `e2e-sub-${stamp}@nearmecab-test.com`)
  await op.fill('#sdphone', `9${String(stamp + 7).slice(-9)}`)
  await op.fill('#sdpassword', 'Password@123')
  await op.fill('#sdlicence', `MH14E2E${String(stamp).slice(-5)}`)
  await op.fill('#sdexpiry', futureDate(700))
  await op.locator('button:has-text("Add driver")').last().click()
  await waitForText(op, 'E2E Employed Driver')
  check('employed driver added', (await op.locator('body').innerText()).includes('E2E Employed Driver'))

  // ------------------------------------------------------------- customer ---
  console.log('\n[Customer books]')
  const cust = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const cp = await cust.newPage()
  watchApi(cp, 'customer', apiErrors)
  await login(cp, CUSTOMER)

  // Drive the real home-page search rather than a hand-built query string —
  // the route id has to come from the price book, not from the URL.
  await cp.selectOption('#route', { label: 'Pune → Mumbai' })
  await cp.click('button[type=submit]')
  await cp.waitForURL('**/app/search**', { timeout: 20000 })
  await settled(cp)
  await cp.locator('button:has-text("Select")').first().waitFor({ timeout: 20000 })
  await cp.locator('button:has-text("Select")').first().click()
  await cp.waitForURL('**/app/book**', { timeout: 20000 })
  await settled(cp)
  await cp.locator('#pickup').waitFor({ timeout: 20000 })
  await cp.fill('#pickup', 'Baner Road, Pune')
  await cp.fill('#drop', 'Bandra Kurla Complex, Mumbai')
  // Two confirm buttons exist: a desktop one inside the form (hidden lg:block)
  // and a mobile one in the sidebar (lg:hidden) that sits OUTSIDE the form and
  // carries its own onClick. Match by visible text so the right one is used at
  // whatever viewport this runs at.
  await cp.locator('button:has-text("Confirm booking"):visible').first().click()
  await cp.waitForURL('**/app/bookings/**', { timeout: 20000 })
  await settled(cp)
  await waitForText(cp, 'Booking received')
  const bookingRef = (await cp.locator('body').innerText()).match(/[A-Z]{2,4}-\d{8}-\d{4}/)?.[0]
  check('customer created a booking', Boolean(bookingRef), bookingRef || 'no reference found')

  // ---------------------------------------------------------------- admin ---
  console.log('\n[Admin advance gate]')
  const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const ap = await admin.newPage()
  watchApi(ap, 'admin', apiErrors)
  await login(ap, ADMIN)

  await ap.goto(`${BASE}/admin/bookings`, { waitUntil: 'networkidle' })
  await settled(ap)
  await ap.locator(`text=${bookingRef}`).first().click()
  await ap.waitForURL(/\/admin\/bookings\/[a-f0-9]{24}/, { timeout: 20000 })
  await settled(ap)

  await ap.locator('button:has-text("Confirm car available")').first().click()
  await ap.locator('button:has-text("Confirm availability")').last().click()
  await waitForText(ap, 'Awaiting Advance')
  text = await ap.locator('body').innerText()
  check('confirming availability requests the advance', text.includes('Awaiting Advance'))

  // The advance must be 15% of the fare, computed by the server.
  const fare = Number((text.match(/Total[\s\S]{0,40}?₹([\d,]+)/) || [])[1]?.replace(/,/g, ''))
  check('advance gate reached with a fare on screen', Number.isFinite(fare) && fare > 0)

  console.log('\n[Owner cannot accept before payment]')
  await op.goto(`${BASE}/driver/open-trips`, { waitUntil: 'networkidle' })
  await settled(op)
  await waitForText(op, 'Open trips')
  check(
    'unpaid booking is not offered to fleet owners',
    !(await op.locator('body').innerText()).includes(bookingRef),
  )

  console.log('\n[Admin records the advance]')
  await ap.locator('button:has-text("Mark advance received")').first().click()
  await ap.locator('button:has-text("Mark advance received")').last().click()
  await waitForText(ap, 'Confirmed')
  check('advance recorded confirms the booking', (await ap.locator('body').innerText()).includes('Confirmed'))

  // ------------------------------------------------------- owner accepts ---
  console.log('\n[Owner accepts]')
  await op.goto(`${BASE}/driver/open-trips`, { waitUntil: 'networkidle' })
  await settled(op)
  await waitForText(op, bookingRef)
  text = await op.locator('body').innerText()
  check('paid booking now appears as open work', text.includes(bookingRef))
  check('open trip shows the wallet hold required', /Holds\s*₹/.test(text))

  const acceptDisabled = await op
    .locator('button:has-text("Accept trip")')
    .first()
    .isDisabled()
  check('accept is blocked while the wallet is empty', acceptDisabled)

  // Fund the wallet through the real admin UI, then retry the acceptance.
  console.log('\n[Admin funds the deposit]')
  await ap.goto(`${BASE}/admin/drivers`, { waitUntil: 'networkidle' })
  await settled(ap)
  await ap.fill('input[aria-label="Search drivers"]', OWNER.email)
  await waitForText(ap, OWNER.name)
  await ap.locator(`text=${OWNER.name}`).first().click()
  await ap.waitForURL(/\/admin\/drivers\/[a-f0-9]{24}/, { timeout: 20000 })
  await settled(ap)

  // Verify them first — an unverified owner is refused regardless of balance.
  await ap.locator('button:has-text("Verify")').first().click()
  await ap.locator('button:has-text("Verify driver")').last().click()
  await waitForText(ap, 'Verified')

  await ap.locator('button:has-text("Wallet")').first().click()
  await ap.waitForSelector('#topup', { timeout: 15000 })
  await ap.fill('#topup', '5000')
  await ap.fill('#topupnote', 'E2E deposit')
  await ap.locator('button:has-text("Add to wallet")').first().click()
  await waitForText(ap, '₹5,000')
  check('admin can record a deposit', (await ap.locator('body').innerText()).includes('₹5,000'))

  console.log('\n[Owner accepts after funding]')
  await op.goto(`${BASE}/driver/open-trips`, { waitUntil: 'networkidle' })
  await settled(op)
  await op.locator('button:has-text("Accept trip")').first().click()
  await op.waitForSelector('#vehicle', { timeout: 15000 })
  await op.selectOption('#vehicle', { index: 1 })
  await op.selectOption('#driver', { index: 1 })
  await op.locator('button:has-text("Accept trip")').last().click()
  await op.waitForURL(/\/driver\/trips\/[a-f0-9]{24}/, { timeout: 25000 })
  await settled(op)
  check('owner accepted the trip', op.url().includes('/driver/trips/'))

  await op.goto(`${BASE}/driver/wallet`, { waitUntil: 'networkidle' })
  await settled(op)
  await waitForText(op, 'Held for trip')
  text = await op.locator('body').innerText()
  check('accepting the trip held part of the deposit', /Held[\s\S]{0,40}₹[1-9]/.test(text))
  check('wallet statement records the hold', text.includes('Held for trip'))

  console.log('\n[Summary]')
  if (apiErrors.length) {
    for (const err of apiErrors.slice(0, 10)) console.log(`  ! ${err}`)
  }
  check('no unexpected API errors', apiErrors.length === 0, apiErrors.slice(0, 3).join('; '))

  await browser.close()

  console.log(`\n${'='.repeat(60)}`)
  if (failed) {
    console.log(`FAILED — ${failed} of ${passed + failed} checks failed`)
    console.log(failures.map((f) => `  - ${f}`).join('\n'))
    process.exit(1)
  }
  console.log(`PASSED — all ${passed} fleet checks succeeded.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
