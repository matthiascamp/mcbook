import { supabase } from './supabase.js'

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signUp(email, password, businessName) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { business_name: businessName } }
  })
}

// Creates the clients row on first login if it doesn't exist yet
export async function ensureClientProfile(uid, businessName) {
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
    })
    if (insertErr) {
      console.error('[MCBook] clients insert failed:', insertErr.message)
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
