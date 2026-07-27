# About and Contact Orbit Story Design

Date: 2026-07-27
Status: Draft for review

## Context

The current Lumi5 Labs application has a coherent public homepage and
authentication system built around dark navy, indigo, green, soft neutral
surfaces, rounded cards, and a connection-orbit motif. The public About and
Contact information currently lives on the separate `www.lumi5labs.com`
website, whose square, editorial visual system does not match the application.

The approved change brings the complete About and Contact content into this
repository as local pages, while preserving the information on the source
pages and expressing it in the application's current visual language.

Source references:

- `https://www.lumi5labs.com/about/`
- `https://www.lumi5labs.com/contact/`

## Goals

- Add local `about.html` and `contact.html` pages that feel native to the
  current Lumi5 application.
- Preserve all user-facing information from the two source pages.
- Use the approved **Orbit Story** direction across both pages.
- Remove the AI/Singapore hero artwork entirely.
- Retain the real Raveen Beemsingh and Victor Chow leadership portraits.
- Preserve full public navigation and clear Sign in and Sign up routes.
- Replace the source Contact page's unreliable `mailto:` form with a real,
  database-backed website submission.
- Provide accessible, responsive pages with clear keyboard and form-feedback
  behavior.
- Avoid changing authentication, portfolio, messaging, dashboard, assignment,
  or role behavior.

## Non-goals

- Redesigning `index.html`, `signin.html`, `signup.html`, or any dashboard.
- Changing the five-role workflow.
- Changing the messaging or portfolio database model.
- Adding a content-management system.
- Adding an admin inbox for contact submissions in this change.
- Sending outbound email or integrating Brevo, SMTP, SendGrid, or another mail
  provider before credentials and delivery requirements are supplied.
- Recreating the removed AI artwork in another style.
- Importing a new font, icon framework, or frontend build system.

## Approved Visual Direction

The approved direction is **Orbit Story**, with no AI imagery.

Both pages use:

- Deep navy-to-indigo hero surfaces
- Thin orbital rings and small labelled nodes
- Indigo as the primary interaction color
- Green as the trust and success accent
- White and light-lavender content surfaces
- Rounded cards, restrained borders, and soft shadows
- The existing system sans-serif stack
- Generous spacing and clear editorial hierarchy

The orbit is an abstract representation of people, knowledge, capital, and
communication connecting through Lumi5 Labs. It must remain decorative and
must never imply live database matching, guaranteed funding, or an actual
recommendation.

No page may load or reference `ai.webp`, use an AI-generated hero image, or
replace it with another synthetic or stock hero image.

## Shared Public Shell

### Header

The About and Contact pages share one public header containing:

- Lumi5 Labs mark, wordmark, and the strapline
  **Inspire, Innovate, Impact**
- Home
- About
- Portfolio
- Blog
- FAQ
- Contact
- Sign in
- Sign up

Routes:

- Home → `index.html`
- About → `about.html`
- Contact → `contact.html`
- Sign in → `signin.html`
- Sign up → `signup.html`
- Portfolio → `https://www.lumi5labs.com/portfolio/`
- Blog → `https://www.lumi5labs.com/blog/`
- FAQ → `https://www.lumi5labs.com/faq/`

The current local page uses `aria-current="page"`. External public links remain
same-tab links so the public site behaves like one coherent website.

### Footer

Both pages use the same footer and preserve:

- Brand: **LUMI5 LABS**
- Description: **A venture studio and innovation lab based in Singapore,
  fueling the growth of technology startups with expert guidance and funding.**
- Navigation: Home, About, Portfolio, Blog, FAQ, Contact
- Address:
  - `1 Fullerton Rd, #02-01 One Fullerton`
  - `Singapore 049213`
- Email: `business@lumi5labs.com`
- Phone: `+65-6599-1991`
- LinkedIn: `https://www.linkedin.com/company/lumi5-labs/`
- Instagram: `https://www.instagram.com/lumi5labs/`
- Bluesky: `https://bsky.app/profile/lumi5labs.bsky.social`
- Facebook: `https://www.facebook.com/profile.php?id=61575224522339`
- Copyright: **Copyright © 2026 LUMI5 LABS**
- Version: `v26.02.13.1`

The email uses a `mailto:` link and the phone uses a `tel:` link. Social links
have visible or accessible names rather than unexplained icon-only controls.

## About Page

### 1. Hero — Our Story

The hero contains:

- Eyebrow: **01 · Our Story**
- Primary headline: **Ideas grow through connection.**
- Supporting identity: **About Lumi5 Labs**
- Supporting statement describing Lumi5 Labs as a venture studio and
  innovation lab connecting visionary founders, strategic guidance,
  technology, and capital
- Context chips: Singapore, Venture building, Meaningful impact
- A decorative Orbit Story illustration with the labels Founders, Capital,
  Technology, and Impact

The illustration uses CSS shapes only. It is exposed as one accessible summary:
**Lumi5 Labs connects founders, capital, technology, and meaningful impact.**
Its internal rings and nodes are hidden from assistive technologies.

### 2. Journey

The page preserves:

- Eyebrow: **02 · Journey**
- Heading: **Our Inspiring Journey**
- All three source paragraphs, verbatim:

> In a world where innovation knows no bounds, two visionary leaders, Raveen
> Beemsingh and Victor Chow, embarked on a journey to create something
> extraordinary. Raveen, the co-founder of Hammerhead, had already made his
> mark by developing cutting-edge software solutions and mentoring startups
> through Techstars. Meanwhile, Victor, with his extensive background in
> SingTel-NCS, Huawei, Fatfish Group, and InspirAsia Fintech Accelerator, had a
> proven track record of fostering entrepreneurship and growth.

> Their paths converged when they decided to establish Lumi5 Labs, a venture
> studio and innovation lab dedicated to investing in, nurturing, and
> transforming startups, small businesses, and large corporations. This
> collaboration was not just about combining their expertise; it was about
> creating a platform where their collective knowledge could empower others.

> Raveen brought his technical prowess and entrepreneurial spirit, while Victor
> contributed his strategic insights and experience in scaling businesses
> across diverse regions. Together, they crafted a unique ecosystem where
> startups could flourish and established companies could innovate. Lumi5 Labs
> became a beacon for those seeking to disrupt industries and redefine success.

### 3. Vision

The page preserves:

- Eyebrow: **03 · Vision**
- Heading: **A Legacy of Innovation and Inspiration**
- All four source statements:

1. **Raveen Beemsingh and Victor Chow, founders of Lumi5 Labs, aimed to create a
   global legacy of innovation and inspiration. Their vision extended beyond
   startups to a global network of innovation labs, empowering entrepreneurs
   and businesses.**
2. **They are seeking strategic corporate partners to launch the Lumi5
   Foundation, offering educational programs and investing in sustainable
   ventures addressing global challenges.**
3. **Quarterly Lumi5 workshops brought together thought leaders and startup
   founders to share ideas and celebrate innovation. Their mission wasn't just
   about profits—it was about uplifting communities, driving sustainability,
   and creating lasting impact.**
4. **Raveen and Victor want to transform Lumi5 Labs into a movement, inspiring
   future generations to innovate and shape a better world.**

The four statements appear in connected, readable cards. The numbers are
organizational labels, not a ranked sequence.

### 4. Leadership

The page preserves:

- Eyebrow: **04 · Leadership**
- Heading: **The Team**

Raveen Beemsingh:

- Role: **CEO & CTO**
- Official portrait saved as a local project asset from
  `https://www.lumi5labs.com/images/raveen.webp`
- Biography paragraph 1:
  **Raveen Beemsingh is a 2-time exited entrepreneur and technology leader with
  over two decades of experience in software development and technology
  ventures. His entrepreneurial journey includes co-founding Hammerhead, a
  cycling technology company, where he served as Chief Technology Officer and
  led the company through the TechStars accelerator program. The company was
  later acquired by SRAM.**
- Biography paragraph 2:
  **Recently Raveen co-founded Lumi5 Labs with Victor, contributing his
  expertise to innovative projects. Prior to his current role, he was the CTO
  at Leadzen.ai. He has also co-founded LuminaryLane, an AI brand builder. His
  expertise spans Hardware, Gen AI and 0-to-1 product building. Raveen actively
  mentors startups through Techstars.**
- LinkedIn: `https://www.linkedin.com/in/raveenbeemsingh/`
- X: `https://x.com/rbmsingh`
- Instagram: `https://www.instagram.com/raveenb/`
- Personal blog: `https://raveenb.lumi5labs.com/`

Victor Chow:

- Role: **COO & CMO**
- Official portrait saved as a local project asset from
  `https://www.lumi5labs.com/images/victor.webp`
- Biography paragraph 1:
  **Victor Chow is a seasoned entrepreneur and corporate leader with over 30
  years of experience in investments, startups, telecommunications, cloud
  computing and blockchain technologies. He has held C-level positions across
  general management, strategic planning, and global operations in Asia
  Pacific, Europe, and North America.**
- Biography paragraph 2:
  **Victor's roles include CEO of Aristagora International, a multi-family
  office subsidiary of Aristagora Advisors based in Tokyo. He also served as
  Venture Partner for Fatfish Group. Previously, Victor was the Global COO for
  Cloud Computing at Huawei Technologies and the Global Business Director for
  SingTel-NCS Group. His expertise in fintech led him to become the Founding
  CEO of InspirAsia Fintech Accelerator.**
- LinkedIn: `https://www.linkedin.com/in/victorchowsingapore/`
- Personal blog: `https://victorc.lumi5labs.com/`

The portraits are the only photographic imagery on the About page. Images use
descriptive alt text, explicit dimensions, and lazy loading below the fold.

### 5. Connect

The closing section preserves:

- Eyebrow: **05 · Connect**
- Heading: **Let's Innovate Together**
- Copy: **Connect with us to explore how we can make your vision a reality.
  Join us in shaping the future.**
- Get Started → `contact.html`

## Contact Page

### 1. Hero

The hero preserves:

- Eyebrow: **01 · Connect**
- Heading: **Contact Us**
- Copy: **Here is how you can contact us for any questions or concerns.**
- A CSS-only contact orbit with Visit, Email, and Call nodes

The orbit uses the accessible summary:
**Connect with Lumi5 Labs by visiting, emailing, calling, or sending a website
message.**

### 2. Contact Details

The details section preserves:

- Eyebrow: **02 · Details**
- Heading: **Get in Touch**
- Address:
  - `1 Fullerton Rd, #02-01 One Fullerton`
  - `Singapore 049213`
- Phone: `+65-6599-1991`
- Email: `business@lumi5labs.com`

The address links to Google Maps. A lazy-loaded map embed uses the title
**Lumi5 Labs office location at One Fullerton, Singapore** and appears inside
the approved rounded map panel. A direct **Open in Google Maps** link remains
available if the iframe is unavailable.

The visible One Fullerton address is canonical. The conflicting Ang Mo Kio
address found only in the source site's metadata is not imported.

### 3. Website Message Form

The form preserves the source fields:

- Name — required, placeholder **Your name**
- Email — required, placeholder **your@email.com**
- Message — optional, placeholder **How can we help you?**
- Submit action: **Send Message**

The form submits through the local API and never invokes the visitor's email
application.

The optional Message field intentionally preserves the source form contract.
Name and Email alone are accepted as a request for the team to make contact;
the form does not invent a required-message rule that the current public page
does not communicate.

Client states:

1. **Idle** — fields are editable and the button is enabled only when the two
   required fields pass client validation.
2. **Sending** — the button is disabled and labelled **Sending…**.
3. **Success** — show **Message received. We'll get back to you soon.**, clear
   the fields, and return focus to the feedback region.
4. **Validation error** — preserve every entered value and show field-specific
   guidance.
5. **Network/server error** — show **We couldn't send your message. Your text
   is still here—please retry.**, preserve every entered value, and re-enable
   submission.

Duplicate clicks cannot create concurrent requests. A successful response is
the only event that clears user input.

## Contact Data Model and API

The approved implementation stores public Contact submissions in the same
MySQL database as the rest of the application.

New table: `contact_submissions`

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `BIGINT UNSIGNED` | Primary key, auto-increment |
| `name` | `VARCHAR(100)` | Required |
| `email` | `VARCHAR(255)` | Required |
| `message` | `TEXT` | Nullable because the source field is optional |
| `created_at` | `TIMESTAMP` | Required, default current timestamp |

Add an index on `created_at` for chronological retrieval. No public read,
update, or delete route is added. Workflow status fields are deferred until a
staff inbox exists and has an approved lifecycle, so this initial table does
not carry unused state.

Public endpoint:

- `POST /api/contact`

Request:

```json
{
  "name": "Visitor name",
  "email": "visitor@example.com",
  "message": "Optional message"
}
```

Validation:

- Trim all string values.
- Name: 1–100 Unicode characters.
- Email: valid format and at most 255 characters.
- Message: optional and at most 5,000 Unicode characters.
- Reject unexpected non-string field types.
- Reject invalid input with `400` and safe field-level errors.
- Reject oversized JSON through the existing global request-body limit.

Abuse controls:

- Include an off-screen `company_website` honeypot with
  `autocomplete="off"` and no keyboard tab stop. It is not a user-visible
  form field.
- If the honeypot is populated, return the same generic `201` response without
  inserting a row, so automated senders receive no useful detection signal.
- Apply an endpoint-specific limit of five requests per source IP in a rolling
  15-minute window with standard rate-limit headers.
- The API runs behind the existing local Apache reverse proxy. Configure one
  trusted proxy hop so the limiter uses the actual client address without
  trusting arbitrary forwarding chains.
- A limited request returns `429` with
  `{ "error": "Too many requests. Please try again later." }`.
- Implement the limiter through the maintained `express-rate-limit` package;
  its in-memory store is sufficient for the current single-process deployment.
- Tests cover the allowed boundary, the sixth-request rejection, the generic
  honeypot response, and the absence of a database insert for honeypot input.

Success:

- Insert one database row.
- Return `201` with `{ "message": "Message received" }`.
- Do not return the database ID or echo submitted personal information.

Failure:

- Return a safe `500` response through the existing global handler.
- Do not clear client input.
- Do not log the submitted name, email, or message.

The displayed email and phone remain direct alternatives. Outbound email
delivery and a staff inbox are separate future changes.

## Implementation Boundaries

Expected files:

- Add `about.html`.
- Add `contact.html`.
- Add local leadership image assets under a new `images/` directory.
- Extend only public-content styles in `css/style.css`, scoped beneath a
  page-specific public content body class.
- Add `js/contact.js` for form validation, state, and submission behavior.
- Add `API.submitContact(...)` in `js/api.js`.
- Add the Contact API route and a small database workflow/service.
- Register the route in `backend/server.js`.
- Add the pinned `express-rate-limit` runtime dependency in
  `backend/package.json` and `backend/package-lock.json`.
- Add the `contact_submissions` table to `backend/schema.sql`, the schema
  contract, production schema metadata fixture, and a focused migration.
- Add focused frontend, route, workflow, schema, and navigation tests.

Existing authentication, dashboards, messaging, assignments, portfolio logic,
and their DOM contracts remain unchanged.

## Responsive Behavior

- At 980 pixels and above:
  - Full public navigation is visible.
  - About and Contact heroes use two columns.
  - Journey and Vision use a title/content split.
  - Leadership cards and Contact details/form use two columns.
- From 661 through 979 pixels:
  - Navigation uses the compact keyboard-operable menu while content sections
    stack.
  - The orbit follows the hero copy.
  - Contact details appear before the form.
- At 660 pixels and below:
  - The same keyboard-operable native `details`/`summary` navigation remains
    in use.
  - Sign up remains visible as the primary header action.
  - All content becomes one column.
  - Team portraits and text remain readable without clipping.
  - Form controls and primary actions remain at least 44 pixels high.

No supported viewport may introduce horizontal overflow.

## Accessibility

- Use semantic header, navigation, main, section, article, form, address, and
  footer elements.
- Give each page one `h1` and a logical heading hierarchy.
- Use `aria-current="page"` on active navigation.
- Keep visible keyboard focus on all interactive elements.
- Meet WCAG AA text and control contrast.
- Do not use color alone for meaning.
- Hide decorative orbit internals and expose one concise accessible summary.
- Respect `prefers-reduced-motion`; orbit motion becomes static.
- Associate every form field with its label and error message.
- Announce form status through one polite live region.
- Move focus to invalid fields or final status only when it materially helps;
  do not unexpectedly shift focus during normal typing.
- Provide a meaningful fallback link for the map.

## Performance and Reliability

- Store leadership portraits locally so page rendering does not depend on the
  source website.
- Use WebP assets with fixed dimensions.
- Lazy-load below-the-fold portraits and the map.
- Require no JavaScript to understand the About content or Contact details.
- Require JavaScript only for form validation and submission; the responsive
  navigation is native HTML and CSS.
- If decorative CSS fails, headings, copy, links, and the form remain usable.
- If the map fails, the address and direct map link remain usable.

## Verification

Automated:

- About and Contact pages contain all required source content and links.
- Neither page references `ai.webp` or contains an AI hero image.
- Header and footer navigation destinations are exact.
- Leadership images and social destinations are present.
- Contact client validates inputs, prevents duplicate submission, preserves
  fields on failure, and clears only on success.
- Contact route accepts valid input, rejects invalid boundaries, writes one
  row, and never exposes stored PII in its response.
- Schema, schema contract, metadata fixture, and migration agree.
- Existing full backend and frontend contract tests still pass.

Browser:

- Both pages render without console errors.
- Desktop and narrow layouts have no horizontal overflow.
- Header links, footer links, mail, phone, map, Sign in, and Sign up work.
- Keyboard order and focus treatment are correct.
- Reduced-motion mode removes optional animation.
- Founder portraits load locally.
- The Contact form demonstrates idle, sending, success, validation-error, and
  retry behavior against the API.
- Refreshing after a successful Contact submission does not resubmit it.
- The existing homepage, authentication, dashboards, portfolios, and messaging
  retain their current behavior.

Database:

- The migration is idempotent.
- `contact_submissions` matches the schema contract.
- A successful browser submission creates exactly one row.
- A rejected or failed submission creates no row.

## Acceptance Criteria

The change is complete when:

- `about.html` and `contact.html` match the approved Orbit Story mockups.
- No AI imagery appears on either page.
- All source-page user-facing information is preserved.
- The founder portraits, contact details, map destination, social links, and
  full public navigation work.
- Contact submissions are validated, saved to MySQL, and acknowledged inline.
- Error paths preserve the visitor's text.
- Both pages are responsive, accessible, and free of introduced console errors.
- The full existing test suite remains green.
- No unrelated application flow is changed.
