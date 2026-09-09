# STEP 7 Backtest Champion Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 저장된 Forecast와 검증 Actual을 비교해 모델 성능·순위·Champion 선택 근거를 저장하고 조회한다.

**Architecture:** SQL 함수가 `core.forecast_result`와 `core.v_test_actual`을 조인해 Backtest Run, 성능, 자동 Champion snapshot을 저장한다. 화면은 analytics view의 저장 결과만 조회하고 CSV·차트는 표현만 담당한다.

**Tech Stack:** Next.js App Router, TypeScript, Supabase PostgreSQL, 순수 CSS, Node test runner

**Spec:** 승인된 STEP 7 대화 설계

## Global Constraints

- scoring 입력은 Forecast Result와 `core.v_test_actual`만 사용한다.
- Forecast 재실행, raw 사용 이력 직접 조회, test 기반 parameter 보정은 금지한다.
- 지표와 Champion 후보는 SQL에서 계산·저장한다.
- 수동 Champion은 ADMIN 서버/DB 권한과 필수 사유를 요구한다.

---

### Task 1: Backtest 지표 안전 계약 테스트

**Files:**
- Create: `lib/backtest-policy.ts`
- Create: `lib/backtest-policy.test.ts`

- [ ] WAPE/MAPE 분모 0, Bias 방향, 수동 사유 검증의 실패 테스트를 작성한다.
- [ ] 테스트를 실패시킨 뒤 최소 정책 함수를 구현한다.

### Task 2: Backtest SQL 저장 계층

**Files:**
- Create: `supabase/migrations/20260828000600_step7_backtest_champion.sql`
- Modify: `SCHEMA.md`

- [ ] Backtest Run, Model Performance, Champion 선택 이력·RLS·analytics view를 추가한다.
- [ ] SQL scoring 및 AUTO/MANUAL Champion 함수를 구현한다.

### Task 3: 조회·실행·비교 UI

**Files:**
- Modify: `lib/scm-model.ts`
- Modify: `lib/scm.ts`
- Create: `components/chart/forecast-overlay-chart.tsx`
- Create: `components/analysis/model-comparison.tsx`
- Create: `app/(user)/analysis/model-comparison/page.tsx`
- Create: `app/(admin)/admin/backtest-runs/*`
- Create: `app/(admin)/admin/champion-models/*`
- Modify: `lib/menu.ts`, `styles/components.css`

- [ ] Server Action의 첫 줄에서 `requireAdmin()`을 호출한다.
- [ ] 화면 필터·toggle·export는 저장 결과만 사용한다.

### Task 4: 전체 검증

- [ ] Forbidden source 확인, `npm test`, `npm run build`, `git diff --check`을 실행한다.
