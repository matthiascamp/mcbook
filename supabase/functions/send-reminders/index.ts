/**
 * send-reminders
 * ──────────────
 * Sends a 24-hour reminder SMS to all customers with bookings tomorrow.
 * Triggered daily by a GitHub Actions cron workflow.
 *
 * Auth: expects `Authorization: Bearer <CRON_SECRET>` header.
 *
 * Env vars: CRON_SECRET, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 *           TWILIO_FROM_NUMBER, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function fmtTime(hhMM: string) {
  const [h, m] = hhMM.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

async function sendTwilioSMS(to: string, body: string) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')!
  const authToken  = Deno.env.get('TWILIO_AUTH_TOKEN')!
  const from       = Deno.env.get('TWILIO_FROM_NUMBER')!

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    },
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Twilio error: ${err}`)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // Verify cron secret
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || token !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Find all bookings for tomorrow in AEST (UTC+10)
  const nowAEST = new Date(Date.now() + 10 * 60 * 60 * 1000)
  const tomorrowAEST = new Date(nowAEST)
  tomorrowAEST.setUTCDate(tomorrowAEST.getUTCDate() + 1)
  const tomorrowISO = tomorrowAEST.toISOString().slice(0, 10)

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, date, time, clients(business_name), customers(name, phone), services(name)')
    .eq('date', tomorrowISO)
    .in('status', ['scheduled', 'confirmed', 'pending_payment'])

  if (error) {
    console.error('send-reminders DB error:', error)
    return json({ error: error.message }, 500)
  }

  let sent = 0
  const errors: string[] = []

  for (const booking of bookings ?? []) {
    const customer: any = (booking as any).customers
    const client: any   = (booking as any).clients
    const service: any  = (booking as any).services

    const phone = customer?.phone
    if (!phone) continue

    try {
      const cancelUrl = `https://matthiasdev.com/mcbook/cancel.html?id=${(booking as any).id}`
      const dateStr   = fmtDate((booking as any).date)
      const timeStr   = fmtTime((booking as any).time)
      const firstName = (customer?.name || 'there').split(' ')[0]

      const message = [
        `Hi ${firstName}! Reminder: your ${service?.name ?? 'appointment'} at ${client?.business_name ?? 'the business'} is tomorrow.`,
        `📅 ${dateStr} at ${timeStr}`,
        `Need to cancel? ${cancelUrl}`,
      ].join('\n')

      await sendTwilioSMS(phone, message)
      sent++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Booking ${(booking as any).id}: ${msg}`)
      console.error('SMS send error:', msg)
    }
  }

  return json({ sent, errors: errors.length > 0 ? errors : undefined })
})
