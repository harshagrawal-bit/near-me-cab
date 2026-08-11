/**
 * Scripted product walkthrough.
 *
 * Drives one real booking from customer request → admin confirmation →
 * driver assignment → trip completion, screenshotting each step. Everything
 * here goes through the real UI and the real API.
 *
 *   node e2e/demo.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const OUT = process.env.SHOT_DIR || new URL('./demo', import.meta.url).pathname
fs.mkdirSync(OUT, { recursive: true })

let step = 0
const shot = async (page, name, full = false) => {
  step += 1
  const file = `${OUT}/${String(step).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file, fullPage: full })
  console.log(`  📸 ${String(step).padStart(2, '0')} ${name}`)
}

async function settled(page) {
  await page.waitForLoadState('networkidle')
  await page
    .waitForFunction(
      () => {
        if (document.querySelectorAll('.skeleton').length) return false
        const t = document.body.innerText || ''
        return !t.includes('Loading…') && t.length > 200
      },
      { timeout: 20000 },
    )
    .catch(() => {})
}

async function signIn(browser, email, password, viewport) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
  await settled(page)
  return { context, page }
}

// The driver we assign to and then sign in as, so the walkthrough follows
// one person end to end.
const DRIVER_NAME = 'Sandeep Kulkarni'
const DRIVER_EMAIL = 'sandeep.kulkarni@localride.in'

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  // ═══════════════════════════════════ 1. Customer books a trip (on a phone)
  console.log('\n▸ CUSTOMER — books a Pune → Mumbai trip')
  const { context: cctx, page: customer } = await signIn(
    browser,
    'aarti.joshi@example.com',
    'Password@123',
    PHONE,
  )
  await shot(customer, 'customer-home')

  // Pick a distinct slot per run, so repeat demos do not trip the
  // driver double-booking guard with their own leftovers.
  const slot = new Date()
  slot.setDate(slot.getDate() + 5 + Math.floor(Math.random() * 40))
  const slotDate = slot.toISOString().slice(0, 10)
  const slotHour = String(7 + Math.floor(Math.random() * 12)).padStart(2, '0')
  await customer.fill('#date', slotDate)
  await customer.fill('#time', `${slotHour}:00`)

  await customer.selectOption('#route', { label: 'Pune → Mumbai' })
  await customer.click('button[type=submit]')
  await customer.waitForURL('**/app/search**')
  await settled(customer)
  await shot(customer, 'customer-fare-options')

  // Choose the Sedan option.
  const sedanCard = customer.locator('div').filter({ hasText: /^Sedan/ }).first()
  await customer
    .locator('button:has-text("Select")')
    .nth(1) // hatchback, sedan, suv, premium, tempo
    .click()
  await customer.waitForURL('**/app/book**')
  await settled(customer)
  await customer.fill('#pickup', 'Sai Residency, Baner Road, Pune')
  await customer.fill('#drop', 'Bandra Kurla Complex, Mumbai')
  await customer.fill('#notes', 'Two large suitcases. Please call on arrival.')
  await shot(customer, 'customer-booking-form', true)

  await customer.locator('aside button:has-text("Confirm booking")').click()
  await customer.waitForURL('**/app/bookings/**', { timeout: 20000 })
  await customer.locator('text=Booking received').first().waitFor({ timeout: 20000 })
  await settled(customer)
  await shot(customer, 'customer-booking-confirmed', true)

  const bookingRef = (await customer.locator('body').innerText()).match(/LR-\d{8}-\d{4}/)[0]
  console.log(`  → created ${bookingRef}`)

  // ═══════════════════════════════════════ 2. Admin confirms + assigns driver
  console.log('\n▸ ADMIN — confirms the booking and assigns a driver')
  const { context: actx, page: admin } = await signIn(
    browser,
    'admin@localride.in',
    'Admin@12345',
    DESKTOP,
  )
  await shot(admin, 'admin-dashboard')

  await admin.goto(`${BASE}/admin/bookings`, { waitUntil: 'networkidle' })
  await settled(admin)
  await admin.fill('input[aria-label="Search bookings"]', bookingRef)
  await admin.waitForTimeout(1200)
  await settled(admin)
  await shot(admin, 'admin-bookings-search')

  await admin.locator('table tbody tr').first().click()
  await admin.waitForURL('**/admin/bookings/**')
  await admin.locator('text=Status history').first().waitFor({ timeout: 20000 })
  await settled(admin)
  await shot(admin, 'admin-booking-detail', true)

  // Confirm
  await admin.locator('button:has-text("Confirm booking")').first().click()
  await admin.locator('[role=dialog]').waitFor()
  await shot(admin, 'admin-confirm-dialog')
  await admin.locator('[role=dialog] button:has-text("Confirm booking")').click()
  await admin.waitForTimeout(1500)
  await settled(admin)

  // Assign a driver
  await admin.locator('button:has-text("Assign driver")').first().click()
  await admin.locator('[role=dialog]').waitFor()
  await admin.waitForTimeout(1200)
  await shot(admin, 'admin-assign-driver')
  await admin
    .locator('[role=dialog] label')
    .filter({ hasText: DRIVER_NAME })
    .first()
    .locator('input[type=radio]')
    .check()
  await admin.locator('[role=dialog] button:has-text("Assign")').click()
  await admin.waitForTimeout(1500)
  await settled(admin)
  await shot(admin, 'admin-driver-assigned', true)
  if (!(await admin.locator('body').innerText()).includes(DRIVER_NAME)) {
    throw new Error(`Assignment to ${DRIVER_NAME} did not take — check the booking detail`)
  }

  const assignedDriver = (await admin.locator('body').innerText())
    .split('Driver & vehicle')[1]
    ?.split('\n')
    .find((l) => l.trim() && !l.includes('Driver'))
  console.log(`  → assigned to ${assignedDriver?.trim() || 'a driver'}`)

  // ══════════════════════════════════════════ 3. Driver runs the trip (phone)
  console.log('\n▸ DRIVER — accepts and runs the trip')
  const { context: dctx, page: driver } = await signIn(
    browser,
    DRIVER_EMAIL,
    'Password@123',
    PHONE,
  )
  await shot(driver, 'driver-dashboard', true)

  await driver.goto(`${BASE}/driver/trips`, { waitUntil: 'networkidle' })
  await settled(driver)
  const tripCard = driver.locator(`text=${bookingRef}`).first()
  if (!(await tripCard.count())) {
    throw new Error(`${bookingRef} is not visible to ${DRIVER_NAME} — assignment did not stick`)
  }
  {
    await tripCard.click()
    // A plain glob also matches the list page itself, so require an id segment.
    await driver.waitForURL(/\/driver\/trips\/[a-f0-9]{24}/, { timeout: 20000 })
    await settled(driver)
    await shot(driver, 'driver-trip-detail', true)

    // Walk the status ladder, screenshotting the confirmation guard once.
    const steps = [
      'Accept this trip',
      "I'm on the way",
      'Customer picked up',
      'Start trip',
      'Complete trip',
    ]
    for (const [index, label] of steps.entries()) {
      const button = driver.locator(`button:has-text("${label}")`).first()
      // Fail loudly: silently skipping a step made an earlier run report
      // success while the booking never left `driver_assigned`.
      await button.waitFor({ timeout: 20000 })
      await button.click()
      await driver.locator('[role=dialog]').waitFor()
      if (index === 0) await shot(driver, 'driver-confirm-guard')
      await driver.locator('[role=dialog] button:has-text("Yes, confirm")').click()
      await driver.waitForTimeout(1400)
      await settled(driver)
    }
    await shot(driver, 'driver-trip-completed', true)
  }

  await driver.goto(`${BASE}/driver/earnings`, { waitUntil: 'networkidle' })
  await settled(driver)
  await shot(driver, 'driver-earnings', true)

  // ═══════════════════════════════════ 4. Customer sees the finished timeline
  console.log('\n▸ CUSTOMER — sees the completed trip and rates it')
  await customer.reload({ waitUntil: 'networkidle' })
  await settled(customer)
  await shot(customer, 'customer-trip-completed', true)

  const rate = customer.locator('button:has-text("Rate this trip")').first()
  if (await rate.count()) {
    await rate.click()
    await customer.locator('[role=dialog]').waitFor()
    await shot(customer, 'customer-rate-trip')
    await customer.locator('[role=dialog] button[aria-label="5 stars"]').click()
    await customer.fill('#comment', 'Clean car, on time, very courteous driver.')
    await customer.locator('[role=dialog] button:has-text("Submit review")').click()
    await customer.waitForTimeout(1500)
    await settled(customer)
    await shot(customer, 'customer-review-done', true)
  }

  // ═══════════════════════════════════════════ 5. Admin sees it land in ops
  console.log('\n▸ ADMIN — the trip lands in reports and reviews')
  await admin.goto(`${BASE}/admin/reviews`, { waitUntil: 'networkidle' })
  await settled(admin)
  await shot(admin, 'admin-reviews')

  await admin.goto(`${BASE}/admin/reports`, { waitUntil: 'networkidle' })
  await settled(admin)
  await shot(admin, 'admin-reports', true)

  await admin.goto(`${BASE}/admin/pricing`, { waitUntil: 'networkidle' })
  await settled(admin)
  await shot(admin, 'admin-pricing')

  await admin.goto(`${BASE}/admin/drivers`, { waitUntil: 'networkidle' })
  await settled(admin)
  await shot(admin, 'admin-drivers')

  await admin.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
  await settled(admin)
  await shot(admin, 'admin-dashboard-after')

  await cctx.close()
  await actx.close()
  await dctx.close()

  console.log(`\n✅ Demo complete — ${step} screenshots in ${OUT}`)
  console.log(`   Booking ${bookingRef} went requested → completed → reviewed.`)
} finally {
  await browser.close()
}
