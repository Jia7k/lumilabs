# Demo Business-Owner Data Design

## Objective

Add three new business-owner accounts—Charlie, Delta, and Echo—to the live
`lumi5_labs` database. Give each owner exactly three realistic approved
portfolios, for nine new portfolios total. Existing users, portfolios,
interests, conversations, messages, documents, and notifications must remain
unchanged except for the new approval records described below.

## Accounts

| Name | Email | Role |
| --- | --- | --- |
| Charlie | `charlie@lumilabs.test` | `business_owner` |
| Delta | `delta@lumilabs.test` | `business_owner` |
| Echo | `echo@lumilabs.test` | `business_owner` |

All three accounts use the shared temporary credential selected by the user.
The plaintext credential must never be committed, written to a backup, printed,
or included in shell history. Generate an independent bcrypt hash for each
account immediately before insertion.

## Portfolio Dataset

Every portfolio has a populated `description`, `funding_goal`, `team_size`,
`founded_year`, `location`, `website`, `monthly_revenue`, `user_count`,
`growth_rate`, `market_size`, `competitor_analysis`, `advisor_names`,
`burn_rate`, and `runway_months`. Websites use the reserved `.example` domain
so no dummy record links to a real organization.

### Charlie

1. **NovaLedger**
   - Sector/stage: `Fintech`, `Launched`
   - Description: Cloud finance operations software that automates cash-flow
     forecasting, invoice reconciliation, and lender reporting for Southeast
     Asian small and medium-sized businesses.
   - Funding/team/year: `900000.00`, `14`, `2022`
   - Location/website: `Singapore`, `https://novaledger.example`
   - Revenue/users/growth: `128000.00`, `3200`, `18.50`
   - Market: Southeast Asian SME finance automation market, estimated at
     US$4.2B annually.
   - Competition: Competes with regional accounting suites; differentiates
     through live banking integrations and lender-ready forecasting.
   - Advisors: `Mei Lin Tan, Marcus Koh`
   - Burn/runway/readiness: `92000.00`, `16`, `100`

2. **CareCircle Connect**
   - Sector/stage: `Healthtech`, `Beta`
   - Description: A coordinated eldercare platform that helps families book
     vetted home-care providers, manage medication schedules, and share care
     updates with clinicians.
   - Funding/team/year: `650000.00`, `9`, `2023`
   - Location/website: `Kuala Lumpur, Malaysia`,
     `https://carecircle.example`
   - Revenue/users/growth: `72000.00`, `1850`, `22.40`
   - Market: Urban Southeast Asian home and community eldercare market,
     estimated at US$3.1B.
   - Competition: Competes with agency directories; differentiates through
     verified care plans, family collaboration, and continuity scoring.
   - Advisors: `Dr Aisha Rahman, Daniel Lim`
   - Burn/runway/readiness: `58000.00`, `13`, `96`

3. **SupplyPilot**
   - Sector/stage: `SaaS`, `Launched`
   - Description: Demand-planning and supplier collaboration software for
     growing consumer brands that need inventory forecasts without an
     enterprise resource-planning implementation.
   - Funding/team/year: `1200000.00`, `18`, `2021`
   - Location/website: `Singapore`, `https://supplypilot.example`
   - Revenue/users/growth: `185000.00`, `740`, `14.80`
   - Market: Asia-Pacific supply-chain planning software market, estimated at
     US$5.6B.
   - Competition: Competes with enterprise planning tools; differentiates
     through rapid onboarding and explainable demand recommendations.
   - Advisors: `Ravi Menon, Claire Wong`
   - Burn/runway/readiness: `120000.00`, `17`, `100`

### Delta

1. **VisionForge AI**
   - Sector/stage: `AI / ML`, `Beta`
   - Description: Computer-vision quality inspection for electronics factories,
     combining edge cameras and adaptive models to detect production defects
     before final assembly.
   - Funding/team/year: `1500000.00`, `16`, `2022`
   - Location/website: `Jakarta, Indonesia`, `https://visionforge.example`
   - Revenue/users/growth: `150000.00`, `210`, `27.50`
   - Market: Asia-Pacific industrial visual-inspection market, estimated at
     US$6.8B.
   - Competition: Competes with fixed-rule inspection systems; differentiates
     through low-data model adaptation and edge deployment.
   - Advisors: `Dr Rina Hartono, Wei Jian Ong`
   - Burn/runway/readiness: `145000.00`, `12`, `96`

2. **RouteMint**
   - Sector/stage: `Logistics`, `Launched`
   - Description: Route optimization and shared-capacity software for regional
     distributors, reducing empty vehicle mileage and improving delivery-time
     predictability.
   - Funding/team/year: `1100000.00`, `22`, `2020`
   - Location/website: `Ho Chi Minh City, Vietnam`,
     `https://routemint.example`
   - Revenue/users/growth: `240000.00`, `520`, `16.20`
   - Market: Southeast Asian last-mile and regional logistics software market,
     estimated at US$7.4B.
   - Competition: Competes with fleet trackers; differentiates through
     multi-carrier capacity pooling and predictive arrival windows.
   - Advisors: `Nguyen Minh Anh, Sophia Teo`
   - Burn/runway/readiness: `175000.00`, `15`, `100`

3. **MarketMosaic**
   - Sector/stage: `E-commerce`, `Beta`
   - Description: A localized storefront and merchandising platform that helps
     independent brands test regional product bundles, languages, and payment
     options from one catalog.
   - Funding/team/year: `780000.00`, `11`, `2023`
   - Location/website: `Bangkok, Thailand`, `https://marketmosaic.example`
   - Revenue/users/growth: `112000.00`, `5600`, `31.20`
   - Market: Southeast Asian direct-to-consumer commerce enablement market,
     estimated at US$4.9B.
   - Competition: Competes with generic storefront builders; differentiates
     through regional bundle testing and localized checkout analytics.
   - Advisors: `Narin Chai, Melissa Goh`
   - Burn/runway/readiness: `84000.00`, `11`, `96`

### Echo

1. **SkillSpring Labs**
   - Sector/stage: `Edtech`, `Launched`
   - Description: Mobile-first technical training that combines short lessons,
     employer-designed projects, and verified skills profiles for early-career
     workers.
   - Funding/team/year: `700000.00`, `13`, `2021`
   - Location/website: `Manila, Philippines`, `https://skillspring.example`
   - Revenue/users/growth: `98000.00`, `12400`, `19.60`
   - Market: Southeast Asian digital workforce upskilling market, estimated at
     US$3.7B.
   - Competition: Competes with video course libraries; differentiates through
     assessed projects and direct employer curriculum partnerships.
   - Advisors: `Maria Santos, Benjamin Lee`
   - Burn/runway/readiness: `76000.00`, `14`, `100`

2. **OpsBeacon**
   - Sector/stage: `SaaS`, `Beta`
   - Description: Operational incident management for multi-site retail teams,
     joining alerts, playbooks, shift handovers, and post-incident analysis in
     one lightweight workspace.
   - Funding/team/year: `950000.00`, `10`, `2022`
   - Location/website: `Singapore`, `https://opsbeacon.example`
   - Revenue/users/growth: `134000.00`, `480`, `24.10`
   - Market: Asia-Pacific frontline operations management software market,
     estimated at US$5.1B.
   - Competition: Competes with generic ticketing tools; differentiates through
     store-level playbooks, shift context, and incident trend detection.
   - Advisors: `Grace Yeo, Arjun Patel`
   - Burn/runway/readiness: `101000.00`, `13`, `96`

3. **WellNest Analytics**
   - Sector/stage: `Healthtech`, `Prototype`
   - Description: Privacy-focused population health analytics for small clinic
     networks, highlighting care gaps and follow-up priorities without exposing
     identifiable patient data.
   - Funding/team/year: `1300000.00`, `8`, `2024`
   - Location/website: `Singapore`, `https://wellnest.example`
   - Revenue/users/growth: `41000.00`, `95`, `35.00`
   - Market: Asia-Pacific ambulatory healthcare analytics market, estimated at
     US$2.9B.
   - Competition: Competes with hospital analytics suites; differentiates
     through clinic-scale deployment and privacy-preserving aggregation.
   - Advisors: `Dr Elaine Chua, Omar Siddiqui`
   - Burn/runway/readiness: `88000.00`, `10`, `92`

## Status and Workflow Records

- All nine portfolios have `status='approved'`.
- `submitted_at`, `created_at`, and `updated_at` use the insertion timestamp.
- `rejection_reason` is `NULL`; populating it would contradict approved status.
- IDs remain auto-generated and each `owner_id` is resolved from the new user's
  inserted ID.
- Use the lowest-ID existing administrator as the deterministic approver.
- Add one `audit_logs` row with `action='approved'` per portfolio.
- Add one `portfolio_approved` notification to the owning account per portfolio.
- Do not create documents, interests, conversations, memberships, or messages.

## Direct SQL Execution

1. Confirm `main` is clean and the live API is ready.
2. Create the restricted backup directory
   `/home/user/lumilabs-quarantine-20260723-demo-businesses` and produce a
   checksum-verified full database dump before writing.
3. Confirm the three emails and all nine names are absent and that at least one
   administrator exists.
4. Generate three independent bcrypt hashes without printing plaintext or hash
   values.
5. Use one MySQL session and one transaction for the user, portfolio, audit, and
   notification inserts. A temporary checked guard table must force an error
   before commit unless all expected ownership and row counts are exact.
6. Commit only after the guard confirms 3 new owners, 9 portfolios, 9 approval
   audits, and 9 approval notifications.

If any statement or guard fails, the MySQL client exits before `COMMIT`, and the
connection rollback leaves the live database unchanged. Never delete or update
an existing row as part of this operation.

## Verification

- Baseline counts for existing users, portfolios, audits, and notifications are
  recorded and increase by exactly `3`, `9`, `9`, and `9` respectively.
- Each new email authenticates with the user-selected temporary credential and
  returns role `business_owner`.
- Each new owner's `/api/portfolios/my` response contains exactly its three
  specified portfolio names with all approved fields intact.
- The investor browse endpoint exposes all nine approved portfolios.
- Existing owner counts remain Beta `7`, testingB `2`, leticia `0`, and
  leticia l `0`.
- Existing conversation `3`, its three members, and messages `7`, `8`, and `9`
  remain unchanged.
- The public API health and readiness endpoints remain `200`.

The backup and exact inserted IDs are retained until the user confirms the demo
data is satisfactory.
