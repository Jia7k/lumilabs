# Public Index Page Revamp Design

Date: 2026-07-27
Status: Visual direction approved; awaiting written-spec review

## Context

The current `index.html` presents Lumi5 Labs as a five-role prototype selector. That exposes internal operational roles on the public homepage and makes the first impression feel like a system demonstration rather than a real investment platform.

The replacement will be a public marketing homepage centered only on the platform's two external audiences:

- Business owners seeking investment
- Investors seeking reviewed opportunities

Internal account types will continue to use the generic sign-in flow, but the index page will not name or advertise them.

## Goals

- Present Lumi5 Labs as a credible, focused investment-connection platform.
- Give business owners and investors distinct, immediately understandable paths.
- Remove every visible and accessibility-text mention of internal staff roles from `index.html`.
- Keep returning-user sign-in and new-user sign-up clearly differentiated.
- Preserve the existing authentication, role routing, dashboards, backend, and database behavior.
- Produce a responsive, accessible landing page that remains visually coherent with the authenticated application.

## Non-goals

- Changing authentication or authorization.
- Changing the role model or database schema.
- Changing any dashboard or staff workflow.
- Redesigning `signin.html` or `signup.html`.
- Adding live homepage statistics, testimonials, partner logos, or claims that the database does not support.
- Adding a new API dependency to render the public homepage.

## Approved Direction

The approved direction is **Dual Journey + Connection Orbit**.

The page uses a light, modern visual system with indigo as the main brand color, green as a supporting investment color, generous whitespace, soft neutral backgrounds, and restrained card shadows. The hero pairs direct product copy with a Connection Orbit illustration that communicates aligned priorities without exposing internal workflow.

The page must not visibly mention:

- Relationship manager
- Administrator
- Superadmin

The generic **Sign in** action remains sufficient for every existing account type.

## Page Structure

### 1. Navigation

The navigation contains:

- Lumi5 Labs logo and wordmark
- **Sign in**, linking to `signin.html`
- **Sign up**, linking to `signup.html`

There is no top-level “How it works” link. The explanatory content remains lower on the page.

### 2. Hero

The hero uses a two-column desktop layout and a stacked mobile layout.

Approved copy:

- Eyebrow: **Focused investment connections**
- Headline: **Funding, found with focus.**
- Supporting copy: **Connect promising businesses with investors who understand their potential—through clearer discovery and meaningful conversations.**

Primary actions:

- **Raise capital**, linking to `signup.html?role=business_owner`
- **Explore opportunities**, linking to `signup.html?role=investor`

Supporting line:

- **Built for ambitious businesses and thoughtful investors**

### 3. Connection Orbit

The right side of the hero contains an abstract orbit centered on the Lumi5 Labs spark mark. Four example alignment labels surround it:

- HealthTech
- Series A
- Strategic capital
- Southeast Asia

These labels illustrate how shared priorities form a relevant connection. They are not live database values and must not imply a real recommendation or guaranteed match.

The orbit container uses `role="img"` with the accessible summary: **Lumi5 Labs connects businesses and investors around shared sector, stage, geography, and capital priorities.** Its internal nodes and lines are hidden from assistive technology.

Any motion must be subtle and disabled when `prefers-reduced-motion` is enabled.

### 4. Trust Strip

A compact strip directly below the hero communicates three platform qualities:

- Reviewed opportunities
- Relevant introductions
- Focused conversations

These are qualitative product statements, not numerical claims.

### 5. Audience Paths

The audience section is headed:

- Kicker: **Choose your path**
- Heading: **One platform, two ambitions**
- Supporting copy: **Whether you are building what comes next or investing in it, Lumi5 Labs helps you reach the right people.**

It contains two equal cards.

Business-owner card:

- Heading: **For business owners**
- Copy: **Showcase your company, present your opportunity clearly and connect with investors aligned to your ambitions.**
- Action: **Start raising**, linking to `signup.html?role=business_owner`

Investor card:

- Heading: **For investors**
- Copy: **Discover reviewed businesses, evaluate relevant opportunities and express interest with confidence.**
- Action: **Start exploring**, linking to `signup.html?role=investor`

### 6. Explanatory Section

The lower-page section is headed **A clearer path to the right connection** and contains three steps:

1. **Build or browse** — Present your business or explore opportunities matched to your interests.
2. **Signal interest** — Move promising opportunities forward with a clear expression of interest.
3. **Start a conversation** — Connect in one focused space and build the relationship from there.

This section remains on the page even though “How it works” is removed from the top navigation.

### 7. Final Call to Action

The closing panel contains:

- Heading: **Find your next meaningful connection.**
- Copy: **Join Lumi5 Labs and take the next step with greater focus.**
- Action: **Sign up**, linking to `signup.html`

### 8. Footer

The footer contains only:

- Lumi5 Labs
- Focused investment connections

No internal account types or operational links are exposed.

## Interaction and Routing

The homepage remains static and does not fetch data from the API or database.

Navigation flow:

1. Existing users select **Sign in**.
2. New users select **Sign up**, **Raise capital**, **Explore opportunities**, **Start raising**, or **Start exploring**.
3. Audience-specific actions retain the existing role query parameters so the signup page can preselect the appropriate public role.
4. Authentication and role-based dashboard routing continue to happen through the existing sign-in and signup flows.

The index page does not add automatic session redirects or new session parsing. It remains usable as a public landing page, and the decorative hero visual must not depend on JavaScript to appear.

## Implementation Boundaries

Expected implementation scope:

- Replace the public landing-page markup in `index.html`.
- Replace or extend only landing-page styles in `css/style.css`.
- Leave `js/script.js` unchanged; the redesigned page requires no new JavaScript behavior.
- Add focused automated tests for public copy, links, forbidden internal-role text, and responsive structural hooks.

Add a `landing-page` class to the index body and scope all new landing selectors beneath it so the styles cannot alter dashboards, messaging, authentication pages, or other shared components.

No backend, database, SFTP structure, dashboard, or messaging change is part of this work.

## Responsive Behavior

- At 900 pixels and above: two-column hero, three-column trust strip, two audience cards, and three explanatory steps.
- From 600 through 899 pixels: single-column hero and audience cards; trust items and explanatory steps remain three columns.
- Below 600 pixels: hero, trust items, audience cards, and explanatory steps all become one readable column.
- Navigation retains the logo, Sign in, and Sign up without horizontal overflow.
- Primary actions remain at least 44 pixels high.
- Orbit labels remain legible and do not overlap or clip.
- Content order on mobile is hero copy, hero graphic, trust strip, audience paths, explanatory steps, final call to action, and footer.

## Accessibility

- Use semantic `nav`, `main`, `section`, heading, link, and footer elements.
- Maintain a logical heading hierarchy with one page-level heading.
- Provide visible keyboard focus states for every link.
- Meet WCAG AA contrast for text and interactive controls.
- Do not use color alone to explain the two audience paths.
- Expose only the orbit container's approved accessible summary and hide its internal decorative shapes.
- Honor reduced-motion preferences.
- Keep touch targets at least 44 by 44 pixels.

## Error Handling

The homepage has no API-driven loading or empty state.

- Broken or unavailable decorative effects must degrade to static content without hiding the headline or calls to action.
- The page must not require local session data to render.
- Link destinations use existing local pages and query formats.
- No user-facing error message is required unless existing authentication routing reports one.

## Verification

Automated checks:

- `index.html` contains no case-insensitive visible or accessibility-text mention of the three internal staff-role names.
- Sign in points to `signin.html`.
- Generic Sign up points to `signup.html`.
- Business-owner calls to action point to `signup.html?role=business_owner`.
- Investor calls to action point to `signup.html?role=investor`.
- The required hero, audience, explanatory, final-call-to-action, and footer copy is present.
- No dashboard or messaging regression tests fail.

Browser checks:

- Desktop and 390-pixel mobile layouts have no horizontal overflow.
- Sign in and all signup paths open the correct page.
- Keyboard navigation follows the visual order and focus is visible.
- The Connection Orbit remains readable without overlapping labels.
- Reduced-motion mode removes optional animation.
- The browser console contains no errors or warnings introduced by the page.
- Signing in with each existing account type continues to route to its current dashboard through the unchanged sign-in flow.

## Acceptance Criteria

The design is complete when:

- The implemented page matches the approved Dual Journey + Connection Orbit direction.
- Only business owners and investors are presented as public audience paths.
- No internal staff role is named anywhere on the public index page.
- Sign in and Sign up have distinct, correct destinations.
- All five account types can still use the unchanged generic sign-in flow.
- The page works at desktop and mobile widths and passes the focused automated checks.
- No unrelated file or workflow is changed.
