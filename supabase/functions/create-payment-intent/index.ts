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
 *   customerEmail   string   Customer's email for Stripe receipt (optional)
 *
 * Amount and platform fee are computed server-side from the booking row's
 * service price + the seller's clients.platform_fee_percent. Any amount/fee
 * values in the request body are IGNORED — the client cannot set their own price.
 *
 * Returns: { clientSecret: string }
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PLATFORM_FEE_PERCENT   (fallback if clients.platform_fee_percent is null)
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

    const { bookingId, customerEmail } = await req.json()

    if (!bookingId) {
      return new Response(
        JSON.stringify({ error: 'bookingId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Load the booking + its service so we know the authoritative price ─────
    // Never trust the client for an amount — the widget runs in the public
    // browser and could be tampered with.
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('id, client_id, service_id, stripe_payment_intent_id, services(price)')
      .eq('id', bookingId)
      .single()

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ error: 'Booking not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const servicePrice = Number((booking as any).services?.price ?? 0)
    if (!servicePrice || servicePrice <= 0) {
      return new Response(
        JSON.stringify({ error: 'Booking has no payable service price' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    const amountCents = Math.round(servicePrice * 100)
    const clientId    = booking.client_id

    // ── Look up the seller's connected Stripe account + fee % ────────────────
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('stripe_account_id, stripe_charges_enabled, business_name, platform_fee_percent')
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

    // ── Calculate platform fee server-side ────────────────────────────────────
    const perClientPct = Number((client as any).platform_fee_percent)
    const envPct       = parseFloat(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '0')
    const feePct       = Number.isFinite(perClientPct) && perClientPct > 0 ? perClientPct : envPct
    const feeCents     = feePct > 0 ? Math.round(amountCents * (feePct / 100)) : 0

    // ── Create PaymentIntent with destination charge ───────────────────────────
    // The full amount goes to Stripe; Stripe sends (amount − fee) to the seller's
    // bank account on payout, and retains `feeCents` for the platform.
    // Idempotency key keyed on bookingId prevents duplicate intents on retries /
    // double-clicks — Stripe will return the same intent for repeat calls.
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
    }, {
      idempotencyKey: `pi-booking-${bookingId}`,
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
