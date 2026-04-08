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
    .select('stripe_charges_enabled').eq('id', uid).single()
  stripeEnabled = clientData?.stripe_charges_enabled ?? false

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
})
