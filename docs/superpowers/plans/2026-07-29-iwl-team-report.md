# Lumi5 Labs IWL Team Report Production Plan

> **Execution:** Build the report in this session as one integrated document artifact. Use parallel agents only for independent evidence drafting or review.

**Goal:** Produce a polished, evidence-backed, exactly 25-page `.docx` report from the supplied IWL Team Report Template, with verified screenshots, implementation-derived diagrams, accurate test evidence, and no em dash characters.

**Architecture:** Preserve the supplied Word template’s page system and typography. Build the report from a retained template copy using `python-docx`, create deterministic diagrams as high-resolution PNG assets, capture the strongest live application states, insert all figures inline, and validate the completed document through rendering, visual inspection, structural audits, and OOXML text scans.

**Tools:** Codex primary Python runtime, `python-docx`, Pillow, LibreOffice headless rendering, Poppler, browser control, Node test runner, Git, and the document skill audit scripts.

---

## Global Constraints

- Final output path: `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/deliverables/Lumi5_Labs_IWL_Team_Report.docx`
- Final rendered page count: exactly 25 pages
- Source template: `/Users/jiarong/Downloads/IWL Team Report Template.docx`
- Retained reference copy: `/private/tmp/lumilabs-report.ePoeJG/reference.docx`
- Never overwrite the source template or retained reference
- Preserve US Letter size, portrait orientation, 0.75-inch left/right/top margins, 1-inch bottom margin, page numbering, serif body text, and heading hierarchy
- Use no em dash character anywhere in authored text or final OOXML
- Unknown team metadata remains clearly labelled, not invented
- Screenshots must not expose passwords, tokens, private uploaded documents, or unintended personal data
- Report every test result from a fresh command run
- Do not claim live database or deployment properties that were not directly verified
- Deliver only the final `.docx`; keep temporary scripts, renders, and assets out of version control

## Task 1: Finalise the Evidence Inventory

**Files to inspect:**

- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/backend/schema.sql`
- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/backend/server.js`
- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/backend/src/routes/*.js`
- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/backend/src/services/*.js`
- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/backend/src/middleware/*.js`
- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/backend/test/*.test.js`
- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/js/*.js`
- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/*.html`
- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/backend/deploy/*`

**Steps:**

1. Confirm the repository branch, commit, and clean-state baseline.
2. Inventory frontend pages, backend routes, workflow services, tables, deployment files, and test modules.
3. Run the complete automated test suite from `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/backend`.
4. Record exact pass, fail, module, and duration evidence.
5. Map each major report claim to source files and representative tests.
6. Record honest limitations that are visible in the repository.

**Verification:**

- `git status --short --branch`
- `npm test`
- `rg --files`
- Claim-to-file evidence table reviewed for unsupported statements

## Task 2: Draft the 25-Page Narrative

**Working files:**

- `/private/tmp/lumilabs-report.ePoeJG/drafts/`
- `/private/tmp/lumilabs-report.ePoeJG/report-content.json`

**Steps:**

1. Draft an abstract below 250 words.
2. Draft the introduction, problem statement, objectives, scope, and contribution summary.
3. Draft background sections on stakeholders, governance, managed communication, and design principles.
4. Draft functional and non-functional requirements plus acceptance evidence.
5. Draft architecture and database explanations grounded in current source files.
6. Draft technical contributions for all five roles and the shared workflows.
7. Draft security, validation, transaction, accessibility, resilience, and deployment analysis.
8. Draft test evaluation, limitations, future work, reflection, and conclusion.
9. Prepare Vancouver-style references using authoritative standards and primary documentation.
10. Scan all prose for em dash characters and unsupported superlatives.

**Verification:**

- Abstract word count at most 250
- Every major claim has a source, test, schema, screenshot, or diagram basis
- `rg -n $'\u2014' /private/tmp/lumilabs-report.ePoeJG/drafts`

## Task 3: Create Three Implementation-Derived Diagrams

**Working files:**

- `/private/tmp/lumilabs-report.ePoeJG/assets/workflow.png`
- `/private/tmp/lumilabs-report.ePoeJG/assets/architecture.png`
- `/private/tmp/lumilabs-report.ePoeJG/assets/data-model.png`

**Steps:**

1. Create the five-role portfolio-to-conversation workflow diagram.
2. Create the layered frontend, API, service, persistence, and deployment architecture diagram.
3. Create the core data model and managed-conversation lifecycle diagram.
4. Use a consistent Lumi5 visual system with high contrast, readable labels, and no decorative clutter.
5. Export each diagram at a resolution suitable for a seven-inch Word figure.
6. Inspect every diagram at full size.

**Verification:**

- Diagram labels match current role, route, service, and table names
- No diagram claims an unimplemented component
- Each PNG is sharp and legible when rendered at seven inches
- No em dash character appears in diagram labels

## Task 4: Capture and Curate Application Screenshots

**Target site:**

- `http://35.212.144.149/`

**Working files:**

- `/private/tmp/lumilabs-report.ePoeJG/screenshots/`

**Priority states:**

1. Public homepage and platform proposition
2. Role-aware sign-up
3. Business-owner dashboard or portfolio authoring
4. Investor discovery
5. Admin portfolio moderation
6. Superadmin relationship-manager assignment
7. Relationship-manager coordination workspace
8. Managed group messaging

**Steps:**

1. Connect to the application through the supported browser runtime.
2. Use only provided test accounts and seeded data.
3. Capture populated, claim-bearing states when available.
4. Avoid destructive actions and avoid changing live database records unless required for a reversible test state.
5. Crop browser chrome and irrelevant empty space.
6. Exclude credentials and sensitive values.
7. Select approximately six to eight non-redundant screenshots.

**Verification:**

- Each selected screenshot has a specific evidence purpose
- Text is readable at report size
- No credential or private-data exposure
- Captions accurately describe the visible state

## Task 5: Assemble the Word Document

**Working files:**

- `/private/tmp/lumilabs-report.ePoeJG/build_report.py`
- `/private/tmp/lumilabs-report.ePoeJG/working-report.docx`

**Final file:**

- `/Users/jiarong/Documents/SIT/Y1T3/lumilabs/deliverables/Lumi5_Labs_IWL_Team_Report.docx`

**Steps:**

1. Load the retained reference template.
2. Remove all sample instructions, example content, sample chart, sample table data, sample references, and placeholder appendices.
3. Preserve template styles, sections, and footer page fields.
4. Insert the title page with clearly marked unknown metadata.
5. Insert a generated contents page with accurate final page numbers.
6. Build the report using explicit page-level composition to target 25 pages.
7. Insert tables with captions above and figures with captions below.
8. Insert screenshots and diagrams inline within the seven-inch text width.
9. Add alt text or descriptive captions for all visuals.
10. Save first to the working path, then copy the verified file to the final path.

**Verification:**

- Document opens with `python-docx`
- Heading audit shows a coherent hierarchy
- Section audit confirms template geometry
- Images audit lists all expected inline figures
- Content-control and footnote audits show no unintended artifacts

## Task 6: Render, Inspect, and Refine

**Render directory:**

- `/private/tmp/lumilabs-report.ePoeJG/final-render/`

**Steps:**

1. Render the working report to PDF and page PNGs with `render_docx.py`.
2. Confirm the rendered output contains exactly 25 pages.
3. Inspect every page at full-page scale.
4. Inspect dense pages, tables, screenshots, and diagrams at original resolution.
5. Correct clipping, overflow, orphaned headings, detached captions, weak spacing, and unreadable labels.
6. Repeat rendering after each document edit.
7. Run style, heading, section, image, field, and accessibility audits.

**Verification:**

- Exactly 25 rendered page PNG files
- No visual clipping or unexpected blank pages
- All figure and table captions remain adjacent to their objects
- Body text and screenshots remain readable

## Task 7: Final Integrity Audit and Delivery

**Steps:**

1. Run a fresh full automated test suite and record the actual result in the report if it differs from the draft.
2. Extract the final DOCX package to a temporary directory.
3. Scan all XML and relationships for em dash characters and placeholder instructional text.
4. Verify the source template SHA-256 is unchanged.
5. Verify the final document’s SHA-256 and page count.
6. Open the final file through `python-docx` and confirm expected headings and figure count.
7. Copy only the verified final `.docx` to the deliverables directory.

**Verification commands:**

- `npm test`
- `render_docx.py ... --emit_pdf`
- `find ... -name 'page-*.png' | wc -l`
- `rg -n $'\u2014' <extracted-docx-directory>`
- `rg -n '\\[TITLE PAGE\\]|brief summary|supplementary content goes here|Example of a figure' <extracted-docx-directory>`
- `shasum -a 256 /Users/jiarong/Downloads/IWL Team Report Template.docx`
- `shasum -a 256 /Users/jiarong/Documents/SIT/Y1T3/lumilabs/deliverables/Lumi5_Labs_IWL_Team_Report.docx`

## Final Review Checklist

- [ ] Exactly 25 pages
- [ ] Abstract is at most 250 words
- [ ] All five roles are accurately represented
- [ ] Portfolio, assignment, interest, and chat workflows are coherent
- [ ] Architecture and database diagrams match the implementation
- [ ] Screenshots prove useful populated states
- [ ] Test evidence comes from a fresh run
- [ ] Security strengths and limitations are balanced
- [ ] References use Vancouver numbering
- [ ] No invented team metadata
- [ ] No em dash characters
- [ ] No template instructions or example content
- [ ] Original template unchanged
- [ ] Final document visually inspected page by page
