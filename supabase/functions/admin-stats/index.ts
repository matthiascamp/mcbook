/**
 * admin-stats
 * ───────────
 * Returns platform-wide statistics for the MCBook admin dashboard.
 * Restricted to matthiasdevelopment@gmail.com only.
 *
 * GET — no body required
 *
 * Environment variables required:
 *   SUPABASE_URL
 *   SERVICE_ROLE_KEY
 */

// @ts-ignore – npm: specifier is valid in Deno Edge Runtime
import { createClient } from 'npm:@supabase/supabase-js@2'

// Deno global — available in Supabase Edge Runtime
declare const Deno: { serve: (h: (r: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } }

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

    // ── Parallel top-level queries ────────────────────────────────────────────
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

    const [
      { data: clients,     error: clientsErr },
      { data: allPayments, error: paymentsErr },
      { count: bookingsThisMonth },
    ] = await Promise.all([
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('payments').select('amount, client_id, booking_id'),
      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', monthStart)
        .lt('created_at', monthEnd),
    ])

    if (clientsErr) throw new Error(`clients query: ${clientsErr.message}`)
    if (paymentsErr) console.warn('payments query failed (table may not exist yet):', paymentsErr.message)

    // ── Aggregate payments (amounts stored in cents — divide by 100 for dollars) ──
    const earningsByClient: Record<string, number> = {}
    const amountByBooking: Record<string, number> = {}

    for (const p of allPayments ?? []) {
      const amt = Number(p.amount ?? 0) / 100  // cents → dollars
      earningsByClient[p.client_id] = (earningsByClient[p.client_id] ?? 0) + amt
      if (p.booking_id) {
        amountByBooking[p.booking_id] = (amountByBooking[p.booking_id] ?? 0) + amt
      }
    }

    const totalRevenue: number = Object.values(earningsByClient).reduce((s, v) => s + v, 0)

    const totalClients         = (clients ?? []).length
    const activeStripeAccounts = (clients ?? []).filter((c: { stripe_charges_enabled: boolean }) => c.stripe_charges_enabled).length

    // ── Per-client detail ─────────────────────────────────────────────────────
    const clientsData = await Promise.all((clients ?? []).map(async (client: any) => {
      const [
        { count: bookingCount },
        { data: recentRaw },
      ] = await Promise.all([
        supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('client_id', client.id),
        supabase
          .from('bookings')
          .select('id, date, status, payment_status, customers(name), services(name)')
          .eq('client_id', client.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      const totalEarnings = earningsByClient[client.id] ?? 0
      const feePct        = Number(client.platform_fee_percent ?? 3.00)
      const myRevenue     = totalEarnings * (feePct / 100)

      const recentBookings = (recentRaw ?? []).map((b: any) => ({
        id:             b.id,
        customer_name:  b.customers?.name  ?? 'Unknown',
        service_name:   b.services?.name   ?? 'Unknown',
        date:           b.date,
        amount:         amountByBooking[b.id] ?? 0,
        status:         b.status,
        payment_status: b.payment_status,
      }))

      return {
        id:                    client.id,
        business_name:         client.business_name,
        email:                 client.email,
        created_at:            client.created_at,
        stripe_charges_enabled: client.stripe_charges_enabled,
        stripe_payouts_enabled: client.stripe_payouts_enabled,
        stripe_account_status:  client.stripe_account_status,
        platform_fee_percent:   feePct,
        widget_custom_styling:  client.widget_custom_styling ?? false,
        totalEarnings,
        myRevenue,
        bookingCount:   bookingCount ?? 0,
        recentBookings,
      }
    }))

    return json({
      totalClients,
      totalRevenue,
      activeStripeAccounts,
      bookingsThisMonth: bookingsThisMonth ?? 0,
      clients: clientsData,
    })

  } catch (err) {
    console.error('admin-stats error:', err)
    return json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      500,
    )
  }
})
