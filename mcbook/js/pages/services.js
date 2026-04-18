import { supabase } from '../supabase.js'
import { getSession } from '../auth.js'
import { setTopbarDate, loadSidebarUser } from '../ui.js'

const DOTS = ['dot-blue', 'dot-purple', 'dot-amber', 'dot-green']

const PMODE_LABELS = {
  free:        'Not collected through website',
  noshow_only: 'Not collected through website',
  after:       'Charge after appointment',
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function durationToMins(s) {
  if (s.includes('1.5')) return 90
  if (s.includes('2 h')) return 120
  if (s.includes('1 h')) return 60
  return parseInt(s) || 30
}
function minsLabel(m) {
  if (m < 60) return `${m} minutes`
  if (m === 60) return '1 hour'
  if (m === 90) return '1.5 hours'
  if (m === 120) return '2 hours'
  return `${m} min`
}
function durationSelectValue(mins) {
  const map = { 15: '15 min', 20: '20 min', 30: '30 min', 45: '45 min',
                60: '1 hour', 90: '1.5 hours', 120: '2 hours' }
  return map[mins] ?? '30 min'
}

// ── State ─────────────────────────────────────────────────────────────────────
let uid = ''
let editId = null
let stripeEnabled = false
let isRestaurant = false

// ── Render ────────────────────────────────────────────────────────────────────
async function loadServices() {
  const { data, error } = await supabase.from('services')
    .select('*').eq('client_id', uid).order('created_at', { ascending: true })
  if (error) { console.error(error); return }

  const list = document.querySelector('.services-list')
  list.innerHTML = ''
  ;(data ?? []).forEach((svc, i) => {
    const card = document.createElement('div')
    card.className = 'service-card'
    card.dataset.serviceId = svc.id
    card.innerHTML = `
      <div class="service-card-main">
        <div class="service-dot ${DOTS[i % 4]}">&#9986;</div>
        <div class="service-info">
          <div class="service-name">${svc.name}</div>
          <div class="service-tags">
            <span class="service-tag">${minsLabel(svc.duration_mins)}</span>
            <span class="service-tag price">$${Number(svc.price).toFixed(2)}</span>
            <span class="service-tag nosho">No-show: $${Number(svc.noshow_fee).toFixed(2)}</span>
            <span class="service-tag">${PMODE_LABELS[svc.payment_mode] ?? 'No-show protection'}</span>
          </div>
        </div>
        <div class="service-actions">
          <div class="service-active-toggle">
            <label class="toggle">
              <input type="checkbox" class="toggle-active" ${svc.active ? 'checked' : ''}>
              <span class="toggle-track"></span>
              <span class="toggle-thumb"></span>
            </label>
            ${svc.active ? 'Active' : 'Inactive'}
          </div>
          <div class="service-edit-btns">
            <button class="btn-edit">Edit</button>
            <button class="btn-delete">Delete</button>
          </div>
        </div>
      </div>
    `
    list.appendChild(card)
  })
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const session = await getSession()
  if (!session) return
  uid = session.user.id
  setTopbarDate()
  loadSidebarUser(uid)

  const { data: clientData } = await supabase.from('clients')
    .select('stripe_charges_enabled, business_mode').eq('id', uid).single()
  stripeEnabled = clientData?.stripe_charges_enabled ?? false
  isRestaurant  = clientData?.business_mode === 'restaurant'

  const capacityPanel = document.getElementById('capacity-panel')
  if (isRestaurant) {
    // Topbar
    document.querySelector('.topbar-title').textContent = 'Seating'
    document.querySelector('.topbar-right .btn-primary').style.display = 'none'
    // Sidebar label
    const svcLink = document.querySelector('.nav-link.active')
    if (svcLink) svcLink.innerHTML = svcLink.innerHTML.replace('Services', 'Seating')
    // Show seating panel
    if (capacityPanel) capacityPanel.style.display = 'block'
    await loadSeatingAreas()
  } else {
    // Reveal service UI (hidden by default to prevent flash)
    document.querySelector('.services-list').style.display = ''
    document.querySelector('.add-service-panel').style.display = ''
  }

  await loadServices()

  const list   = document.querySelector('.services-list')
  const panel  = document.querySelector('.add-service-panel')
  const textInputs = panel.querySelectorAll('input[type="text"]')
  const nameInput  = textInputs[0]
  const descInput  = textInputs[1]
  const durSelect   = panel.querySelector('select')
  const pmodeSelect = panel.querySelector('#svc-pmode')
  const priceInput  = panel.querySelector('#svc-price')
  const noshowInput = panel.querySelector('#svc-noshow')
  const saveBtn     = panel.querySelector('.btn-primary')
  const cancelBtn   = panel.querySelector('.btn-cancel')

  function getNumInputs() { return panel.querySelectorAll('input[type="number"]') }

  function syncPriceFields() {
    const locked = pmodeSelect.value === 'free'
    document.getElementById('field-price').classList.toggle('field-locked', locked)
    document.getElementById('field-noshow').classList.toggle('field-locked', locked)
    if (locked) { priceInput.value = ''; noshowInput.value = '' }
  }

  pmodeSelect.addEventListener('change', () => {
    if (pmodeSelect.value !== 'free' && !stripeEnabled) {
      pmodeSelect.value = 'free'
      alert('You need to connect Stripe before enabling online payments.\nGo to Payouts in the sidebar to set it up.')
    }
    syncPriceFields()
  })
  syncPriceFields()

  function clearForm() {
    nameInput.value = ''; descInput.value = ''
    priceInput.value = ''; noshowInput.value = ''
    durSelect.value = '30 min'; pmodeSelect.value = 'free'; editId = null
    syncPriceFields()
  }

  // Delegate: toggle active
  list.addEventListener('change', async e => {
    const toggle = e.target.closest('.toggle-active')
    if (!toggle) return
    const card   = toggle.closest('.service-card')
    const active = toggle.checked
    const label  = card.querySelector('.service-active-toggle')
    label.lastChild.textContent = active ? ' Active' : ' Inactive'
    await supabase.from('services').update({ active }).eq('id', card.dataset.serviceId)
  })

  // Delegate: delete / edit
  list.addEventListener('click', async e => {
    const card = e.target.closest('.service-card')
    if (!card) return
    const id = card.dataset.serviceId

    if (e.target.closest('.btn-delete')) {
      if (!window.confirm('Delete this service?')) return
      await supabase.from('services').delete().eq('id', id)
      await loadServices()
      return
    }

    if (e.target.closest('.btn-edit')) {
      const { data } = await supabase.from('services').select('*').eq('id', id).single()
      if (!data) return
      nameInput.value = data.name
      descInput.value = data.description ?? ''
      durSelect.value   = durationSelectValue(data.duration_mins)
      pmodeSelect.value = data.payment_mode ?? 'after'
      priceInput.value  = data.price
      noshowInput.value = data.noshow_fee
      editId = id
      syncPriceFields()
      panel.scrollIntoView({ behavior: 'smooth' })
    }
  })

  // Save service (insert or update)
  saveBtn.addEventListener('click', async () => {
    const payload = {
      name: nameInput.value.trim(),
      description: descInput.value.trim() || null,
      duration_mins: durationToMins(durSelect.value),
      price: parseFloat(priceInput.value) || 0,
      noshow_fee: parseFloat(noshowInput.value) || 0,
      payment_mode: pmodeSelect.value || 'free',
    }
    if (!payload.name) return

    if (editId) {
      await supabase.from('services').update(payload).eq('id', editId)
    } else {
      await supabase.from('services').insert({ ...payload, client_id: uid, active: true })
    }
    clearForm()
    await loadServices()
  })

  cancelBtn.addEventListener('click', clearForm)

  document.getElementById('btn-add-seating')?.addEventListener('click', async () => {
    const nameVal = document.getElementById('seating-name-input')?.value.trim()
    const capVal  = parseInt(document.getElementById('seating-cap-input')?.value || '0', 10)
    if (!nameVal || !capVal || capVal < 1) { alert('Please enter an area name and capacity.'); return }
    const { error: insErr } = await supabase.from('seating_areas').insert({ client_id: uid, name: nameVal, capacity: capVal })
    if (insErr) { console.error('[seating_areas insert]', insErr.message, insErr); alert('Error saving: ' + insErr.message); return }
    document.getElementById('seating-name-input').value = ''
    document.getElementById('seating-cap-input').value  = ''
    await loadSeatingAreas()
  })
})

async function loadSeatingAreas() {
  const { data, error } = await supabase.from('seating_areas')
    .select('*').eq('client_id', uid).eq('active', true).order('created_at', { ascending: true })
  if (error) { console.error('[seating_areas fetch]', error.message, error); return }
  console.log('[seating_areas]', data)
  const list = document.getElementById('seating-list')
  if (!list) return
  list.innerHTML = ''

  for (const area of data ?? []) {
    const div = document.createElement('div')
    div.className = 'seating-item'
    div.dataset.areaId = area.id

    // ── View row ──
    const view = document.createElement('div')
    view.className = 'seating-item-view'
    view.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;'
    view.innerHTML = `
      <div class="seating-item-left">
        <span style="font-size:1.1rem;">&#127869;&#65039;</span>
        <div>
          <div class="seating-name">${area.name}</div>
          <div class="seating-cap">${area.capacity} seats</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn-edit-area"
          style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.35);color:var(--accent);cursor:pointer;font-size:0.78rem;font-weight:600;font-family:inherit;padding:5px 12px;border-radius:6px;">Edit</button>
        <button class="btn-remove-area"
          style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.35);color:#ef4444;cursor:pointer;font-size:0.78rem;font-weight:600;font-family:inherit;padding:5px 12px;border-radius:6px;" title="Delete">Delete</button>
      </div>
    `

    // ── Edit row (hidden initially) ──
    const editRow = document.createElement('div')
    editRow.style.cssText = 'display:none;align-items:center;gap:8px;flex-wrap:wrap;width:100%;'
    const nameInp = document.createElement('input')
    nameInp.type = 'text'; nameInp.value = area.name
    nameInp.style.cssText = 'flex:1;min-width:110px;padding:8px 11px;border:1px solid var(--accent);border-radius:6px;font-size:0.88rem;font-family:inherit;color:var(--text);background:var(--surface-2);outline:none;'
    const capInp = document.createElement('input')
    capInp.type = 'number'; capInp.value = area.capacity; capInp.min = '1'; capInp.max = '9999'
    capInp.style.cssText = 'width:90px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.88rem;font-family:inherit;color:var(--text);background:var(--surface-2);outline:none;text-align:center;'
    const saveBtn = document.createElement('button')
    saveBtn.textContent = 'Save'
    saveBtn.style.cssText = 'padding:7px 14px;background:var(--accent);color:#050a08;border:none;border-radius:6px;font-size:0.82rem;font-weight:700;font-family:inherit;cursor:pointer;'
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText = 'padding:7px 12px;background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-2);font-size:0.82rem;font-family:inherit;cursor:pointer;'
    const editBtns = document.createElement('div')
    editBtns.style.cssText = 'display:flex;gap:6px;flex-shrink:0;'
    editBtns.append(saveBtn, cancelBtn)
    editRow.append(nameInp, capInp, editBtns)

    div.append(view, editRow)
    list.appendChild(div)

    // ── Wire up buttons directly ──
    view.querySelector('.btn-edit-area').addEventListener('click', () => {
      view.style.display = 'none'
      editRow.style.display = 'flex'
      nameInp.focus()
    })

    view.querySelector('.btn-remove-area').addEventListener('click', async () => {
      if (!confirm('Delete this seating area?')) return
      await supabase.from('seating_areas').delete().eq('id', area.id)
      await loadSeatingAreas()
    })

    cancelBtn.addEventListener('click', () => {
      nameInp.value = area.name
      capInp.value  = area.capacity
      editRow.style.display = 'none'
      view.style.display = 'flex'
    })

    saveBtn.addEventListener('click', async () => {
      const nameVal = nameInp.value.trim()
      const capVal  = parseInt(capInp.value, 10)
      if (!nameVal || capVal < 1) return
      saveBtn.textContent = 'Saving…'; saveBtn.disabled = true
      await supabase.from('seating_areas').update({ name: nameVal, capacity: capVal }).eq('id', area.id)
      await loadSeatingAreas()
    })
  }
}
