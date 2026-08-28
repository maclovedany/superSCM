# STEP 3 데이터 모델 확장 및 학습·검증 격리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파일 업로드와 Forecast가 사용할 원본 적재 계약, 운영 정책, 학습·검증 데이터 격리를 DB migration으로 확정한다.

**Architecture:** raw는 원본과 적재 이력을 보관하고, core는 기간·정책과 격리 뷰를 제공하며, analytics는 관리자 확인용 coverage 한 행을 제공한다. 기간 설정이 불완전하면 두 격리 뷰가 비어 Data Leakage를 fail-closed로 막는다.

**Tech Stack:** Next.js 15, TypeScript, Node test runner, Supabase PostgreSQL migration, pure CSS.

**Spec:** `docs/superpowers/specs/2026-08-28-step3-data-isolation-design.md`

## Global Constraints

- Supabase 원격 DB에는 자동 적용하지 않고, 사용자가 SQL Editor에서 migration을 수동 실행한다.
- 기존 raw 및 analytics 객체를 drop/recreate하지 않으며, 기존 raw 테이블은 ALTER만 사용한다.
- raw.usage_history 직접 조회는 Forecast·Demand Profile·Backtest 학습 코드에서 금지한다.
- train/test 날짜를 SQL 또는 TypeScript에 고정값으로 쓰지 않는다.
- anon 접근을 차단하고 정책·설정 변경은 ADMIN만 허용한다.
- null 수요값을 0으로 치환하지 않는다.

---

### Task 1: 데이터 격리 계약 테스트

**Files:**
- Create: `lib/forecast-data-contract.test.ts`
- Consumes: `supabase/migrations/20260828000200_step3_data_isolation.sql`
- Produces: migration 객체·격리·권한 계약을 검증하는 Node 테스트

- [ ] **Step 1: 실패하는 migration 계약 테스트를 작성한다.**

```ts
test('STEP3 migration creates fail-closed train and test demand boundaries', () => {
  const migration = readFileSync(migrationPath, 'utf8');
  assert.match(migration, /create or replace view core\.v_train_demand/i);
  assert.match(migration, /create or replace view core\.v_test_actual/i);
  assert.match(migration, /train_start is not null/i);
  assert.match(migration, /test_end is not null/i);
});
```

- [ ] **Step 2: 테스트가 migration 파일 부재로 실패하는지 확인한다.**

Run: `npm test -- lib/forecast-data-contract.test.ts`

- [ ] **Step 3: raw 확장·정책·격리 migration을 작성한다.**

`supabase/migrations/20260828000200_step3_data_isolation.sql`에 `ADD COLUMN IF NOT EXISTS`, 신규 raw 테이블, core 정책 테이블, singleton forecast 설정, 두 뷰, coverage 뷰, RLS/GRANT를 작성한다.

- [ ] **Step 4: 계약 테스트가 통과하는지 확인한다.**

Run: `npm test -- lib/forecast-data-contract.test.ts`

### Task 2: Forecast 코드 접근 규칙 검증

**Files:**
- Modify: `lib/forecast-data-contract.test.ts`
- Consumes: `lib/`, `app/`, `components/`
- Produces: 향후 Forecast 관련 파일이 raw usage를 직접 읽지 않는 정적 검사

- [ ] **Step 1: 실패하는 직접 조회 금지 테스트를 추가한다.**

```ts
test('Forecast-related code does not query raw.usage_history directly', () => {
  const source = readForecastSources();
  assert.doesNotMatch(source, /\.schema\(['"]raw['"]\)[\s\S]{0,120}\.from\(['"]usage_history['"]\)/i);
});
```

- [ ] **Step 2: 테스트가 기존 코드에 대한 기대대로 통과하는지 확인한다.**

Run: `npm test -- lib/forecast-data-contract.test.ts`

- [ ] **Step 3: 전체 테스트를 실행한다.**

Run: `npm test`

### Task 3: 수동 적용 안내와 앱 빌드 검증

**Files:**
- Modify: `error.md` only if a new validation error occurs
- Consumes: migration과 테스트 결과
- Produces: SQL Editor용 검증 쿼리와 빌드 증빙

- [ ] **Step 1: migration에 포함할 SQL Editor 검증 쿼리를 확정한다.**

```sql
select * from analytics.v_data_coverage;
select min(use_date), max(use_date), count(*) from core.v_train_demand;
select min(use_date), max(use_date), count(*) from core.v_test_actual;
```

- [ ] **Step 2: production build를 실행한다.**

Run: `npm run build`

- [ ] **Step 3: migration을 원격 DB에 적용하지 않았음을 확인하고, 사용자 수동 설정 항목을 보고한다.**
