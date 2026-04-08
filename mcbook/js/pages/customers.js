import { supabase } from '../supabase.js'
import { getSession } from '../auth.js'
import { setTopbarDate, loadSidebarUser } from '../ui.js'

// ── Helpers ──────────────────────────────────────────────────────────────────
function monthStartISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function initials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

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
      const noshowCount  = (c.bookings ?? []).filter(b => b.status === 'noshow').length
      const since = new Date(c.created_at)
      const tr = document.createElement('tr')
      tr.innerHTML = `
        <td>
          <div class="customer-cell">
            <div class="cust-avatar c${((from + i) % 8) + 1}">${initials(c.name)}</div>
            <div>
              <div class="cust-name">${c.name}</div>
              <div class="cust-since">Customer since ${MONTHS[since.getMonth()]} ${since.getFullYear()}</div>
            </div>
          </div>
        </td>
        <td>${c.email}</td>
        <td>${c.phone ?? '—'}</td>
        <td><span class="booking-count">${bookingCount}</span></td>
        <td><span class="noshow-count${noshowCount === 0 ? ' none' : ''}">${noshowCount}</span></td>
        <td><button class="btn-view">View</button></td>
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

  // ── Client-side search ────────────────────────────────────────────────────
  document.querySelector('.filter-input')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase()
    document.querySelectorAll('.data-table tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none'
    })
  })
})
