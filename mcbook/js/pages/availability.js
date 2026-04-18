import { supabase } from '../supabase.js'
import { getSession } from '../auth.js'
import { setTopbarDate, loadSidebarUser } from '../ui.js'

// Row index → day_of_week: Mon(1) Tue(2) Wed(3) Thu(4) Fri(5) Sat(6) Sun(0)
const DOW = [1, 2, 3, 4, 5, 6, 0]

// ── Helpers ──────────────────────────────────────────────────────────────────
function to12h(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
function to24h(t) {
  if (!t) return '09:00'
  const [time, ampm] = t.split(' ')
  let [h, m] = time.split(':').map(Number)
  if (ampm === 'PM' && h !== 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
function fmtBlockedDate(iso) {
  const d = new Date(iso + 'T00:00:00')
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} (${DAYS[d.getDay()]})`
}

// ── State ─────────────────────────────────────────────────────────────────────
let uid = ''

// ── Generate 30-min time option list 6:00 AM – 10:00 PM ──────────────────────
function timeOptions() {
  const opts = []
  for (let h = 6; h <= 22; h++) {
    for (const m of [0, 30]) {
      if (h === 22 && m === 30) break
      const ampm = h >= 12 ? 'PM' : 'AM'
      const h12  = h % 12 || 12
      opts.push(`${h12}:${String(m).padStart(2, '0')} ${ampm}`)
    }
  }
  return opts
}

function populateSelect(sel, value) {
  sel.innerHTML = ''
  for (const t of timeOptions()) {
    const opt = document.createElement('option')
    opt.value = opt.textContent = t
    sel.appendChild(opt)
  }
  if (value) sel.value = value
}

// ── Load weekly schedule ──────────────────────────────────────────────────────
async function loadWeeklySchedule() {
  const { data } = await supabase.from('availability_rules')
    .select('*').eq('client_id', uid).order('day_of_week')

  document.querySelectorAll('.week-row').forEach((row, i) => {
    const checkbox  = row.querySelector('input[type="checkbox"]')
    const timeRange = row.querySelector('.time-range')
    const dayClosed = row.querySelector('.day-closed')
    const selects   = row.querySelectorAll('.time-select')

    // Always populate select options with full 30-min range
    if (selects[0]) populateSelect(selects[0], '9:00 AM')
    if (selects[1]) populateSelect(selects[1], '5:00 PM')

    const rule = data?.find(r => r.day_of_week === DOW[i])
    if (rule) {
      checkbox.checked = rule.enabled
      if (selects[0]) selects[0].value = to12h(rule.start_time)
      if (selects[1]) selects[1].value = to12h(rule.end_time)
    }

    const applyEnabled = (on) => {
      if (timeRange) timeRange.style.display = on ? '' : 'none'
      if (dayClosed) dayClosed.style.display = on ? 'none' : ''
    }
    applyEnabled(checkbox.checked)
    checkbox.addEventListener('change', () => applyEnabled(checkbox.checked))
  })
}

// ── Load blocked dates ────────────────────────────────────────────────────────
async function loadBlockedDates() {
  const { data } = await supabase.from('blocked_dates')
    .select('*').eq('client_id', uid).order('date', { ascending: true })

  const blockedList = document.querySelector('.blocked-list')
  blockedList.innerHTML = ''
  for (const bd of data ?? []) {
    const div = document.createElement('div')
    div.className = 'blocked-item'
    div.dataset.blockedId = bd.id
    div.innerHTML = `
      <div class="blocked-item-left">
        <span class="blocked-icon">&#128683;</span>
        <div>
          <div class="blocked-label">${bd.label ?? 'Blocked'}</div>
          <div class="blocked-note">${fmtBlockedDate(bd.date)}</div>
        </div>
      </div>
      <button class="btn-remove" title="Remove">&#215;</button>
    `
    blockedList.appendChild(div)
  }
}

// ── Load booking settings ─────────────────────────────────────────────────────
async function loadBookingSettings() {
  const { data } = await supabase.from('booking_settings')
    .select('*').eq('client_id', uid).limit(1).maybeSingle()
  if (!data) return

  const slotRows   = document.querySelectorAll('.slot-row')
  const slotSel    = slotRows[0]?.querySelector('select')
  const advanceSel = slotRows[1]?.querySelector('select')
  const noticeSel  = slotRows[2]?.querySelector('select')
  const payToggle  = document.getElementById('toggle-require-payment')

  if (slotSel)    slotSel.value    = `${data.slot_duration_mins}`
  if (advanceSel) advanceSel.value = `${data.advance_window_weeks} weeks`
  if (noticeSel)  noticeSel.value  = data.min_notice_hours === 1
    ? '1 hour' : `${data.min_notice_hours} hours`
  if (payToggle)
    payToggle.checked = data.require_payment === true

}


// ── Stripe connection check ───────────────────────────────────────────────────
async function applyStripeGate() {
  const { data } = await supabase.from('clients')
    .select('stripe_account_id').eq('id', uid).maybeSingle()
  const connected = !!data?.stripe_account_id
  const toggle    = document.getElementById('toggle-require-payment')
  const row       = toggle?.closest('.slot-row')
  if (!toggle || !row) return

  if (!connected) {
    toggle.disabled = true
    toggle.checked  = false
    // Add a lock note if not already there
    if (!row.querySelector('.stripe-lock-note')) {
      const note = document.createElement('span')
      note.className = 'stripe-lock-note'
      note.innerHTML = '&#128274; <a href="stripe-onboarding.html">Connect Stripe</a> to enable'
      row.appendChild(note)
    }
  }
}

// ── Advanced availability ─────────────────────────────────────────────────────
const DAYS_SHOWN = 14
let advOverrides = {}  // date-string → override row
let advSelectedDate = null

function fmtAdvDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

async function loadAdvancedCalendar() {
  const today = new Date(); today.setHours(0,0,0,0)
  const todayISO = today.toISOString().slice(0,10)

  // Fetch existing overrides
  const { data } = await supabase.from('availability_overrides')
    .select('*').eq('client_id', uid).gte('date', todayISO)
  advOverrides = Object.fromEntries((data || []).map(o => [o.date, o]))

  renderAdvancedCalendar()
}

function renderAdvancedCalendar() {
  const today = new Date(); today.setHours(0,0,0,0)

  // Find Monday of this week
  const startDay = new Date(today)
  const dow = startDay.getDay() // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow
  startDay.setDate(startDay.getDate() + offset)

  const grid = document.getElementById('adv-grid')
  // Remove old day cells (keep the 7 DOW headers)
  const headers = Array.from(grid.querySelectorAll('.adv-dow'))
  grid.innerHTML = ''
  headers.forEach(h => grid.appendChild(h))

  // Fetch current weekly rules for context
  const weeklyRows = document.querySelectorAll('.week-row')
  const DOW_ENABLED = {}
  weeklyRows.forEach((row, i) => {
    const cb = row.querySelector('input[type="checkbox"]')
    const sel = row.querySelectorAll('.time-select')
    DOW_ENABLED[DOW[i]] = {
      enabled: cb?.checked,
      start: sel[0]?.value,
      end: sel[1]?.value,
    }
  })

  for (let i = 0; i < DAYS_SHOWN; i++) {
    const d = new Date(startDay)
    d.setDate(d.getDate() + i)
    const dateStr = d.toISOString().slice(0,10)
    const isToday = d.getTime() === today.getTime()
    const isPast  = d < today
    const dayDow  = d.getDay()
    const weekly  = DOW_ENABLED[dayDow]
    const ov      = advOverrides[dateStr]

    let cls = 'adv-day'
    let label = ''

    if (isPast) {
      cls += ' adv-closed'
      label = '—'
    } else if (ov) {
      if (!ov.is_available) {
        cls += ' adv-blocked'
        label = 'Blocked'
      } else if (ov.blocked_from && ov.blocked_to) {
        cls += ' adv-break'
        label = 'Break ' + to12h(ov.blocked_from).replace(':00 ',' ') + '–' + to12h(ov.blocked_to).replace(':00 ',' ')
      } else if (ov.start_time && ov.end_time) {
        cls += ' adv-custom'
        label = to12h(ov.start_time).replace(':00 ',' ') + '–' + to12h(ov.end_time).replace(':00 ',' ')
      }
    } else if (!weekly?.enabled) {
      cls += ' adv-closed'
      label = 'Closed'
    } else {
      label = 'Default'
    }

    if (isToday) cls += ' adv-today'

    const cell = document.createElement('div')
    cell.className = cls
    cell.dataset.date = dateStr
    const num = document.createElement('div')
    num.className = 'adv-day-num'
    num.textContent = d.getDate()
    const lbl = document.createElement('div')
    lbl.className = 'adv-day-label'
    lbl.textContent = label
    cell.appendChild(num)
    cell.appendChild(lbl)
    if (!isPast) cell.addEventListener('click', () => openAdvEditor(dateStr, d))
    grid.appendChild(cell)
  }
}

function openAdvEditor(dateStr, dateObj) {
  advSelectedDate = dateStr
  const editor     = document.getElementById('adv-editor')
  const title      = document.getElementById('adv-editor-title')
  const radios     = document.querySelectorAll('input[name="adv-mode"]')
  const customTimes = document.getElementById('adv-custom-times')
  const breakTimes  = document.getElementById('adv-break-times')
  const startSel    = document.getElementById('adv-start')
  const endSel      = document.getElementById('adv-end')
  const breakFromSel = document.getElementById('adv-break-from')
  const breakToSel   = document.getElementById('adv-break-to')

  title.textContent = `${dateObj.toLocaleDateString('en-AU', { weekday: 'long' })} ${fmtAdvDate(dateStr)}`

  // Populate time selects if not already done
  if (!startSel.options.length)     populateSelect(startSel,    '9:00 AM')
  if (!endSel.options.length)       populateSelect(endSel,      '5:00 PM')
  if (!breakFromSel.options.length) populateSelect(breakFromSel,'12:00 PM')
  if (!breakToSel.options.length)   populateSelect(breakToSel,  '1:00 PM')

  const ov = advOverrides[dateStr]
  let mode = 'default'
  if (ov) {
    if (!ov.is_available) {
      mode = 'blocked'
    } else if (ov.blocked_from && ov.blocked_to) {
      mode = 'break'
      breakFromSel.value = to12h(ov.blocked_from)
      breakToSel.value   = to12h(ov.blocked_to)
    } else if (ov.start_time && ov.end_time) {
      mode = 'custom'
      startSel.value = to12h(ov.start_time)
      endSel.value   = to12h(ov.end_time)
    }
  }

  radios.forEach(r => { r.checked = r.value === mode })
  customTimes.classList.toggle('visible', mode === 'custom')
  breakTimes.classList.toggle('visible',  mode === 'break')
  editor.classList.add('open')
  editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession()
  if (!session) return
  uid = session.user.id
  setTopbarDate()
  loadSidebarUser(uid)

  await Promise.all([loadWeeklySchedule(), loadBlockedDates(), loadBookingSettings()])
  await applyStripeGate()
  await loadAdvancedCalendar()

  // Advanced editor radio toggles
  document.querySelectorAll('input[name="adv-mode"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('adv-custom-times').classList.toggle('visible', r.value === 'custom' && r.checked)
      document.getElementById('adv-break-times').classList.toggle('visible',  r.value === 'break'  && r.checked)
    })
  })

  // Advanced save
  document.getElementById('adv-save')?.addEventListener('click', async () => {
    if (!advSelectedDate) return
    const mode         = document.querySelector('input[name="adv-mode"]:checked')?.value
    const startVal     = document.getElementById('adv-start')?.value
    const endVal       = document.getElementById('adv-end')?.value
    const breakFromVal = document.getElementById('adv-break-from')?.value
    const breakToVal   = document.getElementById('adv-break-to')?.value

    if (mode === 'default') {
      const ov = advOverrides[advSelectedDate]
      if (ov?.id) await supabase.from('availability_overrides').delete().eq('id', ov.id)
    } else if (mode === 'blocked') {
      await supabase.from('availability_overrides').upsert({
        client_id: uid, date: advSelectedDate, is_available: false,
        start_time: null, end_time: null, blocked_from: null, blocked_to: null,
      }, { onConflict: 'client_id,date' })
    } else if (mode === 'custom') {
      await supabase.from('availability_overrides').upsert({
        client_id: uid, date: advSelectedDate, is_available: true,
        start_time: to24h(startVal), end_time: to24h(endVal),
        blocked_from: null, blocked_to: null,
      }, { onConflict: 'client_id,date' })
    } else if (mode === 'break') {
      await supabase.from('availability_overrides').upsert({
        client_id: uid, date: advSelectedDate, is_available: true,
        start_time: null, end_time: null,
        blocked_from: to24h(breakFromVal), blocked_to: to24h(breakToVal),
      }, { onConflict: 'client_id,date' })
    }

    document.getElementById('adv-editor').classList.remove('open')
    advSelectedDate = null
    await loadAdvancedCalendar()
  })

  // Advanced cancel
  document.getElementById('adv-cancel')?.addEventListener('click', () => {
    document.getElementById('adv-editor').classList.remove('open')
    advSelectedDate = null
  })

  const saveBtns = document.querySelectorAll('.btn-save')

  // Save weekly schedule
  saveBtns[0]?.addEventListener('click', async () => {
    const rows = []
    document.querySelectorAll('.week-row').forEach((row, i) => {
      const checkbox = row.querySelector('input[type="checkbox"]')
      const selects  = row.querySelectorAll('.time-select')
      rows.push({
        client_id:   uid,
        day_of_week: DOW[i],
        enabled:     checkbox.checked,
        start_time:  selects[0] ? to24h(selects[0].value) : '09:00',
        end_time:    selects[1] ? to24h(selects[1].value) : '17:00'
      })
    })
    const { error } = await supabase.from('availability_rules')
      .upsert(rows, { onConflict: 'client_id,day_of_week' })
    if (!error) alert('Schedule saved.')
    else console.error(error)
  })

  // Save booking settings
  saveBtns[1]?.addEventListener('click', async () => {
    const slotRows   = document.querySelectorAll('.slot-row')
    const slotSel    = slotRows[0]?.querySelector('select')
    const advanceSel = slotRows[1]?.querySelector('select')
    const noticeSel  = slotRows[2]?.querySelector('select')
    const payToggle  = document.getElementById('toggle-require-payment')
    const slotMins   = parseInt(slotSel?.value || '60')
    const { error } = await supabase.from('booking_settings').upsert({
      client_id:            uid,
      slot_duration_mins:   slotMins,
      advance_window_weeks: parseInt(advanceSel?.value || '4'),
      min_notice_hours:     parseInt(noticeSel?.value  || '2'),
      require_payment:      payToggle ? (payToggle.checked && !payToggle.disabled) : false,
    }, { onConflict: 'client_id' })
    if (error) { console.error(error); return }
    // For restaurants, keep the Table Booking service duration in sync
    const { data: clientData } = await supabase.from('clients').select('business_mode').eq('id', uid).maybeSingle()
    if (clientData?.business_mode === 'restaurant') {
      await supabase.from('services').update({ duration_mins: slotMins }).eq('client_id', uid).eq('active', true)
    }
    alert('Settings saved.')
  })

  // Remove blocked date (delegated — outside loadBlockedDates so no duplicate listeners)
  document.querySelector('.blocked-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('.btn-remove')
    if (!btn) return
    const id = btn.closest('.blocked-item')?.dataset.blockedId
    if (id) {
      await supabase.from('blocked_dates').delete().eq('id', id)
      loadBlockedDates()
    }
  })

  // Add blocked date
  document.querySelector('.btn-add-block')?.addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.add-blocked-form input')
    const dateVal  = inputs[0]?.value
    const labelVal = inputs[1]?.value.trim() || null
    if (!dateVal) return
    await supabase.from('blocked_dates').insert({ client_id: uid, date: dateVal, label: labelVal })
    if (inputs[0]) inputs[0].value = ''
    if (inputs[1]) inputs[1].value = ''
    loadBlockedDates()
  })

})
