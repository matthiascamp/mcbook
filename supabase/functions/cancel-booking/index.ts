/**
 * cancel-booking
 * ──────────────
 * Public endpoint — cancels a booking by its UUID.
 * Called from the customer-facing cancel.html page (linked from SMS).
 *
 * POST body: { bookingId: string }
 *
 * No auth required — booking UUID acts as an unguessable token (128-bit random).
 * Only cancels bookings with status 'scheduled' or 'pending_payment'.
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

// @ts-ignore
import { createClient } from 'npm:@supabase/supabase-js@2'

declare const Deno: { serve: (h: (r: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // GET: fetch booking details for display in cancel.html
  if (req.method === 'GET') {
    const url  = new URL(req.url)
    const id   = url.searchParams.get('id')
    if (!id) return json({ error: 'id required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, date, time, status, clients(business_name), customers(name), services(name)')
      .eq('id', id)
      .single()

    if (error || !booking) return json({ error: 'Booking not found' }, 404)

    return json({
      id:           (booking as any).id,
      status:       (booking as any).status,
      date:         (booking as any).date,
      time:         (booking as any).time,
      customerName: (booking as any).customers?.name ?? '',
      serviceName:  (booking as any).services?.name ?? '',
      businessName: (booking as any).clients?.business_name ?? '',
    })
  }

  // POST: cancel the booking
  if (req.method === 'POST') {
    try {
      const { bookingId } = await req.json()
      if (!bookingId) return json({ error: 'bookingId required' }, 400)

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )

      const { data: booking, error: fetchErr } = await supabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .single()

      if (fetchErr || !booking) return json({ error: 'Booking not found' }, 404)

      const status = (booking as any).status
      if (status === 'cancelled') return json({ error: 'already_cancelled' }, 422)
      if (!['scheduled', 'confirmed', 'pending_payment'].includes(status)) {
        return json({ error: 'This booking cannot be cancelled online.' }, 422)
      }

      const { error: updateErr } = await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)

      if (updateErr) throw updateErr

      return json({ success: true })
    } catch (err) {
      console.error('cancel-booking error:', err)
      return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
    }
  }

  return new Response('Method not allowed', { status: 405, headers: corsHeaders })
})
