import { supabase } from '../supabase.js'
import { getSession } from '../auth.js'
import { setTopbarDate, loadSidebarUser } from '../ui.js'

const CHARGE_NOSHOW_URL = 'https://uijudgnqawtvjyjuyuwo.supabase.co/functions/v1/charge-noshow'
const PAGE_SIZE = 10
let currentPage = 1
let cancelledPage = 1
let statusFilter = ''
let dateFilter = ''
let clientId = ''

// ── Helpers ──────────────────────────────────────────────────────────────────
function todayISO() { return new Date().toISOString().slice(0, 10) }
function weekStartISO() {
  const d = new Date(); const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  return d.toISOString().slice(0, 10)
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

// ── Load & render ─────────────────────────────────────────────────────────────
async function loadBookings() {
  const today = todayISO()
  let q = supabase.from('bookings')
    .select('id, date, time, status, customers(name, email), services(name, payment_mode)', { count: 'exact' })
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
    const isScheduled = b.status === 'scheduled' || b.status === 'pending_payment'
    const isChargeable = b.services?.payment_mode === 'noshow_only' || b.services?.payment_mode === 'after'
    const statusLabel = b.status === 'pending_payment' ? 'Scheduled' : capitalize(b.status.replace('_', ' '))
    const statusCls   = b.status === 'pending_payment' ? 'scheduled' : b.status
    const payTag = b.services?.payment_mode === 'free'
      ? '<div class="pay-tag">Pay externally</div>'
      : b.services?.payment_mode
        ? '<div class="pay-tag">Card on file</div>'
        : ''
    const tr = document.createElement('tr')
    tr.dataset.bookingId = b.id
    tr.innerHTML = `
      <td>
        <div class="customer-cell">
          <div class="cust-avatar">${initials(name)}</div>
          <div>
            <div class="cust-name">${name}</div>
            <div class="cust-email">${b.customers?.email ?? ''}</div>
          </div>
        </div>
      </td>
      <td>${b.services?.name ?? ''}${payTag}</td>
      <td>${fmtDate(b.date)}</td>
      <td>${fmtTime(b.time)}</td>
      <td><span class="status-pill ${statusCls}">${statusLabel}</span></td>
      <td>
        <div class="row-actions">
          ${isChargeable ? `<button class="btn-noshow" ${isScheduled ? '' : 'disabled'}>No-show + Charge</button>` : ''}
          <button class="btn-waive" ${isScheduled ? '' : 'disabled'}>Waive No-show</button>
          <button class="btn-cancel" ${isScheduled ? '' : 'disabled'}>Cancel</button>
          <button class="btn-view">View</button>
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
    tr.innerHTML = `
      <td>
        <div class="customer-cell">
          <div class="cust-avatar">${initials(name)}</div>
          <div>
            <div class="cust-name">${name}</div>
            <div class="cust-email">${b.customers?.email ?? ''}</div>
          </div>
        </div>
      </td>
      <td>${b.services?.name ?? ''}</td>
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
  tr?.querySelector('.btn-noshow')?.setAttribute('disabled', '')
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
  tr?.querySelectorAll('.btn-noshow, .btn-cancel, .btn-waive').forEach(b => b.setAttribute('disabled', ''))
}

async function markNoshow(bookingId, buttonEl) {
  buttonEl.disabled    = true
  buttonEl.textContent = 'Charging\u2026'

  const session = await getSession()
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
    buttonEl.textContent = 'Mark No-show'
  } else {
    buttonEl.disabled    = false
    buttonEl.textContent = 'Mark No-show'
    alert('Charge failed: ' + (json.error || 'Unknown error'))
  }
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
  const STATUS_MAP = { 'Scheduled': 'scheduled', 'Completed': 'completed', 'No-show': 'noshow' }
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

  // Mark no-show / waive / cancel (delegated on tbody)
  document.querySelector('.data-table tbody')?.addEventListener('click', e => {
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
    }
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
