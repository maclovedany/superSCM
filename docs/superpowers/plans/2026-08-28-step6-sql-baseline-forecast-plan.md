# STEP 6 SQL Baseline Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학습 데이터 전용 SQL Baseline Forecast와 실행 이력·재현 가능한 모델 버전·관리 조회 화면을 제공한다.

**Architecture:** `core.run_baseline_forecast()`가 활성 Forecast 설정, 활성 SQL 모델, STEP 5 수요 유형을 읽고 실행·결과를 저장한다. 화면은 `analytics` 뷰만 조회하며 관리자 Server Action이 실행 RPC를 호출한다.

**Tech Stack:** Next.js App Router, TypeScript, Supabase PostgreSQL, 순수 CSS, Node test runner

**Spec:** 승인된 STEP 6 대화 설계

## Global Constraints

- Forecast 입력은 `core.v_train_demand`만 사용한다.
- `raw.usage_history`와 `core.v_test_actual`을 Forecast SQL에서 직접 참조하지 않는다.
- 모델 파라미터, enabled 상태, 적용 수요 유형은 `core.model_config`에서 관리한다.
- null/데이터 부족은 0으로 보정하지 않는다.
- 화면은 `analytics` 뷰만 읽고 계산하지 않는다.
- 모델 변경과 실행은 ADMIN 권한을 서버와 RLS에서 검증한다.

---

### Task 1: Forecast 계약과 모델 정책 테스트

**Files:**
- Create: `lib/forecast-baseline.ts`
- Create: `lib/forecast-baseline.test.ts`

- [ ] 모델 적용 수요 유형 및 SQL Baseline 파라미터 계약을 테스트한다.
- [ ] MA_3M, MA_6M, WMA_3M(3:2:1), PY/Seasonal Naive 데이터 부족 경계를 테스트한다.
- [ ] 실패를 확인한 뒤 최소 순수 함수를 구현하고 테스트를 통과시킨다.

### Task 2: DB Migration과 실행 함수

**Files:**
- Create: `supabase/migrations/20260828000500_step6_baseline_forecast.sql`
- Modify: `SCHEMA.md`

- [ ] `model_config`, `model_version`, `forecast_run`, `forecast_result`와 RLS를 추가한다.
- [ ] 모델 registry seed, 월별 train grid, residual sigma, interval, stale analytics 뷰를 추가한다.
- [ ] `core.run_baseline_forecast()`가 snapshot/run/result/status를 원자적으로 저장하도록 구현한다.

### Task 3: Analytics 조회 및 관리자 실행 경계

**Files:**
- Modify: `lib/scm-model.ts`
- Modify: `lib/scm.ts`
- Create: `app/(admin)/admin/forecast-models/page.tsx`
- Create: `app/(admin)/admin/forecast-runs/page.tsx`
- Create: `app/(admin)/admin/forecast-runs/actions.ts`
- Modify: `lib/menu.ts`

- [ ] analytics view 정규화와 조회 함수를 추가한다.
- [ ] 관리자 페이지는 설정·실행 이력만 렌더링하고, 실행 Action 첫 줄에서 `requireAdmin()`을 호출한다.
- [ ] 모델 토글은 DB 설정을 갱신하는 ADMIN 전용 Action으로 구현한다.

### Task 4: 검증과 문서화

**Files:**
- Modify: `lib/forecast-baseline.test.ts`
- Modify: `SCHEMA.md`

- [ ] SQL 계약과 모델 경계 테스트를 보강한다.
- [ ] `npm test`, `npm run build`, `git diff --check`을 실행한다.
- [ ] Supabase SQL Editor에서 수행할 실행·검증 쿼리를 완료 보고에 명시한다.
