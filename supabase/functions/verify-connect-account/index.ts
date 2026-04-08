/**
 * verify-connect-account
 * ──────────────────────
 * Returns the current Stripe verification status for the authenticated seller's
 * connected account. Used by stripe-onboarding.html and stripe-return.html to
 * show whether the seller is fully approved for charges and payouts.
 *
 * GET (no body required — derives account from the authenticated user)
 *
 * Returns:
 *   {
 *     accountId:       string
 *     chargesEnabled:  boolean
 *     payoutsEnabled:  boolean
 *     status:          "pending" | "restricted" | "enabled"
 *     requirements:    string[]   — list of outstanding requirements
 *     dashboardUrl:    string | null  — Stripe Express dashboard login link
 *   }
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY
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

    // ── Look up the seller's connected account ID ─────────────────────────────
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('stripe_account_id')
      .eq('id', user.id)
      .single()

    if (clientError || !client?.stripe_account_id) {
      return new Response(
        JSON.stringify({ accountId: null, chargesEnabled: false, payoutsEnabled: false, status: 'none' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const accountId = client.stripe_account_id

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // ── Fetch live account data from Stripe ───────────────────────────────────
    const account = await stripe.accounts.retrieve(accountId)

    // Debug log so we can inspect the raw Stripe response in Supabase logs
    console.log('Stripe account:', JSON.stringify({
      id:               account.id,
      charges_enabled:  account.charges_enabled,
      payouts_enabled:  account.payouts_enabled,
      disabled_reason:  account.requirements?.disabled_reason,
      currently_due:    account.requirements?.currently_due,
      past_due:         account.requirements?.past_due,
      eventually_due:   account.requirements?.eventually_due,
      fut_currently_due:(account as any).future_requirements?.currently_due,
      fut_past_due:     (account as any).future_requirements?.past_due,
    }))

    // Collect outstanding requirements
    const reqs: string[] = [
      ...(account.requirements?.currently_due  ?? []),
      ...(account.requirements?.past_due       ?? []),
      ...(account.requirements?.errors?.map((e) => e.requirement) ?? []),
    ]

    // Determine status
    // 'enabled'    = charges + payouts both on
    // 'restricted' = has any outstanding requirements (currently_due, past_due, or disabled)
    // 'pending'    = no requirements left but Stripe still reviewing (rare)
    const anyDue =
      (account.requirements?.currently_due?.length ?? 0) > 0 ||
      (account.requirements?.past_due?.length       ?? 0) > 0 ||
      (account.requirements?.eventually_due?.length ?? 0) > 0

    let status: 'pending' | 'restricted' | 'enabled' = 'pending'
    if (account.charges_enabled && account.payouts_enabled) {
      status = 'enabled'
    } else if (account.requirements?.disabled_reason || anyDue) {
      // Account has outstanding items OR is explicitly disabled — needs action
      status = 'restricted'
    }

    // ── Keep Supabase in sync ─────────────────────────────────────────────────
    await supabase
      .from('clients')
      .update({
        stripe_account_status:  status,
        stripe_charges_enabled: account.charges_enabled,
        stripe_payouts_enabled: account.payouts_enabled,
      })
      .eq('id', user.id)

    // ── Generate dashboard link ───────────────────────────────────────────────
    // Express accounts get a single-use login link via the API.
    // Standard accounts manage their own Stripe dashboard — just link to stripe.com.
    let dashboardUrl: string | null = null
    try {
      const loginLink = await stripe.accounts.createLoginLink(accountId)
      dashboardUrl = loginLink.url  // Express: direct login link
    } catch {
      // Standard accounts don't support createLoginLink — fall back to stripe.com
      dashboardUrl = 'https://dashboard.stripe.com'
    }

    return new Response(
      JSON.stringify({
        accountId,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        status,
        requirements:   reqs,
        dashboardUrl,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    console.error('verify-connect-account error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
