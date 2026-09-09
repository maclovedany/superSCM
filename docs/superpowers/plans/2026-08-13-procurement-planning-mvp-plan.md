# Procurement Planning MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Build a local browser prototype that makes the complete monthly procurement-planning flow visible before implementing detailed calculations, uploads, SQLite persistence, and report generation.

**Architecture:** A Next.js App Router application will provide a single-user workflow shell with typed mock state held in the client for phase 1. The domain boundaries will be represented as focused components so later phases can replace mock state with Server Actions, Repository interfaces, and SQLite without redesigning the user flow.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, lucide-react icons.

## Global Constraints

- Local MVP only; no login, external API, Supabase, or real supplier submission.
- Phase 1 is intentionally overview-level: no real SQLite persistence, Excel/CSV import, detailed calculation engine, or Excel/PDF export yet.
- UI copy is Korean and reflects the approved PRD terminology: OL, SFDC, Bulk-deal, Open PO, MOQ, Lead Time, Flexibility Rule, FX-LIVE.
- The prototype must run with a local development command and show the end-to-end flow in the browser.

---

### Task 1: Scaffold the local web app

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx`

**Interfaces:**
- Produces a runnable Next.js page at `/` with Korean procurement-planning shell.

- [ ] Create the minimal Next.js package configuration with `dev`, `build`, and `start` scripts.
- [ ] Add the root layout with Korean language metadata and global CSS imports.
- [ ] Add the page entry that renders the workflow application component.
- [ ] Run `npm install` using the bundled Node runtime.
- [ ] Run `npm run build` and confirm exit code 0.

### Task 2: Build the workflow shell and navigation

**Files:**
- Create: `components/procurement-app.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- `ProcurementApp` owns the active phase state and renders the phase navigation, progress indicator, and phase content.
- Phase IDs are `dashboard`, `demand`, `supply`, `master`, `calculation`, and `report`.

- [ ] Add a left navigation showing the six phases and completed/current/locked visual states.
- [ ] Add the top header with product name, current planning month, and local prototype badge.
- [ ] Add navigation controls allowing the user to move backward and forward through the overview flow.
- [ ] Add a progress strip showing `작성중 → 수요확정 → 재고·공급 → 계산검토 → 보고자료`.
- [ ] Keep the page responsive for desktop and tablet widths.

### Task 3: Add overview-level phase screens

**Files:**
- Create: `components/workflow/dashboard-step.tsx`
- Create: `components/workflow/demand-step.tsx`
- Create: `components/workflow/supply-step.tsx`
- Create: `components/workflow/master-step.tsx`
- Create: `components/workflow/calculation-step.tsx`
- Create: `components/workflow/report-step.tsx`

**Interfaces:**
- Each phase component accepts `onNext: () => void` and `onBack: () => void` where applicable.
- Components use representative mock rows and clearly label unavailable detailed functionality as phase 2.

- [ ] Render dashboard cards for plan status, demand confirmation, inventory readiness, exceptions, and report readiness.
- [ ] Render demand step with OL/SFDC/Bulk-deal/Trend input cards, demand-confirmation status, and a sample confirmation table.
- [ ] Render supply step with inventory and Open PO readiness cards, sample status rows, and missing-data callouts.
- [ ] Render master step with cards for items, BOM, attachment rate, usage, MOQ, Lead Time, and Flexibility Rule.
- [ ] Render calculation step with KPI cards, sample calculation rows, exception badges, and a disabled detailed-calculation notice.
- [ ] Render report step with executive-summary cards, comparison sections, report preview, and disabled Excel/PDF buttons marked as phase 2.

### Task 4: Add visual QA and browser-run instructions

**Files:**
- Modify: `README.md`

**Interfaces:**
- README documents the exact local commands and explains the phase 1 boundary.

- [ ] Add a README with prerequisites, install command, dev command, browser URL, and phase 1 limitations.
- [ ] Run `npm run build` again after all UI changes.
- [ ] Run the dev server and verify the root page returns HTTP 200.
- [ ] Inspect the rendered page for clipped text, broken layout, and console/build errors.

### Phase 1 handoff checkpoint

Stop after Task 4 and ask the user to review the running browser prototype. Do not implement SQLite, upload parsing, detailed calculation, manual adjustments, or report downloads until the user approves the overview flow.
