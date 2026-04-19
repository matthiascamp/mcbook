import { supabase } from '../supabase.js'
import { getSession } from '../auth.js'
import { setTopbarDate, loadSidebarUser, esc } from '../ui.js'

// ── Helpers ──────────────────────────────────────────────────────────────────
function monthStartISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function initials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
function fmtTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
function statusLabel(s) {
  if (!s) return ''
  if (s === 'pending_payment') return 'Scheduled'
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession()
  if (!session) return
  const uid = session.user.id
  setTopbarDate()
  loadSidebarUser(uid)

  // ── Stat chips (parallel) ─────────────────────────────────────────────────
  const [
    { count: totalCount },
    { count: newCount },
    { data: custBookings }
  ] = await Promise.all([
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('client_id', uid),
    supabase.from('customers').select('*', { count: 'exact', head: true })
      .eq('client_id', uid).gte('created_at', monthStartISO()),
    supabase.from('customers').select('id, bookings(id)').eq('client_id', uid)
  ])

  const chips = document.querySelectorAll('.stat-chip-val')
  if (chips[0]) chips[0].textContent = totalCount ?? 0
  if (chips[1]) chips[1].textContent = newCount ?? 0
  if (chips[2] && custBookings)
    chips[2].textContent = custBookings.filter(c => (c.bookings?.length ?? 0) >= 3).length

  // ── Customers table with pagination ──────────────────────────────────────
  const PAGE_SIZE = 10
  let currentPage = 1
  const total = totalCount ?? 0

  async function loadPage(page) {
    const from = (page - 1) * PAGE_SIZE
    const { data: customers } = await supabase.from('customers')
      .select('id, name, email, phone, created_at, bookings(id, status)')
      .eq('client_id', uid)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    const tbody = document.querySelector('.data-table tbody')
    tbody.innerHTML = ''
    ;(customers ?? []).forEach((c, i) => {
      const bookingCount = (c.bookings ?? []).filter(b => b.status !== 'cancelled').length
      const noshowCount  = (c.bookings ?? []).filter(b => b.status === 'no_show').length
      const since = new Date(c.created_at)
      const tr = document.createElement('tr')
      tr.innerHTML = `
        <td>
          <div class="customer-cell">
            <div class="cust-avatar c${((from + i) % 8) + 1}">${esc(initials(c.name))}</div>
            <div>
              <div class="cust-name">${esc(c.name)}</div>
              <div class="cust-since">Customer since ${MONTHS[since.getMonth()]} ${since.getFullYear()}</div>
            </div>
          </div>
        </td>
        <td>${esc(c.email)}</td>
        <td>${esc(c.phone ?? '—')}</td>
        <td><span class="booking-count">${Number(bookingCount)}</span></td>
        <td><span class="noshow-count${noshowCount === 0 ? ' none' : ''}">${Number(noshowCount)}</span></td>
        <td><button class="btn-view" data-customer-id="${esc(c.id)}">View</button></td>
      `
      tbody.appendChild(tr)
    })

    // Update label
    const start = total === 0 ? 0 : from + 1
    const end   = Math.min(from + PAGE_SIZE, total)
    const label = document.getElementById('pagination-label')
    if (label) label.textContent = total === 0
      ? 'No customers yet'
      : `Showing ${start}–${end} of ${total} customer${total === 1 ? '' : 's'}`

    // Update top count
    document.querySelector('.table-count').textContent = label?.textContent ?? ''

    // Rebuild page buttons
    const btns      = document.getElementById('pagination-btns')
    const totalPages = Math.ceil(total / PAGE_SIZE)
    if (btns) {
      btns.innerHTML = ''
      if (totalPages > 1) {
        const prev = document.createElement('button')
        prev.className = 'page-btn'
        prev.innerHTML = '&#8249;'
        prev.disabled  = page <= 1
        prev.addEventListener('click', () => { currentPage--; loadPage(currentPage) })
        btns.appendChild(prev)

        for (let p = 1; p <= totalPages; p++) {
          const btn = document.createElement('button')
          btn.className = 'page-btn' + (p === page ? ' current' : '')
          btn.textContent = p
          btn.addEventListener('click', () => { currentPage = p; loadPage(currentPage) })
          btns.appendChild(btn)
        }

        const next = document.createElement('button')
        next.className = 'page-btn'
        next.innerHTML = '&#8250;'
        next.disabled  = page >= totalPages
        next.addEventListener('click', () => { currentPage++; loadPage(currentPage) })
        btns.appendChild(next)
      }
    }
  }

  await loadPage(1)

  // ── Customer detail modal ────────────────────────────────────────────────
  const modal      = document.getElementById('customer-modal')
  const modalTitle = document.getElementById('customer-modal-title')
  const modalBody  = document.getElementById('customer-modal-body')
  const modalClose = document.getElementById('customer-modal-close')

  function closeModal() {
    modal?.classList.remove('open')
    if (modalBody) modalBody.innerHTML = '<div class="modal-loading">Loading\u2026</div>'
  }
  modalClose?.addEventListener('click', closeModal)
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })

  async function openCustomer(customerId) {
    if (!modal || !modalBody) return
    modal.classList.add('open')
    modalBody.innerHTML = '<div class="modal-loading">Loading\u2026</div>'

    const { data: cust, error: custErr } = await supabase.from('customers')
      .select('id, name, email, phone, created_at')
      .eq('id', customerId).eq('client_id', uid).single()
    if (custErr || !cust) {
      modalBody.innerHTML = `<div class="modal-loading">Could not load customer${custErr ? ': ' + esc(custErr.message) : ''}</div>`
      return
    }

    const { data: bookings } = await supabase.from('bookings')
      .select('id, date, time, status, services(name, price)')
      .eq('customer_id', customerId).eq('client_id', uid)
      .order('date', { ascending: false }).order('time', { ascending: false })
      .limit(50)

    const list   = bookings ?? []
    const total  = list.length
    const done   = list.filter(b => b.status === 'completed').length
    const upcoming = list.filter(b => ['scheduled','confirmed','pending_payment'].includes(b.status)).length
    const cancelled = list.filter(b => b.status === 'cancelled').length
    const noshow = list.filter(b => b.status === 'no_show').length
    const spend  = list
      .filter(b => b.status === 'completed')
      .reduce((s, b) => s + Number(b.services?.price || 0), 0)

    modalTitle.textContent = cust.name || 'Customer'

    const since = new Date(cust.created_at)
    const bookingsHtml = list.length === 0
      ? '<div class="modal-booking-empty">No bookings yet.</div>'
      : list.slice(0, 10).map(b => `
          <div class="modal-booking-row">
            <div class="modal-booking-main">
              <span class="modal-booking-service">${esc(b.services?.name ?? 'Service')}</span>
              <span class="modal-booking-date">${fmtDate(b.date)} at ${fmtTime(b.time)}</span>
            </div>
            <span class="status-pill ${b.status}">${statusLabel(b.status)}</span>
          </div>`).join('')

    const moreNote = list.length > 10
      ? `<div class="modal-booking-empty">Showing 10 of ${list.length}.</div>`
      : ''

    modalBody.innerHTML = `
      <div class="modal-section">
        <div class="modal-section-title">Contact</div>
        <div class="modal-row"><span class="modal-label">Name</span><span class="modal-val">${esc(cust.name ?? '')}</span></div>
        <div class="modal-row"><span class="modal-label">Email</span><span class="modal-val">${esc(cust.email ?? '')}</span></div>
        <div class="modal-row"><span class="modal-label">Phone</span><span class="modal-val">${esc(cust.phone ?? '\u2014')}</span></div>
        <div class="modal-row"><span class="modal-label">Customer since</span><span class="modal-val">${MONTHS[since.getMonth()]} ${since.getFullYear()}</span></div>
      </div>

      <div class="modal-section">
        <div class="modal-section-title">Stats</div>
        <div class="modal-row"><span class="modal-label">Total bookings</span><span class="modal-val">${Number(total)}</span></div>
        <div class="modal-row"><span class="modal-label">Upcoming</span><span class="modal-val">${Number(upcoming)}</span></div>
        <div class="modal-row"><span class="modal-label">Completed</span><span class="modal-val">${Number(done)}</span></div>
        <div class="modal-row"><span class="modal-label">Cancelled</span><span class="modal-val">${Number(cancelled)}</span></div>
        <div class="modal-row"><span class="modal-label">No-shows</span><span class="modal-val">${Number(noshow)}</span></div>
        <div class="modal-row"><span class="modal-label">Lifetime spend</span><span class="modal-val">$${spend.toFixed(2)}</span></div>
      </div>

      <div class="modal-section">
        <div class="modal-section-title">Recent bookings</div>
        ${bookingsHtml}
        ${moreNote}
      </div>
    `
  }

  // Delegate click on the View button
  document.querySelector('.data-table tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('.btn-view')
    if (!btn) return
    const id = btn.dataset.customerId
    if (id) openCustomer(id)
  })

  // ── Client-side search ────────────────────────────────────────────────────
  document.querySelector('.filter-input')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase()
    document.querySelectorAll('.data-table tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'
    })
  })
})
