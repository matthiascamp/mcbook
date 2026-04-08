import { supabase } from '../supabase.js'
import { getSession } from '../auth.js'
import { setTopbarDate, loadSidebarUser } from '../ui.js'

// ── Helpers ──────────────────────────────────────────────────────────────────
function todayISO() { return new Date().toISOString().slice(0, 10) }
function yesterdayISO() {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10)
}
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
function fmtMoney(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function statusLabel(s) {
  if (s === 'pending_payment') return 'Scheduled'
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function statCard(label) {
  return [...document.querySelectorAll('.stat-card')]
    .find(c => c.querySelector('.stat-card-label')?.textContent.trim() === label)
}
function findPanel(title) {
  return [...document.querySelectorAll('.panel')]
    .find(p => p.querySelector('.panel-title')?.textContent.trim() === title)
}
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DNAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// ── Main ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession()
  if (!session) return
  const uid = session.user.id
  setTopbarDate()
  loadSidebarUser(uid)
  const today = todayISO()
  const yesterday = yesterdayISO()

  // ── Stat cards (parallel) ─────────────────────────────────────────────────
  const [
    { count: todayCount },
    { count: yestCount },
    { count: weekCount },
    { data: revRows },
    { data: nshRows }
  ] = await Promise.all([
    supabase.from('bookings').select('*', { count: 'exact', head: true })
      .eq('client_id', uid).eq('date', today),
    supabase.from('bookings').select('*', { count: 'exact', head: true })
      .eq('client_id', uid).eq('date', yesterday),
    supabase.from('bookings').select('*', { count: 'exact', head: true })
      .eq('client_id', uid).gte('date', weekStartISO()),
    supabase.from('bookings').select('services(price)')
      .eq('client_id', uid).gte('date', monthStartISO()).neq('status', 'cancelled'),
    supabase.from('bookings').select('id, payments(amount)')
      .eq('client_id', uid).eq('status', 'no_show').gte('date', monthStartISO())
  ])

  // Today's Bookings
  const todayCard = statCard("Today's Bookings")
  if (todayCard) {
    const diff = (todayCount ?? 0) - (yestCount ?? 0)
    todayCard.querySelector('.stat-value').textContent = todayCount ?? 0
    const d = todayCard.querySelector('.stat-delta')
    d.textContent = `${diff >= 0 ? '+' : ''}${diff} from yesterday`
    d.className = 'stat-delta ' + (diff >= 0 ? 'up' : 'down')
  }

  // This Week
  const weekCard = statCard('This Week')
  if (weekCard) weekCard.querySelector('.stat-value').textContent = weekCount ?? 0

  // Revenue MTD
  const revCard = statCard('Revenue (MTD)')
  if (revCard && revRows) {
    const total = revRows.reduce((s, b) => s + Number(b.services?.price || 0), 0)
    revCard.querySelector('.stat-value').textContent = fmtMoney(total)
  }

  // No-shows MTD
  const nshCard = statCard('No-shows (MTD)')
  if (nshCard && nshRows) {
    const fees = nshRows.flatMap(b => b.payments ?? []).reduce((s, p) => s + Number(p.amount), 0)
    nshCard.querySelector('.stat-value').textContent = nshRows.length
    nshCard.querySelector('.stat-delta').textContent = `${fmtMoney(fees)} collected in fees`
  }

  // ── Today's Schedule ──────────────────────────────────────────────────────
  const { data: todayBookings } = await supabase.from('bookings')
    .select('id, time, status, customers(name), services(name, duration_mins)')
    .eq('client_id', uid).eq('date', today)
    .order('time', { ascending: true })

  const schedPanel = findPanel("Today's Schedule")
  if (schedPanel) {
    schedPanel.querySelectorAll('.booking-list-item, .panel-empty').forEach(el => el.remove())
    const badge = schedPanel.querySelector('.panel-badge')
    if (badge) badge.textContent = todayBookings?.length ? `${todayBookings.length} bookings` : ''
    if (!todayBookings || todayBookings.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'panel-empty'
      empty.textContent = 'No bookings today'
      schedPanel.appendChild(empty)
    }
    for (const b of (todayBookings ?? [])) {
      const name = b.customers?.name ?? ''
      const el = document.createElement('div')
      el.className = 'booking-list-item'
      el.dataset.bookingId = b.id
      el.innerHTML = `
        <span class="booking-time">${fmtTime(b.time)}</span>
        <div class="booking-avatar">${initials(name)}</div>
        <div class="booking-info">
          <div class="booking-name">${name}</div>
          <div class="booking-service">${b.services?.name ?? ''} · ${b.services?.duration_mins ?? ''} min</div>
        </div>
        <span class="status-pill ${b.status}">${statusLabel(b.status)}</span>
      `
      schedPanel.appendChild(el)
    }
  }

  // ── Upcoming ──────────────────────────────────────────────────────────────
  const { data: upcoming, error: upErr } = await supabase.from('bookings')
    .select('id, date, time, status, customers(name), services(name)')
    .eq('client_id', uid).gt('date', today).neq('status', 'cancelled')
    .order('date', { ascending: true }).order('time', { ascending: true })
    .limit(5)

  if (upErr) console.error('[MCBook] upcoming bookings query failed:', upErr.message)

  const upPanel = findPanel('Upcoming')
  if (upPanel) {
    upPanel.querySelectorAll('.upcoming-item, .panel-empty').forEach(el => el.remove())

    if (!upcoming || upcoming.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'panel-empty'
      empty.textContent = 'No upcoming bookings'
      upPanel.appendChild(empty)
    } else {
      for (const b of upcoming) {
        const d = new Date(b.date + 'T00:00:00')
        const el = document.createElement('div')
        el.className = 'upcoming-item'
        el.innerHTML = `
          <div class="upcoming-date-box">
            <span class="day">${d.getDate()}</span>
            <span class="mon">${MONTHS[d.getMonth()]}</span>
          </div>
          <div class="upcoming-info">
            <div class="upcoming-name">${b.customers?.name ?? ''}</div>
            <div class="upcoming-meta">${b.services?.name ?? ''} · ${fmtTime(b.time)}</div>
          </div>
          <span class="status-pill ${b.status}">${statusLabel(b.status)}</span>
        `
        upPanel.appendChild(el)
      }
    }
  }

  // ── Revenue chart (last 7 days) ───────────────────────────────────────────
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d
  })
  const sevenAgo = days[0].toISOString().slice(0, 10)

  const { data: chartRows } = await supabase.from('bookings')
    .select('date, services(price)')
    .eq('client_id', uid).gte('date', sevenAgo).lte('date', today)
    .neq('status', 'cancelled')

  const chartPanel = findPanel('Revenue — Last 7 Days')
  if (chartPanel && chartRows) {
    const byDate = {}
    for (const b of chartRows)
      byDate[b.date] = (byDate[b.date] || 0) + Number(b.services?.price || 0)

    const maxRev = Math.max(...days.map(d => byDate[d.toISOString().slice(0, 10)] || 0), 1)
    const container = chartPanel.querySelector('.chart-placeholder')
    if (container) {
      container.querySelectorAll('.chart-bar-row').forEach(el => el.remove())
      for (const d of days) {
        const iso = d.toISOString().slice(0, 10)
        const rev = byDate[iso] || 0
        const pct = Math.round((rev / maxRev) * 100)
        const row = document.createElement('div')
        row.className = 'chart-bar-row'
        row.innerHTML = `
          <span class="chart-label">${DNAMES[d.getDay()]}</span>
          <div class="chart-bar-wrap"><div class="chart-bar" style="width:${pct}%"></div></div>
          <span class="chart-val">${rev > 0 ? fmtMoney(rev) : '—'}</span>
        `
        container.appendChild(row)
      }
    }
  }

  // ── Realtime subscription ─────────────────────────────────────────────────
  function handleBookingChange(payload) {
    const { eventType } = payload

    if (eventType === 'INSERT') {
      if (payload.new.date !== today) return
      // Fetch full row with joined customer + service data
      supabase.from('bookings')
        .select('id, time, status, customers(name), services(name, duration_mins)')
        .eq('id', payload.new.id)
        .single()
        .then(({ data: b }) => {
          if (!b || !schedPanel) return
          // Prepend new item directly after panel-header
          const name = b.customers?.name ?? ''
          const el = document.createElement('div')
          el.className = 'booking-list-item'
          el.dataset.bookingId = b.id
          el.innerHTML = `
            <span class="booking-time">${fmtTime(b.time)}</span>
            <div class="booking-avatar">${initials(name)}</div>
            <div class="booking-info">
              <div class="booking-name">${name}</div>
              <div class="booking-service">${b.services?.name ?? ''} · ${b.services?.duration_mins ?? ''} min</div>
            </div>
            <span class="status-pill ${b.status}">${statusLabel(b.status)}</span>
          `
          const header = schedPanel.querySelector('.panel-header')
          if (header) header.after(el)
          else schedPanel.prepend(el)

          // Increment Today's Bookings stat value
          const todayCard = statCard("Today's Bookings")
          if (todayCard) {
            const valEl = todayCard.querySelector('.stat-value')
            valEl.textContent = Number(valEl.textContent) + 1
          }

          // Increment panel badge count
          const badge = schedPanel.querySelector('.panel-badge')
          if (badge) {
            const n = parseInt(badge.textContent) + 1
            badge.textContent = `${n} bookings`
          }
        })
    }

    if (eventType === 'UPDATE') {
      const el = schedPanel?.querySelector(`.booking-list-item[data-booking-id="${payload.new.id}"]`)
      if (!el) return
      const pill = el.querySelector('.status-pill')
      if (pill) {
        pill.className = `status-pill ${payload.new.status}`
        pill.textContent = statusLabel(payload.new.status)
      }
    }

    if (eventType === 'DELETE') {
      schedPanel
        ?.querySelector(`.booking-list-item[data-booking-id="${payload.old.id}"]`)
        ?.remove()
    }
  }

  const channel = supabase
    .channel('dashboard-bookings')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'bookings',
      filter: 'client_id=eq.' + uid
    }, handleBookingChange)
    .subscribe()

  window.addEventListener('beforeunload', () => supabase.removeChannel(channel))
})
