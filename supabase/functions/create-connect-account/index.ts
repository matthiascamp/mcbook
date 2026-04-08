/**
 * create-connect-account
 * ─────────────────────
 * Standard Connect: exchanges a Stripe OAuth code for the seller's connected
 * account ID and saves it to Supabase. Called from stripe-oauth-callback.html
 * after Stripe redirects the seller back with ?code=...
 *
 * POST body (JSON):
 *   code   string   The OAuth authorisation code from Stripe (ac_...)
 *
 * Returns: { accountId: string }
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY          sk_live_... or sk_test_...
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const { code } = await req.json()

    if (!code) {
      return new Response(JSON.stringify({ error: 'Missing OAuth code' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Exchange OAuth code for connected account ID ───────────────────────────
    // Stripe returns the seller's stripe_user_id — this is their account ID.
    // The seller may have used an existing Stripe account or created a new one.
    const oauthResponse = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    })

    const accountId = oauthResponse.stripe_user_id!

    // ── Fetch account details to confirm it's valid ───────────────────────────
    const account = await stripe.accounts.retrieve(accountId)

    // ── Save to Supabase ──────────────────────────────────────────────────────
    await supabase
      .from('clients')
      .update({
        stripe_account_id:      accountId,
        stripe_account_status:  account.charges_enabled && account.payouts_enabled
                                  ? 'enabled' : 'pending',
        stripe_charges_enabled: account.charges_enabled,
        stripe_payouts_enabled: account.payouts_enabled,
      })
      .eq('id', user.id)

    console.log(`Connected Standard account ${accountId} for user ${user.id}`)

    return new Response(JSON.stringify({ accountId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('create-connect-account error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
