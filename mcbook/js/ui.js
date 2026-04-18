import { supabase } from './supabase.js'

const DAYS  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function setTopbarDate() {
  const d = new Date()
  const str = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  document.querySelectorAll('.topbar-date').forEach(el => el.textContent = str)
}

export async function loadSidebarUser(uid) {
  const { data } = await supabase.from('clients').select('business_name, business_mode').eq('id', uid).maybeSingle()
  if (!data) return
  const name = data.business_name || ''
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  document.querySelectorAll('.sidebar-user-name').forEach(el => el.textContent = name)
  document.querySelectorAll('.sidebar-avatar').forEach(el => el.textContent = initials)
  if (data.business_mode === 'restaurant') {
    document.querySelectorAll('a[href="services.html"]').forEach(el => {
      el.querySelector('.nav-icon').textContent = '🍽️'
      el.childNodes[el.childNodes.length - 1].textContent = ' Seating'
    })
  }
}
