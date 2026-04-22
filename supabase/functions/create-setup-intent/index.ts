/**
 * create-setup-intent
 * ───────────────────
 * Creates a Stripe SetupIntent so the booking widget can collect and save
 * a customer's card before the booking is confirmed.
 *
 * Called by the public booking widget when a customer reaches the payment step.
 *
 * POST body (JSON):
 *   bookingData.customerId     string   UUID of the customer row in Supabase
 *   bookingData.serviceId      string   UUID of the service being booked
 *   bookingData.clientId       string   UUID of the McBook client (seller)
 *   bookingData.customerEmail  string   Customer's email address
 *   bookingData.customerName   string   Customer's full name
 *
 * Returns: { clientSecret: string }
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-ignore
import Stripe from 'npm:stripe@13'
// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2'

declare const Deno: { serve: (h: (r: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } }

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

    const { bookingData } = await req.json()
    const { customerId, serviceId, clientId, customerEmail, customerName } = bookingData ?? {}

    if (!clientId || !customerEmail) {
      return new Response(
        JSON.stringify({ error: 'clientId and customerEmail are required' }),
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
        JSON.stringify({ error: 'Seller has not completed Stripe payment setup' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Create a SetupIntent to save the card for later charging ─────────────
    const setupIntent = await stripe.setupIntents.create({
      payment_method_types: ['card'],
      on_behalf_of: client.stripe_account_id,
      usage: 'off_session',
      metadata: {
        customer_id:    customerId   ?? '',
        service_id:     serviceId    ?? '',
        client_id:      clientId,
        customer_email: customerEmail,
        customer_name:  customerName ?? '',
      },
    })

    return new Response(
      JSON.stringify({ clientSecret: setupIntent.client_secret }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    console.error('create-setup-intent error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
