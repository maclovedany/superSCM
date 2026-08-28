# STEP 4·5 Import Pipeline 및 SKU Demand Profile 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 안전한 파일 적재·rollback 기반과 학습 전용 SKU 수요 프로파일 및 조회 화면을 만든다.

**Architecture:** 서버 Route Handler가 staging과 validation을 관리하고 DB RPC가 raw mutation을 원자적으로 수행한다. Demand Profile은 `core.v_train_demand`와 Forecast 설정만 읽는 analytics view로 계산한다.

**Tech Stack:** Next.js 15, TypeScript, Supabase PostgreSQL, Papa Parse, SheetJS xlsx, Node test runner, pure CSS.

**Spec:** `docs/superpowers/specs/2026-08-28-step4-step5-import-demand-profile-design.md`

## Global Constraints

- 원격 Supabase SQL은 자동 적용하지 않는다.
- raw insert는 validation 완료·ADMIN 확인·batch_id가 있을 때만 수행한다.
- raw.usage_history와 core.v_test_actual은 Demand Profile에서 직접 사용하지 않는다.
- 오류값을 보정하거나 null을 0으로 바꾸지 않는다.
- UI에 validation·통계 계산을 넣지 않는다.

---

### Task 1: Import 도메인 계약과 라이브러리

**Files:** `package.json`, `lib/import/types.ts`, `lib/import/schema.ts`, `lib/import/parse.ts`, `lib/import/validate.ts`, `lib/import/*.test.ts`

- [ ] 실패 테스트로 필수값, 날짜, 숫자, 중복, 알 수 없는 품목/공급처 오류와 CSV 생성 계약을 정의한다.
- [ ] Papa Parse·xlsx 의존성을 추가하고 서버 파서·자동 매핑·순수 validation 모듈을 구현한다.
- [ ] 테스트를 통과시킨다.

### Task 2: Import DB 경계 및 서버 API

**Files:** `supabase/migrations/20260828000300_step4_import_pipeline.sql`, `lib/import/repository.ts`, `app/api/admin/imports/**/route.ts`

- [ ] 실패 migration 계약 테스트를 작성한다.
- [ ] batch, staging, mapping, validation error, backup, commit/rollback RPC, RLS와 stale 처리 migration을 구현한다.
- [ ] ADMIN Route Handler에서 parse → validate → confirm import → rollback을 연결한다.

### Task 3: Data Management 화면

**Files:** `app/(admin)/admin/data-management/page.tsx`, `components/admin/import-manager.tsx`, `components/admin/import-history.tsx`, `styles/components.css`, `lib/menu.ts`

- [ ] validation 전 Import 버튼 비활성화와 replace 확인을 검증하는 UI 상태 테스트를 작성한다.
- [ ] 파일 선택, import type/mode, preview, mapping, validation 결과, Error CSV, history/rollback UI를 구현한다.

### Task 4: Demand Profile SQL 및 화면

**Files:** `supabase/migrations/20260828000400_step5_sku_demand_profile.sql`, `lib/demand-profile.ts`, `lib/demand-profile.test.ts`, `app/(user)/analysis/demand-profile/page.tsx`, `components/analysis/demand-profile-table.tsx`, `lib/menu.ts`

- [ ] ADI·CV²·분류·계산 불가·seasonality 기간 규칙의 실패 테스트를 작성한다.
- [ ] 학습 전용 grid/profile/KPI view와 RLS를 구현한다.
- [ ] 서버 조회와 저장된 결과 필터 UI를 구현한다.

### Task 5: 통합 검증

- [ ] raw 직접 조회, test actual 참조, anon write, 날짜 상수를 검색한다.
- [ ] `npm test`, `npm run build`, `git diff --check`를 실행한다.
- [ ] 수동 SQL Editor 검증 쿼리와 운영 제약을 보고한다.
