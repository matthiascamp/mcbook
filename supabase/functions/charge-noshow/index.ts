/**
 * charge-noshow
 * ─────────────
 * Charges a no-show fee from a customer's saved payment method and marks
 * the booking as no_show. Only charges the service's noshow_fee — not the
 * full service price.
 *
 * POST body (JSON):
 *   bookingId   string   UUID of the booking
 *
 * Called by the bookings page when the client clicks "No-show + Charge".
 * Requires the booking to have a saved payment_method_id (card saved via SetupIntent).
 */

// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2'
// @ts-ignore
import Stripe from 'npm:stripe@13'

declare const Deno: { serve: (h: (r: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '').trim()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify auth
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { bookingId } = await req.json()
    if (!bookingId) return json({ error: 'bookingId required' }, 400)

    // Get booking with service info
    const { data: booking, error: bookErr } = await supabase
      .from('bookings')
      .select('id, client_id, payment_method_id, status, services(noshow_fee, payment_mode)')
      .eq('id', bookingId)
      .single()

    if (bookErr || !booking) return json({ error: 'Booking not found' }, 404)
    if (booking.client_id !== user.id) return json({ error: 'Forbidden' }, 403)
    if (booking.status !== 'scheduled' && booking.status !== 'pending_payment') {
      return json({ error: 'Booking is not in a chargeable state' }, 422)
    }

    const service = booking.services as any

    if (!booking.payment_method_id) {
      return json({ error: 'No payment method saved for this booking' }, 422)
    }

    const noShowFeeCents = Math.round(parseFloat(service?.noshow_fee ?? '0') * 100)
    if (noShowFeeCents <= 0) {
      // No fee configured — just mark as no_show without charging
      await supabase.from('bookings').update({ status: 'no_show' }).eq('id', bookingId)
      return json({ success: true })
    }

    // Get client's connected Stripe account
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('stripe_account_id, stripe_charges_enabled')
      .eq('id', booking.client_id)
      .single()

    if (clientErr || !client?.stripe_account_id || !client.stripe_charges_enabled) {
      return json({ error: 'Stripe account not configured or not enabled' }, 422)
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-04-10',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // Charge only the no-show fee from the saved card
    const paymentIntent = await stripe.paymentIntents.create({
      amount:           noShowFeeCents,
      currency:         'aud',
      payment_method:   booking.payment_method_id,
      confirm:          true,
      transfer_data:    { destination: client.stripe_account_id },
      metadata:         { booking_id: bookingId, client_id: booking.client_id, type: 'noshow_fee' },
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    })

    // Update booking status
    await supabase.from('bookings').update({ status: 'no_show' }).eq('id', bookingId)

    // Record the charge in payments table
    await supabase.from('payments').insert({
      booking_id:       bookingId,
      client_id:        booking.client_id,
      stripe_charge_id: paymentIntent.latest_charge as string ?? null,
      amount:           noShowFeeCents,
      type:             'noshow_fee',
    })

    return json({ success: true })
  } catch (err) {
    console.error('charge-noshow error:', err)
    return json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500)
  }
})
