/**
 * NearMe Cab website.
 *
 * Vanilla on purpose: one page, no build step, and a file you can open and
 * read. It talks to the same API the app does, through /api/public/* — which
 * is why a booking made here lands in the same database and reaches the same
 * admin console and the same drivers.
 *
 * Nothing here decides a price. The server quotes, the server recomputes at
 * booking time, and this file only renders what it is told.
 */

const API = window.NEARME_API_BASE || '' // same-origin by default; set for a split host

const $ = (id) => document.getElementById(id)

const state = {
  tripType: 'one_way',
  routes: [],
  options: [],
  selected: null,
  routeId: null,
  company: null,
}

/* ---------------------------------------------------------------- api --- */

async function api(path, options = {}) {
  const response = await fetch(`${API}/api/public${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    // The API returns a human-readable detail; prefer it over a status code.
    throw new Error(body?.detail || 'Something went wrong. Please try again.')
  }
  return body
}

/* ------------------------------------------------------------ company --- */

async function loadCompany() {
  try {
    const data = await api('/company')
    state.company = data
    const c = data.company || {}

    const tel = `tel:${c.support_phone || ''}`
    ;['headerCall', 'callFab'].forEach((id) => { if ($(id)) $(id).href = tel })
    if ($('footPhone')) { $('footPhone').href = tel; $('footPhone').textContent = c.support_phone || '—' }
    if ($('footEmail')) { $('footEmail').href = `mailto:${c.support_email || ''}`; $('footEmail').textContent = c.support_email || '—' }
    if ($('footAddress')) $('footAddress').textContent = c.address || ''
    if ($('footHours')) $('footHours').textContent = c.working_hours ? `Open ${c.working_hours}` : ''
    if ($('footLegalName')) $('footLegalName').textContent = c.legal_name || 'NearMe Cab'

    // The cancellation promise has to match what the engine actually charges,
    // so it is read from settings rather than written into the page.
    const rules = data.cancellation
    if (rules && $('cancelCopy')) {
      $('cancelCopy').textContent =
        `Cancel more than ${rules.customer_free_hours} hours before pickup and you pay nothing.`
    }

    renderPaymentOptions(data)
    renderCancellation(data)
    renderFaq(data)
    if ($('trustHours') && c.working_hours) $('trustHours').textContent = `Booking support (${c.working_hours})`

    // Policy pages are served by the API, so they live wherever it does.
    const base = API || ''
    if ($('linkPrivacy')) $('linkPrivacy').href = `${base}/privacy`
    if ($('linkTerms')) $('linkTerms').href = `${base}/terms`
    if ($('linkDriver')) $('linkDriver').href = `${base}/driver-terms`
  } catch {
    /* The page is still usable without company details. */
  }
}

/* ------------------------------------------------- information sections --- */

/**
 * The money rules are rendered from the API, not written into the page.
 *
 * A site that promises free cancellation for two hours while the engine
 * charges after one is worse than a site that says nothing, and the two drift
 * the moment somebody changes a setting. Everything factual below comes from
 * the same settings the booking code reads.
 */
function renderPaymentOptions(data) {
  const host = $('payList')
  if (!host) return
  const options = data.payment_options || {}
  const percent = Math.round(Number(data.advance?.percent) || 0)
  const recommended = options.recommended || 'part'

  const rows = [
    options.allow_pay_later !== false && {
      id: 'pay_later',
      title: 'Book now, pay later',
      body: 'Nothing up front. Settle the whole fare with the driver at the end of the trip.',
    },
    options.allow_part_payment !== false && {
      id: 'part',
      title: `Part payment — ${percent}% now`,
      body: `Pay ${percent}% to hold the car, the rest at the drop. Paid by card, UPI, netbanking or wallet.`,
    },
    options.allow_full_payment !== false && {
      id: 'full',
      title: 'Pay in full',
      body: 'Settle the whole fare up front so there is nothing left to pay at the end.',
    },
  ].filter(Boolean)

  host.innerHTML = ''
  rows.forEach((row, index) => {
    const el = document.createElement('div')
    el.className = 'pay-row'
    el.innerHTML =
      `<span class="num">${index + 1}</span>` +
      `<span><h3>${escapeHtml(row.title)}` +
      (row.id === recommended ? '<span class="badge-rec">Most popular</span>' : '') +
      `</h3><p>${escapeHtml(row.body)}</p></span>`
    host.appendChild(el)
  })

  if ($('payIntro')) {
    $('payIntro').textContent =
      'Choose when you pay. Booking on this page settles with the driver; the options below are available in the app.'
  }
}

function renderCancellation(data) {
  const rules = data.cancellation
  if (!rules) return
  const hours = rules.customer_free_hours
  const percent = Math.round(Number(rules.customer_fee_percent) || 0)
  const hourWord = hours === 1 ? 'hour' : 'hours'

  const free = $('cancelFree')
  if (free) {
    free.innerHTML = [
      `Cancel more than ${hours} ${hourWord} before pickup and you pay nothing.`,
      'Anything you have already paid comes back in full.',
      'Refunds reach the account you paid from, usually in 5–7 working days.',
    ].map((line) => `<li><span class="mark" aria-hidden="true">✓</span><span>${escapeHtml(line)}</span></li>`).join('')
  }

  const late = $('cancelLate')
  if (late) {
    late.innerHTML = [
      `Cancel within ${hours} ${hourWord} of pickup and we keep ${percent}% of what you have paid.`,
      'The rest is refunded automatically — you do not have to ask.',
      'Once the trip has started it cannot be cancelled here. Call us instead.',
    ].map((line) => `<li><span class="mark" aria-hidden="true">+</span><span>${escapeHtml(line)}</span></li>`).join('')
  }
}

async function loadFleet() {
  const host = $('fleetList')
  if (!host) return
  try {
    const classes = await api('/vehicle-classes')
    host.innerHTML = ''
    ;(classes || []).forEach((item) => {
      const el = document.createElement('div')
      el.className = 'vehicle'
      el.innerHTML =
        `<div class="vehicle-top"><h3>${escapeHtml(item.label)}</h3>` +
        `<span class="seats">${item.seating_capacity} seats</span></div>` +
        `<p>${escapeHtml(item.description || '')}</p>`
      host.appendChild(el)
    })
  } catch {
    host.innerHTML = '<p class="hint">Call us and we will tell you what is available.</p>'
  }
}

function renderFaq(data) {
  const host = $('faqList')
  if (!host) return
  const c = data.company || {}
  const rules = data.cancellation || {}
  const percent = Math.round(Number(data.advance?.percent) || 0)
  const hours = rules.customer_free_hours
  const hourWord = hours === 1 ? 'hour' : 'hours'

  const items = [
    ['Do I need an account to book?',
     'No. Give us a name and a mobile number and we will call you back to confirm. An account is only needed if you want to pay online or track trips in the app.'],
    ['When do I pay, and how?',
     `Booking on this page, you settle the full fare with the driver. In the app you can also pay ${percent}% up front to hold the car, or pay in full — by card, UPI, netbanking or wallet.`],
    ['Are tolls and parking included?',
     'Usually not. Road tolls, parking, state permits and airport entry are charged at actuals on top of the fare. Every car you are offered carries a tag saying which applies to that trip.'],
    ['What if I need to cancel?',
     `Cancel more than ${hours} ${hourWord} before pickup and you pay nothing. Inside that window we keep ${Math.round(Number(rules.customer_fee_percent) || 0)}% of what you have paid and refund the rest automatically.`],
    ['How do I know who is driving?',
     'Once a driver is assigned you get their name, number and vehicle. For your privacy the driver only sees your number shortly before pickup.'],
    ['Can I book for someone else?',
     'Yes. Put their name and number in the passenger details and we will coordinate with them directly.'],
    ['Do you drive between states?',
     'Yes. State permit fees apply on the route and are charged at actuals — we tell you the amount before you travel.'],
    ['What if my flight is delayed?',
     `Call us on ${c.support_phone || 'our number'} and we will move the pickup. We track the booking, not the clock.`],
    ['Is there a cancellation charge for the driver too?',
     'Yes. Drivers are charged when they drop a trip they accepted, rising the closer it is to pickup. It is why cancellations by our side are rare.'],
  ]

  host.innerHTML = items.map(([q, a]) => (
    `<details><summary>${escapeHtml(q)}</summary><div class="answer">${escapeHtml(a)}</div></details>`
  )).join('')
}

/* ------------------------------------------------------------- routes --- */

async function loadRoutes() {
  const host = $('routeList')
  try {
    // Fetch the catalogue, show a handful. The trust figure must be the real
    // total, not the page size — a count that is really "how many we rendered"
    // is a number that quietly lies.
    const data = await api('/routes?limit=200')
    state.routes = data.items || []
    if ($('trustRoutes')) $('trustRoutes').textContent = String(state.routes.length)
    const featured = state.routes.slice(0, 9)
    if (!state.routes.length) {
      host.innerHTML = '<p class="hint">Call us and we will quote any route.</p>'
      return
    }
    host.innerHTML = ''
    featured.forEach((route) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'route-card'
      button.innerHTML =
        `<span><span class="r-name">${escapeHtml(route.name)}</span><br>` +
        `<span class="r-meta">${route.distance_km ? Math.round(route.distance_km) + ' km' : ''}</span></span>` +
        `<span aria-hidden="true">→</span>`
      button.addEventListener('click', () => {
        $('pickup').value = route.origin
        $('drop').value = route.destination
        state.routeId = route.id
        $('book').scrollIntoView({ behavior: 'smooth', block: 'start' })
        $('pickup').focus({ preventScroll: true })
      })
      host.appendChild(button)
    })
  } catch {
    host.innerHTML = '<p class="hint">Could not load routes just now.</p>'
  }
}

/* ----------------------------------------------------- autocomplete ----- */

function attachSuggestions(input) {
  let box = null
  let timer = null

  const close = () => { if (box) { box.remove(); box = null } }

  input.addEventListener('input', () => {
    // Typing invalidates any route we had matched from a popular-route tap.
    state.routeId = null
    clearTimeout(timer)
    const query = input.value.trim()
    if (query.length < 2) return close()
    timer = setTimeout(async () => {
      try {
        const results = await api(`/places?q=${encodeURIComponent(query)}`)
        close()
        if (!results?.length) return
        box = document.createElement('ul')
        box.className = 'suggestions'
        results.slice(0, 6).forEach((place) => {
          const li = document.createElement('li')
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = place.description
          button.addEventListener('click', () => { input.value = place.description; close() })
          li.appendChild(button)
          box.appendChild(li)
        })
        input.parentElement.appendChild(box)
      } catch { close() }
    }, 250)
  })

  // Delay so a click on a suggestion lands before the list disappears.
  input.addEventListener('blur', () => setTimeout(close, 180))
}

/* -------------------------------------------------------------- quote --- */

async function getQuote() {
  const pickup = $('pickup').value.trim()
  const drop = $('drop').value.trim()
  const area = $('quoteArea')
  message('')

  if (pickup.length < 2 || drop.length < 2) {
    area.innerHTML = '<div class="notice notice-error">Tell us where you are going from and to.</div>'
    return
  }
  if (!$('date').value) {
    area.innerHTML = '<div class="notice notice-error">Pick a travel date.</div>'
    return
  }

  area.innerHTML = '<p class="hint">Working out your fare…</p>'
  $('detailsArea').hidden = true
  state.selected = null

  try {
    const payload = {
      trip_type: state.tripType,
      scheduled_at: scheduledAt(),
    }
    if (state.routeId) payload.route_id = state.routeId
    else { payload.pickup = pickup; payload.drop = drop }

    const data = await api('/quote', { method: 'POST', body: JSON.stringify(payload) })
    state.options = data.options || []
    if (data.route?.id) state.routeId = data.route.id
    renderFares()
  } catch (error) {
    // A route we have not priced is the common case here, so say what happens
    // next rather than showing a bare failure.
    area.innerHTML =
      `<div class="notice notice-warn"><strong>We have not priced this route yet.</strong><br>` +
      `Call us on ${escapeHtml(state.company?.company?.support_phone || 'our number')} ` +
      `and we will quote it for you.</div>`
  }
}

function renderFares() {
  const area = $('quoteArea')
  if (!state.options.length) {
    area.innerHTML = '<div class="notice notice-warn">No vehicles priced for this route yet.</div>'
    return
  }

  area.innerHTML = '<div class="fares" id="fareList"></div>'
  const list = $('fareList')

  state.options.forEach((option) => {
    const tollIncluded = Number(option.breakdown?.toll) > 0
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'fare'
    button.setAttribute('aria-pressed', 'false')
    button.innerHTML =
      `<span><span class="name">${escapeHtml(option.label || option.vehicle_type)}</span><br>` +
      `<span class="meta">${option.seating_capacity || ''} seats</span><br>` +
      `<span class="chip">${tollIncluded ? 'Toll included' : 'Toll + parking extra'}</span></span>` +
      `<span class="price">${money(option.fare)}</span>`
    button.addEventListener('click', () => {
      state.selected = option
      list.querySelectorAll('.fare').forEach((el) => el.setAttribute('aria-pressed', 'false'))
      button.setAttribute('aria-pressed', 'true')
      $('detailsArea').hidden = false
      $('name').focus({ preventScroll: true })
    })
    list.appendChild(button)
  })

  const note = document.createElement('p')
  note.className = 'hint'
  note.textContent = 'Choose a vehicle to continue. Fares are confirmed by our team.'
  area.appendChild(note)
}

/* ------------------------------------------------------------- submit --- */

async function submitBooking(event) {
  event.preventDefault()
  if (!state.selected) {
    message('Choose a vehicle first.', 'error')
    return
  }

  const phone = $('phone').value.replace(/\D/g, '').slice(-10)
  if (!/^[6-9]\d{9}$/.test(phone)) {
    message('Enter a valid 10-digit mobile number.', 'error')
    return
  }
  if ($('name').value.trim().length < 2) {
    message('Tell us your name.', 'error')
    return
  }

  const button = $('submitBtn')
  button.disabled = true
  button.textContent = 'Requesting…'

  try {
    const payload = {
      name: $('name').value.trim(),
      phone,
      pickup: $('pickup').value.trim(),
      drop: $('drop').value.trim(),
      trip_type: state.tripType,
      vehicle_type: state.selected.vehicle_type,
      scheduled_at: scheduledAt(),
      passenger_count: Number($('passengers').value) || 1,
    }
    if (state.routeId) payload.route_id = state.routeId
    if ($('email').value.trim()) payload.email = $('email').value.trim()
    if ($('notes').value.trim()) payload.notes = $('notes').value.trim()

    const booking = await api('/bookings', { method: 'POST', body: JSON.stringify(payload) })

    $('bookingForm').hidden = true
    message(
      `<strong>Booked — reference ${escapeHtml(booking.booking_id)}.</strong><br>` +
      `${escapeHtml(booking.message)} Keep this reference to check your trip.`,
      'ok',
    )
  } catch (error) {
    message(error.message, 'error')
  } finally {
    button.disabled = false
    button.textContent = 'Request this cab'
  }
}

/* -------------------------------------------------------------- track --- */

async function trackBooking() {
  const reference = $('trackRef').value.trim()
  const phone = $('trackPhone').value.replace(/\D/g, '').slice(-10)
  const out = $('trackResult')

  if (!reference || phone.length !== 10) {
    out.innerHTML = '<div class="notice notice-error">Enter both the reference and the number you booked with.</div>'
    return
  }

  out.innerHTML = '<p class="hint">Checking…</p>'
  try {
    const data = await api(`/bookings/${encodeURIComponent(reference)}?phone=${phone}`)
    out.innerHTML =
      `<div class="notice notice-ok"><strong>${escapeHtml(data.booking_id)}</strong> — ` +
      `${escapeHtml(String(data.status).replace(/_/g, ' '))}<br>` +
      `${escapeHtml(data.pickup || '')} → ${escapeHtml(data.drop || '')}<br>` +
      `${money(data.total_fare)}</div>`
  } catch {
    out.innerHTML = '<div class="notice notice-error">No booking found with that reference and number.</div>'
  }
}

/* -------------------------------------------------------------- utils --- */

function scheduledAt() {
  // The input is local wall-clock; the API wants an instant.
  return new Date(`${$('date').value}T${$('time').value || '09:00'}`).toISOString()
}

function money(value) {
  const number = Number(value || 0)
  return '₹' + number.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function message(html, tone) {
  const host = $('formMessage')
  host.innerHTML = html ? `<div class="notice notice-${tone || 'warn'}">${html}</div>` : ''
}

/** Everything interpolated into innerHTML goes through this. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ))
}

/* ---------------------------------------------------------------- init -- */

function init() {
  // Tomorrow by default: today often fails the minimum lead time.
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  $('date').value = tomorrow.toISOString().slice(0, 10)
  $('date').min = new Date().toISOString().slice(0, 10)

  document.querySelectorAll('.pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-pressed', 'false'))
      pill.setAttribute('aria-pressed', 'true')
      state.tripType = pill.dataset.trip
    })
  })

  attachSuggestions($('pickup'))
  attachSuggestions($('drop'))

  $('quoteBtn').addEventListener('click', getQuote)
  $('bookingForm').addEventListener('submit', submitBooking)
  $('trackBtn').addEventListener('click', trackBooking)

  loadCompany()
  loadRoutes()
  loadFleet()
}

document.addEventListener('DOMContentLoaded', init)
