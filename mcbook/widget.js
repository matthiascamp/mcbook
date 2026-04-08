/**
 * McBook — Embeddable Booking Widget
 * Drop-in with: <script src="widget.js" data-business-id="123"></script>
 * Self-contained via Shadow DOM — zero conflicts with host page styles.
 */
(function () {
  'use strict';

  // ─── Mock data (replace with real API calls later) ────────────────────────
  const MOCK_SERVICES = [
    { id: 1, name: 'Haircut',          duration: '30 min', price: '$35',  nosho: '$25' },
    { id: 2, name: 'Color Treatment',  duration: '2 hr',   price: '$120', nosho: '$60' },
    { id: 3, name: 'Beard Trim',       duration: '20 min', price: '$25',  nosho: '$15' },
    { id: 4, name: 'Full Styling',     duration: '1 hr',   price: '$80',  nosho: '$40' },
  ];

  // Time slots available each day
  const MOCK_TIMES = [
    '9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
    '1:00 PM','1:30 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM',
  ];

  // Days blocked (0 = Sunday, 6 = Saturday) — Sundays unavailable in demo
  const BLOCKED_WEEKDAYS = [0];

  // ─── Supabase client (self-contained, no import from js/supabase.js) ────────
  const SUPABASE_URL      = 'https://uijudgnqawtvjyjuyuwo.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpanVkZ25xYXd0dmp5anV5dXdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MjI1NDQsImV4cCI6MjA5MTA5ODU0NH0.MkIJL-GmeAzUsyinykQWa0-4mjAWTf-WEuZelLouDYg';
  let sb = null;
  const sbReady = (async () => {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  })();

  // ─── Stripe constants ─────────────────────────────────────────────────────
  const STRIPE_PUBLISHABLE_KEY  = 'pk_live_51TIM7W3KdzLQ6RvXRpuNTwZtQjLGq9s18uWusHKHo3aaoL2KmYccr2so1Zy0o1IkuzG0pi1WEzh82MiQPtoMrC6W00iOR1stqs';
  const CREATE_SETUP_INTENT_URL   = 'https://uijudgnqawtvjyjuyuwo.supabase.co/functions/v1/create-setup-intent';
  const CONFIRM_BOOKING_URL       = 'https://uijudgnqawtvjyjuyuwo.supabase.co/functions/v1/confirm-booking';

  // ─── Mount real Stripe Elements (handles setup and payment intents) ──────────
  async function mountStripeElements(widget) {
    // Inject Stripe.js into the host document once
    if (!window.Stripe) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://js.stripe.com/v3/';
        s.onload  = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    await sbReady;

    const { contact, service, date } = widget.state;
    const mode = service.payment_mode || 'noshow_only';

    // Upsert customer (look up by email; create if missing)
    let customerId;
    const { data: existing } = await sb.from('customers')
      .select('id')
      .eq('client_id', widget.businessId)
      .eq('email', contact.email)
      .limit(1)
      .maybeSingle();

    if (existing) {
      customerId = existing.id;
    } else {
      const { data: newCust, error: custErr } = await sb.from('customers')
        .insert({ client_id: widget.businessId, name: contact.name,
                  email: contact.email, phone: contact.phone })
        .select('id')
        .single();
      if (custErr) throw custErr;
      customerId = newCust.id;
    }
    widget._customerId = customerId;

    // SetupIntent — save card for noshow_only or after
    const siRes  = await fetch(CREATE_SETUP_INTENT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        bookingData: {
          customerId,
          serviceId:     service.id,
          clientId:      widget.businessId,
          customerEmail: contact.email,
          customerName:  contact.name,
        },
      }),
    });
    const siJson = await siRes.json();
    if (siJson.error) throw new Error(siJson.error);
    const clientSecret = siJson.clientSecret;

    // Stripe cannot mount inside a shadow root — create light DOM slot containers
    // that are projected into the shadow DOM via named slots.
    // Card inputs are always white regardless of widget theme — standard form UX.
    const slotStyle = 'width:100% !important; background:#ffffff !important; color:#0a0a0f !important; color-scheme:light !important; display:block !important;';
    const cnDiv = document.createElement('div');
    cnDiv.setAttribute('slot', 'stripe-card-number');
    cnDiv.setAttribute('style', slotStyle);
    const ceDiv = document.createElement('div');
    ceDiv.setAttribute('slot', 'stripe-card-expiry');
    ceDiv.setAttribute('style', slotStyle);
    const ccDiv = document.createElement('div');
    ccDiv.setAttribute('slot', 'stripe-card-cvc');
    ccDiv.setAttribute('style', slotStyle);
    widget._host.appendChild(cnDiv);
    widget._host.appendChild(ceDiv);
    widget._host.appendChild(ccDiv);

    const stripe   = window.Stripe(STRIPE_PUBLISHABLE_KEY);
    const elements = stripe.elements({
      appearance: {
        theme: 'flat',
        variables: {
          colorBackground:      '#ffffff',
          colorText:            '#0a0a0f',
          colorTextPlaceholder: '#94a3b8',
          fontFamily:           'Inter, system-ui, sans-serif',
          fontSizeBase:         '14px',
        },
      },
    });
    const cardStyle = {
      base: {
        color:           '#0a0a0f',
        backgroundColor: '#ffffff',
        fontFamily:      'Inter, system-ui, sans-serif',
        fontSize:        '14px',
        '::placeholder': { color: '#94a3b8' },
      },
      invalid: { color: '#0a0a0f' },
    };
    const cardNumber = elements.create('cardNumber', { style: cardStyle });
    const cardExpiry = elements.create('cardExpiry', { style: cardStyle });
    const cardCvc    = elements.create('cardCvc',    { style: cardStyle });
    cardNumber.mount(cnDiv);
    cardExpiry.mount(ceDiv);
    cardCvc.mount(ccDiv);

    // Focus/blur → highlight the shadow DOM wrapper so users see which box is active
    const cnWrap = widget.root.querySelector('#stripe-card-number-wrap');
    const ceWrap = widget.root.querySelector('#stripe-card-expiry-wrap');
    const ccWrap = widget.root.querySelector('#stripe-card-cvc-wrap');
    [[cardNumber, cnWrap], [cardExpiry, ceWrap], [cardCvc, ccWrap]].forEach(([el, wrap]) => {
      if (!wrap) return;
      el.on('focus', () => wrap.classList.add('focused'));
      el.on('blur',  () => wrap.classList.remove('focused'));
    });

    widget._stripeElements = { stripe, cardNumber, clientSecret, mode, _slotDivs: [cnDiv, ceDiv, ccDiv] };
  }

  function destroyStripeSlots(widget) {
    if (widget._stripeElements?._slotDivs) {
      widget._stripeElements._slotDivs.forEach(d => d.remove());
    }
    widget._stripeElements = null;
  }

  // Convert "h:mm AM/PM" → "HH:MM"
  function timeToHHMM(t) {
    const [time, ampm] = t.split(' ');
    let [h, m] = time.split(':').map(Number);
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Format duration_mins as "X min" or "X hr"
  function fmtDuration(mins) {
    if (mins < 60) return `${mins} min`;
    return `${mins / 60} hr`;
  }

  // ─── Live slot generation ─────────────────────────────────────────────────
  async function getAvailableSlots(businessId, dateObj, serviceDurationMins) {
    const dateISO   = dateObj.toISOString().slice(0, 10);
    const dayOfWeek = dateObj.getDay();

    await sbReady;

    // a. Check override for this specific date
    const { data: override } = await sb.from('availability_overrides')
      .select('is_available, start_time, end_time')
      .eq('client_id', businessId)
      .eq('date', dateISO)
      .limit(1)
      .maybeSingle();
    if (override && !override.is_available) return [];

    // b. Availability rule for this day (used if no override times)
    const { data: rule } = await sb.from('availability_rules')
      .select('start_time, end_time')
      .eq('client_id', businessId)
      .eq('day_of_week', dayOfWeek)
      .eq('enabled', true)
      .limit(1)
      .maybeSingle();
    // Use override times if provided, otherwise fall back to weekly rule
    const effectiveRule = (override?.start_time && override?.end_time) ? override : rule;
    if (!effectiveRule) return [];

    // c. Booking settings (slot size, min notice)
    const { data: settings } = await sb.from('booking_settings')
      .select('slot_duration_mins, min_notice_hours')
      .eq('client_id', businessId)
      .limit(1)
      .maybeSingle();
    const slotMins       = settings ? settings.slot_duration_mins : 30;
    const minNoticeHours = settings ? settings.min_notice_hours   : 2;

    // d. Already-booked times for this date
    const { data: booked } = await sb.from('bookings')
      .select('time')
      .eq('client_id', businessId)
      .eq('date', dateISO)
      .neq('status', 'cancelled');
    const bookedSet = new Set((booked || []).map(b => b.time.slice(0, 5)));

    // e. Blocked date check
    const { data: blocked } = await sb.from('blocked_dates')
      .select('id')
      .eq('client_id', businessId)
      .eq('date', dateISO)
      .limit(1)
      .maybeSingle();
    if (blocked) return [];

    // f. Generate slots
    const slots      = [];
    const now        = new Date();
    const noticeMs   = minNoticeHours * 60 * 60 * 1000;
    const [startH, startM] = effectiveRule.start_time.split(':').map(Number);
    const [endH,   endM  ] = effectiveRule.end_time.split(':').map(Number);
    let cur = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    // Pre-compute blocked period in minutes (if any)
    let breakStart = -1, breakEnd = -1;
    if (override?.blocked_from && override?.blocked_to) {
      const [bfH, bfM] = override.blocked_from.split(':').map(Number);
      const [btH, btM] = override.blocked_to.split(':').map(Number);
      breakStart = bfH * 60 + bfM;
      breakEnd   = btH * 60 + btM;
    }

    const durMins = serviceDurationMins > 0 ? serviceDurationMins : slotMins;

    while (cur < endTotal) {
      // Skip slots where the service would run past business hours
      if (cur + durMins > endTotal) break;

      // Skip slots that fall inside the blocked period
      if (breakStart >= 0 && cur >= breakStart && cur < breakEnd) {
        cur += slotMins;
        continue;
      }

      const h = Math.floor(cur / 60);
      const m = cur % 60;
      const slotTime = new Date(dateObj);
      slotTime.setHours(h, m, 0, 0);

      if (slotTime - now >= noticeMs) {
        const hhMM = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        if (!bookedSet.has(hhMM)) {
          const ampm    = h >= 12 ? 'PM' : 'AM';
          const display = `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`;
          slots.push(display);
        }
      }
      cur += slotMins;
    }
    return slots;
  }

  // ─── Detect host-page styles ───────────────────────────────────────────────
  function detectHostStyles() {
    try {
      const body   = document.body;
      const styles = window.getComputedStyle(body);

      // Font family
      const font = styles.fontFamily || "'Inter', sans-serif";

      // Background colour — walk up if body is transparent
      let bg = styles.backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
        bg = '#ffffff';
      }

      // Text colour
      let text = styles.color;
      if (!text) text = '#1a1a2e';

      // Accent colour — scan all buttons on the host page
      let accent = null;
      const btns = document.querySelectorAll('button, [class*="btn"], a[class*="btn"]');
      for (const btn of btns) {
        const s = window.getComputedStyle(btn);
        const c = s.backgroundColor;
        if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent' && c !== 'rgb(0, 0, 0)') {
          accent = c;
          break;
        }
      }
      // Fallback accent
      if (!accent) accent = '#3b82f6';

      return { font, bg, text, accent };
    } catch (e) {
      return {
        font:   "'Inter', sans-serif",
        bg:     '#ffffff',
        text:   '#1a1a2e',
        accent: '#3b82f6',
      };
    }
  }

  // ─── Colour helpers ────────────────────────────────────────────────────────
  // Darken a computed rgb() string by a given ratio (0–1)
  function darken(rgbStr, ratio) {
    const m = rgbStr.match(/[\d.]+/g);
    if (!m || m.length < 3) return rgbStr;
    const r = Math.round(parseInt(m[0]) * (1 - ratio));
    const g = Math.round(parseInt(m[1]) * (1 - ratio));
    const b = Math.round(parseInt(m[2]) * (1 - ratio));
    return `rgb(${r},${g},${b})`;
  }

  // Determine if a colour string is dark (for contrast decisions)
  function isDark(rgbStr) {
    const m = rgbStr.match(/[\d.]+/g);
    if (!m || m.length < 3) return false;
    const lum = 0.299 * parseInt(m[0]) + 0.587 * parseInt(m[1]) + 0.114 * parseInt(m[2]);
    return lum < 128;
  }

  // ─── Calendar helpers ──────────────────────────────────────────────────────
  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function firstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
  }

  function isDateAvailable(date, enabledWeekdays, availabilityRules, minNoticeHours, slotMins, overrides) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return false;

    const dateStr = date.toISOString().slice(0, 10);
    const ov = overrides?.get(dateStr);

    if (ov) {
      if (!ov.is_available) return false;
      // Override marks day available — fall through to notice check using override or weekly times
    } else {
      // No override — respect weekly rule
      if (enabledWeekdays && !enabledWeekdays.has(date.getDay())) return false;
    }

    // Effective time rule: override times take priority over weekly rule
    const rule = (ov?.end_time) ? ov : availabilityRules?.[date.getDay()];
    if (!rule) return !!ov; // override says available but no time rule → allow

    // Check whether any slot falls within the notice window
    const now = new Date();
    const noticeMins = (minNoticeHours ?? 2) * 60;
    const slot = slotMins ?? 30;
    const earliestBookable = new Date(now.getTime() + noticeMins * 60 * 1000);
    const earliestDate = new Date(earliestBookable);
    earliestDate.setHours(0, 0, 0, 0);

    if (earliestDate > date) return false; // notice window pushes past this whole day
    if (earliestDate < date) return true;  // this day is fully after the notice window

    // Same day — check if any slot still fits
    const earliestMins = earliestBookable.getHours() * 60 + earliestBookable.getMinutes();
    const [endH, endM] = rule.end_time.split(':').map(Number);
    return earliestMins <= endH * 60 + endM - slot;
  }

  // ─── CSS ───────────────────────────────────────────────────────────────────
  // Switches between McBook dark palette (dark host pages) and
  // a clean sage-green light palette (light host pages).
  function buildCSS(theme) {
    const dark = isDark(theme.bg);

    // Build a normalised theme object for either mode
    const t = dark ? {
      bg:       '#0a0a0f',
      surface:  '#111118',
      border:   '#1e1e2e',
      accent:   '#4ade80',
      accentBg: 'rgba(74,222,128,0.07)',
      text:     '#ffffff',
      sub:      '#8b8b9e',
      btnText:  '#0a0a0f',
      inputBg:  '#0d0d15',
      glow:     '0 0 12px rgba(74,222,128,0.15)',
    } : {
      bg:       '#ffffff',
      surface:  '#f4f7f4',
      border:   'rgba(0,0,0,0.09)',
      accent:   '#16a34a',
      accentBg: 'rgba(22,163,74,0.07)',
      text:     '#0a0a0f',
      sub:      '#64748b',
      btnText:  '#ffffff',
      inputBg:  '#eef2ee',
      glow:     '0 0 12px rgba(22,163,74,0.12)',
    };

    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

      /* ── Reset ── */
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      /* ── Host ── */
      :host {
        display: block;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        color: ${t.text};
      }

      /* ── Wrapper ── */
      .bw-wrap {
        background: ${t.bg};
        border: 1px solid ${t.border};
        border-radius: 12px;
        width: min(90vw, 680px);
        margin: 0 auto;
        overflow: hidden;
      }

      /* ── Header ── */
      .bw-header {
        background: ${t.surface};
        padding: 18px 24px 0;
      }
      .bw-header h2 {
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: ${t.text};
      }
      .bw-header p {
        font-size: 0.75rem;
        color: ${t.sub};
        margin-top: 3px;
        letter-spacing: 0.01em;
      }

      /* ── Progress bar ── */
      .bw-progress {
        display: flex;
        gap: 4px;
        padding: 14px 24px 18px;
        background: ${t.surface};
        border-bottom: 1px solid ${t.border};
      }
      .bw-progress-step {
        flex: 1;
        height: 2px;
        border-radius: 1px;
        background: ${t.border};
        transition: background 0.2s ease;
      }
      .bw-progress-step.active { background: ${t.accent}; }
      .bw-progress-step.done   { background: ${t.accent}; opacity: 0.4; }

      /* ── Body ── */
      .bw-body {
        padding: 22px 24px;
        background: ${t.bg};
      }
      .bw-step-title {
        font-size: 0.875rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: ${t.text};
        margin-bottom: 16px;
      }

      /* ── Service cards ── */
      .bw-services { display: flex; flex-direction: column; gap: 7px; }
      .bw-service-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 13px 16px;
        border: 1px solid ${t.border};
        border-radius: 8px;
        cursor: pointer;
        background: ${t.surface};
        transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      }
      .bw-service-card:hover {
        border-color: ${t.accent};
        background: ${t.accentBg};
      }
      .bw-service-card.selected {
        border-color: ${t.accent};
        background: ${t.accentBg};
        box-shadow: ${t.glow};
      }
      .bw-service-name { font-size: 0.875rem; font-weight: 600; color: ${t.text}; }
      .bw-service-meta { font-size: 0.75rem; color: ${t.sub}; margin-top: 2px; }
      .bw-service-price { font-size: 0.9rem; font-weight: 700; color: ${t.accent}; }

      /* ── Calendar ── */
      .bw-cal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .bw-cal-header button {
        background: ${t.surface};
        border: 1px solid ${t.border};
        border-radius: 8px;
        width: 30px; height: 30px;
        cursor: pointer;
        font-size: 1rem;
        color: ${t.sub};
        display: flex; align-items: center; justify-content: center;
        transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
      }
      .bw-cal-header button:hover {
        border-color: ${t.accent};
        color: ${t.accent};
        background: ${t.accentBg};
      }
      .bw-cal-month {
        font-size: 0.875rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: ${t.text};
      }
      .bw-cal-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 3px;
        text-align: center;
      }
      .bw-cal-dow {
        font-size: 0.65rem;
        font-weight: 600;
        color: ${t.sub};
        padding-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .bw-cal-day {
        aspect-ratio: 1;
        display: flex; align-items: center; justify-content: center;
        border-radius: 6px;
        font-size: 0.81rem;
        color: ${t.text};
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease;
        user-select: none;
      }
      .bw-cal-day:empty { cursor: default; }
      .bw-cal-day.available:hover {
        background: ${t.accentBg};
        color: ${t.accent};
      }
      .bw-cal-day.selected {
        background: ${t.accent};
        color: ${t.btnText};
        font-weight: 700;
      }
      .bw-cal-day.unavailable { color: ${t.border}; cursor: default; }
      .bw-cal-day.today {
        outline: 1px solid ${t.accent};
        outline-offset: -1px;
      }

      /* ── Time slots ── */
      .bw-times {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
      }
      .bw-time-slot {
        padding: 10px 4px;
        text-align: center;
        border: 1px solid ${t.border};
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.79rem;
        font-weight: 500;
        color: ${t.text};
        background: ${t.surface};
        transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
      }
      .bw-time-slot:hover {
        border-color: ${t.accent};
        color: ${t.accent};
        background: ${t.accentBg};
      }
      .bw-time-slot.selected {
        border-color: ${t.accent};
        background: ${t.accent};
        color: ${t.btnText};
        font-weight: 600;
      }

      /* ── Form fields ── */
      .bw-form { display: flex; flex-direction: column; gap: 12px; }
      .bw-field label {
        display: block;
        font-size: 0.69rem;
        font-weight: 600;
        color: ${t.sub};
        text-transform: uppercase;
        letter-spacing: 0.09em;
        margin-bottom: 5px;
      }
      .bw-field input {
        width: 100%;
        padding: 10px 13px;
        border: 1px solid ${t.border};
        border-radius: 8px;
        font-size: 0.875rem;
        font-family: 'Inter', system-ui, sans-serif;
        background: ${t.inputBg};
        color: ${t.text};
        outline: none;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }
      .bw-field input:focus {
        border-color: ${t.accent};
        box-shadow: ${t.glow};
      }
      .bw-field input::placeholder { color: ${t.sub}; }

      /* ── Stripe placeholder ── */
      .bw-stripe-box {
        border: 1px solid ${t.border};
        border-radius: 8px;
        padding: 10px 13px;
        background: #ffffff;
        color-scheme: light;
        font-size: 0.84rem;
        color: #0a0a0f;
        display: flex;
        align-items: center;
        gap: 8px;
        outline: none;
      }
      .bw-stripe-box.focused {
        border-color: ${t.accent};
        box-shadow: 0 0 0 2px ${t.accentBg};
      }
      .bw-stripe-loading {
        font-size: 0.78rem;
        color: #64748b;
        font-style: italic;
      }
      .bw-stripe-icon { font-size: 1rem; }
      .bw-stripe-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .bw-secure-note {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 0.71rem;
        color: ${t.sub};
        margin-top: -2px;
      }

      /* ── Summary box ── */
      .bw-summary {
        background: ${t.surface};
        border: 1px solid ${t.border};
        border-radius: 8px;
        padding: 14px 16px;
        margin-bottom: 16px;
        font-size: 0.84rem;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .bw-summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .bw-summary-label { color: ${t.sub}; }
      .bw-summary-val { font-weight: 600; color: ${t.text}; }

      /* ── Confirmation ── */
      .bw-confirm { text-align: center; padding: 8px 0 4px; }
      .bw-confirm-icon {
        width: 52px; height: 52px;
        margin: 0 auto 16px;
        background: ${t.accentBg};
        border: 1px solid ${t.accent};
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        font-size: 1.3rem;
        color: ${t.accent};
        box-shadow: ${t.glow};
      }
      .bw-confirm h3 {
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: ${t.text};
        margin-bottom: 6px;
      }
      .bw-confirm p {
        font-size: 0.84rem;
        color: ${t.sub};
        line-height: 1.6;
      }
      .bw-confirm-ref {
        display: inline-block;
        margin-top: 14px;
        padding: 7px 16px;
        background: ${t.accentBg};
        border: 1px solid ${t.border};
        border-radius: 8px;
        font-size: 0.75rem;
        color: ${t.accent};
        font-weight: 700;
        letter-spacing: 0.1em;
      }

      /* ── Buttons ── */
      .bw-btn-row { display: flex; gap: 8px; margin-top: 20px; }
      .bw-btn {
        flex: 1;
        padding: 11px 20px;
        border-radius: 8px;
        border: 1px solid transparent;
        font-size: 0.875rem;
        font-weight: 600;
        font-family: 'Inter', system-ui, sans-serif;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .bw-btn:active { transform: scale(0.98); }

      /* Primary — full green fill, near-black text */
      .bw-btn-primary {
        background: ${t.accent};
        color: ${t.btnText};
        border-color: ${t.accent};
      }
      .bw-btn-primary:hover {
        filter: brightness(1.08);
        box-shadow: ${t.glow};
      }
      .bw-btn-primary:disabled {
        opacity: 0.22;
        cursor: not-allowed;
        box-shadow: none;
        filter: none;
      }

      /* Secondary — dark surface, green text & border on hover */
      .bw-btn-secondary {
        background: ${t.surface};
        color: ${t.sub};
        border-color: ${t.border};
      }
      .bw-btn-secondary:hover {
        border-color: ${t.accent};
        color: ${t.accent};
        background: ${t.accentBg};
      }

      /* ── Error ── */
      .bw-error {
        color: #ef4444;
        font-size: 0.75rem;
        margin-top: 6px;
        display: none;
      }
      .bw-error.visible { display: block; }

      /* ── Powered-by footer ── */
      .bw-footer {
        padding: 10px 24px 12px;
        border-top: 1px solid ${t.border};
        background: ${t.surface};
        text-align: center;
        font-size: 0.67rem;
        color: ${t.sub};
        letter-spacing: 0.04em;
      }
      .bw-footer a {
        color: ${t.sub};
        text-decoration: none;
        transition: color 0.2s ease;
      }
      .bw-footer a:hover { color: ${t.accent}; }
      .bw-footer-brand {
        font-weight: 700;
        color: ${t.accent};
        letter-spacing: 0.01em;
      }

      /* ── Responsive ── */
      @media (max-width: 420px) {
        .bw-body { padding: 18px 16px; }
        .bw-times { grid-template-columns: repeat(2, 1fr); }
        .bw-stripe-row { grid-template-columns: 1fr; }
      }
    `;
  }

  // ─── Utility: generate a random booking reference ─────────────────────────
  function genRef() {
    return 'BK-' + Math.random().toString(36).toUpperCase().slice(2, 8);
  }

  // ─── Month names ──────────────────────────────────────────────────────────
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const DOWS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  // ─── Widget class ─────────────────────────────────────────────────────────
  class BookingWidget {
    constructor(scriptEl) {
      this.businessId = scriptEl.getAttribute('data-business-id') || '0';
      // Default to MCBook dark theme until client settings are loaded
      this.theme = { bg: 'rgb(10,10,15)', text: 'rgb(255,255,255)', accent: 'rgb(74,222,128)', font: "'Inter', sans-serif" };

      // Booking state
      this.state = {
        step:      1,          // 1-6
        service:   null,
        date:      null,
        time:      null,
        contact:   {},
        ref:       null,
        bookingId: null,
        calYear:   new Date().getFullYear(),
        calMonth:  new Date().getMonth(),
      };

      // Availability unknown until loaded
      this._hasAvailability = false;

      this._mount(scriptEl);
    }

    // ── Mount shadow DOM next to the script tag ──────────────────────────────
    _mount(scriptEl) {
      const host = document.createElement('div');
      host.setAttribute('data-booking-widget', this.businessId);
      scriptEl.parentNode.insertBefore(host, scriptEl.nextSibling);

      const shadow = host.attachShadow({ mode: 'open' });

      // Styles
      const styleEl = document.createElement('style');
      styleEl.textContent = buildCSS(this.theme);
      shadow.appendChild(styleEl);
      this._styleEl = styleEl;

      // Root wrapper
      this.root = document.createElement('div');
      this.root.className = 'bw-wrap';
      shadow.appendChild(this.root);

      // Keep host reference so Stripe can mount in light DOM via slots
      this._host = host;

      this._render();
      this._loadClientSettings();
    }

    // ── Load widget_custom_styling from DB, update theme if enabled ───────────
    async _loadClientSettings() {
      try {
        await sbReady;
        const { data } = await sb
          .from('clients')
          .select('widget_custom_styling')
          .eq('id', this.businessId)
          .single();
        if (data?.widget_custom_styling) {
          this.theme = detectHostStyles();
          this._styleEl.textContent = buildCSS(this.theme);
          this._render();
        }
      } catch (_) {
        // Non-fatal — keep default theme
      }
    }

    // ── Render full widget based on current state ────────────────────────────
    _render() {
      const hostTop = this._host.getBoundingClientRect().top;
      const scrollY = window.scrollY;

      this.root.innerHTML =
        this._headerHTML() +
        `<div class="bw-body">${this._stepHTML()}</div>` +
        `<div class="bw-footer">Powered by <span class="bw-footer-brand">McBook</span></div>`;

      requestAnimationFrame(() => {
        const delta = this._host.getBoundingClientRect().top - hostTop;
        if (Math.abs(delta) > 2) {
          window.scrollTo({ top: scrollY + delta, behavior: 'instant' });
        }
      });

      this._bindEvents();
    }

    _headerHTML() {
      const mode      = this.state.service?.payment_mode;
      const needsCard = mode && mode !== 'free';
      const labels    = ['Service','Date','Time','Contact', needsCard ? 'Payment' : 'Confirm','Done'];
      const bars      = labels.map((_, i) => {
        const n = i + 1;
        let cls = '';
        if (n < this.state.step)  cls = 'done';
        if (n === this.state.step) cls = 'active';
        return `<div class="bw-progress-step ${cls}"></div>`;
      }).join('');

      const stepNames = ['Select a Service','Choose a Date','Choose a Time',
        'Your Details', needsCard ? 'Payment' : 'Review & Confirm','Confirmation'];
      return `
        <div class="bw-header">
          <h2>Book an Appointment</h2>
          <p>Step ${this.state.step} of 6 — ${stepNames[this.state.step - 1]}</p>
        </div>
        <div class="bw-progress">${bars}</div>
      `;
    }

    // ── Step HTML dispatcher ─────────────────────────────────────────────────
    _stepHTML() {
      switch (this.state.step) {
        case 1: return this._step1();
        case 2: return this._step2();
        case 3: return this._step3();
        case 4: return this._step4();
        case 5: return this._step5();
        case 6: return this._step6();
      }
    }

    // Step 1 — Service selection
    _step1() {
      // If services not yet loaded, show loading state and kick off fetch
      if (!this._services) {
        (async () => {
          await sbReady;
          const todayISO = new Date().toISOString().slice(0, 10);
          const [{ data }, { data: rules }, { data: settings }, { data: ovData }] = await Promise.all([
            sb.from('services')
              .select('id, name, duration_mins, price, noshow_fee, payment_mode')
              .eq('client_id', this.businessId)
              .eq('active', true)
              .order('created_at', { ascending: true }),
            sb.from('availability_rules')
              .select('day_of_week, start_time, end_time')
              .eq('client_id', this.businessId)
              .eq('enabled', true),
            sb.from('booking_settings')
              .select('slot_duration_mins, min_notice_hours')
              .eq('client_id', this.businessId)
              .limit(1)
              .maybeSingle(),
            sb.from('availability_overrides')
              .select('date, is_available, start_time, end_time')
              .eq('client_id', this.businessId)
              .gte('date', todayISO),
          ]);
          this._services = data || [];
          this._enabledWeekdays = new Set((rules || []).map(r => r.day_of_week));
          this._availabilityRules = Object.fromEntries((rules || []).map(r => [r.day_of_week, r]));
          this._minNoticeHours = settings?.min_notice_hours ?? 2;
          this._slotMins = settings?.slot_duration_mins ?? 30;
          this._overrides = new Map((ovData || []).map(o => [o.date, o]));
          this._hasAvailability = this._enabledWeekdays.size > 0;
          if (this.state.step === 1) this._render();
        })();
        return `
          <div class="bw-step-title">What service do you need?</div>
          <div class="bw-services" style="padding:16px 0;color:inherit;opacity:0.55;font-size:0.84rem;">Loading\u2026</div>
          <div class="bw-btn-row">
            <button type="button" class="bw-btn bw-btn-primary" id="bw-next" disabled>Next &rarr;</button>
          </div>`;
      }

      // No services or no availability set up — show a polite unavailable state
      if (this._services.length === 0 || !this._hasAvailability) {
        return `
          <div class="bw-confirm" style="padding:24px 0 8px;">
            <div class="bw-confirm-icon" style="font-size:1.4rem;">&#128197;</div>
            <h3>No availability yet</h3>
            <p>Online bookings aren't available right now.<br>Please get in touch directly to arrange an appointment.</p>
          </div>`;
      }

      const cards = this._services.map(s => {
        const sel = this.state.service && this.state.service.id === s.id ? 'selected' : '';
        return `
          <div class="bw-service-card ${sel}" data-service-id="${s.id}">
            <div>
              <div class="bw-service-name">${s.name}</div>
              <div class="bw-service-meta">${fmtDuration(s.duration_mins)}</div>
            </div>
            ${s.payment_mode !== 'free' ? `<div class="bw-service-price">$${s.price}</div>` : ''}
          </div>`;
      }).join('');

      return `
        <div class="bw-step-title">What service do you need?</div>
        <div class="bw-services">${cards}</div>
        <div class="bw-btn-row">
          <button type="button" class="bw-btn bw-btn-primary" id="bw-next"
            ${!this.state.service ? 'disabled' : ''}>Next &rarr;</button>
        </div>`;
    }

    // Step 2 — Calendar date picker
    _step2() {
      return `
        <div class="bw-step-title">Pick a date</div>
        ${this._calendarHTML()}
        <div class="bw-error" id="bw-date-err">Please select a date to continue.</div>
        <div class="bw-btn-row">
          <button type="button" class="bw-btn bw-btn-secondary" id="bw-back">&larr; Back</button>
          <button type="button" class="bw-btn bw-btn-primary" id="bw-next"
            ${!this.state.date ? 'disabled' : ''}>Next &rarr;</button>
        </div>`;
    }

    // Calendar HTML helper
    _calendarHTML() {
      const { calYear, calMonth, date: selDate } = this.state;
      const today     = new Date(); today.setHours(0,0,0,0);
      const totalDays = daysInMonth(calYear, calMonth);
      const startDay  = firstDayOfMonth(calYear, calMonth);

      const dowHeaders = DOWS.map(d => `<div class="bw-cal-dow">${d}</div>`).join('');

      // Empty leading cells
      let cells = Array(startDay).fill('<div class="bw-cal-day"></div>').join('');

      for (let d = 1; d <= totalDays; d++) {
        const thisDate = new Date(calYear, calMonth, d);
        const avail    = isDateAvailable(thisDate, this._enabledWeekdays, this._availabilityRules, this._minNoticeHours, this._slotMins, this._overrides);
        const isToday  = thisDate.getTime() === today.getTime();
        const isSel    = selDate && selDate.getTime() === thisDate.getTime();

        let cls = '';
        if (isSel)   cls = 'selected';
        else if (!avail) cls = 'unavailable';
        else cls = 'available';
        if (isToday) cls += ' today';

        const dataAttr = avail ? `data-day="${d}"` : '';
        cells += `<div class="bw-cal-day ${cls}" ${dataAttr}>${d}</div>`;
      }

      return `
        <div class="bw-cal-header">
          <button type="button" id="bw-cal-prev">&#8249;</button>
          <span class="bw-cal-month">${MONTHS[calMonth]} ${calYear}</span>
          <button type="button" id="bw-cal-next">&#8250;</button>
        </div>
        <div class="bw-cal-grid">
          ${dowHeaders}
          ${cells}
        </div>`;
    }

    // Step 3 — Time slot selection
    _step3() {
      const dateStr = this.state.date
        ? this.state.date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})
        : '';

      // If slots not yet loaded, show loading state and kick off fetch
      if (!this._slots) {
        (async () => {
          this._slots = await getAvailableSlots(this.businessId, this.state.date, this.state.service?.duration_mins || 0);
          if (this.state.step === 3) this._render();
        })();
        return `
          <div class="bw-step-title">Available times &mdash; ${dateStr}</div>
          <div class="bw-times" style="grid-column:1/-1;padding:16px 0;opacity:0.55;font-size:0.84rem;">Loading times\u2026</div>
          <div class="bw-btn-row">
            <button type="button" class="bw-btn bw-btn-secondary" id="bw-back">&larr; Back</button>
            <button type="button" class="bw-btn bw-btn-primary" id="bw-next" disabled>Next &rarr;</button>
          </div>`;
      }

      if (this._slots.length === 0) {
        return `
          <div class="bw-step-title">Available times &mdash; ${dateStr}</div>
          <div style="font-size:0.84rem;opacity:0.65;padding:12px 0;">No available times for this date. Please choose another.</div>
          <div class="bw-btn-row">
            <button type="button" class="bw-btn bw-btn-secondary" id="bw-back">&larr; Back</button>
            <button type="button" class="bw-btn bw-btn-primary" id="bw-next" disabled>Next &rarr;</button>
          </div>`;
      }

      const slotsHTML = this._slots.map(t => {
        const sel = this.state.time === t ? 'selected' : '';
        return `<div class="bw-time-slot ${sel}" data-time="${t}">${t}</div>`;
      }).join('');

      return `
        <div class="bw-step-title">Available times &mdash; ${dateStr}</div>
        <div class="bw-times">${slotsHTML}</div>
        <div class="bw-btn-row">
          <button type="button" class="bw-btn bw-btn-secondary" id="bw-back">&larr; Back</button>
          <button type="button" class="bw-btn bw-btn-primary" id="bw-next"
            ${!this.state.time ? 'disabled' : ''}>Next &rarr;</button>
        </div>`;
    }

    // Step 4 — Contact details
    _step4() {
      const c = this.state.contact;
      return `
        <div class="bw-step-title">Your details</div>
        <div class="bw-form">
          <div class="bw-field">
            <label>Full Name</label>
            <input type="text" id="bw-name" placeholder="Jane Smith"
              value="${c.name || ''}">
          </div>
          <div class="bw-field">
            <label>Email Address</label>
            <input type="email" id="bw-email" placeholder="jane@example.com"
              value="${c.email || ''}">
          </div>
          <div class="bw-field">
            <label>Phone Number</label>
            <input type="tel" id="bw-phone" placeholder="+1 (555) 000-0000"
              value="${c.phone || ''}">
          </div>
        </div>
        <div class="bw-error" id="bw-contact-err">Please fill in all fields.</div>
        <div class="bw-btn-row">
          <button type="button" class="bw-btn bw-btn-secondary" id="bw-back">&larr; Back</button>
          <button type="button" class="bw-btn bw-btn-primary" id="bw-next">Next &rarr;</button>
        </div>`;
    }

    // Step 5 — Payment / card save / confirm depending on service payment_mode
    _step5() {
      const { service, date, time } = this.state;
      const mode    = service?.payment_mode || 'free';
      const dateStr = date
        ? date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})
        : '';

      const summaryRows = `
        <div class="bw-summary">
          <div class="bw-summary-row">
            <span class="bw-summary-label">Service</span>
            <span class="bw-summary-val">${service ? service.name : ''}</span>
          </div>
          <div class="bw-summary-row">
            <span class="bw-summary-label">Date &amp; Time</span>
            <span class="bw-summary-val">${dateStr} at ${time}</span>
          </div>
          <div class="bw-summary-row">
            <span class="bw-summary-label">Duration</span>
            <span class="bw-summary-val">${service ? fmtDuration(service.duration_mins) : ''}</span>
          </div>
        </div>`;

      if (mode === 'free') {
        return `
          <div class="bw-step-title">Review &amp; Confirm</div>
          ${summaryRows}
          <div style="font-size:0.77rem;opacity:0.65;margin-bottom:4px;">Payment is not collected online — please arrange payment directly with the business.</div>
          <div class="bw-error" id="bw-confirm-err"></div>
          <div class="bw-btn-row">
            <button type="button" class="bw-btn bw-btn-secondary" id="bw-back">&larr; Back</button>
            <button type="button" class="bw-btn bw-btn-primary" id="bw-next">Book</button>
          </div>`;
      }

      // Card-required modes (noshow_only, after)
      const chargeRow = `<div class="bw-summary-row"><span class="bw-summary-label">Due after appointment</span><span class="bw-summary-val">$${service.price}</span></div>`;

      const modeNote = 'Your card will be saved and charged after your appointment.';

      const confirmLabel = 'Book';

      return `
        <div class="bw-step-title">Review &amp; Card Details</div>
        ${summaryRows}
        <div class="bw-summary" style="margin-top:-8px;">${chargeRow}</div>
        <div class="bw-form">
          <div style="font-size:0.77rem;opacity:0.65;margin-bottom:4px;">${modeNote}</div>
          <div class="bw-field">
            <label>Card Number</label>
            <div class="bw-stripe-box" id="stripe-card-number-wrap">
              <slot name="stripe-card-number"><span class="bw-stripe-loading">Initializing secure payment form…</span></slot>
            </div>
          </div>
          <div class="bw-stripe-row">
            <div class="bw-field">
              <label>Expiry</label>
              <div class="bw-stripe-box" id="stripe-card-expiry-wrap"><slot name="stripe-card-expiry"><span class="bw-stripe-loading">Loading…</span></slot></div>
            </div>
            <div class="bw-field">
              <label>CVC</label>
              <div class="bw-stripe-box" id="stripe-card-cvc-wrap"><slot name="stripe-card-cvc"><span class="bw-stripe-loading">Loading…</span></slot></div>
            </div>
          </div>
          <div class="bw-secure-note">&#128274; Payments are encrypted and secured by Stripe.</div>
        </div>
        <div class="bw-error" id="bw-confirm-err"></div>
        <div class="bw-btn-row">
          <button type="button" class="bw-btn bw-btn-secondary" id="bw-back">&larr; Back</button>
          <button type="button" class="bw-btn bw-btn-primary" id="bw-next">${confirmLabel}</button>
        </div>`;
    }

    // Step 6 — Confirmation
    _step6() {
      const { service, date, time, contact, ref } = this.state;
      const dateStr = date
        ? date.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})
        : '';

      return `
        <div class="bw-confirm">
          <div class="bw-confirm-icon">&#10003;</div>
          <h3>You're all booked, ${contact.name ? contact.name.split(' ')[0] : 'there'}!</h3>
          <p>
            ${contact.phone ? `A text message confirmation has been sent to <strong>${contact.phone}</strong>.` : 'You will receive a text message confirmation shortly.'}<br>
            We look forward to seeing you.
          </p>
          <div class="bw-summary" style="text-align:left;margin-top:20px;">
            <div class="bw-summary-row">
              <span class="bw-summary-label">Service</span>
              <span class="bw-summary-val">${service ? service.name : ''}</span>
            </div>
            <div class="bw-summary-row">
              <span class="bw-summary-label">Date &amp; Time</span>
              <span class="bw-summary-val">${dateStr} at ${time}</span>
            </div>
          </div>
          <div class="bw-confirm-ref">Booking ref: ${ref}</div>
        </div>
        <div class="bw-btn-row">
          <button class="bw-btn bw-btn-secondary" id="bw-new-booking">Book Another</button>
          <button class="bw-btn bw-btn-secondary" id="bw-cancel-booking" style="color:#ef4444;border-color:rgba(239,68,68,0.3);">Cancel Booking</button>
        </div>`;
    }

    // ── Event binding after each render ─────────────────────────────────────
    _bindEvents() {
      const root = this.root;

      // Next / Back buttons
      const nextBtn = root.querySelector('#bw-next');
      const backBtn = root.querySelector('#bw-back');
      if (nextBtn) nextBtn.addEventListener('click', () => this._next());
      if (backBtn) backBtn.addEventListener('click', () => this._back());

      // New booking / cancel buttons (step 6)
      const newBtn = root.querySelector('#bw-new-booking');
      if (newBtn) newBtn.addEventListener('click', () => this._reset());
      const cancelBookingBtn = root.querySelector('#bw-cancel-booking');
      if (cancelBookingBtn) cancelBookingBtn.addEventListener('click', () => this._cancelBooking());

      // Step-specific listeners
      switch (this.state.step) {
        case 1: this._bindStep1(); break;
        case 2: this._bindStep2(); break;
        case 3: this._bindStep3(); break;
        case 5: {
          const mode = this.state.service?.payment_mode || 'free';
          if (mode !== 'free' && !this._stripeElements) {
            const nextBtn = this.root.querySelector('#bw-next');
            if (nextBtn) nextBtn.disabled = true;
            mountStripeElements(this).then(() => {
              const btn = this.root.querySelector('#bw-next');
              if (btn) btn.disabled = false;
            }).catch(err => {
              const errEl = this.root.querySelector('#bw-confirm-err');
              if (errEl) { errEl.textContent = err.message; errEl.classList.add('visible'); }
            });
          }
          break;
        }
      }
    }

    _bindStep1() {
      this.root.querySelectorAll('.bw-service-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-service-id');
          this.state.service = (this._services || []).find(s => s.id === id) || null;
          this._render();
        });
      });
    }

    _bindStep2() {
      // Calendar navigation
      const prev = this.root.querySelector('#bw-cal-prev');
      const next = this.root.querySelector('#bw-cal-next');
      const today = new Date();

      if (prev) prev.addEventListener('click', () => {
        let { calYear, calMonth } = this.state;
        calMonth--;
        if (calMonth < 0) { calMonth = 11; calYear--; }
        // Don't go before current month
        if (calYear < today.getFullYear() ||
            (calYear === today.getFullYear() && calMonth < today.getMonth())) return;
        this.state.calYear  = calYear;
        this.state.calMonth = calMonth;
        this._render();
      });

      if (next) next.addEventListener('click', () => {
        let { calYear, calMonth } = this.state;
        calMonth++;
        if (calMonth > 11) { calMonth = 0; calYear++; }
        this.state.calYear  = calYear;
        this.state.calMonth = calMonth;
        this._render();
      });

      // Day selection
      this.root.querySelectorAll('.bw-cal-day.available').forEach(cell => {
        cell.addEventListener('click', () => {
          const d = parseInt(cell.getAttribute('data-day'));
          this.state.date = new Date(this.state.calYear, this.state.calMonth, d);
          this._slots = null; // clear cached slots for new date
          this._render();
        });
      });
    }

    _bindStep3() {
      this.root.querySelectorAll('.bw-time-slot').forEach(slot => {
        slot.addEventListener('click', () => {
          this.state.time = slot.getAttribute('data-time');
          this._render();
        });
      });
    }

    // ── Navigation logic ─────────────────────────────────────────────────────
    async _next() {
      if (this.state.step === 4) {
        // Validate contact fields
        const name  = this.root.querySelector('#bw-name').value.trim();
        const email = this.root.querySelector('#bw-email').value.trim();
        const phone = this.root.querySelector('#bw-phone').value.trim();
        const errEl = this.root.querySelector('#bw-contact-err');
        if (!name || !email || !phone) {
          errEl.textContent = 'Please fill in all fields.';
          errEl.classList.add('visible');
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errEl.textContent = 'Please enter a valid email address.';
          errEl.classList.add('visible');
          return;
        }
        this.state.contact = { name, email, phone };
      }

      if (this.state.step === 5) {
        if (this._processing) return; // prevent double-submit
        this._processing = true;

        const nextBtn = this.root.querySelector('#bw-next');
        const errEl   = this.root.querySelector('#bw-confirm-err');
        nextBtn.disabled    = true;
        nextBtn.textContent = 'Processing\u2026';
        if (errEl) { errEl.textContent = ''; errEl.classList.remove('visible'); }

        try {
          const { contact, service, date } = this.state;
          const mode     = service.payment_mode || 'free';
          const dateISO  = date.toISOString().slice(0, 10);
          const timeHHMM = timeToHHMM(this.state.time);

          await sbReady;

          if (mode === 'free') {
            // No card — upsert customer and insert booking directly
            let customerId;
            const { data: existing } = await sb.from('customers')
              .select('id').eq('client_id', this.businessId).eq('email', contact.email)
              .limit(1).maybeSingle();
            if (existing) {
              customerId = existing.id;
            } else {
              const { data: newCust, error: custErr } = await sb.from('customers')
                .insert({ client_id: this.businessId, name: contact.name,
                          email: contact.email, phone: contact.phone })
                .select('id').single();
              if (custErr && custErr.code === '23505') {
                // Race condition: another request just created this customer
                const { data: retry } = await sb.from('customers')
                  .select('id').eq('client_id', this.businessId).eq('email', contact.email)
                  .limit(1).maybeSingle();
                if (retry) { customerId = retry.id; } else { throw custErr; }
              } else if (custErr) {
                throw custErr;
              } else {
                customerId = newCust.id;
              }
            }
            const { data: booking, error: bookErr } = await sb.from('bookings')
              .insert({ client_id: this.businessId, customer_id: customerId,
                        service_id: service.id, date: dateISO, time: timeHHMM, status: 'scheduled' })
              .select('id').single();
            if (bookErr) throw bookErr;
            this.state.bookingId = booking.id;
            this.state.ref       = 'BK-' + booking.id.slice(0, 6).toUpperCase();
            // Send confirmation SMS (fire-and-forget)
            fetch(CONFIRM_BOOKING_URL, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ bookingId: booking.id }),
            }).catch(() => {});
            this._processing = false;
            this.state.step++;
            this._render();
            return;
          }

          // noshow_only or after — confirm card setup then insert booking
          const { stripe, cardNumber, clientSecret } = this._stripeElements;
          const { setupIntent, error: stripeErr } = await stripe.confirmCardSetup(clientSecret, {
            payment_method: {
              card:            cardNumber,
              billing_details: { name: contact.name, email: contact.email },
            },
          });
          if (stripeErr) throw new Error(stripeErr.message);

          // Upsert customer (card path uses mountStripeElements which already created customer,
          // but handle race condition defensively)
          let customerId = this._customerId;
          if (!customerId) {
            const { data: existing } = await sb.from('customers')
              .select('id').eq('client_id', this.businessId).eq('email', contact.email)
              .limit(1).maybeSingle();
            customerId = existing?.id;
          }

          const { data: booking, error: bookErr } = await sb.from('bookings')
            .insert({
              client_id:         this.businessId,
              customer_id:       customerId,
              service_id:        service.id,
              date:              dateISO,
              time:              timeHHMM,
              status:            'scheduled',
              payment_method_id: setupIntent.payment_method,
            })
            .select('id').single();
          if (bookErr) throw bookErr;

          this.state.bookingId = booking.id;
          this.state.ref       = 'BK-' + booking.id.slice(0, 6).toUpperCase();
          // Send confirmation SMS (fire-and-forget)
          fetch(CONFIRM_BOOKING_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ bookingId: booking.id }),
          }).catch(() => {});
          destroyStripeSlots(this);
          this._processing = false;
          this.state.step++;
          this._render();
        } catch (err) {
          this._processing = false;
          const nextBtn2 = this.root.querySelector('#bw-next');
          const errEl2   = this.root.querySelector('#bw-confirm-err');
          if (nextBtn2) { nextBtn2.disabled = false; nextBtn2.textContent = 'Book'; }
          if (errEl2)   { errEl2.textContent = err.message || 'Something went wrong. Please try again.'; errEl2.classList.add('visible'); }
        }
        return;
      }

      this.state.step++;
      this._render();
    }

    _back() {
      const mode = this.state.service?.payment_mode || 'free';
      if (this.state.step === 5 && mode !== 'free') {
        destroyStripeSlots(this);
        this._customerId = null;
      }
      this.state.step--;
      this._render();
    }

    _reset() {
      this._slots      = null; // clear slot cache (date will change); keep this._services
      this._processing = false;
      destroyStripeSlots(this);
      this._customerId = null;
      this.state = {
        step:      1,
        service:   null,
        date:      null,
        time:      null,
        contact:   {},
        ref:       null,
        bookingId: null,
        calYear:   new Date().getFullYear(),
        calMonth:  new Date().getMonth(),
      };
      this._render();
    }

    async _cancelBooking() {
      const btn = this.root.querySelector('#bw-cancel-booking');
      if (!this.state.bookingId) {
        if (btn) { btn.disabled = true; btn.textContent = 'Cancelled'; }
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = 'Cancelling\u2026'; }
      await sbReady;
      await sb.from('bookings').update({ status: 'cancelled' }).eq('id', this.state.bookingId);
      const h3 = this.root.querySelector('.bw-confirm h3');
      const p  = this.root.querySelector('.bw-confirm p');
      if (h3) h3.textContent = 'Booking cancelled.';
      if (p)  p.innerHTML    = 'Your booking has been cancelled.';
      if (btn) btn.textContent = 'Cancelled';
    }
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────
  function init() {
    // Find all booking widget script tags on the page
    const scripts = document.querySelectorAll('script[data-business-id]');
    scripts.forEach(s => new BookingWidget(s));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
