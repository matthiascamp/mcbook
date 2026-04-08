/**
 * admin-update-client
 * ───────────────────
 * Updates a client's platform_fee_percent.
 * Restricted to matthiasdevelopment@gmail.com only.
 *
 * POST body: { client_id: string, platform_fee_percent: number }
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
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }
    if (user.email !== ADMIN_EMAIL) {
      return json({ error: 'Forbidden' }, 403)
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    const body = await req.json().catch(() => null)
    if (!body) {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const { client_id, platform_fee_percent, widget_custom_styling } = body

    if (!client_id || typeof client_id !== 'string') {
      return json({ error: 'client_id is required' }, 400)
    }

    const updatePayload: Record<string, unknown> = {}

    if (platform_fee_percent !== undefined) {
      const fee = Number(platform_fee_percent)
      if (isNaN(fee) || fee < 0 || fee > 100) {
        return json({ error: 'platform_fee_percent must be a number between 0 and 100' }, 400)
      }
      updatePayload.platform_fee_percent = fee
    }

    if (widget_custom_styling !== undefined) {
      updatePayload.widget_custom_styling = Boolean(widget_custom_styling)
    }

    if (Object.keys(updatePayload).length === 0) {
      return json({ error: 'No fields to update' }, 400)
    }

    // ── Update ────────────────────────────────────────────────────────────────
    const { error: updateErr } = await supabase
      .from('clients')
      .update(updatePayload)
      .eq('id', client_id)

    if (updateErr) {
      throw new Error(updateErr.message)
    }

    return json({ success: true })

  } catch (err) {
    console.error('admin-update-client error:', err)
    return json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500,
    )
  }
})
