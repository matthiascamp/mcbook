/**
 * admin-create-client
 * ───────────────────
 * Creates a new client account (auth user + clients row).
 * Restricted to matthiasdevelopment@gmail.com only.
 *
 * POST body: {
 *   email:                string   (required)
 *   password:             string   (required, min 8 chars)
 *   business_name:        string   (required)
 *   business_mode?:       'service' | 'restaurant'  (default: 'service')
 *   platform_fee_percent?: number  (default: 0.1)
 * }
 *
 * The auth user is pre-confirmed — client can log in immediately.
 *
 * Environment variables required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ADMIN_EMAIL = 'matthiasdevelopment@gmail.com'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    // ── Auth check (admin only) ───────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)
    if (user.email !== ADMIN_EMAIL) return json({ error: 'Forbidden' }, 403)

    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    // ── Parse & validate body ─────────────────────────────────────────────────
    const body = await req.json().catch(() => null)
    if (!body) return json({ error: 'Invalid JSON body' }, 400)

    const { email, password, business_name, business_mode, platform_fee_percent } = body

    if (!email || typeof email !== 'string') {
      return json({ error: 'email is required' }, 400)
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return json({ error: 'password must be at least 8 characters' }, 400)
    }
    if (!business_name || typeof business_name !== 'string' || !business_name.trim()) {
      return json({ error: 'business_name is required' }, 400)
    }

    const fee = platform_fee_percent !== undefined ? Number(platform_fee_percent) : 0.1
    if (isNaN(fee) || fee < 0 || fee > 100) {
      return json({ error: 'platform_fee_percent must be between 0 and 100' }, 400)
    }

    const cleanEmail = email.toLowerCase().trim()
    const cleanName  = business_name.trim()
    const mode       = business_mode === 'restaurant' ? 'restaurant' : 'service'

    // ── Create auth user (email pre-confirmed) ────────────────────────────────
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: {
        business_name: cleanName,
        business_mode: mode,
      },
    })

    if (createErr) return json({ error: createErr.message }, 400)

    const uid = created.user.id

    // ── Insert clients row ────────────────────────────────────────────────────
    const { error: insertErr } = await supabase.from('clients').insert({
      id:                   uid,
      business_name:        cleanName,
      email:                cleanEmail,
      business_mode:        mode,
      platform_fee_percent: fee,
    })

    if (insertErr) {
      // Roll back auth user so we don't orphan it
      await supabase.auth.admin.deleteUser(uid)
      return json({ error: `Client profile creation failed: ${insertErr.message}` }, 500)
    }

    return json({ success: true, client_id: uid })

  } catch (err) {
    console.error('admin-create-client error:', err)
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500)
  }
})
