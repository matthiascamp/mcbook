/**
 * stripe-webhook
 * ──────────────
 * Handles incoming Stripe webhook events. Register this function's URL in your
 * Stripe Dashboard → Developers → Webhooks.
 *
 * Handled events:
 *   payment_intent.succeeded    — mark booking as paid
 *   payment_intent.payment_failed — log failure
 *   charge.refunded             — mark booking as refunded
 *   account.updated             — sync seller verification status to Supabase
 *   payout.paid                 — log successful payout
 *   payout.failed               — log payout failure
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET    whsec_...   (from Stripe Dashboard)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
    apiVersion: '2024-04-10',
    httpClient: Stripe.createFetchHttpClient(),
  })
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ── Verify webhook signature ──────────────────────────────────────────────
  // Try both secrets: platform events use STRIPE_WEBHOOK_SECRET,
  // connected account events use STRIPE_CONNECT_SECRET.
  const sig  = req.headers.get('stripe-signature')
  const body = await req.text()

  const secrets = [
    Deno.env.get('STRIPE_WEBHOOK_SECRET'),
    Deno.env.get('STRIPE_CONNECT_SECRET'),
  ].filter(Boolean) as string[]

  let event: Stripe.Event | null = null
  for (const secret of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, sig!, secret)
      break  // signature matched
    } catch {
      // try next secret
    }
  }

  if (!event) {
    console.error('Webhook signature verification failed for all secrets')
    return new Response('Webhook signature verification failed', { status: 400 })
  }

  console.log(`Received Stripe event: ${event.type} [${event.id}]`)

  try {
    switch (event.type) {

      // ── Payment succeeded: mark booking as paid ─────────────────────────
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent
        const bookingId = pi.metadata?.booking_id
        if (!bookingId) break

        await supabase
          .from('bookings')
          .update({ status: 'scheduled', payment_status: 'paid' })
          .eq('id', bookingId)

        // Log to payments audit table
        await supabase.from('payments').insert({
          booking_id:       bookingId,
          client_id:        pi.metadata?.client_id,
          stripe_charge_id: pi.latest_charge as string ?? null,
          amount:           pi.amount,
          type:             'booking_payment',
        })
        break
      }

      // ── Payment failed: log it ──────────────────────────────────────────
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent
        const bookingId = pi.metadata?.booking_id
        if (!bookingId) break

        await supabase
          .from('bookings')
          .update({ payment_status: 'failed' })
          .eq('id', bookingId)
        break
      }

      // ── Charge refunded ─────────────────────────────────────────────────
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge
        const pi = charge.payment_intent as string

        // Find the booking by PaymentIntent ID
        const { data: booking } = await supabase
          .from('bookings')
          .select('id, client_id')
          .eq('stripe_payment_intent_id', pi)
          .single()

        if (booking) {
          await supabase
            .from('bookings')
            .update({ payment_status: 'refunded', status: 'cancelled' })
            .eq('id', booking.id)

          await supabase.from('payments').insert({
            booking_id:       booking.id,
            client_id:        booking.client_id,
            stripe_charge_id: charge.id,
            amount:           -(charge.amount_refunded ?? charge.amount), // negative = refund
            type:             'refund',
          })
        }
        break
      }

      // ── Connected account updated: sync verification status ─────────────
      // Fires when charges_enabled or payouts_enabled changes on an Express account.
      case 'account.updated': {
        const account = event.data.object as Stripe.Account

        // Look up the seller by their stripe_account_id
        const { data: client } = await supabase
          .from('clients')
          .select('id')
          .eq('stripe_account_id', account.id)
          .single()

        if (!client) break

        // Determine human-readable status
        let status = 'pending'
        if (account.charges_enabled && account.payouts_enabled) {
          status = 'enabled'
        } else if (account.requirements?.disabled_reason) {
          status = 'restricted'
        }

        await supabase
          .from('clients')
          .update({
            stripe_account_status:  status,
            stripe_charges_enabled: account.charges_enabled,
            stripe_payouts_enabled: account.payouts_enabled,
          })
          .eq('id', client.id)

        console.log(`Account ${account.id} → status=${status}`)
        break
      }

      // ── Payout succeeded: log it ─────────────────────────────────────────
      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout
        // Payout events come from the connected account; the account ID is in
        // the event's account field (only present for Connect events).
        const connectedAccountId = (event as any).account as string | undefined

        if (connectedAccountId) {
          // Find the seller
          const { data: client } = await supabase
            .from('clients')
            .select('id')
            .eq('stripe_account_id', connectedAccountId)
            .single()

          if (client) {
            await supabase.from('payments').insert({
              booking_id:       null,               // payouts aren't per-booking
              client_id:        client.id,
              stripe_charge_id: payout.id,
              amount:           payout.amount,
              type:             'payout',
            })
          }
        }
        break
      }

      // ── Payout failed: log it ────────────────────────────────────────────
      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout
        const connectedAccountId = (event as any).account as string | undefined
        console.warn(`Payout ${payout.id} failed for account ${connectedAccountId}: ${payout.failure_message}`)
        // TODO: notify the seller that their bank details need updating
        break
      }

      default:
        // Unhandled event type — not an error, just ignore
        console.log(`Unhandled event type: ${event.type}`)
    }
  } catch (err) {
    console.error(`Error processing ${event.type}:`, err)
    // Return 200 so Stripe doesn't retry — we already logged the error.
    // If you want retries, return 500 here instead.
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
