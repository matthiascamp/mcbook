# MCBook Full Test Checklist

Work through each section. Tick the box when verified.

---

## Priority Order (if short on time)

1. Booking Flow (Section 11)
2. Widget (Section 12)
3. Services + Availability (Sections 7-8)
4. Login + Auth (Sections 2, 15)
5. Dashboard + Bookings (Sections 4-5)
6. Everything else

---

## 1. Landing Page (`index.html`)

- [ ] 1.1 Open `https://matthiasdev.com/mcbook/` — page loads with hero section, no console errors
- [ ] 1.2 Scroll down slowly — each section fades up smoothly as it enters viewport
- [ ] 1.3 Click each nav link (Features, Pricing, FAQ, etc.) — smooth scroll to correct section
- [ ] 1.4 Click a gallery/screenshot image — lightbox modal opens with enlarged image
- [ ] 1.5 Close the lightbox (click outside or X) — modal closes, page scrollable again
- [ ] 1.6 Resize browser to <768px — hamburger menu appears, nav links collapse
- [ ] 1.7 Click hamburger, then a nav link — menu opens, link scrolls to section and closes menu
- [ ] 1.8 Fill in contact form and submit — Formspree submission succeeds, success message shown
- [ ] 1.9 Submit contact form with empty fields — validation prevents submission, error feedback shown
- [ ] 1.10 Click "Get Started" / CTA buttons — navigates to login or signup page

**Edge cases:**
- [ ] 1.11 Open in Safari — check for layout differences
- [ ] 1.12 Open in Firefox — check for layout differences
- [ ] 1.13 Test on an actual phone (not just resized browser) — touch scrolling works

---

## 2. Login Page (`login.html`)

- [ ] 2.1 Load login page — Sign In tab active by default, email + password fields visible
- [ ] 2.2 Click "Reset Password" tab — form switches to show only email field + reset button
- [ ] 2.3 Click "Sign In" tab again — returns to sign-in form
- [ ] 2.4 Sign in with valid credentials — redirects to `dashboard.html`, session stored
- [ ] 2.5 Sign in with wrong password — error message displayed (e.g. "Invalid login credentials")
- [ ] 2.6 Sign in with non-existent email — error message displayed, no crash
- [ ] 2.7 Submit with empty email field — validation prevents submission
- [ ] 2.8 Submit with empty password field — validation prevents submission
- [ ] 2.9 Click eye icon on password field — password toggles between visible text and dots
- [ ] 2.10 Request password reset with valid email — success message: "Check your email for a reset link"
- [ ] 2.11 Request password reset with invalid email — appropriate error message

**Edge cases:**
- [ ] 2.12 Paste an email with leading/trailing whitespace — should still work or be trimmed
- [ ] 2.13 Submit form by pressing Enter (not clicking button) — should work
- [ ] 2.14 Double-click the sign in button rapidly — should not fire two requests

---

## 3. Admin Login (`admin-login.html`)

- [ ] 3.1 Log in with `matthiasdevelopment@gmail.com` — access granted, redirects to admin dashboard
- [ ] 3.2 Log in with any other email — access denied with error message, even if Supabase auth succeeds

---

## 4. Dashboard (`dashboard.html`)

- [ ] 4.1 Load while authenticated — stats cards load (bookings count, revenue, no-shows), today's schedule populates
- [ ] 4.2 Load with no bookings today — empty state message shown (e.g. "No bookings today")
- [ ] 4.3 Check stats cards — numbers match reality; delta arrows (up/down) show correctly
- [ ] 4.4 Revenue chart renders — chart visible with data or empty state
- [ ] 4.5 Click "Add Booking" button — modal opens with service dropdown, customer fields, date/time pickers
- [ ] 4.6 Fill in all fields and save booking — modal closes, new booking appears in today's schedule (if today)
- [ ] 4.7 Click "View All" on upcoming bookings — navigates to `bookings.html`
- [ ] 4.8 Check sidebar — business name displayed, correct nav item highlighted as active
- [ ] 4.9 Click each sidebar link — navigates to the correct page
- [ ] 4.10 Load on mobile (<768px) — sidebar collapses, hamburger menu works

**Edge cases:**
- [ ] 4.11 Load dashboard with session expired — should redirect to login, not show broken page
- [ ] 4.12 Rapidly navigate away and back — no stale data or double-loaded content

---

## 5. Bookings Page (`bookings.html`)

- [ ] 5.1 Load page — all bookings listed, most recent first
- [ ] 5.2 Filter by status "Scheduled" — only scheduled bookings shown
- [ ] 5.3 Filter by status "Completed" — only completed bookings shown
- [ ] 5.4 Filter by status "Cancelled" — only cancelled bookings shown
- [ ] 5.5 Filter by status "No-show" — only no-show bookings shown
- [ ] 5.6 Filter by date range — only bookings within the range appear
- [ ] 5.7 Clear all filters — full list restored
- [ ] 5.8 Click a booking to view details — detail panel/modal shows full info (customer, service, time, status, notes)
- [ ] 5.9 Change a booking's status to "Completed" — status pill updates, persists on refresh
- [ ] 5.10 Mark a booking as "No-show" — status changes, no-show counter on dashboard increments
- [ ] 5.11 Cancel a booking — status changes to "Cancelled", persists
- [ ] 5.12 Load with zero bookings — empty state message shown, no errors

**Edge cases:**
- [ ] 5.13 Filter to a combination that returns zero results — should show empty state, not broken layout
- [ ] 5.14 Booking with very long customer name or notes — should not break layout

---

## 6. Customers Page (`customers.html`)

- [ ] 6.1 Load page — all customers listed with name, email, phone
- [ ] 6.2 Search for a customer by name — list filters in real-time
- [ ] 6.3 Search for a customer by email — correct match appears
- [ ] 6.4 Click a customer — detail view shows booking history for that customer
- [ ] 6.5 Load with zero customers — empty state message

**Edge cases:**
- [ ] 6.6 Search with special characters (`<script>`, `"`, `&`) — no XSS, shows "no results"
- [ ] 6.7 Customer with no phone number — field shows gracefully (blank or "N/A"), not "null"

---

## 7. Services Page (`services.html`)

- [ ] 7.1 Load page — all services listed with name, price, duration, payment mode
- [ ] 7.2 Click "Add Service" — modal/form opens
- [ ] 7.3 Create service: name "Test Cut", price $50, duration 30min, payment mode "Free" — service appears in list
- [ ] 7.4 Create service with payment mode "Upfront" — saved with correct payment mode
- [ ] 7.5 Create service with payment mode "Noshow_only" — saved correctly
- [ ] 7.6 Create service with payment mode "After" — saved correctly
- [ ] 7.7 Edit an existing service name — updated in list, persists on refresh
- [ ] 7.8 Edit service price — updated correctly
- [ ] 7.9 Delete a service — removed from list (confirm dialog first)
- [ ] 7.10 Toggle service active/inactive — visual indicator changes, inactive services hidden from booking widget

**Edge cases:**
- [ ] 7.11 Create service with price $0 — should be allowed for "Free" mode
- [ ] 7.12 Create service with empty name — validation should block
- [ ] 7.13 Create service with very long name (100+ chars) — should not break layout
- [ ] 7.14 Create service with negative price — should be rejected
- [ ] 7.15 Delete a service that has existing bookings — should warn or handle gracefully

---

## 8. Availability Page (`availability.html`)

- [ ] 8.1 Load page — weekly schedule grid shows current hours for each day
- [ ] 8.2 Set Monday: 9:00 AM - 5:00 PM — saves, reflected in booking widget time slots
- [ ] 8.3 Set Sunday: closed (no hours) — Sunday shows no slots in booking widget
- [ ] 8.4 Block a specific date (e.g. 2026-05-01) — that date shows as unavailable in booking calendar
- [ ] 8.5 Set minimum notice to 2 hours — slots within 2 hours of now are not bookable
- [ ] 8.6 Set minimum notice to 24 hours — slots within 24 hours of now are not bookable
- [ ] 8.7 Remove a blocked date — date becomes available again
- [ ] 8.8 Set advance booking window — dates beyond the window are greyed out in calendar

**Edge cases:**
- [ ] 8.9 Set end time before start time (e.g. 5PM - 9AM) — should reject or warn
- [ ] 8.10 Set availability for today with times already past — past slots should not appear
- [ ] 8.11 Block today's date when bookings exist — existing bookings remain, but no new ones allowed
- [ ] 8.12 Set minimum notice to 0 — all future slots should be available
- [ ] 8.13 Set overlapping availability windows — should handle or prevent

---

## 9. Stripe Onboarding (`stripe-onboarding.html`)

- [ ] 9.1 Load page (Stripe not connected) — "Connect Stripe" button visible, status shows "Not connected"
- [ ] 9.2 Click "Connect Stripe" — redirects to Stripe OAuth flow
- [ ] 9.3 Complete Stripe OAuth and return — status updates to "Connected" or "Pending"
- [ ] 9.4 Load page (Stripe already connected) — status shows "Connected", re-auth option available
- [ ] 9.5 Click re-authorize — initiates new OAuth flow

**Edge cases:**
- [ ] 9.6 Return from Stripe with an error parameter in URL — error message displayed
- [ ] 9.7 Load page while not authenticated — redirect to login

---

## 10. Embed / Share Page (`embed.html`)

- [ ] 10.1 Load page — shareable booking link displayed, embed code shown
- [ ] 10.2 Click "Copy" on booking link — link copied to clipboard, "Copied!" feedback shown
- [ ] 10.3 Click "Copy" on embed code — HTML snippet copied to clipboard
- [ ] 10.4 Open the shareable link in an incognito window — booking page loads correctly for your business
- [ ] 10.5 Paste embed code into a test HTML file and open — widget renders inside the page

---

## 11. Booking Flow — Standalone (`book.html`) ⭐ CRITICAL PATH

- [ ] 11.1 Open `book.html?id=YOUR_CLIENT_ID` — business name/logo loads, service list shown
- [ ] 11.2 Open `book.html` with no ID — error message: "No business found" or similar
- [ ] 11.3 Open `book.html?id=INVALID_ID` — error message, not a blank page
- [ ] 11.4 Select a service — calendar view appears with available dates
- [ ] 11.5 Verify unavailable dates are greyed out — blocked dates, past dates, days with no hours not selectable
- [ ] 11.6 Select an available date — time slots load for that date
- [ ] 11.7 Verify time slots respect availability rules — only slots within business hours appear
- [ ] 11.8 Verify time slots respect minimum notice — slots too soon are not shown
- [ ] 11.9 Verify already-booked slots are excluded — a time with an existing booking does not appear
- [ ] 11.10 Select a time slot — customer details form appears (name, email, phone)
- [ ] 11.11 Fill in valid customer info — "Next" enabled
- [ ] 11.12 Leave name empty — validation blocks progression
- [ ] 11.13 Enter invalid email (e.g. "notanemail") — validation blocks progression
- [ ] 11.14 **FREE service:** Complete booking — confirmation shown, booking appears in your dashboard
- [ ] 11.15 **UPFRONT service:** Card form appears — Stripe Elements card fields render (Card Number, Expiry, CVC)
- [ ] 11.16 Enter valid test card `4242 4242 4242 4242` — payment processes, booking confirmed
- [ ] 11.17 Enter declined card `4000 0000 0000 0002` — error: "Your card was declined", booking not created
- [ ] 11.18 **NOSHOW_ONLY service:** Card form appears — card saved (SetupIntent), no charge, booking confirmed
- [ ] 11.19 **AFTER service:** Card form appears — card saved, booking confirmed, charge expected later
- [ ] 11.20 After successful booking, confirmation screen — shows date, time, service name, confirmation message

**Edge cases:**
- [ ] 11.21 Book the last available slot on a day, then try booking again — slot should be gone
- [ ] 11.22 Open booking page in two tabs, select same slot, submit both — only one should succeed
- [ ] 11.23 Enter card number with spaces or dashes — Stripe Elements handles formatting
- [ ] 11.24 Slow network: click "Confirm" and wait — button disables, spinner shown, no double-submit
- [ ] 11.25 Extremely long customer name or phone number — should not break layout
- [ ] 11.26 Book for the maximum advance date — should work if within window
- [ ] 11.27 Book at exactly the minimum notice boundary — edge timing

---

## 12. Booking Widget (`widget.js` / `widget-demo.html`)

- [ ] 12.1 Open `widget-demo.html`, enter your business ID — widget renders inside the page
- [ ] 12.2 Complete a full booking through the widget — service → date → time → details → payment → confirmation
- [ ] 12.3 Widget styles do not leak to host page — host page fonts/colors unaffected (Shadow DOM)
- [ ] 12.4 Host page styles do not leak into widget — widget looks correct regardless of host CSS
- [ ] 12.5 Stripe card inputs render correctly — Card Number, Expiry, CVC visible and functional
- [ ] 12.6 Embed widget in a page with conflicting CSS (e.g. `* { color: red }`) — widget unaffected

**Edge cases:**
- [ ] 12.7 Load widget with an invalid business ID — error state, not blank
- [ ] 12.8 Resize the widget container to very narrow (<300px) — should remain usable or show message
- [ ] 12.9 Embed on a page with no access to Stripe CDN — graceful error

---

## 13. Cancel Booking (`cancel.html`)

- [ ] 13.1 Open cancel page with valid booking ID — booking details shown (date, service, customer)
- [ ] 13.2 Click "Cancel Booking" — confirmation prompt, then status changes to "Cancelled"
- [ ] 13.3 Open cancel page with invalid/nonexistent booking ID — error: "Booking not found"
- [ ] 13.4 Try to cancel an already-cancelled booking — message: "This booking is already cancelled"
- [ ] 13.5 Try to cancel a past/completed booking — should be rejected or warned

---

## 14. Settings Page (`settings.html`)

- [ ] 14.1 Load page — current business info pre-filled
- [ ] 14.2 Update business name and save — change persists, reflected in sidebar and booking page header
- [ ] 14.3 Update email and save — confirmation email sent if email change confirmation enabled
- [ ] 14.4 Save with no changes — no error, no unnecessary update

---

## 15. Authentication & Session

- [ ] 15.1 Access any dashboard page while logged out — redirect to `login.html`
- [ ] 15.2 Log in, close browser, reopen dashboard — session persists (localStorage), still logged in
- [ ] 15.3 Click Sign Out in sidebar — session cleared, redirect to login
- [ ] 15.4 After sign out, press browser Back button — should not show dashboard data, redirect to login
- [ ] 15.5 Open dashboard in two tabs, sign out in one — other tab redirects to login on next action

---

## 16. Responsive / Mobile

- [ ] 16.1 Every page at 375px width (iPhone SE) — no horizontal scroll, all content readable
- [ ] 16.2 Every page at 768px width (iPad) — tablet layout clean, sidebar may collapse
- [ ] 16.3 Sidebar on mobile — hamburger menu works, overlay appears, links navigate correctly
- [ ] 16.4 Booking widget on mobile — calendar, time slots, and card inputs all usable with touch
- [ ] 16.5 Modals on mobile — scrollable if content overflows, close button reachable

---

## 17. Cross-Browser

Test in **Chrome, Safari, and Firefox:**

- [ ] 17.1 Landing page animations
- [ ] 17.2 Login flow
- [ ] 17.3 Booking widget (Shadow DOM support)
- [ ] 17.4 Stripe card inputs
- [ ] 17.5 Calendar date picker
- [ ] 17.6 Modal open/close

---

## 18. Deployment Pipeline

- [ ] 18.1 Push a small change to `main` — GitHub Action triggers
- [ ] 18.2 Check Actions tab — workflow runs: checkout, rsync, commit, push
- [ ] 18.3 After workflow completes, check live site — change reflected at `matthiasdev.com/mcbook/`

---

## Notes

_Use this space for bugs or observations found during testing:_

-
-
-
-
-
