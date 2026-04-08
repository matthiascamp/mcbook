/**
 * stripe-setup.js
 * ───────────────
 * One-time script that registers the McBook webhook endpoint with Stripe
 * and prints your signing secret (whsec_...) so you can paste it into Supabase.
 *
 * Usage:
 *   node stripe-setup.js
 *
 * You will be prompted for your Stripe secret key (sk_test_... or sk_live_...)
 * Nothing is stored — the key is only held in memory while the script runs.
 */

const https  = require('https')
const readline = require('readline')

const WEBHOOK_URL = 'https://uijudgnqawtvjyjuyuwo.supabase.co/functions/v1/stripe-webhook'

// Events to listen for on YOUR platform account
const PLATFORM_EVENTS = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'payout.paid',
  'payout.failed',
]

// Events to listen for on CONNECTED accounts (sellers)
const CONNECT_EVENTS = [
  'account.updated',
  'payout.paid',
  'payout.failed',
]

// ── Prompt helper ─────────────────────────────────────────────────────────────
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()) })
  })
}

// ── Stripe API call helper ────────────────────────────────────────────────────
function stripeRequest(method, path, body, secretKey, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? new URLSearchParams(body).toString() : ''

    const options = {
      hostname: 'api.stripe.com',
      port:     443,
      path,
      method,
      headers: {
        'Authorization':  `Bearer ${secretKey}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Stripe-Version': '2024-04-10',
        ...extraHeaders,
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) reject(new Error(parsed.error.message))
          else resolve(parsed)
        } catch {
          reject(new Error('Invalid JSON response from Stripe'))
        }
      })
    })

    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

// ── Flatten events array into form-encoded format Stripe expects ──────────────
// e.g. { 'enabled_events[0]': 'payment_intent.succeeded', ... }
function encodeEvents(events) {
  return events.reduce((acc, event, i) => {
    acc[`enabled_events[${i}]`] = event
    return acc
  }, {})
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔════════════════════════════════════════╗')
  console.log('║   McBook — Stripe Webhook Setup        ║')
  console.log('╚════════════════════════════════════════╝\n')

  // Get secret key — from CLI arg or prompt
  let secretKey = process.argv[2]
  if (!secretKey) {
    secretKey = await prompt('Paste your Stripe secret key (sk_test_... or sk_live_...): ')
  }

  if (!secretKey.startsWith('sk_')) {
    console.error('\n✗ That doesn\'t look like a Stripe secret key. It should start with sk_test_ or sk_live_')
    process.exit(1)
  }

  console.log('\n⏳ Verifying key with Stripe...')

  // Verify the key works by fetching the account
  let account
  try {
    account = await stripeRequest('GET', '/v1/account', null, secretKey)
  } catch (err) {
    console.error(`\n✗ Could not authenticate with Stripe: ${err.message}`)
    process.exit(1)
  }

  const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST'
  console.log(`✓ Connected to Stripe account: ${account.id} (${mode} mode)`)
  console.log(`  Business: ${account.business_profile?.name ?? account.email ?? 'unknown'}\n`)

  if (mode === 'LIVE') {
    const confirm = await prompt('⚠️  You are using a LIVE key. Continue? (yes/no): ')
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  // ── Check for existing webhooks pointing at our URL ───────────────────────
  console.log('⏳ Checking for existing webhooks...')
  const existing = await stripeRequest('GET', '/v1/webhook_endpoints?limit=20', null, secretKey)
  const alreadyExists = existing.data?.filter(w => w.url === WEBHOOK_URL) ?? []

  if (alreadyExists.length > 0) {
    console.log(`\n⚠️  Found ${alreadyExists.length} existing webhook(s) pointing at this URL:`)
    alreadyExists.forEach(w => console.log(`   ${w.id} — ${w.status}`))
    const overwrite = await prompt('\nDelete them and create fresh ones? (yes/no): ')
    if (overwrite.toLowerCase() === 'yes') {
      for (const w of alreadyExists) {
        await stripeRequest('DELETE', `/v1/webhook_endpoints/${w.id}`, null, secretKey)
        console.log(`   Deleted ${w.id}`)
      }
    } else {
      console.log('\nKeeping existing webhooks. Exiting.')
      process.exit(0)
    }
  }

  // ── Create platform webhook (your account events) ─────────────────────────
  console.log('\n⏳ Creating platform webhook (your account events)...')
  const platformWebhook = await stripeRequest('POST', '/v1/webhook_endpoints', {
    url:         WEBHOOK_URL,
    description: 'McBook — platform events',
    ...encodeEvents(PLATFORM_EVENTS),
  }, secretKey)

  console.log(`✓ Platform webhook created: ${platformWebhook.id}`)
  const platformSecret = platformWebhook.secret

  // ── Create Connect webhook (connected account events) ─────────────────────
  console.log('\n⏳ Creating Connect webhook (connected account / seller events)...')
  const connectWebhook = await stripeRequest('POST', '/v1/webhook_endpoints', {
    url:         WEBHOOK_URL,
    description: 'McBook — connected account events',
    connect:     'true',    // listens to events from connected accounts
    ...encodeEvents(CONNECT_EVENTS),
  }, secretKey)

  console.log(`✓ Connect webhook created: ${connectWebhook.id}`)
  const connectSecret = connectWebhook.secret

  // ── Print results ─────────────────────────────────────────────────────────
  console.log('\n╔════════════════════════════════════════════════════════════════╗')
  console.log('║  ✓ All done! Add these to Supabase Edge Function Secrets:      ║')
  console.log('╚════════════════════════════════════════════════════════════════╝\n')

  console.log('Go to: https://supabase.com/dashboard/project/uijudgnqawtvjyjuyuwo')
  console.log('       → Settings → Edge Functions → Secrets\n')

  console.log('┌─────────────────────────────────────────────────────────────┐')
  console.log('│ Secret name              │ Value                            │')
  console.log('├─────────────────────────────────────────────────────────────┤')
  console.log(`│ STRIPE_SECRET_KEY        │ ${secretKey.slice(0, 12)}...${secretKey.slice(-4)}                  │`)
  console.log(`│ STRIPE_WEBHOOK_SECRET    │ ${platformSecret}  │`)
  console.log(`│ STRIPE_CONNECT_SECRET    │ ${connectSecret}  │`)
  console.log('│ PLATFORM_FEE_PERCENT     │ 0  (change to e.g. 5 for 5%)    │')
  console.log('└─────────────────────────────────────────────────────────────┘')

  console.log('\n── Platform webhook (your account) ───────────────────────────')
  console.log(`   ID:     ${platformWebhook.id}`)
  console.log(`   Secret: ${platformSecret}`)
  console.log(`   Events: ${PLATFORM_EVENTS.join(', ')}`)

  console.log('\n── Connect webhook (seller accounts) ─────────────────────────')
  console.log(`   ID:     ${connectWebhook.id}`)
  console.log(`   Secret: ${connectSecret}`)
  console.log(`   Events: ${CONNECT_EVENTS.join(', ')}`)

  console.log('\n⚠️  Save these secrets now — Stripe will not show them again.\n')
}

main().catch((err) => {
  console.error('\n✗ Unexpected error:', err.message)
  process.exit(1)
})
