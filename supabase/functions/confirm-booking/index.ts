/**
 * confirm-booking
 * ───────────────
 * Sends a booking confirmation SMS to the customer via Twilio.
 * Called by the public booking widget immediately after a booking is created.
 *
 * POST body: { bookingId: string }
 *
 * Anti-abuse: only sends SMS for bookings created in the last 10 minutes.
 *
 * Env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
 *           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

  try {
    const { bookingId } = await req.json()
    if (!bookingId) return json({ error: 'bookingId required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Fetch booking with related data
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('id, date, time, created_at, client_id, clients(business_name, notification_phone), customers(name, phone), services(name)')
      .eq('id', bookingId)
      .single()

    if (error || !booking) return json({ error: 'Booking not found' }, 404)

    // Anti-abuse: only send for bookings created in the last 10 minutes
    const createdAt = new Date((booking as any).created_at)
    if (Date.now() - createdAt.getTime() > 10 * 60 * 1000) {
      return json({ error: 'Booking too old — SMS not sent' }, 422)
    }

    const customer: any = (booking as any).customers
    const client: any   = (booking as any).clients
    const service: any  = (booking as any).services

    const phone = customer?.phone
    if (!phone) return json({ error: 'No phone number on record' }, 422)

    const cancelUrl = `https://matthiasdev.com/mcbook/cancel.html?id=${bookingId}`
    const dateStr   = fmtDate((booking as any).date)
    const timeStr   = fmtTime((booking as any).time)
    const firstName = (customer?.name || 'there').split(' ')[0]

    // Check for custom SMS template
    let template = `Hi {first_name}! Your {service} at {business} is confirmed.\n📅 {date} at {time}\nTo cancel: {cancel_link}`
    const { data: tpl } = await supabase.from('sms_templates')
      .select('template').eq('client_id', (booking as any).client_id).eq('type', 'confirmation').maybeSingle()
    if (tpl?.template) template = tpl.template

    const message = template
      .replace(/\{first_name\}/g, firstName)
      .replace(/\{service\}/g, service?.name ?? 'appointment')
      .replace(/\{business\}/g, client?.business_name ?? 'the business')
      .replace(/\{date\}/g, dateStr)
      .replace(/\{time\}/g, timeStr)
      .replace(/\{cancel_link\}/g, cancelUrl)

    await sendTwilioSMS(phone, message)

    // Notify the client (business owner) about the new booking
    const clientPhone = client?.notification_phone
    if (clientPhone) {
      const clientMsg = `New booking! ${customer?.name || 'A customer'} booked ${service?.name ?? 'an appointment'} on ${dateStr} at ${timeStr}.`
      await sendTwilioSMS(clientPhone, clientMsg).catch(err => {
        console.error('Client notification failed:', err)
      })
    }

    return json({ success: true })
  } catch (err) {
    console.error('confirm-booking error:', err)
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500)
  }
})
