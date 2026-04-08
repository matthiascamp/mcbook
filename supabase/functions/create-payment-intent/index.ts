/**
 * create-payment-intent
 * ─────────────────────
 * Creates a Stripe PaymentIntent that routes funds to the seller's connected
 * Stripe account. Optionally deducts a platform fee for McBook.
 *
 * Called by the public booking widget when a customer is ready to pay.
 *
 * POST body (JSON):
 *   bookingId       string   UUID of the booking row in Supabase
 *   clientId        string   UUID of the McBook client (seller)
 *   amountCents     number   Total charge in AUD cents (e.g. 5000 = $50.00)
 *   platformFeeCents number  (optional) Fee to retain on the platform in cents
 *   customerEmail   string   Customer's email for Stripe receipt
 *
 * Returns: { clientSecret: string }
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PLATFORM_FEE_PERCENT   (optional, e.g. "5" for 5%) — overridden by body param
 */

import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno&no-check'
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const {
      bookingId,
      clientId,
      amountCents,
      platformFeeCents,
      customerEmail,
    } = await req.json()

    if (!bookingId || !clientId || !amountCents) {
      return new Response(
        JSON.stringify({ error: 'bookingId, clientId, and amountCents are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Look up the seller's connected Stripe account ─────────────────────────
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('stripe_account_id, stripe_charges_enabled, business_name')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return new Response(
        JSON.stringify({ error: 'Seller not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!client.stripe_account_id || !client.stripe_charges_enabled) {
      return new Response(
        JSON.stringify({ error: 'Seller has not completed payment setup' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Calculate platform fee ────────────────────────────────────────────────
    // Use the fee explicitly sent by the caller, or fall back to the env default.
    let feeCents = platformFeeCents ?? 0
    if (!feeCents) {
      const feePct = parseFloat(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '0')
      feeCents = feePct > 0 ? Math.round(amountCents * (feePct / 100)) : 0
    }

    // ── Create PaymentIntent with destination charge ───────────────────────────
    // The full amount goes to Stripe; Stripe sends (amount − fee) to the seller's
    // bank account on payout, and retains `feeCents` for the platform.
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'aud',
      // Route payment to the seller's connected account
      transfer_data: {
        destination: client.stripe_account_id,
      },
      // Platform fee (set to 0 if you don't want to take a cut)
      ...(feeCents > 0 && { application_fee_amount: feeCents }),
      // Receipt goes to the customer
      receipt_email: customerEmail,
      // Tag with booking ID for reconciliation in webhooks
      metadata: {
        booking_id: bookingId,
        client_id:  clientId,
        platform_fee_cents: feeCents,
      },
      description: `Booking via McBook — ${client.business_name ?? 'McBook'}`,
      automatic_payment_methods: { enabled: true },
    })

    // ── Store the PaymentIntent ID on the booking row ─────────────────────────
    await supabase
      .from('bookings')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', bookingId)

    return new Response(
      JSON.stringify({ clientSecret: paymentIntent.client_secret }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    console.error('create-payment-intent error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
