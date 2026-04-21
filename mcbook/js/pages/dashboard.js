import { supabase } from '../supabase.js'
import { getSession } from '../auth.js'
import { setTopbarDate, loadSidebarUser, esc } from '../ui.js'

// ── Helpers ──────────────────────────────────────────────────────────────────
function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function todayISO() { return localISO(new Date()) }
function yesterdayISO() {
  const d = new Date(); d.setDate(d.getDate() - 1); return localISO(d)
}
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

// ── Contact links builder ────────────────────────────────────────────────────
function contactButtons(phone, email) {
  if (!phone && !email) return ''
  let html = '<div class="contact-actions">'
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
    .select('id, time, status, customers(name, phone, email), services(name, duration_mins)')
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
        <div class="booking-avatar">${esc(initials(name))}</div>
        <div class="booking-info">
          <div class="booking-name">${esc(name)}</div>
          <div class="booking-service">${esc(b.services?.name ?? '')} · ${Number(b.services?.duration_mins ?? 0)} min</div>
        </div>
        ${contactButtons(b.customers?.phone, b.customers?.email)}
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
            <div class="upcoming-name">${esc(b.customers?.name ?? '')}</div>
            <div class="upcoming-meta">${esc(b.services?.name ?? '')} · ${fmtTime(b.time)}</div>
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
  const sevenAgo = localISO(days[0])

  const { data: chartRows } = await supabase.from('bookings')
    .select('date, services(price)')
    .eq('client_id', uid).gte('date', sevenAgo).lte('date', today)
    .neq('status', 'cancelled')

  const chartPanel = findPanel('Revenue — Last 7 Days')
  if (chartPanel && chartRows) {
    const byDate = {}
    for (const b of chartRows)
      byDate[b.date] = (byDate[b.date] || 0) + Number(b.services?.price || 0)

    const maxRev = Math.max(...days.map(d => byDate[localISO(d)] || 0), 1)
    const container = chartPanel.querySelector('.chart-placeholder')
    if (container) {
      container.querySelectorAll('.chart-bar-row').forEach(el => el.remove())
      for (const d of days) {
        const iso = localISO(d)
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

  // ── Add Booking modal ──────────────────────────────────────────────────────
  const abModal     = document.getElementById('add-booking-modal')
  const abCustomer  = document.getElementById('ab-customer')
  const abName      = document.getElementById('ab-name')
  const abEmail     = document.getElementById('ab-email')
  const abPhone     = document.getElementById('ab-phone')
  const abService   = document.getElementById('ab-service')
  const abDate      = document.getElementById('ab-date')
  const abTime      = document.getElementById('ab-time')
  const abSave      = document.getElementById('ab-save')

  // Set default date to today and load dynamic time slots
  if (abDate) abDate.value = today
  if (abTime && abDate) {
    await loadTimeSlots(uid, abDate.value, abTime)
    abDate.addEventListener('change', async () => {
      if (!abDate.value) return
      await loadTimeSlots(uid, abDate.value, abTime)
    })
  }

  // Load customers & services for the modal
  async function loadModalData() {
    const [{ data: customers }, { data: services }] = await Promise.all([
      supabase.from('customers').select('id, name, email, phone').eq('client_id', uid).order('name'),
      supabase.from('services').select('id, name, duration_mins, price').eq('client_id', uid).eq('active', true).order('name')
    ])

    if (abCustomer) {
      abCustomer.innerHTML = '<option value="">-- Select existing customer --</option><option value="__new__">+ New customer</option>'
      for (const c of customers ?? []) {
        const opt = document.createElement('option')
        opt.value = c.id
        opt.textContent = `${c.name} (${c.email})`
        opt.dataset.name = c.name
        opt.dataset.email = c.email
        opt.dataset.phone = c.phone || ''
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

  // Auto-fill name/email/phone when selecting existing customer
  abCustomer?.addEventListener('change', () => {
    const opt = abCustomer.selectedOptions[0]
    if (opt && opt.value && opt.value !== '__new__') {
      abName.value  = opt.dataset.name  || ''
      abEmail.value = opt.dataset.email || ''
      abPhone.value = opt.dataset.phone || ''
    } else {
      abName.value = ''; abEmail.value = ''; abPhone.value = ''
    }
  })

  async function openAddBookingModal() {
    abCustomer.value = ''; abName.value = ''; abEmail.value = ''; abPhone.value = ''
    abService.value = ''; abDate.value = today
    abSave.disabled = false; abSave.textContent = 'Create Booking'
    loadModalData()
    abModal.classList.add('open')
    await loadTimeSlots(uid, abDate.value, abTime)
  }

  function closeAddBookingModal() { abModal?.classList.remove('open') }

  document.getElementById('btn-add-booking')?.addEventListener('click', openAddBookingModal)
  document.getElementById('btn-add-booking-panel')?.addEventListener('click', openAddBookingModal)
  document.getElementById('add-booking-close')?.addEventListener('click', closeAddBookingModal)
  document.getElementById('ab-cancel')?.addEventListener('click', closeAddBookingModal)
  abModal?.addEventListener('click', e => { if (e.target === abModal) closeAddBookingModal() })

  // Save new booking
  abSave?.addEventListener('click', async () => {
    const name  = abName.value.trim()
    const email = abEmail.value.trim()
    const serviceId = abService.value
    const date = abDate.value
    const time = abTime.value

    if (!name || !email) { alert('Please enter the customer name and email.'); return }
    if (!serviceId) { alert('Please select a service.'); return }
    if (!date || !time) { alert('Please select a date and time.'); return }

    abSave.disabled = true
    abSave.textContent = 'Checking…'

    // Check for double-booking
    const { data: conflictRows } = await supabase.from('bookings')
      .select('id, customers(name), services(name)')
      .eq('client_id', uid).eq('date', date).eq('time', time)
      .in('status', ['scheduled', 'confirmed', 'pending_payment'])
      .limit(1)

    if (conflictRows && conflictRows.length > 0) {
      const c = conflictRows[0]
      abSave.disabled = false
      abSave.textContent = 'Create Booking'
      alert(`There's already a booking at ${fmtTime(time)} on that date (${c.customers?.name ?? 'Unknown'} — ${c.services?.name ?? 'Service'}). Choose a different time.`)
      return
    }

    abSave.textContent = 'Creating…'

    try {
      // Find or create the customer
      let customerId = abCustomer.value
      if (!customerId || customerId === '__new__') {
        // Check if customer already exists by email
        const { data: existing } = await supabase.from('customers')
          .select('id').eq('client_id', uid).eq('email', email).maybeSingle()

        if (existing) {
          customerId = existing.id
          // Update name/phone if provided
          await supabase.from('customers').update({
            name, phone: abPhone.value.trim() || null
          }).eq('id', customerId)
        } else {
          const { data: newCust, error: custErr } = await supabase.from('customers')
            .insert({ client_id: uid, name, email, phone: abPhone.value.trim() || null })
            .select('id').single()
          if (custErr) { alert('Could not create customer: ' + custErr.message); return }
          customerId = newCust.id
        }
      }

      // Insert the booking
      const { error: bookErr } = await supabase.from('bookings').insert({
        client_id: uid,
        customer_id: customerId,
        service_id: serviceId,
        date,
        time,
        status: 'scheduled',
        payment_status: 'none'
      })

      if (bookErr) { alert('Could not create booking: ' + bookErr.message); return }

      closeAddBookingModal()
      // Reload the page to reflect the new booking everywhere
      location.reload()
    } catch (err) {
      alert('Error creating booking: ' + err.message)
    } finally {
      abSave.disabled = false
      abSave.textContent = 'Create Booking'
    }
  })

  // ── Realtime subscription ─────────────────────────────────────────────────
  function handleBookingChange(payload) {
    const { eventType } = payload

    if (eventType === 'INSERT') {
      if (payload.new.date !== today) return
      // Fetch full row with joined customer + service data
      supabase.from('bookings')
        .select('id, time, status, customers(name, phone, email), services(name, duration_mins)')
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
            <div class="booking-avatar">${esc(initials(name))}</div>
            <div class="booking-info">
              <div class="booking-name">${esc(name)}</div>
              <div class="booking-service">${esc(b.services?.name ?? '')} · ${Number(b.services?.duration_mins ?? 0)} min</div>
            </div>
            ${contactButtons(b.customers?.phone, b.customers?.email)}
            <span class="status-pill ${b.status}">${statusLabel(b.status)}</span>
          `
          const header = schedPanel.querySelector('.panel-header')
          if (header) header.after(el)
          else schedPanel.prepend(el)

          // Increment Today's Bookings stat value
          const todayCard = statCard("Today's Bookings")
          if (todayCard) {
            const valEl = todayCard.querySelector('.stat-value')
            valEl.textContent = (Number(valEl.textContent) || 0) + 1
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
