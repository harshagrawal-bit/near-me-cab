/**
 * Browser-driven verification of the three role experiences.
 * Fails loudly on any console error, page error or failed network request.
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const SHOTS = process.env.SHOT_DIR || new URL('./screenshots', import.meta.url).pathname
fs.mkdirSync(SHOTS, { recursive: true })

const results = []
const consoleIssues = []
let checks = 0

function check(name, ok, detail = '') {
  checks++
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` — ${detail}`}`)
}

async function newPage(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // "Failed to load resource" is the browser echoing an HTTP status we
    // already assert on below; React DevTools is a nag, not an error.
    if (/Download the React DevTools|Failed to load resource/i.test(text)) return
    consoleIssues.push(`[${label}] console: ${text}`)
  })
  page.on('pageerror', (err) => consoleIssues.push(`[${label}] pageerror: ${err.message}`))
  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/')) {
      consoleIssues.push(`[${label}] request failed: ${req.url()}`)
    }
  })
  page.on('response', (res) => {
    const url = res.url()
    if (!url.includes('/api/')) return
    const status = res.status()
    if (status < 400) return
    // A 401 from /auth/refresh is the designed signed-out path, not a fault.
    if (status === 401 && url.includes('/api/auth/refresh')) return
    consoleIssues.push(`[${label}] API ${status} ${url.replace(BASE, '')}`)
  })
  return { context, page }
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  // React Router navigates client-side, so wait for the URL to leave /login.
  await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), {
    timeout: 15000,
  })
  await page.waitForLoadState('networkidle')
}

/**
 * Waits for a page to actually finish rendering real data.
 *
 * `networkidle` alone is not enough: after a client-side navigation it can
 * resolve during the gap before the lazy route chunk loads and fires its
 * fetch. So we also wait for the Suspense loader and every skeleton to be
 * gone, and for the page to carry real content.
 */
async function settled(page, timeout = 20000) {
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(
    () => {
      if (document.querySelectorAll('.skeleton').length > 0) return false
      const text = document.body.innerText || ''
      if (text.includes('Loading…') || text.includes('Checking your session')) return false
      return text.length > 200
    },
    { timeout },
  )
  await page.waitForLoadState('networkidle')
}

/**
 * Waits for specific text to appear.
 *
 * Needed because React Router's v7 startTransition keeps the previous route
 * mounted while a lazy chunk loads, so "no skeletons + has text" can describe
 * the page we just navigated away from.
 */
async function waitForText(page, text, timeout = 20000) {
  await page.locator(`text=${text}`).first().waitFor({ timeout })
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  // ---------------------------------------------------------------- customer
  console.log('\n[Customer]')
  {
    const { context, page } = await newPage(browser, 'customer')
    await login(page, 'aarti.joshi@example.com', 'Password@123')
    await settled(page)
    check('customer lands on /app', page.url().includes('/app'), page.url())
    check(
      'booking form rendered',
      await page.locator('button:has-text("Get Fare Estimate")').isVisible(),
    )
    check('greeting shows first name', (await page.textContent('h1'))?.includes('Aarti'))
    await shot(page, 'customer-home')

    // Pick Pune → Mumbai and get an estimate.
    await page.selectOption('#route', { label: 'Pune → Mumbai' })
    await page.click('button[type=submit]')
    await page.waitForURL('**/app/search**')
    await settled(page)
    await page.locator('button:has-text("Select")').first().waitFor({ timeout: 15000 })
    const fares = await page.locator('text=/₹\\s?[0-9,]+/').allTextContents()
    check('fare options rendered', fares.length > 0, JSON.stringify(fares.slice(0, 5)))
    check(
      'sedan priced at ₹3,000 from the database',
      (await page.locator('body').textContent()).includes('₹3,000'),
    )
    await shot(page, 'customer-search')

    // Select the first vehicle and open the booking form.
    await page.locator('button:has-text("Select")').first().click()
    await page.waitForURL('**/app/book**')
    await settled(page)
    await page.locator('#pickup').waitFor({ timeout: 15000 })
    check('booking form loaded', await page.locator('#pickup').isVisible())
    check(
      'fare summary shows total payable',
      (await page.locator('body').textContent()).includes('Total payable'),
    )
    await shot(page, 'customer-book')

    // Confirm the booking.
    await page.fill('#pickup', 'Baner Road, Pune')
    await page.fill('#drop', 'Bandra Kurla Complex, Mumbai')
    await page.locator('form button[type=submit]').first().click()
    await page.waitForURL('**/app/bookings/**', { timeout: 20000 })
    await waitForText(page, 'Booking received')
    await settled(page)
    const body = await page.locator('body').textContent()
    check('booking created and detail shown', body.includes('Booking received'), '')
    // Prefix is brand-dependent and set by BOOKING_PREFIX on the server, so
    // match the shape rather than a literal that breaks on every rebrand.
    check('booking reference visible', /[A-Z]{2,4}-\d{8}-\d{4}/.test(body))
    check('status timeline rendered', body.includes('Requested') && body.includes('Completed'))
    check(
      'navigation resets scroll to the top',
      (await page.evaluate(() => window.scrollY)) === 0,
    )
    await shot(page, 'customer-booking-detail')

    // My trips
    await page.goto(`${BASE}/app/bookings`, { waitUntil: 'networkidle' })
    await settled(page)
    check('my trips list renders', (await page.locator('body').textContent()).includes('My trips'))
    await shot(page, 'customer-bookings')

    // Guard: customer cannot reach admin
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
    check('customer redirected away from /admin', !page.url().endsWith('/admin'), page.url())

    // Mobile viewport
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/app`, { waitUntil: 'networkidle' })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    check('no horizontal overflow on mobile', !overflow)
    check('bottom tab bar visible on mobile', await page.locator('nav[aria-label=Primary]').first().isVisible())
    await shot(page, 'customer-mobile')

    await context.close()
  }

  // ------------------------------------------------------------------ driver
  console.log('\n[Driver]')
  {
    const { context, page } = await newPage(browser, 'driver')
    await login(page, 'sandeep.kulkarni@localride.in', 'Password@123')
    await settled(page)
    check('driver lands on /driver', page.url().includes('/driver'), page.url())
    const body = await page.locator('body').textContent()
    check('availability toggle present', body.includes('online') || body.includes('offline'))
    check("today's earnings card present", body.includes("Today's earnings"))
    await shot(page, 'driver-dashboard')

    await page.goto(`${BASE}/driver/earnings`, { waitUntil: 'networkidle' })
    await settled(page)
    const earnings = await page.locator('body').textContent()
    check('earnings page renders windows', earnings.includes('This week') && earnings.includes('Lifetime'))
    check('earnings chart rendered', (await page.locator('svg.recharts-surface').count()) > 0)
    await shot(page, 'driver-earnings')

    await page.goto(`${BASE}/driver/documents`, { waitUntil: 'networkidle' })
    await settled(page)
    check(
      'documents show verification status',
      (await page.locator('body').textContent()).includes('Driving Licence'),
    )
    await shot(page, 'driver-documents')

    await page.goto(`${BASE}/driver/trips`, { waitUntil: 'networkidle' })
    await settled(page)
    check('trips page renders', (await page.locator('body').textContent()).includes('My trips'))

    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
    check('driver redirected away from /admin', !page.url().endsWith('/admin'), page.url())

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/driver`, { waitUntil: 'networkidle' })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    check('driver home has no mobile overflow', !overflow)
    await shot(page, 'driver-mobile')

    await context.close()
  }

  // ------------------------------------------------------------------- admin
  console.log('\n[Admin]')
  {
    const { context, page } = await newPage(browser, 'admin')
    await login(page, 'admin@localride.in', 'Admin@12345')
    await settled(page)
    check('admin lands on /admin', page.url().includes('/admin'), page.url())
    let body = await page.locator('body').textContent()
    check('dashboard cards rendered', body.includes('Bookings today') && body.includes('Revenue today'))
    check('revenue chart rendered', (await page.locator('svg.recharts-surface').count()) > 0)
    check('booking status distribution rendered', body.includes('Booking status'))
    await shot(page, 'admin-dashboard')

    const pages = [
      ['bookings', 'Bookings'],
      ['drivers', 'Drivers'],
      ['customers', 'Customers'],
      ['vehicles', 'Vehicles'],
      ['routes', 'Routes'],
      ['pricing', 'Pricing'],
      ['payments', 'Payments'],
      ['offers', 'Offers'],
      ['reviews', 'Reviews'],
      ['reports', 'Reports'],
      ['support', 'Support inbox'],
      ['settings', 'Settings'],
    ]
    for (const [slug, heading] of pages) {
      await page.goto(`${BASE}/admin/${slug}`, { waitUntil: 'networkidle' })
      await settled(page)
      const text = await page.locator('body').textContent()
      check(`admin/${slug} renders`, text.includes(heading), `heading "${heading}" missing`)
      await shot(page, `admin-${slug}`)
    }

    // Drill into a booking to exercise the workflow screen.
    await page.goto(`${BASE}/admin/bookings`, { waitUntil: 'networkidle' })
    await settled(page)
    await page.locator('table tbody tr').first().click()
    await page.waitForURL('**/admin/bookings/**')
    await waitForText(page, 'Status history')
    await settled(page)
    body = await page.locator('body').textContent()
    check('booking detail shows actions', body.includes('Actions'))
    check('booking detail shows status history', body.includes('Status history'))
    check('booking detail shows fare breakdown', body.includes('Total payable'))
    await shot(page, 'admin-booking-detail')

    // Pricing grid shows seeded ₹3,000 Pune → Mumbai sedan fare.
    await page.goto(`${BASE}/admin/pricing`, { waitUntil: 'networkidle' })
    await settled(page)
    check(
      'pricing grid shows seeded fares',
      (await page.locator('body').textContent()).includes('₹3,000'),
    )

    // Tablet viewport for the admin shell.
    await page.setViewportSize({ width: 820, height: 1180 })
    await page.goto(`${BASE}/admin/bookings`, { waitUntil: 'networkidle' })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    check('admin bookings has no tablet overflow', !overflow)
    await shot(page, 'admin-tablet')

    await context.close()
  }

  // ------------------------------------------------------------- unauthorised
  console.log('\n[Unauthenticated]')
  {
    const { context, page } = await newPage(browser, 'anon')
    await page.goto(`${BASE}/app/bookings`, { waitUntil: 'networkidle' })
    check('signed-out user sent to /login', page.url().includes('/login'), page.url())
    await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' })
    check('signed-out user blocked from admin', page.url().includes('/login'), page.url())
    await page.goto(`${BASE}/nope-does-not-exist`, { waitUntil: 'networkidle' })
    check('404 page renders', (await page.locator('body').textContent()).includes('404'))
    await shot(page, 'not-found')
    await context.close()
  }
} finally {
  await browser.close()
}

console.log(`\n${'='.repeat(60)}`)
const failed = results.filter((r) => !r.ok)
if (consoleIssues.length) {
  console.log(`\nConsole / network issues (${consoleIssues.length}):`)
  ;[...new Set(consoleIssues)].slice(0, 25).forEach((i) => console.log(`  · ${i}`))
}
if (failed.length || consoleIssues.length) {
  console.log(`\nFAILED — ${failed.length} of ${checks} checks failed, ${consoleIssues.length} console issues.`)
  process.exit(1)
}
console.log(`PASSED — all ${checks} UI checks succeeded, no console errors.`)
