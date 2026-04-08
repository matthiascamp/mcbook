# MCBook — Project Context for Claude Code

## What this project is
MCBook is a SaaS booking platform built by Matthias Development. Business owners (clients) sign up, configure their services and availability, and embed a booking widget on their own websites. The platform is hosted on GitHub at `matthiascamp/matthiasdev` and served from `matthiasdev.com/mcbook/`.

Backend: Supabase (Postgres DB + Auth + Edge Functions)
Payments: Stripe Connect (each client has their own connected Stripe account)
Frontend: Vanilla JS + HTML, no build step

---

## Booking Widget — architecture you MUST understand before styling

The widget lives in `mcbook/widget.js`. It is a self-contained drop-in script:
```html
<script src="widget.js" data-business-id="CLIENT_UUID"></script>
```

### Shadow DOM
The widget mounts inside a **Shadow DOM** (`mode: 'open'`). This means:
- All widget CSS is completely isolated from the host page — host page styles cannot bleed in, and widget styles cannot bleed out.
- All styling is built dynamically via the `buildCSS(theme)` function and injected into a `<style>` element inside the shadow root.
- To change widget appearance you must edit `buildCSS()` in `widget.js`, NOT add external CSS.

### Theme system
On load, the widget checks whether `widget_custom_styling` is enabled for the client (fetched from `clients` table). 

- **Custom styling OFF (default):** Uses MCBook dark palette — near-black background, white text, green accent (`#4ade80`).
- **Custom styling ON:** Calls `detectHostStyles()` which reads the host page's `background-color`, `color`, and scans buttons for an accent colour. The result is passed into `buildCSS(theme)`.

`buildCSS(theme)` checks `isDark(theme.bg)` and picks one of two fully-specified palette objects (`t`):
- **Dark palette:** `bg:#0a0a0f`, `surface:#111118`, `accent:#4ade80`, `text:#ffffff`
- **Light palette:** `bg:#ffffff`, `surface:#f4f7f4`, `accent:#16a34a`, `text:#0a0a0f`

The palette object `t` is what actually drives all CSS custom values — not the raw `theme` object. So to change widget colours, modify the palette objects inside `buildCSS`.

### Stripe Elements — special case
Stripe card inputs (`cardNumber`, `cardExpiry`, `cardCvc`) **cannot mount inside a Shadow DOM**. They mount in the host page's light DOM via named `<slot>` elements projected into the shadow. Style them via the `stripeStyle` object passed to `elements.create()` — not via CSS. The colour is set based on `isDark(widget.theme.bg)`.

### CSS class naming
All widget classes are prefixed `bw-` (booking widget) to avoid collisions. Key classes:
- `.bw-wrap` — outer container
- `.bw-header` / `.bw-body` / `.bw-footer` — layout regions
- `.bw-service-card` — service selection cards
- `.bw-cal-*` — calendar
- `.bw-time-slot` — time picker slots
- `.bw-field` / `.bw-stripe-box` — form inputs
- `.bw-btn` / `.bw-btn-primary` / `.bw-btn-secondary` — buttons
- `.bw-footer` — always shows "Powered by McBook" — keep this

---

## When applying custom styling to a widget

The goal is to make the widget blend into the client's existing website without looking like a foreign embed. The "Powered by McBook" footer must always remain visible.

### How the styling actually works (proven workflow)

`detectHostStyles()` reads the host page's `background-color`, `color`, and scans buttons for an accent. It returns a raw `theme` object. That is passed into `buildCSS(theme)`, which calls `isDark(theme.bg)` — a luminance check — to decide which palette branch to use.

**For dark host sites** (luminance < 128) → the `dark ? { ... }` palette branch is used.
**For light host sites** → the `: { ... }` palette branch is used.

The palette object (`t`) is a plain JS object with these keys — **this is what you edit:**

```js
const t = dark ? {
  bg:       '#0a0a0f',   // widget background
  surface:  '#111118',   // card/header backgrounds
  border:   '#1e1e2e',   // borders and dividers
  accent:   '#4ade80',   // buttons, selections, highlights, active states
  accentBg: 'rgba(74,222,128,0.07)', // accent tint for hover backgrounds
  text:     '#ffffff',   // primary text
  sub:      '#8b8b9e',   // secondary/muted text
  btnText:  '#0a0a0f',   // text ON accent-coloured buttons
  inputBg:  '#0d0d15',   // input field backgrounds
  glow:     '0 0 12px rgba(74,222,128,0.15)', // box-shadow glow effect
} : { /* light palette — edit if client has a light site */ }
```

Every colour in the CSS comes from this object. Replacing these values is how you theme the widget.

### Real example — CBlends (dark site, gold accent)

CBlends has a near-black site (`#0c0c0c` background) with a gold accent (`#C9A84C`). Since the background resolves as dark, only the dark branch needed editing:

```js
const t = dark ? {
  bg:       '#0c0c0c',
  surface:  '#141414',
  border:   'rgba(201,168,76,0.18)',
  accent:   '#C9A84C',
  accentBg: 'rgba(201,168,76,0.08)',
  text:     '#f0ece4',
  sub:      '#888880',
  btnText:  '#0c0c0c',
  inputBg:  '#0c0c0c',
  glow:     '0 0 12px rgba(201,168,76,0.2)',
}
```

The Stripe card inputs (which live outside the Shadow DOM) were matched separately via `stripeStyle` in `mountStripeElements()`:

```js
const stripeStyle = {
  base: {
    color: '#f0ece4',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '14px',
    '::placeholder': { color: '#888880' },
  },
};
```

The light palette was left untouched — CBlends will always resolve as dark.

### Step-by-step process for a new client site

1. **Enable custom styling** in the admin dashboard (`admin.html` → client row → Details → Widget Settings toggle ON). This makes the widget call `detectHostStyles()` on load.
2. **Inspect the client's site** — find their exact background colour, text colour, and accent/button colour from their CSS variables or DevTools.
3. **Edit the appropriate palette branch** in `buildCSS()` in `mcbook/widget.js` — dark branch for dark sites, light branch for light sites.
4. **Update `stripeStyle`** in `mountStripeElements()` to match — `color` = their text colour, `::placeholder color` = their muted text colour.
5. **Test** with the client's `data-business-id` on their actual site or `widget-demo.html`.
6. **Push and deploy** — `widget.js` is served statically, changes go live immediately on push.

**Do NOT:**
- Add `<link>` or `<style>` tags outside the shadow root expecting them to affect the widget
- Try to override widget styles from the host page's CSS (Shadow DOM blocks this entirely)
- Remove or hide the `.bw-footer` "Powered by McBook" branding

---

## Key files

| File | Purpose |
|------|---------|
| `mcbook/widget.js` | The entire booking widget — Shadow DOM, theme, all steps |
| `mcbook/embed.html` | Client-facing "Share & Embed" page where they get their embed code |
| `mcbook/book.html` | Standalone booking page (non-embed version) |
| `mcbook/admin.html` | Matthias's admin dashboard — manage all clients |
| `mcbook/admin-login.html` | Admin login (restricted to `matthiasdevelopment@gmail.com`) |
| `mcbook/js/supabase.js` | Shared Supabase client (anon key, project URL) |
| `supabase/functions/admin-stats/` | Edge Function — returns all client stats |
| `supabase/functions/admin-update-client/` | Edge Function — updates client settings incl. `widget_custom_styling` |
| `supabase/functions/create-payment-intent/` | Edge Function — Stripe upfront payment |
| `supabase/functions/create-setup-intent/` | Edge Function — Stripe card save (noshow/after modes) |

## Edge Functions — deployment notes
All Edge Functions must be deployed with `--no-verify-jwt`:
```bash
supabase functions deploy <function-name> --no-verify-jwt
```
Functions use `npm:@supabase/supabase-js@2` (not `esm.sh`) for Deno v2 compatibility.
Auto-injected env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`.

## Database — relevant tables
- `clients` — one row per business owner. Key cols: `id`, `business_name`, `email`, `platform_fee_percent`, `widget_custom_styling` (bool), `stripe_account_id`, `stripe_charges_enabled`
- `services` — per client. Cols: `name`, `price`, `noshow_fee`, `duration_mins`, `payment_mode` (`free` | `noshow_only` | `after` | `upfront`), `active`
- `bookings` — col: `status` (`scheduled` | `confirmed` | `cancelled` | `completed` | `no_show` | `pending_payment`), `payment_status`
- `customers` — per client, identified by email
- `availability_rules` — day_of_week + start/end times per client
- `payments` — tracks Stripe charges, linked to booking and client
