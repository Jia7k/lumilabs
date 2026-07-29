# Lumi5 Labs IWL Team Report Design

**Date:** 29 July 2026  
**Target:** 25 rendered pages in the supplied IWL Team Report Template  
**Approach:** Evidence-first systems report

## 1. Purpose

The report will explain, evaluate, and demonstrate the complete Lumi5 Labs codebase as a five-role investment facilitation platform. It will prioritise verifiable engineering evidence over generic feature descriptions. Every major claim will be supported by one or more of the following:

- Source code and route behaviour
- Database schema constraints
- Automated test results
- A diagram derived from the implementation
- A screenshot of the implemented interface

Unknown title-page details will remain as clearly labelled placeholders. They will not reduce the depth of the technical content.

## 2. Core Narrative

Lumi5 Labs addresses a trust and coordination problem between business owners and investors. It introduces governed human oversight through two staff layers:

1. An admin evaluates submitted portfolios.
2. A superadmin assigns approved portfolios to relationship managers.
3. A relationship manager converts valid investor interest into a managed portfolio group conversation.

The report will follow this lifecycle from business-owner submission through moderation, assignment, investor interest, and group messaging. This narrative allows architecture, data design, security, interface design, and testing to be discussed as parts of one coherent system.

## 3. Proposed Page Allocation

The final document will target exactly 25 rendered pages.

| Pages | Content |
|---|---|
| 1 | Title page and abstract |
| 2 | Acknowledgments and contents |
| 3 | Contents continuation and report overview |
| 4 to 5 | Introduction, problem statement, objectives, and scope |
| 6 to 7 | Background research, stakeholder analysis, and design principles |
| 8 to 9 | Requirements, five-role responsibility model, and end-to-end workflow |
| 10 to 12 | System architecture, API structure, deployment model, and database design |
| 13 to 17 | Technical contributions and implemented user journeys |
| 18 to 20 | Security, data integrity, transaction handling, accessibility, and resilience |
| 21 to 22 | Verification strategy, automated test evidence, and requirements traceability |
| 23 | Limitations, engineering trade-offs, and future work |
| 24 | Reflection and conclusion |
| 25 | References and compact appendix evidence |

Pagination may shift slightly during layout refinement, but the final rendered output must contain 25 pages.

## 4. Report Structure

### Front Matter

- Project title placeholder
- Team metadata placeholders
- Abstract of no more than 250 words
- Acknowledgments
- Generated contents list

### 1. Introduction

- Investment discovery and trust problem
- Project motivation
- System objectives
- Project scope and exclusions
- Contribution summary

### 2. Research and Background

- Stakeholder needs
- Role separation and governance
- Portfolio readiness and structured investor discovery
- Managed communication compared with direct one-to-one messaging
- Design principles: least privilege, traceability, controlled state transitions, and data persistence

### 3. Requirements and Workflow

- Functional requirements
- Non-functional requirements
- Five-role permission matrix
- Portfolio lifecycle
- Managed conversation lifecycle
- Acceptance criteria

### 4. System Architecture and Data Design

- Static multi-page frontend
- Shared browser API client
- Express REST routes
- Workflow and read-model services
- MySQL persistence
- Controlled document storage
- Same-origin reverse proxy and service deployment
- Core entity relationships and database constraints

### 5. Technical Contributions

- Authentication and five-role authorization
- Portfolio creation, scoring, document upload, and submission
- Admin moderation
- Superadmin staff provisioning and manager assignment
- Investor discovery and interest
- Relationship-manager coordination
- Portfolio-scoped persistent group messaging
- Notifications and audit trails
- Public contact workflow
- Shared interface and accessibility patterns

### 6. Verification and Evaluation

- Automated test strategy
- Test summary: 49 modules and 815 passing executed tests
- Representative workflow, route, boundary, schema, and client tests
- Requirements-to-test traceability
- Security and database-alignment review
- Screenshot evidence of the main role flow

### 7. Limitations and Future Work

- No repository CI workflow or coverage threshold
- No browser end-to-end automation
- No performance or load testing
- JWT storage in browser local storage
- Limited rate limiting
- Upload validation without file-signature or malware inspection
- Missing evidenced TLS and security-header configuration
- Recommended improvements ordered by impact

### 8. Reflection and Conclusion

- Architectural lessons
- Importance of database-backed business rules
- Value of separation of duties
- Testing and integration lessons
- Summary of project outcomes

### References and Appendices

- Vancouver-style technical references
- Compact requirements traceability
- Additional implementation and screenshot evidence if space permits

## 5. Visual Evidence Plan

Only visuals that explain an important relationship or prove an implemented state will be included.

### Diagrams

1. **Five-role portfolio-to-conversation workflow**
   - Business owner submission
   - Admin moderation
   - Superadmin assignment
   - Investor interest
   - Relationship-manager chat creation
   - Persistent managed conversation

2. **Layered system architecture**
   - Role-specific HTML and JavaScript pages
   - Shared API client
   - Express route modules
   - Workflow and read-model services
   - MySQL and document storage
   - Deployment boundary

3. **Core data model and chat lifecycle**
   - Users
   - Portfolios
   - Documents
   - Interests
   - Conversations
   - Conversation members
   - Messages
   - Notifications
   - Audit records

### Screenshots

The strongest available populated states will be captured:

1. Public homepage and value proposition
2. Role-aware sign-up
3. Business-owner dashboard
4. Portfolio creation or editing
5. Investor discovery
6. Admin portfolio-review interface
7. Superadmin assignment interface
8. Relationship-manager coordination workspace
9. Managed group conversation

The final report will use approximately six to eight of these screenshots. Redundant, empty, or purely decorative screens will be excluded. Screenshots will not expose passwords, tokens, private files, or unintended personal data.

## 6. Evidence Standards

- Test counts will be reported only from a fresh final test run.
- Production database compliance will not be claimed unless directly verified.
- Deployment will be described from repository evidence and visible site behaviour, not from assumptions.
- Security strengths and limitations will be reported together.
- Code listings will be short and used only when a diagram or prose explanation is insufficient.
- Each table and figure will be referenced in the surrounding text.
- All diagrams will be derived from the current schema and source code.

## 7. Formatting and Quality Rules

- Preserve the supplied template’s page size, margins, serif typography, heading hierarchy, and page numbering.
- Use 11-point body text and the template heading styles.
- Place table captions above tables and figure captions below figures.
- Keep figures inline and within the seven-inch text width.
- Generate the contents list from heading styles.
- Keep the abstract below 250 words.
- Remove all template instructions and sample content.
- Use no em dash characters anywhere in the final document.
- Keep the final report to exactly 25 rendered pages.
- Inspect every rendered page for clipping, overflow, weak spacing, and unreadable figures.

## 8. Completion Criteria

The report is complete only when:

1. The final `.docx` opens and renders successfully.
2. It contains exactly 25 pages.
3. Every page has been visually inspected.
4. No placeholder content remains except clearly marked unknown title-page metadata.
5. No em dash character exists in the document package.
6. The current automated test result is accurately represented.
7. Architecture, workflow, data, security, verification, limitations, and reflection are all covered.
8. Screenshots and diagrams are readable and directly support the narrative.
9. The supplied source template remains unchanged.
