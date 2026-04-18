import { supabase } from './supabase.js'

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signUp(email, password, businessName, businessMode) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { business_name: businessName, business_mode: businessMode || 'service' } }
  })
}

// Creates the clients row on first login if it doesn't exist yet
export async function ensureClientProfile(uid, businessName, businessMode) {
  const { data: existing, error: selectErr } = await supabase
    .from('clients')
    .select('id')
    .eq('id', uid)
    .maybeSingle()

  if (selectErr) {
    console.error('[MCBook] clients select failed:', selectErr.message)
    return
  }

  if (!existing) {
    const { error: insertErr } = await supabase.from('clients').insert({
      id:            uid,
      business_name: businessName || 'My Business',
      business_mode: businessMode || 'service',
    })
    if (insertErr) {
      console.error('[MCBook] clients insert failed:', insertErr.message)
      return
    }
    // Seed a default bookable service so the widget works immediately
    if (businessMode === 'restaurant') {
      await supabase.from('services').insert({
        client_id: uid, name: 'Table Booking', duration_mins: 60,
        price: 0, noshow_fee: 0, payment_mode: 'free', active: true,
      })
    }
  }
}

export async function resetPassword(email) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/mcbook/login.html`
  })
}

export async function signOut() {
  await supabase.auth.signOut()
  window.location.href = 'login.html'
}

export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

export async function requireAuth() {
  const session = await getSession()
  if (!session) {
    window.location.href = 'login.html'
    return false
  }
  return session
}
