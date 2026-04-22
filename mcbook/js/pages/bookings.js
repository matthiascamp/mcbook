import { supabase } from '../supabase.js'
import { getSession } from '../auth.js'
import { setTopbarDate, loadSidebarUser, esc } from '../ui.js'

const CHARGE_NOSHOW_URL = 'https://uijudgnqawtvjyjuyuwo.supabase.co/functions/v1/charge-noshow'
const PAGE_SIZE = 10
let currentPage = 1
let cancelledPage = 1
let statusFilter = ''
let dateFilter = ''
let clientId = ''
let _openReschedule = null // set in DOMContentLoaded, used by viewBooking modal button

// ── Helpers ──────────────────────────────────────────────────────────────────
function contactHtml(phone, email) {
  if (!phone && !email) return ''
  let html = '<div class="contact-actions" style="display:inline-flex;margin-left:6px;">'
  if (phone) {
    const p = esc(phone)
    html += `<a class="contact-btn" href="tel:${p}" title="Call ${p}">&#128222;</a>`
    html += `<a class="contact-btn" href="sms:${p}" title="Text ${p}">&#128172;</a>`
  }
  if (email) {
    html += `<a class="contact-btn" href="mailto:${esc(email)}" title="Email ${esc(email)}">&#9993;</a>`
  }
  return html + '</div>'
}
function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function todayISO() { return localISO(new Date()) }
function weekStartISO() {
  const d = new Date(); const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  return localISO(d)
}
function monthStartISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function initials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
function fmtDate(iso) {
  return new Date(iso + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1) }
// DB returns HH:MM:SS but our selects use HH:MM
function timeHHMM(t) { return (t || '').slice(0, 5) }

// ── Dynamic time-slot generation based on business settings ──────────────────
async function loadTimeSlots(clientIdVal, dateISO, selectEl) {
  if (!selectEl || !dateISO) return
  selectEl.innerHTML = '<option value="">Loading…</option>'

  const dow = new Date(dateISO + 'T00:00:00').getDay() // 0=Sun … 6=Sat

  const [{ data: settings }, { data: rules }, { data: overrides }] = await Promise.all([
    supabase.from('booking_settings').select('slot_duration_mins').eq('client_id', clientIdVal).limit(1).maybeSingle(),
    supabase.from('availability_rules').select('start_time, end_time, enabled').eq('client_id', clientIdVal).eq('day_of_week', dow).limit(1).maybeSingle(),
    supabase.from('availability_overrides').select('is_available, start_time, end_time').eq('client_id', clientIdVal).eq('date', dateISO).limit(1).maybeSingle()
  ])

  const duration = settings?.slot_duration_mins || 30

  // Determine open hours: override takes precedence, then rule, then closed
  let startTime = null, endTime = null
  if (overrides) {
    if (!overrides.is_available) { selectEl.innerHTML = '<option value="">Closed on this date</option>'; return }
    startTime = overrides.start_time
    endTime = overrides.end_time
  } else if (rules) {
    if (!rules.enabled) { selectEl.innerHTML = '<option value="">Closed on this day</option>'; return }
    startTime = rules.start_time
    endTime = rules.end_time
  }

  // Parse HH:MM or HH:MM:SS into total minutes
  function toMins(t) {
    if (!t) return null
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }

  const openMins = toMins(startTime) ?? 0
  const closeMins = toMins(endTime) ?? 1440

  selectEl.innerHTML = ''
  let count = 0
  for (let m = openMins; m < closeMins; m += duration) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    const val = `${hh}:${mm}`
    const opt = document.createElement('option')
    opt.value = val
    opt.textContent = fmtTime(val)
    selectEl.appendChild(opt)
    count++
  }

  if (count === 0) selectEl.innerHTML = '<option value="">No slots available</option>'
}

// Check if a proposed date+time conflicts with an existing booking
async function checkConflict(clientIdVal, date, time, excludeBookingId) {
  let q = supabase.from('bookings')
    .select('id, time, customers(name), services(name)')
    .eq('client_id', clientIdVal)
    .eq('date', date)
    .eq('time', time)
    .in('status', ['scheduled', 'confirmed', 'pending_payment'])
    .limit(1)

  if (excludeBookingId) q = q.neq('id', excludeBookingId)

  const { data } = await q
  if (data && data.length > 0) {
    const existing = data[0]
    return `There's already a booking at ${fmtTime(time)} on ${fmtDate(date)} (${existing.customers?.name ?? 'Unknown'} — ${existing.services?.name ?? 'Service'}). Choose a different time.`
  }
  return null
}

// ── Load & render ─────────────────────────────────────────────────────────────
async function loadBookings() {
  const today = todayISO()
  let q = supabase.from('bookings')
    .select('id, date, time, status, party_size, customers(name, email, phone), services(name, payment_mode, noshow_fee)', { count: 'exact' })
    .eq('client_id', clientId)
    .neq('status', 'cancelled')
    .order('date', { ascending: false })
    .order('time', { ascending: false })

  if (statusFilter) q = q.eq('status', statusFilter)
  if (dateFilter === 'Today') q = q.eq('date', today)
  else if (dateFilter === 'This Week') q = q.gte('date', weekStartISO())
  else if (dateFilter === 'This Month') q = q.gte('date', monthStartISO())

  const from = (currentPage - 1) * PAGE_SIZE
  const { data, count, error } = await q.range(from, from + PAGE_SIZE - 1)
  if (error) { console.error(error); return }

  const tbody = document.querySelector('.data-table tbody')
  tbody.innerHTML = ''
  for (const b of data ?? []) {
    const name = b.customers?.name ?? ''
    const isScheduled = b.status === 'scheduled' || b.status === 'confirmed' || b.status === 'pending_payment'
    const isChargeable = b.services?.payment_mode === 'noshow_only' || b.services?.payment_mode === 'after' || Number(b.services?.noshow_fee) > 0
    const statusLabel = b.status === 'pending_payment' ? 'Scheduled' : capitalize(b.status.replace('_', ' '))
    const statusCls   = b.status === 'pending_payment' ? 'scheduled' : b.status
    const hasCardOnFile = b.services?.payment_mode !== 'free' || Number(b.services?.noshow_fee) > 0
    const payTag = hasCardOnFile
      ? '<div class="pay-tag">Card on file</div>'
      : b.services?.payment_mode === 'free'
        ? '<div class="pay-tag">Pay externally</div>'
        : ''
    const tr = document.createElement('tr')
    tr.dataset.bookingId = b.id
    tr.innerHTML = `
      <td>
        <div class="customer-cell">
          <div class="cust-avatar">${esc(initials(name))}</div>
          <div>
            <div class="cust-name">${esc(name)}</div>
            <div class="cust-email">${esc(b.customers?.email ?? '')}</div>
          </div>
        </div>
      </td>
      <td>${esc(b.services?.name ?? '')}${payTag}${Number(b.party_size) > 1 ? `<div class="pay-tag">Party of ${Number(b.party_size)}</div>` : ''}</td>
      <td>${fmtDate(b.date)}</td>
      <td>${fmtTime(b.time)}</td>
      <td><span class="status-pill ${statusCls}">${statusLabel}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn-reschedule" data-date="${esc(b.date)}" data-time="${esc(timeHHMM(b.time))}" data-cust-name="${esc(name)}" ${isScheduled ? '' : 'disabled'}>Reschedule</button>
          ${isChargeable ? `<button class="btn-noshow" ${isScheduled ? '' : 'disabled'}>No-show + Charge</button>` : ''}
          ${isChargeable ? `<button class="btn-waive" ${isScheduled ? '' : 'disabled'}>Waive No-show</button>` : ''}
          <button class="btn-cancel" ${isScheduled ? '' : 'disabled'}>Cancel</button>
          <button class="btn-view">View</button>
          ${contactHtml(b.customers?.phone, b.customers?.email)}
        </div>
      </td>
    `
    tbody.appendChild(tr)
  }

  const total = count ?? 0
  const rangeEnd = Math.min(from + PAGE_SIZE, total)
  document.querySelector('.table-count').textContent =
    `Showing ${total > 0 ? from + 1 : 0}–${rangeEnd} of ${total} results`

  renderPagination(total)
}

function renderPagination(total) {
  const pageCount = Math.ceil(total / PAGE_SIZE)
  const from = (currentPage - 1) * PAGE_SIZE
  const rangeEnd = Math.min(from + PAGE_SIZE, total)

  const paginationSpan = document.querySelector('.pagination > span')
  if (paginationSpan)
    paginationSpan.textContent = `Showing ${total > 0 ? from + 1 : 0}–${rangeEnd} of ${total} bookings`

  const btnContainer = document.querySelector('.page-btns')
  if (!btnContainer) return
  btnContainer.innerHTML = ''

  const prev = document.createElement('button')
  prev.className = 'page-btn'
  prev.innerHTML = '&#8249;'
  prev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadBookings() } })
  btnContainer.appendChild(prev)

  const maxShown = Math.min(pageCount, 7)
  for (let i = 1; i <= maxShown; i++) {
    const btn = document.createElement('button')
    btn.className = 'page-btn' + (i === currentPage ? ' current' : '')
    btn.textContent = i
    btn.addEventListener('click', () => { currentPage = i; loadBookings() })
    btnContainer.appendChild(btn)
  }

  const next = document.createElement('button')
  next.className = 'page-btn'
  next.innerHTML = '&#8250;'
  next.addEventListener('click', () => { if (currentPage < pageCount) { currentPage++; loadBookings() } })
  btnContainer.appendChild(next)
}

async function loadCancelled() {
  const from = (cancelledPage - 1) * PAGE_SIZE
  const { data, count, error } = await supabase.from('bookings')
    .select('id, date, time, customers(name, email), services(name)', { count: 'exact' })
    .eq('client_id', clientId)
    .eq('status', 'cancelled')
    .order('date', { ascending: false })
    .order('time', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  if (error) { console.error(error); return }

  const tbody = document.getElementById('cancelled-tbody')
  tbody.innerHTML = ''
  for (const b of data ?? []) {
    const name = b.customers?.name ?? ''
    const tr = document.createElement('tr')
    tr.style.opacity = '0.6'
    tr.dataset.bookingId = b.id
    tr.innerHTML = `
      <td>
        <div class="customer-cell">
          <div class="cust-avatar">${esc(initials(name))}</div>
          <div>
            <div class="cust-name">${esc(name)}</div>
            <div class="cust-email">${esc(b.customers?.email ?? '')}</div>
          </div>
        </div>
      </td>
      <td>${esc(b.services?.name ?? '')}</td>
      <td>${fmtDate(b.date)}</td>
      <td>${fmtTime(b.time)}</td>
      <td><div class="row-actions"><button class="btn-view">View</button></div></td>
    `
    tbody.appendChild(tr)
  }

  const total = count ?? 0
  document.getElementById('cancelled-count').textContent = `${total} cancelled`

  const pageCount = Math.ceil(total / PAGE_SIZE)
  const btnContainer = document.getElementById('cancelled-page-btns')
  btnContainer.innerHTML = ''
  if (pageCount > 1) {
    const prev = document.createElement('button')
    prev.className = 'page-btn'; prev.innerHTML = '&#8249;'
    prev.addEventListener('click', () => { if (cancelledPage > 1) { cancelledPage--; loadCancelled() } })
    btnContainer.appendChild(prev)
    for (let i = 1; i <= Math.min(pageCount, 7); i++) {
      const btn = document.createElement('button')
      btn.className = 'page-btn' + (i === cancelledPage ? ' current' : '')
      btn.textContent = i
      btn.addEventListener('click', () => { cancelledPage = i; loadCancelled() })
      btnContainer.appendChild(btn)
    }
    const next = document.createElement('button')
    next.className = 'page-btn'; next.innerHTML = '&#8250;'
    next.addEventListener('click', () => { if (cancelledPage < pageCount) { cancelledPage++; loadCancelled() } })
    btnContainer.appendChild(next)
  }
}

async function cancelBooking(bookingId, buttonEl) {
  if (!confirm('Cancel this booking? This cannot be undone.')) return
  buttonEl.disabled    = true
  buttonEl.textContent = 'Cancelling\u2026'

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)

  if (error) {
    buttonEl.disabled    = false
    buttonEl.textContent = 'Cancel'
    alert('Failed to cancel booking: ' + error.message)
    return
  }

  const tr   = buttonEl.closest('tr')
  const pill = tr?.querySelector('.status-pill')
  if (pill) { pill.className = 'status-pill cancelled'; pill.textContent = 'Cancelled' }
  buttonEl.textContent = 'Cancelled'
  tr?.querySelectorAll('.btn-noshow, .btn-waive, .btn-reschedule').forEach(b => b.setAttribute('disabled', ''))
}

async function waiveBooking(bookingId, buttonEl) {
  if (!confirm('Mark as no-show without charging a fee?')) return
  buttonEl.disabled    = true
  buttonEl.textContent = 'Waiving\u2026'

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'no_show' })
    .eq('id', bookingId)

  if (error) {
    buttonEl.disabled    = false
    buttonEl.textContent = 'Waive No-show'
    alert('Failed: ' + error.message)
    return
  }

  const tr   = buttonEl.closest('tr')
  const pill = tr?.querySelector('.status-pill')
  if (pill) { pill.className = 'status-pill noshow'; pill.textContent = 'No-show' }
  buttonEl.textContent = 'Waived'
  tr?.querySelectorAll('.btn-noshow, .btn-cancel, .btn-waive, .btn-reschedule').forEach(b => b.setAttribute('disabled', ''))
}

async function markNoshow(bookingId, buttonEl) {
  buttonEl.disabled    = true
  buttonEl.textContent = 'Charging\u2026'

  try {
    const session = await getSession()
    if (!session) {
      buttonEl.disabled    = false
      buttonEl.textContent = 'No-show + Charge'
      alert('Session expired — please refresh the page and try again.')
      return
    }
    const res  = await fetch(CHARGE_NOSHOW_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ bookingId }),
    })
    const json = await res.json()

    if (json.success) {
      const tr   = buttonEl.closest('tr')
      const pill = tr?.querySelector('.status-pill')
      if (pill) { pill.className = 'status-pill noshow'; pill.textContent = 'No-show' }
      buttonEl.disabled    = true
      buttonEl.textContent = 'Charged'
      tr?.querySelectorAll('.btn-waive, .btn-cancel, .btn-reschedule').forEach(b => b.setAttribute('disabled', ''))
    } else {
      buttonEl.disabled    = false
      buttonEl.textContent = 'No-show + Charge'
      alert('Charge failed: ' + (json.error || 'Unknown error'))
    }
  } catch (err) {
    buttonEl.disabled    = false
    buttonEl.textContent = 'No-show + Charge'
    alert('Network error — please check your connection and try again.')
  }
}

function openModal(html) {
  document.getElementById('modal-body').innerHTML = html
  document.getElementById('booking-modal').classList.add('open')
}

function closeModal() {
  document.getElementById('booking-modal').classList.remove('open')
}

async function viewBooking(bookingId) {
  openModal('<div class="modal-loading">Loading\u2026</div>')

  const { data: b, error } = await supabase
    .from('bookings')
    .select('id, date, time, status, payment_status, customers(name, email, phone), services(name, duration_mins, price, noshow_fee, payment_mode)')
    .eq('id', bookingId)
    .single()

  if (error || !b) {
    openModal('<div class="modal-loading">Could not load booking details.</div>')
    return
  }

  const customer = b.customers ?? {}
  const service  = b.services  ?? {}
  const ref      = 'BK-' + b.id.slice(0, 6).toUpperCase()

  const payModeLabel = {
    free:        'Pay externally (no card)',
    noshow_only: 'Card on file — no-show fee only',
    after:       'Card on file — charged after appointment',
    upfront:     'Paid upfront',
  }[service.payment_mode] ?? service.payment_mode ?? '—'

  const payStatusLabel = b.payment_status
    ? b.payment_status.charAt(0).toUpperCase() + b.payment_status.slice(1)
    : '—'

  const duration = service.duration_mins
    ? (service.duration_mins < 60 ? `${service.duration_mins} min` : `${service.duration_mins / 60} hr`)
    : '—'

  const statusLabel = b.status === 'pending_payment' ? 'Scheduled' : capitalize(b.status.replace('_', ' '))
  const statusCls   = b.status === 'pending_payment' ? 'scheduled' : b.status

  document.getElementById('modal-title').textContent = `Booking \u2014 ${customer.name || 'Unknown'}`

  openModal(`
    <div class="modal-section">
      <div class="modal-section-title">Customer</div>
      <div class="modal-row"><span class="modal-label">Name</span><span class="modal-val">${esc(customer.name || '—')}</span></div>
      <div class="modal-row"><span class="modal-label">Email</span><span class="modal-val">${esc(customer.email || '—')}</span></div>
      <div class="modal-row"><span class="modal-label">Phone</span><span class="modal-val">${esc(customer.phone || '—')}</span></div>
      <div class="modal-row" style="padding-top:8px;">
        <span class="modal-label">Contact</span>
        <span class="modal-val">${contactHtml(customer.phone, customer.email)}</span>
      </div>
    </div>
    <div class="modal-section">
      <div class="modal-section-title">Appointment</div>
      <div class="modal-row"><span class="modal-label">Service</span><span class="modal-val">${esc(service.name || '—')}</span></div>
      <div class="modal-row"><span class="modal-label">Date</span><span class="modal-val">${fmtDate(b.date)}</span></div>
      <div class="modal-row"><span class="modal-label">Time</span><span class="modal-val">${fmtTime(b.time)}</span></div>
      <div class="modal-row"><span class="modal-label">Duration</span><span class="modal-val">${duration}</span></div>
      <div class="modal-row"><span class="modal-label">Status</span><span class="modal-val"><span class="status-pill ${statusCls}">${statusLabel}</span></span></div>
    </div>
    <div class="modal-section">
      <div class="modal-section-title">Payment</div>
      <div class="modal-row"><span class="modal-label">Mode</span><span class="modal-val">${esc(payModeLabel)}</span></div>
      ${service.price ? `<div class="modal-row"><span class="modal-label">Price</span><span class="modal-val">$${service.price}</span></div>` : ''}
      ${Number(service.noshow_fee) > 0 ? `<div class="modal-row"><span class="modal-label">No-show fee</span><span class="modal-val">$${service.noshow_fee}</span></div>` : ''}
      <div class="modal-row"><span class="modal-label">Payment status</span><span class="modal-val">${payStatusLabel}</span></div>
    </div>
    ${(b.status === 'scheduled' || b.status === 'confirmed' || b.status === 'pending_payment') ? `
    <div style="display:flex;justify-content:center;gap:10px;padding-top:8px;">
      <button class="btn-reschedule" style="padding:8px 20px;font-size:0.82rem;border-radius:50px;" id="modal-reschedule-btn"
        data-booking-id="${esc(b.id)}" data-date="${esc(b.date)}" data-time="${esc(timeHHMM(b.time))}" data-cust-name="${esc(customer.name || '')}">
        Reschedule This Booking
      </button>
    </div>` : ''}
    <div style="text-align:center;padding-top:4px;">
      <span class="modal-ref">${ref}</span>
    </div>
  `)

  // Wire the modal reschedule button
  document.getElementById('modal-reschedule-btn')?.addEventListener('click', () => {
    if (_openReschedule) _openReschedule(b.id, customer.name || 'Customer', b.date, timeHHMM(b.time))
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession()
  if (!session) return
  clientId = session.user.id
  setTopbarDate()
  loadSidebarUser(clientId)

  await loadBookings()

  const filterInput = document.querySelector('.filter-input')
  const filterSelects = document.querySelectorAll('.filter-select')
  const statusSelect = filterSelects[0]
  const dateSelect = filterSelects[1]

  // Client-side text search (debounced)
  let debounce
  filterInput?.addEventListener('input', () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      const q = filterInput.value.toLowerCase()
      document.querySelectorAll('.data-table tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'
      })
    }, 300)
  })

  // Status filter
  const STATUS_MAP = { 'Scheduled': 'scheduled', 'Completed': 'completed', 'No-show': 'no_show' }
  statusSelect?.addEventListener('change', () => {
    statusFilter = STATUS_MAP[statusSelect.value] ?? ''
    currentPage = 1; loadBookings()
  })

  // Date filter
  dateSelect?.addEventListener('change', () => {
    const v = dateSelect.value
    dateFilter = v === 'All Time' ? '' : v
    currentPage = 1; loadBookings()
  })

  // Delegated click handler — active bookings table
  document.querySelector('.data-table tbody')?.addEventListener('click', e => {
    const rsBtn = e.target.closest('.btn-reschedule')
    if (rsBtn && !rsBtn.disabled) {
      const tr = rsBtn.closest('tr')
      const id = tr?.dataset.bookingId
      if (id) openReschedule(id, rsBtn.dataset.custName, rsBtn.dataset.date, rsBtn.dataset.time)
      return
    }
    const noShowBtn = e.target.closest('.btn-noshow')
    if (noShowBtn && !noShowBtn.disabled) {
      const id = noShowBtn.closest('tr')?.dataset.bookingId
      if (id) markNoshow(id, noShowBtn)
      return
    }
    const waiveBtn = e.target.closest('.btn-waive')
    if (waiveBtn && !waiveBtn.disabled) {
      const id = waiveBtn.closest('tr')?.dataset.bookingId
      if (id) waiveBooking(id, waiveBtn)
      return
    }
    const cancelBtn = e.target.closest('.btn-cancel')
    if (cancelBtn && !cancelBtn.disabled) {
      const id = cancelBtn.closest('tr')?.dataset.bookingId
      if (id) cancelBooking(id, cancelBtn)
      return
    }
    const viewBtn = e.target.closest('.btn-view')
    if (viewBtn) {
      const id = viewBtn.closest('tr')?.dataset.bookingId
      if (id) viewBooking(id)
    }
  })

  // Delegated click handler — cancelled bookings table
  document.getElementById('cancelled-tbody')?.addEventListener('click', e => {
    const viewBtn = e.target.closest('.btn-view')
    if (viewBtn) {
      const id = viewBtn.closest('tr')?.dataset.bookingId
      if (id) viewBooking(id)
    }
  })

  // Modal close
  document.getElementById('modal-close')?.addEventListener('click', closeModal)
  document.getElementById('booking-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeReschedule(); closeAddBooking() }
  })

  // ── Reschedule modal ─────────────────────────────────────────────────────
  const rsModal = document.getElementById('reschedule-modal')
  const rsDate  = document.getElementById('rs-date')
  const rsTime  = document.getElementById('rs-time')
  const rsSave  = document.getElementById('rs-save')
  const rsInfo  = document.getElementById('reschedule-info')
  const rsCurrent = document.getElementById('reschedule-current')
  let rescheduleBookingId = null

  // Reload time slots when reschedule date changes
  rsDate?.addEventListener('change', async () => {
    if (!rsDate.value) return
    const prevTime = rsTime.value
    await loadTimeSlots(clientId, rsDate.value, rsTime)
    // Try to re-select the previous time if still available
    if (prevTime && [...rsTime.options].some(o => o.value === prevTime)) rsTime.value = prevTime
  })

  async function openReschedule(bookingId, custName, currentDate, currentTime) {
    closeModal() // close detail modal if open
    rescheduleBookingId = bookingId
    const normTime = timeHHMM(currentTime)
    rsInfo.textContent = `Rescheduling booking for ${custName}`
    rsCurrent.textContent = `Currently: ${fmtDate(currentDate)} at ${fmtTime(currentTime)}`
    rsDate.value = currentDate
    rsSave.disabled = false
    rsSave.textContent = 'Save New Time'
    rsModal.classList.add('open')
    // Load valid time slots for this date, then select current time
    await loadTimeSlots(clientId, currentDate, rsTime)
    if ([...rsTime.options].some(o => o.value === normTime)) rsTime.value = normTime
  }

  function closeReschedule() { rsModal?.classList.remove('open'); rescheduleBookingId = null }
  _openReschedule = openReschedule

  document.getElementById('reschedule-close')?.addEventListener('click', closeReschedule)
  document.getElementById('rs-cancel')?.addEventListener('click', closeReschedule)
  rsModal?.addEventListener('click', e => { if (e.target === rsModal) closeReschedule() })

  rsSave?.addEventListener('click', async () => {
    if (!rescheduleBookingId) return
    const newDate = rsDate.value
    const newTime = rsTime.value
    if (!newDate || !newTime) { alert('Please select a new date and time.'); return }

    rsSave.disabled = true
    rsSave.textContent = 'Checking…'

    const conflict = await checkConflict(clientId, newDate, newTime, rescheduleBookingId)
    if (conflict) {
      rsSave.disabled = false
      rsSave.textContent = 'Save New Time'
      alert(conflict)
      return
    }

    rsSave.textContent = 'Saving…'

    const { error } = await supabase.from('bookings')
      .update({ date: newDate, time: newTime })
      .eq('id', rescheduleBookingId)

    if (error) {
      rsSave.disabled = false
      rsSave.textContent = 'Save New Time'
      alert('Failed to reschedule: ' + error.message)
      return
    }

    closeReschedule()
    await loadBookings()
  })

  // ── Add Booking modal (from bookings page) ──────────────────────────────
  const abModal    = document.getElementById('add-booking-modal')
  const abCustomer = document.getElementById('ab-customer')
  const abName     = document.getElementById('ab-name')
  const abEmail    = document.getElementById('ab-email')
  const abPhone    = document.getElementById('ab-phone')
  const abService  = document.getElementById('ab-service')
  const abDate     = document.getElementById('ab-date')
  const abTime     = document.getElementById('ab-time')
  const abSave     = document.getElementById('ab-save')

  // Load time slots for today's date initially, and reload on date change
  if (abDate) abDate.value = todayISO()
  if (abTime && abDate) {
    await loadTimeSlots(clientId, abDate.value, abTime)
    abDate.addEventListener('change', async () => {
      if (!abDate.value) return
      await loadTimeSlots(clientId, abDate.value, abTime)
    })
  }

  async function loadAddBookingData() {
    const [{ data: customers }, { data: services }] = await Promise.all([
      supabase.from('customers').select('id, name, email, phone').eq('client_id', clientId).order('name'),
      supabase.from('services').select('id, name, duration_mins, price').eq('client_id', clientId).eq('active', true).order('name')
    ])
    if (abCustomer) {
      abCustomer.innerHTML = '<option value="">-- Select existing customer --</option><option value="__new__">+ New customer</option>'
      for (const c of customers ?? []) {
        const opt = document.createElement('option')
        opt.value = c.id
        opt.textContent = `${c.name} (${c.email})`
        opt.dataset.name = c.name; opt.dataset.email = c.email; opt.dataset.phone = c.phone || ''
        abCustomer.appendChild(opt)
      }
    }
    if (abService) {
      abService.innerHTML = '<option value="">-- Select service --</option>'
      for (const s of services ?? []) {
        const opt = document.createElement('option')
        opt.value = s.id
        opt.textContent = `${s.name} — ${s.duration_mins} min${s.price > 0 ? ` ($${s.price})` : ''}`
        abService.appendChild(opt)
      }
    }
  }

  abCustomer?.addEventListener('change', () => {
    const opt = abCustomer.selectedOptions[0]
    if (opt && opt.value && opt.value !== '__new__') {
      abName.value = opt.dataset.name || ''; abEmail.value = opt.dataset.email || ''; abPhone.value = opt.dataset.phone || ''
    } else { abName.value = ''; abEmail.value = ''; abPhone.value = '' }
  })

  async function openAddBooking() {
    abCustomer.value = ''; abName.value = ''; abEmail.value = ''; abPhone.value = ''
    abService.value = ''; abDate.value = todayISO()
    abSave.disabled = false; abSave.textContent = 'Create Booking'
    loadAddBookingData()
    abModal.classList.add('open')
    await loadTimeSlots(clientId, abDate.value, abTime)
  }
  function closeAddBooking() { abModal?.classList.remove('open') }

  document.querySelector('.btn-primary')?.addEventListener('click', openAddBooking)
  document.getElementById('add-booking-close')?.addEventListener('click', closeAddBooking)
  document.getElementById('ab-cancel')?.addEventListener('click', closeAddBooking)
  abModal?.addEventListener('click', e => { if (e.target === abModal) closeAddBooking() })

  abSave?.addEventListener('click', async () => {
    const name = abName.value.trim(), email = abEmail.value.trim()
    const serviceId = abService.value, date = abDate.value, time = abTime.value
    if (!name || !email) { alert('Please enter the customer name and email.'); return }
    if (!serviceId) { alert('Please select a service.'); return }
    if (!date || !time) { alert('Please select a date and time.'); return }

    abSave.disabled = true; abSave.textContent = 'Checking…'

    const conflict = await checkConflict(clientId, date, time, null)
    if (conflict) {
      abSave.disabled = false; abSave.textContent = 'Create Booking'
      alert(conflict)
      return
    }

    abSave.textContent = 'Creating…'
    try {
      let customerId = abCustomer.value
      if (!customerId || customerId === '__new__') {
        const { data: existing } = await supabase.from('customers')
          .select('id').eq('client_id', clientId).eq('email', email).maybeSingle()
        if (existing) {
          customerId = existing.id
          await supabase.from('customers').update({ name, phone: abPhone.value.trim() || null }).eq('id', customerId)
        } else {
          const { data: newCust, error: custErr } = await supabase.from('customers')
            .insert({ client_id: clientId, name, email, phone: abPhone.value.trim() || null })
            .select('id').single()
          if (custErr) { alert('Could not create customer: ' + custErr.message); return }
          customerId = newCust.id
        }
      }
      const { error: bookErr } = await supabase.from('bookings').insert({
        client_id: clientId, customer_id: customerId, service_id: serviceId,
        date, time, status: 'scheduled', payment_status: 'none'
      })
      if (bookErr) { alert('Could not create booking: ' + bookErr.message); return }
      closeAddBooking()
      currentPage = 1; await loadBookings()
    } catch (err) { alert('Error creating booking: ' + err.message) }
    finally { abSave.disabled = false; abSave.textContent = 'Create Booking' }
  })

  // Cancelled section — fetch count eagerly, load rows lazily on expand
  loadCancelled()
  document.getElementById('cancelled-toggle')?.addEventListener('click', () => {
    const body = document.getElementById('cancelled-body')
    const chevron = document.getElementById('cancelled-chevron')
    const open = body.style.display !== 'none'
    body.style.display = open ? 'none' : ''
    chevron.style.transform = open ? '' : 'rotate(180deg)'
  })
})
