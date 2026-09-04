# renew.prd 구현 단계 (step.md)

> `renew.prd` 를 현재 코드베이스 위에서 구현하기 위해, **무엇이 이미 있고 · 무엇이 없고 · 어떤 순서로 붙여야 하는지** 를 기술한 문서입니다.
> 작성 기준: 2026-08-27 / 대상 커밋 `4700a62`
> 함께 읽을 문서 — `renew.prd`(요구사항) · `design.md`(디자인) · `AGENTS.md`(규칙) · `SCHEMA.md`(데이터) · `ARCHITECTURE.md`

---

## 0. 지금 해야 할 일 (2026-09-03 기준)

**STEP 1~20 의 코드는 전부 작성됐습니다.** 남은 것은 **DB 적용과 배포 설정**이며, 그 전까지 화면은 조회 실패나 빈 상태로 보입니다.

### 0.1 DB 적용 — `sql/README.md` 가 유일한 기준입니다

파일 26개를 그 문서의 순서대로 SQL Editor 에 하나씩 붙여넣습니다. 순서와 재실행 규칙이 거기 있습니다.
**`28-anon-lockdown.sql` 은 선택이 아닙니다** — 적용 전에는 로그인 없이도 브라우저에 노출되는 키만으로 전체 데이터가 읽힙니다(운영 DB 에서 확인된 문제).

적용 전에 `scripts/sql-verify/run.sh` 로 로컬에서 미리 돌려볼 수 있습니다. 운영 DB 에 붙지 않습니다.

### 0.1-b `sql/16` 을 고쳤습니다 — 다시 적용하세요 ★

대시보드 첫 화면의 `canceling statement due to statement timeout` 원인을 잡았습니다.
계획기가 하위 뷰를 품목 수만큼 다시 계산하고 있었고, `sql/16` 안에 CTE 울타리를 쳐서
막았습니다 (`error.md` #30). 대시보드가 2.95초에서 1.30초로 줄었고 **결과는 그대로**입니다.

`sql/16` 은 `drop view … cascade` 로 시작하므로 **그 뒤 파일을 전부 다시 돌려야 합니다.**
이미 `21` 까지 적용하셨다면 이 순서로 이어가세요.

```
16 → 17 → 18 → 19 → 20 → 21 → 22 → 23 → 24 → 26 → 27 → 29 → 28
```

`28-anon-lockdown.sql` 이 마지막인 것은 변함없습니다.

그래도 시간 초과가 나면, 아래를 한 번 돌려 제한을 늘려 두고 다시 보세요.
되돌리려면 `reset statement_timeout` 으로 같은 자리에서 지웁니다.

```sql
alter role authenticated set statement_timeout = '30s';
```

`sql/30-indexes.sql` 은 **지금은 돌리지 않아도 됩니다.** 품목 20개 기준으로 효과가
측정되지 않았습니다. 3년치 실데이터를 적재한 뒤에 한 번 돌리세요.

### 0.1-c `sql/13` 을 고쳤습니다 — 다시 적용하세요 ★

모델 비교 화면의 `Encountered two children with the same key, SEASONAL_NAIVE` 원인을 잡았습니다.
`analytics.v_model_performance` 가 백테스트 run 을 거르지 않아, 백테스트를 돌린 횟수만큼
같은 모델이 반복됐습니다. 품목마다 가장 최근에 성공한 run 하나만 내도록 고쳤습니다 (`error.md` #31).

`13` 은 `drop … cascade` 가 없어 혼자 다시 돌려도 되지만, `27` 이 `13` 의 함수를 덮어쓰고
`29` 가 `13` 의 뷰를 가리므로 **이 순서로 이어서 돌립니다.**

```
13 → 27 → 29 → 28
```

**★ 전제 — `0.1-b` 의 `16 → … → 28` 이 끝까지 적용된 상태여야 합니다.** `29` 는 앞 파일의
뷰가 전부 있어야 돌아갑니다. `16` 의 cascade 로 지워진 대시보드 뷰가 아직 없으면
`29` 가 `analytics.v_dashboard_kpi 에 없는 컬럼을 가리려 했습니다` 로 멈춥니다 (`error.md` #32).

- `0.1-b` 를 아직 시작하지 않았다면 — `13` 을 먼저 돌리고 `16 → … → 28` 을 그대로.
- `0.1-b` 를 하다 멈췄다면 — `13` 을 돌린 뒤, 멈춘 자리부터 `28` 까지 이어갑니다.
  어디서 멈췄는지 모르면 `error.md` #32 의 확인 방법으로 없는 뷰를 찾습니다.

### 0.2 한 번만 해 둘 설정

```sql
alter database postgres set app.cron_secret = '충분히-긴-무작위-문자열';
```

- Supabase → Settings → API → Exposed schemas 에 `core` · `analytics` (`raw` 는 넣지 않습니다)
- Vercel 환경변수 — `CRON_SECRET`(위 값과 동일) · `SUPABASE_SECRET_KEY`(외부 API 조회용, `NEXT_PUBLIC_` 접두어 금지) · `OPENAI_BASE_URL` · `OPENAI_API_KEY` · `OPENAI_MODEL`(AI 미설정이어도 나머지는 정상 동작)
- 예측 서비스(선택) — Railway 에 `forecast-service/` 배포 후 `FORECAST_SERVICE_URL` · `FORECAST_SERVICE_TOKEN`

### 0.3 적용 직후 순서 ★

1. `sql/05-first-admin.sql` 로 첫 관리자 지정
2. `/admin/forecast-runs` 에서 **검증 실행** 1회 → `/model-evaluation` 에서 백테스트
3. `/admin/forecast-runs` 에서 **운영 실행** 1회 — **이걸 하지 않으면** 재고전개·발주추천·대시보드가 전부 `NO_FORECAST` 입니다 (검증 실행은 과거 구간을 예측하기 때문입니다. STEP 20 참조)
4. `/alerts` 에서 [지금 스캔] 1회

### 0.4 데이터

현재 `raw.usage_history` 는 약 17개월입니다. `renew.prd` 12.1 이 전제한 2023~2025 3년치를 넣으면 계절성 모델과 간헐수요 모델이 값을 하기 시작합니다 (`sql/14-reload-real-data.sql` · `docs/sample-data/실데이터-적재-가이드.md`).

---

## 0.5 처음 작성 당시의 요약 (2026-08-27)

현재 프로젝트는 **"리드타임 · 재고소진 두 개의 분석 화면 + 하드코딩된 6단계 업무 플로우 데모"** 입니다.
`renew.prd` 는 **"예측 → 백테스트 → Champion → 재고전개 → 발주추천 → 승인 → AI Agent"** 전체 플랫폼입니다.

즉 **재사용 가능한 자산은 데이터 계층(raw/core/analytics)과 리드타임 분석뿐이고, 나머지는 신규 구현**입니다.

| 구분 | 비중 |
|---|---|
| 이미 있고 그대로 쓸 수 있는 것 | 약 10% (리드타임 분석 · 사용량 프로파일 · 3계층 스키마 규칙) |
| 있으나 **재작성**이 필요한 것 | 약 10% (재고소진 계산식 · RLS 정책 · Supabase 클라이언트 · 워크플로우 화면) |
| 완전 신규 | 약 80% (인증/권한 · 업로드 · 예측 · 백테스트 · 발주추천 · 승인 · Alert · AI · 외부 API) |

---

## 1. 현재 상태 (사실 확인)

### 1.1 있는 것

**애플리케이션**
| 경로 | 내용 | 데이터 출처 |
|---|---|---|
| `app/page.tsx` → `components/procurement-app.tsx` | 6단계 워크플로우(현황·수요·재고·마스터·계산·보고) | **전부 하드코딩 샘플** (DB 미연결, 저장 없음) |
| `app/analysis/leadtime/page.tsx` | 공급처별 리드타임 갭 12행 | `analytics.v_leadtime_gap` |
| `app/analysis/stockout/page.tsx` | 재고소진 위험 20행 + KPI | `analytics.v_stockout_risk`, `v_stockout_kpi` |
| `app/api/health/supabase/route.ts` | 연결 헬스체크 | — |

**라이브러리**
- `lib/scm.ts` — 조회 함수 **3개** (`getLeadtimeGap`, `getStockoutKpi`, `getStockoutRisks`)
- `lib/scm-model.ts` — 타입 + 컬럼명 정규화 함수 (99줄)
- `lib/supabase/*` — publishable key 기반 **읽기 전용** 클라이언트 (`persistSession: false`)

**데이터베이스 (Supabase)**
- `raw` — shipment_log 2,864 / usage_history 7,038 / inventory 43 / item_master 23 / supplier_master 13 / purchase_order 92 / goods_receipt 81
- `core` — `leadtime_plan`(쓰기) · `usage_profile`(쓰기) · 정제 뷰 8개
- `analytics` — `v_leadtime_gap` · `v_stockout_risk` · `v_stockout_kpi` · `v_usage_profile` · `v_usage_anomaly`
- `public` — `planning_runs` · `ol_demand` · `sfdc_pipeline` · `bulk_deals` · `historical_actuals` · `demand_confirmations` (마이그레이션으로 생성됨, **화면과 미연결**)

**규칙 자산** — `AGENTS.md` 의 8개 원칙(계산은 SQL, 계산불가는 null+사유코드, raw 직접조회 금지 등)은 PRD 32장 설계원칙과 **일치**합니다. 그대로 유지합니다.

### 1.2 없는 것 (PRD 요구 대비)

| PRD 장 | 요구 | 현재 |
|---|---|---|
| 4 | 인증 · Role · RBAC 3중(FE/BE/DB) | **없음.** 로그인 화면·사용자 테이블·미들웨어 전무 |
| 8 | File Upload · Validation · Import History · Rollback | **없음** |
| 9 | External API (Inbound/Outbound) · API Key | **없음** |
| 10 | SKU Demand Profile (Trend/Seasonality/간헐수요 판정) | CV·안정성만 있음. Trend/Seasonality/Zero-rate 없음 |
| 11–12 | Forecast Model 레지스트리 · Forecast Engine · run_id 재현성 | **없음** |
| 13 | Backtest · WAPE/MAPE/Bias/RMSE · **가상 운영 결과** | **없음** |
| 14 | Champion Model 자동선정 | **없음** |
| 16 | Model Comparison 차트 · 성능 사전저장 | **없음** (차트 라이브러리 자체가 없음) |
| 17 | Forecast Override · Consensus · reason_code | **없음** |
| 18 | Lead Time 구간분해 · 분위수 · Policy | **거의 충족** (Admin 화면·변경이력만 부족) |
| 19 | Inventory Projection (기간별 전개) | **계산식이 다름.** 현재는 `available ÷ 일평균` 단순 나눗셈 |
| 20 | Stockout Risk 4상태 | 부분 충족 (SAFE/CRITICAL/UNKNOWN 3상태, WARNING 없음) |
| 21 | Safety Stock (σ_DLT) | **없음** |
| 22 | Purchase Recommendation (MOQ/Pack) | **없음** |
| 23 | Approval Workflow · 근거 Snapshot | **없음** |
| 24 | Alert Center · 백그라운드 스캔 | **없음** |
| 25 | What-If Simulation | **없음** |
| 26–27 | AI Agent · 영업 Agent · ATP · Soft Allocation | **없음** |
| 33.1 | Python Forecast Service | **없음** |

### 1.3 "추가"가 아니라 "정리"가 필요한 것 ★

새로 붙이기 전에 **먼저 치워야 하는 것**들입니다. 순서를 어기면 나중에 전부 다시 손봐야 합니다.

| 대상 | 문제 | 처리 |
|---|---|---|
| `sql/02-policies.sql` | `anon` 에게 `for all using(true)` — publishable key 를 가진 누구나 정책값 수정 가능 | **폐기.** STEP 2 에서 role 기반 RLS 로 교체 |
| `lib/supabase/server.ts` | `persistSession:false` 세션 없는 클라이언트 | `@supabase/ssr` 쿠키 세션 클라이언트로 **교체** (의존성은 이미 설치됨) |
| `components/workflow/*` 6개 | 하드코딩 데모. PRD 30장 메뉴 구조와 충돌 | `/legacy` 로 격리하거나 폐기. **PRD 화면으로 대체되므로 개선 대상이 아님** |
| `public.*` 6개 테이블 | PRD 의 CORE 계층과 역할 중복 | `core` 로 흡수하거나 폐기 결정 |
| `analytics.v_stockout_risk` | 계산식이 PRD 19장과 다름 | STEP 9 에서 Forecast 기반으로 **재작성** (화면은 유지) |
| 차트 없음 | PRD 16장은 다중모델 Overlay 차트가 필수 | **결정 완료 — `recharts@3.10.1`** (§4.1) |
| `app/globals.css` 라이트 테마 | 디자인 방향이 다크 관제 콘솔로 확정됨 | **전면 교체.** 기존 클래스(`card`·`metric`·`tag`·`analysis-*`) **폐기**, 이름 재사용 금지 → `design.md` |

---

## 2. 순차 구현 단계

의존 관계상 **앞 단계를 건너뛰면 뒤 단계가 성립하지 않는 순서**로 배열했습니다.
각 단계는 `완료 판정` 을 통과해야 다음으로 넘어갑니다.

```
STEP 1 ─ 2 ─ 3 ─ 4 ─ 5 ─ 6 ─ 7 ─┬─ 8 ─ 9 ─ 10 ─ 11 ─ 12 ─ 13 ─ 14 ─ 15 ─ 16 ─ 17 ─ 18
                                 └─ (STEP 8 은 6 과 병행 가능)
```

---

### PHASE 1 — 기반과 예측

#### STEP 1. 디자인 시스템 교체 + 라우팅 재편 + 레거시 격리
**왜 먼저인가** — 두 가지가 같은 이유로 여기 있습니다. **화면을 30개 붙인 뒤에 바꾸면 30개를 다시 손봐야 합니다.** 지금은 화면이 4개뿐이라 비용이 가장 쌉니다.

**기준 문서** — `design.md` (색·글꼴·컴포넌트·상태 표현). 이 단계에서 문서를 코드로 옮깁니다.

**할 일 (디자인)**
- `app/globals.css` **전면 교체** — `design.md` §3.6 토큰 블록을 최상단에 넣고, 기존 클래스 전체 폐기
- 스타일 4파일 분리 — `app/globals.css` · `styles/shell.css` · `styles/components.css` · `styles/chart.css`
- 글꼴 로드 — Pretendard(한글) · Inter(영문·숫자) · JetBrains Mono(코드). **Inter 에는 한글 글리프가 없으므로 Pretendard 를 앞에 둡니다**
- 공통 컴포넌트 구현 (`design.md` §6) — 사이드바 · 탑바 · 페이지 헤더 · KPI 카드 · 패널 카드 · 배지 · 버튼 · 데이터 테이블 · 알림 행 · 인사이트 배너 · AI 우측 레일
- **상태 4색 + null 표기법 확정** (`design.md` §8) — `SAFE` · `WARNING` · `CRITICAL` · `산출 불가(—)`. 이후 모든 화면이 이 규칙을 씁니다
- 기존 두 화면(`/analysis/leadtime` · `/analysis/stockout`)을 새 컴포넌트로 재작성해 **디자인 시스템을 실물로 검증**

**할 일 (라우팅)**
- `app/(auth)/` · `app/(user)/` · `app/(admin)/` 라우트 그룹 생성
- 메뉴 정의를 **한 파일**(`lib/menu.ts`)에 모음 — role 별 메뉴는 여기서 갈라짐
- `components/workflow/*` 6개를 `app/(legacy)/workflow/` 로 이동 또는 폐기 (§5)

**신규 파일**
```
app/globals.css              토큰 · 리셋 · 폰트 (교체)
styles/shell.css             사이드바 · 탑바 · 페이지 골격
styles/components.css        카드 · 배지 · 버튼 · 표 · 알림
styles/chart.css             차트 껍데기
lib/menu.ts                  메뉴 정의 (role 별)
lib/chart-colors.ts          시리즈 색 고정 매핑
components/shell/sidebar.tsx · topbar.tsx · page-header.tsx
components/ui/kpi-card.tsx · panel.tsx · badge.tsx · button.tsx · data-table.tsx
components/ui/alert-row.tsx · insight-banner.tsx · empty-value.tsx
```

`components/ui/empty-value.tsx` 는 작지만 중요합니다. **`—` + 사유 코드**를 렌더링하는 단일 컴포넌트로, 이후 모든 화면이 이것만 씁니다.

**완료 판정 — 완료 (2026-08-27)**
- ☑ PRD 30장의 메뉴 항목 전부가 라우트로 존재하고 404 가 없다 — **31개 라우트 빌드 성공**
- ☑ 두 분석 화면이 새 디자인으로 동작한다 — 리드타임 12행 · 재고소진 20행 (`SCHEMA.md` 기대값과 일치)
- ☑ 화면 파일에 hex 색 하드코딩이 한 건도 없다 (레거시 데모 제외)
- ☑ 산출 불가 품목이 `—` + 사유 코드로 표시되고, 정렬 시 맨 뒤로 간다
- ☑ `npm test` 7건 통과 · `npm run build` 성공

**남은 정리**
- ☐ `ARCHITECTURE.md` 갱신 (구 구조를 서술하고 있어 stale)
- ☐ 레거시 데모(`/workflow`) 폐기 여부 결정 (§5)

---

#### STEP 2. 인증 · Role · RBAC 3중 ★ 가장 먼저 해야 하는 기능
**왜 먼저인가** — PRD 34장이 명시합니다. *"나중에 붙이면 모든 화면과 API를 다시 손봐야 한다."* 지금은 화면이 4개뿐이라 비용이 가장 쌉니다.

**할 일 (DB)**
- `core.app_user` — `user_id`(auth.users FK) · `email` · `name` · `department` · `role`(ADMIN/USER) · `active` · `last_login_at`
- `auth.users` INSERT 트리거로 `app_user` 자동 생성
- `core.audit_log` — `actor` · `action` · `target_type` · `target_id` · `before` · `after` · `at`
- **`sql/02-policies.sql` 폐기** → `sql/03-rls.sql` 신규: 모든 테이블 RLS 재설계, 쓰기는 `authenticated` + role 조건, `anon` 은 전면 차단
- `is_admin()` SQL 헬퍼 함수 (RLS 정책에서 재사용)

**할 일 (서버)**
- `lib/supabase/server.ts` 를 `@supabase/ssr` 쿠키 기반으로 교체 (기존 읽기전용 클라이언트는 `lib/supabase/service.ts` 로 분리)
- `middleware.ts` — 미로그인 → `/login`, USER 가 `/admin/*` 접근 → 403
- `lib/auth.ts` — `requireUser()` · `requireAdmin()` · `getRole()`. **모든 서버 액션과 Route Handler 첫 줄에서 호출**
- `lib/audit.ts` — 감사로그 기록 헬퍼

**할 일 (화면)** — 로그인 / 로그아웃 / Admin > Users (목록·역할변경·비활성화)

**완료 판정** (PRD 35 인증·권한 전 항목)

*코드 — 완료 (2026-08-27)*
- ☑ 로그인 화면과 Server Action (`lib/auth-actions.ts`)
- ☑ 미로그인 요청이 `/login?next=…` 으로 리다이렉트됨 (`middleware.ts`)
- ☑ USER 가 `/admin/*` 에 접근하면 **서버 레이아웃이** 403 을 렌더링함
- ☑ ADMIN·USER 메뉴가 다름 (`lib/menu.ts` · ADMIN 은 USER 메뉴 포함)
- ☑ 역할 변경이 `core.audit_log` 에 기록됨 (`lib/audit.ts`)
- ☑ 자기 계정의 관리자 권한·활성 상태는 스스로 못 바꿈
- ☑ `npm run build` 성공 · `npm test` 7건 통과

*DB — 적용 완료 (2026-08-27 · anon 키로 검증)*
- ☑ `sql/03-auth.sql` 실행 — `core.app_user` 조회 시 `42501 permission denied` (테이블 존재 + anon 차단)
- ☑ `sql/04-rls.sql` 실행 — **anon 의 `core.leadtime_plan` 쓰기가 `42501` 로 거부됨**
- ☑ `analytics` 뷰 정상 — `v_leadtime_gap` 12행 · `v_stockout_risk` 20행

*남은 확인 — 계정 생성 후*
- ☑ Supabase 대시보드에서 계정 생성 → `sql/05-first-admin.sql` 로 첫 관리자 지정
- ☑ 로그인 후 `/admin/users` 목록 확인
- ☐ USER 계정으로 `/admin/users` 접근 시 403 확인 (관리자 계정만 있어 미확인)

**실행 순서**

```
1  Supabase → SQL Editor → sql/03-auth.sql          ☑ 완료
2  Supabase → SQL Editor → sql/04-rls.sql           ☑ 완료
3  Supabase → Authentication → Users → Add user
     · "Create new user" 선택
     · Password 는 그 자리에서 직접 정합니다 (6자 이상)
     · Auto Confirm User 를 켭니다
4  sql/05-first-admin.sql 실행
5  npm run dev → /login 에서 3번의 이메일·비밀번호로 로그인
```

상세 안내는 `sql/05-first-admin.sql` 헤더에 있습니다.

---

#### STEP 3. 데이터 모델 확장 + 2025 격리
**왜 이 순서인가** — 업로드(STEP 4)가 넣을 테이블이 먼저 있어야 합니다. 그리고 **2025 격리는 예측 코드를 한 줄이라도 쓰기 전에** 만들어야 Data Leakage 를 구조적으로 막을 수 있습니다.

**할 일 (DB)**
- `raw` 신규 테이블 — `business_event` · `sales_order` · `item_substitute`
- 모든 `raw` 테이블에 공통 컬럼 추가 — `batch_id` · `source_type` · `loaded_at` · `source_record_id`
- `core` 정책·설정 테이블
  - `policy_config` (Service Level · Z값 · Review Period · 납기 여유일 · 가예약 유효기간)
  - `outlier_rule` (프로젝트성 출고 · 반품 · 중복 제외 규칙 — **코드에 하드코딩 금지**)
  - `item_policy` (MOQ · pack_size · item_grade · service_level)
- `core.soft_allocation` (STEP 16 에서 사용, 스키마만 먼저)
- **2025 격리** — `core.v_train_demand` 뷰 생성. `WHERE period <= (select train_end from core.forecast_setting)` 조건 고정. **예측·백테스트 경로는 이 뷰만 조회하도록 강제하고, `raw.usage_history` 직접 조회를 코드리뷰에서 금지**

**실행 파일** — `sql/06-core-extend.sql` → `sql/07-train-isolation.sql`

**격리 방식** — 경계를 코드에 하드코딩하지 않고 `core.forecast_setting` 한 행에 둡니다. `core.v_train_demand` 가 그 값만 보고 `train_end` 이후 행을 **물리적으로 내보내지 않습니다.** 예측·백테스트 코드는 이 뷰만 조회하고, `raw.usage_history` 직접 조회는 리뷰에서 반려합니다. 정답지는 `core.v_test_actual` 로 이름을 달리해, 학습 코드가 실수로 부르면 눈에 띄게 했습니다.

**★ 실데이터 확인 결과 (2026-08-27)** — 현재 DB 의 `raw.usage_history` 는 **2025-03-13 ~ 2026-07-28 (약 17개월)** 입니다. `renew.prd` 12.1 이 전제한 2023~2025 3년치가 **아직 적재되지 않았습니다.**

- 그래서 경계를 PRD 값으로 하드코딩하지 않고, **검증 = 마지막 6개월 · 학습 = 그 이전 전부**로 자동 계산해 넣었습니다
- 3년치를 적재한 뒤에는 `UPDATE` 한 줄로 PRD 값(train 2023.01~2024.12 · test 2025)으로 바꿉니다
- 경계가 데이터와 어긋나면 `analytics.v_data_coverage` 의 `train_window_ok` · `test_window_ok` 가 `false` 로 드러납니다
- **17개월로는 계절성 학습이 어렵습니다.** 최소 24개월이 필요하며, STEP 6~8 의 모델 성능이 이 데이터 길이에 좌우됩니다

**검증 화면** — `/admin/forecast-settings` 에서 데이터 기간 · 학습/검증 구간 · 격리 상태 · 공통 정책값을 확인합니다.

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 7건 통과
- ☑ `sql/06-core-extend.sql` 실행 (2026-08-27 확인)
- ☑ `sql/07-train-isolation.sql` 실행 — `v_data_coverage` 응답 확인
- ☑ **경계 정합** — `train_window_ok: true` · `test_window_ok: true`
- ☐ MOQ·pack_size 가 품목별로 채워진다 — **관리자 입력 필요** (`raw.item_master` 에 컬럼 없음)

---

#### STEP 4. 데이터 적재 파이프라인 (File Upload)
**왜 이 순서인가** — PRD 34장: *"데이터를 넣는 수단이 없으면 이후 단계를 실데이터로 검증할 수 없다."*

**할 일**
- 의존성 추가 — `papaparse` (CSV) · `xlsx` (Excel)
- **서버 파싱**. 수만 행을 브라우저에서 파싱하지 않음 (PRD 33.2)
- 파이프라인 구현 — `파일선택 → 종류선택 → Parse → Preview → Column Mapping → Validation → 사용자 확인 → Import → raw 저장`
- DB — `core.upload_batch` · `core.column_mapping`(매핑 규칙 재사용) · `core.validation_error`(행 단위)
- 검증 규칙 — 필수컬럼 · 타입 · 날짜형식 · Null · Duplicate · 마스터 존재 여부 · 음수 · 논리오류(입고일 < 발주일)
- **임의 보정 금지.** 오류 행만 CSV 다운로드
- 적재 방식 3종 (`append` / `replace` / `upsert`) + `batch_id` 단위 **rollback**
- 적재 후 처리 — CORE 재계산 트리거, 영향받는 예측에 `stale` 플래그

**화면** — Admin > Data Management > (File Upload · Import History · Validation Errors)
**핵심 설계** — 검증 로직을 `lib/import/validate.ts` **단일 모듈**로 만듭니다. STEP 19 의 External API 가 **같은 함수**를 호출해야 하기 때문입니다 (PRD 9.1).

**완료 판정**

*코드 — 완료 (2026-08-27)*
- ☑ `lib/import/` 5개 모듈 — `types` · `schema` · `parse` · `validate` · `repository` · `history`
- ☑ 검증 테스트 11건 (전체 18건 통과) — 날짜 형식 · 숫자 · 마스터 참조 · 논리 오류 · 중복 · 부분 성공
- ☑ CSV(UTF-8 · BOM · EUC-KR) · Excel · JSON 서버 파싱
- ☑ 한국어 컬럼 자동 매핑 + 매핑 규칙 저장·재사용
- ☑ 3단계 화면 — 올리기 → 검증 결과 → 적재. 검증 전에는 적재 버튼이 없음
- ☑ 오류 행만 CSV 내려받기 (`/api/import/errors/[batchId]`, 원본 컬럼 포함)
- ☑ `append` · `upsert` · `replace` + 배치 되돌리기
- ☑ `npm run build` 성공

*실제 파일로 확인한 파이프라인*
```
자동 매핑  품목코드→item_id · 출고일→use_date · 출고수량→qty · 비고→note
Total 7  Success 4  Warning 1  Error 3
  행 3  [ERROR]   UNKNOWN_ITEM   품목코드 'ITEM999' 가 마스터에 없습니다
  행 4  [ERROR]   INVALID_DATE   '2025/13/01' 은 날짜 형식이 아닙니다
  행 5  [ERROR]   REQUIRED       'qty' 는 비워둘 수 없습니다
  행 7  [WARNING] DUPLICATE      1행과 키가 같습니다
```

*DB — 사용자가 Supabase SQL Editor 에서 실행해야 함*
- ☑ `sql/08-import.sql` 실행
- ☑ `sql/09-import-commit.sql` 실행 — `raw` 를 노출하지 않고 적재 (error.md #9)
- ☑ 실제 파일 업로드·검증·적재 동작 확인

**설계 결정 기록**
- **적재 전 임시 보관** — 미리보기와 실제 적재 사이에 파일을 다시 올리게 하지 않으려고 `core.import_staging` 에 둡니다. 오류 CSV 내려받기와 되돌리기도 여기서 나옵니다
- **사용 실적의 음수는 오류가 아닙니다** — 반품이며 정상 데이터입니다. 적재는 하되 `core.v_train_demand` 의 `qty > 0` 이 학습에서만 뺍니다 (PRD 12.3)
- **`replace` 는 되돌릴 수 없습니다** — 지운 원본을 복구할 수 없기 때문입니다. `rollback_batch()` 가 거부합니다
- **업로드 크기** — Server Action 본문 25MB. Vercel 서버리스는 4.5MB 제한이 있어, 운영에서는 Storage 직접 업로드로 바꿔야 합니다 (PRD 33.2)

---

#### STEP 5. 수요 패턴 분석 (SKU Demand Profile)
**왜 이 순서인가** — 이 분류가 **모델 선택과 안전재고 정책의 입력**입니다 (PRD 10장). 간헐수요 판정 없이 모델을 돌리면 자재 품목에서 예측이 무너집니다.

**실행 파일** — `sql/10-demand-profile.sql`

**분류 기준** — Syntetos · Boylan · Croston (2005). 임의 기준을 만들지 않고 표준을 씁니다.

```
        ADI < 1.32          ADI >= 1.32
CV² <0.49  평활 SMOOTH        간헐 INTERMITTENT
CV² >=0.49 불규칙 ERRATIC      덩어리 LUMPY
```

`ADI` = 전체 기간 수 ÷ 출고가 있었던 기간 수 · `CV²` = 출고가 있었던 달 수량의 변동계수 제곱.
**간헐 + 덩어리** 가 Croston 계열이 필요한 품목입니다.

**★ 학습 구간만 봅니다** — 이 프로파일이 모델 선택을 좌우하므로, 검증 구간 통계를 보면 그 자체가 Data Leakage 입니다. `raw` 가 아니라 `core.v_train_demand` 를 읽습니다.

**계절성은 판정하지 않습니다** — 최소 24개월이 필요한데 현재 학습 구간이 11개월입니다. `null` + `INSUFFICIENT_PERIODS` 사유를 돌려주고, 화면에 "기간 부족" 으로 표시합니다. 임의 값으로 채우지 않습니다.

**산출 항목** — ADI · CV · CV² · Zero-demand Rate · 추세(기간당 %) · 최근 3개월 증감률 · Peak Month · 분류 · 판정 불가 사유 · 안정성

**화면** — `/analysis/demand-profile` (메뉴 "예측 > 수요 패턴")

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 23건 통과
- ☑ `sql/10-demand-profile.sql` 실행
- ☑ 19개 품목이 분류되었다 — **전부 평활(SMOOTH)**
- ☑ 간헐 계열 품목 수를 셀 수 있다 — **0개**

**★ 분류 결과가 시사하는 것 (2026-08-27)**

```
품목 19개 · 평활 19 · 간헐 0 · 불규칙 0 · 덩어리 0
평균 CV 0.158 · 평균 ADI 1.00 · 학습 11개월
```

`ADI = 1.00` 은 **모든 품목이 매달 빠짐없이 출고됐다**는 뜻입니다. 수요가 0인 달이 하나도 없습니다.
현재 데이터에는 **간헐수요 품목이 없습니다.** `renew.prd` 11.1 이 "간헐수요 모델은 반드시 포함한다"
고 한 이유(자재는 몇 달에 한 번 나가는 품목이 많다)가 이 표본에서는 드러나지 않습니다.

평균 CV 0.158 도 매우 안정적입니다. 실데이터 3년치를 넣거나 집계 단위를 주 단위로 바꾸면
간헐 품목이 나타날 가능성이 큽니다. **STEP 8 의 Croston 계열은 그때 값을 합니다.**

---

#### STEP 6. Forecast Engine — Baseline(SQL) + 실행 이력
**왜 SQL 먼저인가** — PRD 34장: *"백테스트 파이프라인이 돌아가는 상태를 만들어두면 Python 서비스 구축이 지연되어도 Phase 2 가 막히지 않는다."*

**할 일 (DB)**
- `core.model_config` — `model_id` · `model_name` · `type` · `version` · `enabled` · `is_default` · `applicable_demand_type` · `parameters`
- `core.model_version` — 모델 코드/파라미터 버전 스냅샷
- `core.forecast_setting` — Champion Metric · Horizon · Granularity · Train 기간 · Prediction Interval
- `analytics.forecast_run` — `run_id` · 조건 · `data_snapshot_at` · 실행자 · 상태
- `analytics.model_forecast_result` — `run_id` · `model_id` · `item_id` · `period` · `predicted_qty` · `p50` · `p80` · `p90`

**할 일 (모델)** — Baseline 4종 SQL 구현: Previous Year Same Month · MA 3M/6M · Weighted MA · Seasonal Naive

**실행 파일** — `sql/11-forecast-engine.sql`

**화면** — Admin > 예측 모델(on/off·파라미터) · Admin > 예측 실행(실행·이력)

**설계 결정**
- **테이블은 `core`, 화면은 `analytics` 뷰** — 지금까지 만든 것과 같은 방식입니다. `analytics` 에는 뷰만 둡니다
- **계산은 DB 안에서 끝냅니다** — 앱은 `core.run_baseline_forecast()` 를 부르는 방아쇠일 뿐입니다. 학습 데이터가 앱으로 나오지 않아 격리가 유지되고, 수만 행을 왕복하지 않습니다
- **예측 시작점은 `train_end` 다음 기간** — 검증 구간과 겹치므로 STEP 7 의 백테스트가 이 결과를 그대로 채점합니다
- **값을 낼 수 없으면 행을 만들지 않습니다** — 전년동월·계절나이브는 12개월 이상 학습 데이터가 필요합니다. 없으면 0 이나 임의 값으로 채우지 않고 **결과를 비웁니다**
- **예측구간(P50·P80·P90)** — 학습 구간 잔차의 표준편차 σ 로 정규 근사합니다 (`P80 = 점추정 + 0.8416σ`). σ 를 못 구하면 `null` 입니다. 이 σ 는 STEP 10 안전재고가 그대로 씁니다

**Baseline 5종** — `MA_3M` · `MA_6M` · `WMA_3M`(3:2:1) · `PY_SAME_MONTH` · `SEASONAL_NAIVE`

**★ 현재 데이터의 제약** — 학습 구간이 11개월이라 **전년동월·계절나이브는 결과를 내지 못합니다.** 12개월 전 실적이 없기 때문입니다. 이동평균 3종만 값을 냅니다. 3년치를 적재하면 자동으로 살아납니다.

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 29건 통과
- ☑ `sql/11-forecast-engine.sql` 실행 (`column reference is ambiguous` 수정 후 · error.md #11)
- ☑ `sql/12-forecast-summary.sql` 실행 — 결과 조회 뷰
- ☑ **예측 실행 성공** — 모델 5종 · 품목 19개 · 1,102행 · 1.1초
- ☑ `/forecast` 화면에서 결과 확인
- ☐ 관리자가 모델을 on/off 하고 `audit_log` 에 남는다 (미시도)
- ☐ **같은 snapshot · version 으로 재실행하면 동일한 결과가 나온다** (2회차 미실행)
- ☐ 실행 뒤 데이터를 올리면 "재실행 필요" 가 뜬다 (미시도)

모델별 결과 — `MA_3M` 208 · `MA_6M` 207 · `WMA_3M` 207 · `PY_SAME_MONTH` 189 · `SEASONAL_NAIVE` 189

---

#### STEP 7. Backtest + Champion + Model Comparison 화면
**왜 이 순서인가** — 예측만 있고 검증이 없으면 신뢰 근거가 없습니다. 그리고 **Safety Stock(STEP 10)이 백테스트의 σ_d 를 입력으로 받습니다.**

**할 일 (DB)**
- `analytics.model_performance` — `run_id` · `model_id` · `item_id` · WAPE · MAPE · Bias · RMSE · MAE · baseline_improvement · rank
- `analytics.champion_model` — `item_id` · `champion_model_id` · `model_version` · 성능지표 전체 · **후보 전체 성능** · 선정근거 · 선정방식(자동/수동) · 선정시각
- `analytics.backtest_run` — 실행 이력

**할 일 (화면)** — Model Comparison
- 조건 설정(SKU · 기간 · Horizon · 모델 체크박스)
- **Overlay 차트** — Actual 굵은 실선 + 모델별 선 + 검증구간 음영 + P50/P80/P90 밴드
- 성능 비교표 (정렬 · CSV/Excel 내보내기) · 월별 상세표
- **★ 모델 체크박스 토글 시 재실행 없이 즉시 갱신** — `model_forecast_result` 를 미리 저장해두었기 때문에 가능 (PRD 16.5)

**실행 파일** — `sql/13-backtest.sql`

**지표 정의**
```
WAPE = Σ|실적−예측| ÷ Σ실적          핵심 KPI
MAPE = avg(|실적−예측| ÷ 실적)        실적 0 인 기간은 제외 (발산 방지)
Bias = Σ(예측−실적) ÷ Σ실적           부호 유지 · + 는 과대예측
RMSE · MAE
기준선 대비 = (기준선 WAPE − 모델 WAPE) ÷ 기준선 WAPE
```

**설계 결정**
- **후보 전체 성능을 `champion_model.candidates` 에 jsonb 로 저장** — "왜 이 모델이 뽑혔는지" 를 보여주려면 1등만으로는 부족합니다 (PRD 14.2)
- **수동 지정은 자동 선정이 덮어쓰지 않습니다** — 사람이 사유를 적어 고른 것이라, 다음 백테스트가 지워버리면 안 됩니다
- **채점 불가는 사유 코드로** — 검증 구간 실적 합계가 0 이면 `NO_ACTUAL`, 겹치는 기간이 없으면 `INSUFFICIENT_SAMPLE`. 지표를 0 으로 채우지 않습니다
- **차트는 `components/chart/` 만 recharts 를 import** — 화면은 래퍼만 씁니다 (AGENTS.md 규칙 11)

**차트 (`recharts@3.10.1` · `components/chart/forecast-overlay-chart.tsx`)**
- 실적 = 잉크 블랙 2.5px 실선 · 모델 예측 = 시리즈 색 2px 파선
- 검증 구간 `ReferenceArea` 음영 · Champion 의 P80/P90 `Area` 밴드
- **범례 칩 클릭으로 모델 on/off — 재조회 없이 즉시 갱신** (클라이언트 상태)
- 이후 STEP 9·11·18 이 이 컴포넌트를 재사용합니다

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 29건 통과
- ☑ `recharts@3.10.1` 도입 · 화면에서 직접 import 0건 확인
- ☐ `sql/13-backtest.sql` 실행
- ☐ WAPE · MAPE · Bias · RMSE 가 산출된다
- ☐ SKU별 Champion 이 자동 선정되고 **후보 전체 성능이 저장된다**
- ☐ 관리자 수동 지정 시 **사유가 필수**이고 자동 선정이 덮어쓰지 않는다
- ☐ 범례 토글 시 재실행 없이 차트가 갱신된다
- ☐ 성능 비교표를 CSV 로 내려받을 수 있다

---

#### STEP 8. Python Forecast Service (병행 가능)
**왜 뒤인가** — STEP 6~7 로 파이프라인이 이미 돌아가므로, 여기서는 **모델만 추가**하면 백테스트와 Champion 선택에 자동 편입됩니다.

**할 일**
- 별도 리포지토리/서비스 (FastAPI · Railway)
- **Plug-in 인터페이스** — `forecast(train_df, horizon, params) -> DataFrame`. 함수 하나 추가로 파이프라인 코드 수정 없이 편입
- 모델 — Exponential Smoothing · Holt/Holt-Winters · SARIMA · Prophet · **Croston/SBA/TSB** · XGBoost/LightGBM
- 엔드포인트 — `POST /forecast/run` · `POST /backtest/run` · `GET /models` · `GET /health`
- 실행 방식은 **배치**. Next.js 는 트리거와 조회만 담당
- 결과는 `run_id` · `model_version` 과 함께 DB write

**구현 (2026-09-03)** — `forecast-service/` (FastAPI · 이 리포지토리 안의 자기완결 디렉터리) · `sql/25-python-models.sql` · `lib/forecast-service.ts` · 지시서 `docs/prompts/step-08-python-forecast-service.md`

**설계 결정**
- **같은 `run_id` 에 이어 붙인다** — 관리자가 예측 실행을 누르면 SQL Baseline 이 먼저 run 을 만들고, 서비스가 Python 모델 결과를 그 run 에 append. 백테스트가 두 계열을 한 조건에서 채점
- 학습 데이터는 `core.v_train_demand` · `core.v_demand_grid` 만 (서비스 코드에 `raw` 문자열 0건 — 테스트로 강제)
- Plug-in = `app/models/*.py` 파일 하나. `forecast(train_df, horizon, params) -> DataFrame`. 모델 8종: ETS · HOLT_WINTERS · SARIMA · PROPHET(선택·기본 off) · CROSTON · SBA · TSB · LIGHTGBM
- 값을 못 내는 (모델, 품목) 은 행을 만들지 않고 `forecast_run.models[].skipped` 에 사유
- σ 는 in-sample 잔차(LightGBM 은 out-of-fold) · p80/p90 은 sql/11 과 같은 상수 · σ 없으면 null
- 서비스는 `DATABASE_URL` 로 직접 접속 (postgres 사용자). `core.is_admin()` 이 `session_user = 'postgres'` 직접 접속을 관리자로 봄 — API(PostgREST) 경로는 session_user 가 authenticator 라 절대 해당 없음. **실행 후 `select core.is_admin(), session_user;` 로 확인**
- 서비스 미설정·미응답이어도 SQL 결과는 그대로, 화면 정상 (`FORECAST_SERVICE_URL` 없으면 칩 "미설정")

**완료 판정**
- ☑ pytest 70건 통과 · `npm run build` 성공 · 검토 2회(Approved)
- ☑ `/health` 가 DB 없이도 응답 · 토큰 없으면 401(fail-closed)
- ☐ **`sql/25-python-models.sql` 실행** → `core.model_config` 13행 (SQL 5 + PYTHON 8)
- ☐ Railway 배포 (Root Directory = `forecast-service`) · `DATABASE_URL` · `SERVICE_TOKEN` · Vercel 에 `FORECAST_SERVICE_URL` · `FORECAST_SERVICE_TOKEN`
- ☐ Python 서비스가 죽어도 저장된 예측 결과는 계속 조회된다 (배포 후 서비스 중지 상태로 화면 확인)
- ☐ 간헐수요 모델이 후보에 포함되고 Croston 계열이 Champion 으로 선정되는 품목이 존재한다 (현재 표본은 전부 평활이라 3년치 적재 후 확인)

**남은 우려** — 한 run 의 실행 시간(품목 수백 개 × SARIMA 면 수 분) · run 진행 상태가 프로세스 메모리에 있어 인스턴스 1개 전제 · Supavisor 트랜잭션 모드의 `session_user` 값 미확인(세션 모드 5432 권장)

---

### PHASE 2 — 재고와 발주 (시스템의 핵심 가치)

#### STEP 9. Lead Time 정책화 + Inventory Projection 재작성
**현재 상태** — 리드타임 구간분해·분위수·`leadtime_plan` 은 **이미 있습니다.** 부족한 것은 관리 화면과 이력입니다.

**할 일 (리드타임)**
- Admin > SCM Policies > Lead Time 화면 (SQL 없이 확정값 변경, **변경 이력 저장**)
- `core.v_leadtime_effective`(확정값 → 없으면 실적 P80)는 이미 존재. 그대로 사용

**할 일 (Inventory Projection — 재작성)**
- 현재 `v_stockout_risk` 는 `available ÷ 일평균` 입니다. PRD 19장 기준으로 교체:
  ```
  Projected Inventory = 가용재고 + 입고예정 − 가예약 − 확정수주 − Forecast 수요
  ```
- `analytics.v_inventory_projection` — 기간별 projected inventory · Stockout Date · Days/Months of Supply
- 리드타임 이후까지의 **누적 수요** 기준 필요량 (PRD 19.3)
- Stockout Risk 4상태로 확장 — `SAFE` / **`WARNING`(리드타임 이내 결품, 발주 가능)** / `CRITICAL`(지금 발주해도 늦음) / `CALCULATION_UNAVAILABLE`
- 사유 코드 4종 유지·확장 — `NO_USAGE_HISTORY` · `NO_LEADTIME` · `NO_INVENTORY_DATA` · `INSUFFICIENT_SAMPLE`

**실행 파일** — `sql/15-inventory-projection.sql` · 지시서 `docs/prompts/step-09-inventory-projection.md`

**설계 결정 (2026-09-03)**
- **기간별 적용수요 = max(예측, 확정수주) + 가예약(첫 기간)** — 확정수주는 예측보다 우선(PRD 22.1)이되, 둘을 더하면 이중 계산이라 기간별 max
- **판정 임계값은 `core.policy_config` 에서** — CRITICAL: 소진일수 < 리드타임 · WARNING: < 리드타임 + REVIEW_PERIOD_DAYS + SAFETY_BUFFER_DAYS · SAFE: 그 밖
- **예측이 없는 기간은 행을 만들지 않는다** — 오늘 이후 예측이 하나도 없으면 `NO_FORECAST` (사유 코드 5종: NO_INVENTORY_DATA · NO_LEADTIME · NO_FORECAST · NO_USAGE_HISTORY · INSUFFICIENT_SAMPLE)
- **`current_stock` 은 재고 행이 없으면 0 이 아니라 null** — "재고 0" 과 "모름" 을 구분 (규칙 5)
- **결품일 보간 = 기간 시작 + (기초 + 입고) ÷ 일평균 적용수요** — 같은 달 입고를 무시하면 WARNING 이 CRITICAL 로 오판
- `core.forecast_override` 테이블과 `core.v_consensus_forecast` 는 여기서 스키마만 먼저 만듦 (STEP 12 가 화면)

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 38건 통과 · 검토 2회(Approved)
- ☑ `analytics.v_inventory_projection` (품목 × 기간 · 기초/입고/예측/확정수주/가예약/적용수요/기말/누적수요)
- ☑ `analytics.v_stockout_risk` 4상태 재작성 (기존 컬럼 유지 + 8개 추가) · `v_stockout_kpi` 에 n_warning · n_within_60d
- ☑ 리드타임 정책 화면 `/admin/policies/leadtime` — 사유 필수 · 변경 이력(`core.leadtime_plan_history`)
- ☑ `/inventory-projection` 화면 · `/analysis/stockout` 4상태 갱신 · `components/chart/projection-chart.tsx`
- ☐ **`sql/15-inventory-projection.sql` 실행** (SQL Editor) → 파일 끝 확인 select 4개
- ☐ 기간별 예상재고가 표로 나온다 · Stockout Date 계산 · 계산불가가 숫자로 대체되지 않는다 (DB 실행 후 화면 확인)

**보류(minor)** — 선적 실적이 없는 공급처는 정책 화면에 안 보임(수동 확정 함수는 받음) · `v_stockout_risk` 가 전개 뷰를 3회 읽음(품목 수천 개면 materialized view) · `INSUFFICIENT_SAMPLE` 은 현재 도달 불가

---

#### STEP 10. Safety Stock + Purchase Recommendation
**왜 STEP 7 이후인가** — `σ_d` 를 **백테스트 결과에서** 가져옵니다. 예측이 잘 맞는 품목은 버퍼를 얇게, 자주 빗나가는 품목은 두껍게 — 이 지점에서 백테스트와 발주가 연결됩니다.

**할 일**
```
σ_DLT = √( L × σ_d² + d² × σ_L² )
Safety Stock = Z × σ_DLT
```
- `core.service_level` — `item_grade` · `service_level` · `z_value` · 적용 시작일
- `analytics.v_safety_stock`
- `analytics.purchase_recommendation`
  ```
  필요량 = max(Forecast, 확정수주) + Safety Stock − 가용재고 − 입고예정
  최종수량 = MOQ · Pack Size 반영 올림
  발주시점 = Stockout Date − Lead Time − Safety Buffer Days
  ```
- 출력 항목 전체 (PRD 22.3 의 18개 필드)
- 화면 — Purchase Recommendation 목록 + SKU Detail (PRD 29장 28개 항목 한 흐름)

**실행 파일** — `sql/16-safety-stock-recommendation.sql` · 지시서 `docs/prompts/step-10-safety-stock-recommendation.md`

**설계 결정 (2026-09-03)**
- **σ_d 는 백테스트(champion rmse) → 없으면 in-sample sigma → 없으면 null.** 월 단위 σ 를 √30.4 로 나눠 일 단위로 (일별 오차 독립 가정 — 자기상관이 있으면 안전재고가 작게 나올 수 있음. 뷰 주석과 화면에 명시)
- **σ_L 표본이 1건이면 0 으로 두고 `lead_time_confidence` 로 드러냄** (사유 코드가 아님)
- **서비스 수준 우선순위** 품목 직접 지정 → 등급(`core.service_level` 최신 effective_from) → `policy_config` 기본값. Z 는 `core.z_table` 최근접
- **`analytics.v_demand_window`** (리드타임+검토주기 창의 수요) 를 따로 두어 안전재고가 재고 유무에 묶이지 않게 함
- 단가는 `raw.item_master."표준단가"` 를 `core.v_item_price` 로만 읽음 (컬럼을 못 찾으면 실행 시 `raise notice`)
- `/purchase-recommendation` 에는 Primary 버튼 없음. 총 추천 금액 카드는 필터 없음

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 59건 통과
- ☑ `analytics.v_safety_stock` · `v_purchase_recommendation`(PRD 22.3 필드 전부 + is_urgent) · `v_purchase_recommendation_kpi` · `v_sku_detail` · `v_item_policy` · `v_consensus_forecast`
- ☑ 화면 4개 — `/purchase-recommendation` · `/purchase-recommendation/[itemId]`(PRD 29 SKU Detail · 승인 §5 는 STEP 13) · `/admin/policies/service-level`(등급 + 품목 정책 MOQ/Pack) · `/admin/policies/safety-stock`(정책값 편집 + 안전재고 근거 표) · CSV 내보내기
- ☐ **`sql/16-safety-stock-recommendation.sql` 실행** → `raise notice` 두 줄 확인(단가 컬럼) · 파일 끝 확인 select
- ☐ MOQ/Pack 반영 수량 · 발주 권고일 · 확정수주 우선 적용 (DB 실행 후 화면 확인)
- ☐ STEP 3 잔여 "MOQ·pack_size 관리자 입력" → `/admin/policies/service-level` 하단 품목 정책 표에서 입력

---

#### STEP 11. 가상 운영 결과 ★ (도입 판단의 근거)
**왜 중요한가** — PRD 2장: *"16번이 도입 판단의 근거가 된다. 오차율만으로는 그래서 도입하면 뭐가 나아지나에 답할 수 없다."*

**할 일**
- 2025년 1월 시점에서 시스템이 추천했을 발주량을 STEP 10 로직으로 재계산
- 그대로 발주했을 경우의 재고 추이를 월별 시뮬레이션
- **실제 발주 실적과 비교** — 결품 발생 횟수 · 평균 재고 수준 · 과잉 발주 건수 · 재고 회전율
- 산출 문장 자동 생성: *"AI 추천대로 발주했다면 2025년 실제 결품 4회 중 3회를 막을 수 있었고, 평균 재고는 15% 낮게 유지됐을 것이다."*

**선행 조건** — 검증 구간의 **실제 입고 실적**(`raw.goods_receipt`)이 DB 에 있어야 합니다. 없으면 비교 대상이 없습니다. (§5 협의)

**실행 파일** — `sql/17-virtual-operation.sql` · 지시서 `docs/prompts/step-11-virtual-operation.md` · 화면 `/virtual-operation`

**설계 결정 (2026-09-03)**
- 검증 구간(`forecast_setting.test_start~test_end`) 시작으로 돌아가 **매달 초 STEP 10 공식으로 발주 판단** (창 수요 + 안전재고 − 기초 − 파이프라인 → MOQ · Pack) · 도착 = 발주월 + ceil(리드타임/30.4) 개월
- **기초 재고는 현재고에서 역산한 추정치** (현재고 − 이후 입고 + 이후 사용). 음수면 0 에서 시작하고 그 품목 수를 `kpis.opening_clamped_items` 로 공개
- 미충족 수요는 유실(기말 0 · 결품 플래그). 실제 쪽도 같은 규칙
- 근거(재고 · 리드타임 · Z · σ_d)가 없는 품목은 **양쪽에서 함께 제외** (모집단을 같게) · 과잉 발주는 양쪽 모두 파이프라인 제외로 동일 기준
- σ_d 는 그 run 의 백테스트 RMSE 를 우선 — 검증 구간 성적을 같은 구간 시뮬에 쓰는 약한 정보 누설. 백테스트 없이 돌리면 in-sample σ (두 번 돌려 비교 가능)
- 한글 컬럼(`raw.goods_receipt` · `raw.purchase_order`)은 `core.v_goods_receipt` · `core.v_purchase_order` 로만 정규화. 날짜 표기 3종만 인식
- 문장은 SQL 이 만들어 `simulation_run.sentence` 에 저장

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 91건 통과
- ☑ 실제 vs 시뮬레이션 4개 지표(결품 횟수 · 평균 재고 · 과잉 발주 · 회전율)가 뷰와 화면에 나란히 · `components/chart/comparison-chart.tsx`
- ☐ **`sql/17-virtual-operation.sql` 실행** → 확인 select ①(한글 컬럼 정규화 행 수) 를 먼저 · 관리자 세션에서 `select * from core.run_virtual_operation();`
- ☐ 문장이 화면 상단에 뜬다 (DB 실행 후)
- ☑ 검토 2회 통과 (Critical 1건 · Important 3건 수정 — 회전율/평균재고 단위 · 초기 파이프라인 시드 · 발주 건수 단위 · DD-MON-YY 날짜)
- ★ **평균 재고와 회전율은 "전 품목 합계의 기간 평균" 기준**입니다. 품목별 표의 평균은 품목 단위이며 라벨로 구분합니다

**남은 우려** — 실패한 실행은 이력 행이 남지 않음(`sql/13` 과 같은 구조) · 품목 수천 개면 insert 를 `unnest` 로

---

### PHASE 3 — 사람의 개입

#### STEP 12. Forecast Override · Consensus Forecast
**할 일**
- `analytics.forecast_override` — `ai_forecast` · `override_qty` · `consensus_forecast` · `reason_code` · `reason_text` · `user` · `timestamp`
- **AI Forecast 원본은 수정 불가로 보존.** 별도 Override 행으로 입력
- `reason_code` 코드 체계 8종 (`NEW_CONTRACT` · `PROMOTION` · `NEW_PRODUCT` · `DISCONTINUED` · `PROJECT` · `MARKET_CHANGE` · `DATA_ERROR` · `OTHER`(텍스트 필수))
- **Forecast Value Add** — Actual 확정 후 AI 정확도 vs Consensus 정확도 비교. reason_code 별 집계

**실행 파일** — `sql/18-forecast-override.sql` · 지시서 `docs/prompts/step-12-forecast-override.md` (테이블 `core.forecast_override` 와 `core.v_consensus_forecast` 는 STEP 9 의 `sql/15` 가 먼저 만듦)

**설계 결정 (2026-09-03)**
- Override 는 **증감(delta)** 이며 음수 가능. Consensus = AI + 증감, 음수가 되면 거절
- 입력은 로그인 사용자 누구나(PRD 4.3) · 같은 (품목, 기간)의 이전 유효 행은 함수가 `superseded_at` 으로 대체 · 해제는 본인 또는 관리자
- Value Add 는 `core.v_actual_demand`(전 기간 실적, 학습 격리와 무관한 운영 뷰)에서 **기간이 끝난(`is_closed`) 달만** 채점. 실적 행이 없는 달(수요 0)은 채점에서 빠짐(한계)
- `improvement_pct` 는 비율(0.12 = 12%). STEP 15 에서 100 을 두 번 곱하지 말 것
- `lib/override-model.ts`(순수 · 클라이언트 폼도 import) 와 `lib/override.ts`(조회) 분리

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 77건 통과
- ☑ 원본 보존 — `core.forecast_result` 를 고치는 코드 없음 · reason_code 8종 코드 저장 · OTHER 는 텍스트 필수
- ☑ Consensus 가 발주 계산에 반영 — `sql/15` 재고전개와 `sql/16` 발주추천이 `core.v_consensus_forecast` 를 읽음
- ☑ 화면 — SKU Detail §2 Override 행 폼 · `/forecast-override`(보정 목록 · Value Add 요약 · 사유별 · 반복 보정 품목)
- ☐ **`sql/18-forecast-override.sql` 실행** → 파일 끝 확인 select (Consensus = AI + 증감 검산 0행)

---

#### STEP 13. Approval Workflow + 근거 Snapshot
**할 일**
- `추천 확인 → 수정 → 사유 입력 → 승인` 플로우
- `analytics.approval` — `recommendation_id` · `recommended_qty` · `approved_qty` · `adjustment` · `reason_code` · `approved_by` · `approved_at`
- **근거 Snapshot** — 승인 시점의 Forecast · Inventory · Open PO · Lead Time · Safety Stock · `model_version` · `run_id` · `data_snapshot_at` 를 **함께 저장**. 이후 데이터가 바뀌어도 당시 판단 근거를 재현할 수 있어야 함
- Decision History 화면

**실행 파일** — `sql/19-approval.sql` · 지시서 `docs/prompts/step-13-approval.md` · 화면 SKU Detail §5 · `/decision-history` · `/decision-history/[approvalId]`

**설계 결정 (2026-09-03)**
- **근거 Snapshot 은 security definer 함수 안에서 뷰 7개를 `to_jsonb` 로 담습니다** — 클라이언트가 보내지 않습니다. Forecast · Inventory · Open PO · Lead Time · Safety Stock · model_version · run_id · data_snapshot_at (PRD 23.2)
- **AI 추천값은 앱이 보내지 않고 함수가 승인 시점에 뷰에서 읽습니다** (PRD 32 추천과 승인 분리). 수량이 추천과 다른데 사유가 `AS_RECOMMENDED` 면 거절, `OTHER` 는 텍스트 필수
- **반려·보류는 승인 수량을 0 으로 강제**합니다. 추천값을 남기면 이력이 "반려 · 수량 1,000" 으로 읽히고 합계가 오염됩니다
- `core.approval` 에 앱이 직접 insert 하지 않습니다 — rpc 만
- **`analytics.v_sku_detail` 정의가 `sql/16` 과 `sql/19` 두 곳에 있습니다.** `sql/16` 을 다시 실행하면 **오류로 중단**되므로, 재실행 시 반드시 `sql/19` 도 이어서 실행하세요 (양쪽 파일 머리에 경고)

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 171건 통과 · 검토 2회 통과
- ☑ 승인 근거 Snapshot 저장 · `/decision-history/[approvalId]` 에서 재조회 (코드 경로 기준. DB 실행 후 실물 확인 필요)
- ☑ 수량 수정 시 사유 필수 · 추천 원본 보존 · 결정 이력 통합(승인 · 보정 · Champion · 리드타임)
- ☐ **`sql/19-approval.sql` 실행** → 파일 끝 확인 select · 로그인 세션에서 `core.approve_recommendation(...)` 시험

---

#### STEP 14. Alert Center + 백그라운드 스캔
**할 일**
- `analytics.alert` — `severity` · `item_id` · `type` · `reason` · `impact` · `recommended_action` · `detected_at` · `acknowledged_by`
- 탐지 룰 12종 (Stockout Risk · Order Too Late · Excess Inventory · Demand Spike · Forecast Outlier · Open PO Delay · Lead Time Deterioration · Forecast Accuracy Drop · **Excessive Override**(모델 개선 신호) · 납기 약속 위험 · 가예약 만료 임박 · 문의 급증)
- 우선순위 정렬 — 단가 · 결품 영향도 · 남은 시간
- **스케줄러** — Vercel Cron 또는 Railway Cron 으로 전체 SKU 주기 스캔

**실행 파일** — `sql/20-alert.sql` · 지시서 `docs/prompts/step-14-alert-center.md` · 화면 `/alerts` · 크론 `app/api/cron/scan-alerts/route.ts`

**설계 결정 (2026-09-03)**
- 탐지 룰 12종을 `core.scan_alerts()` 한 함수 안에서 훑고 **fingerprint**(`유형:품목|공급처`) 기준 upsert — 스캔마다 같은 알림이 늘어나지 않음. 이번 스캔에 안 잡힌 미해결 알림은 `resolved_at` 으로 닫힘
- 임계값 7종은 `core.policy_config` 의 `ALERT_*` 키. 정렬 가중치 3개만 상수(정책값 아님)
- 크론은 `Authorization: Bearer ${CRON_SECRET}` 검사(없거나 틀리면 401 — 실측 확인). DB 쪽은 `core.is_admin()` 또는 `p_secret = current_setting('app.cron_secret')`
- **1회 설정 필요**: `alter database postgres set app.cron_secret = '<CRON_SECRET 과 같은 값>';`
- `INQUIRY_SPIKE` 는 `core.sales_inquiry`(STEP 17)가 없으면 건너뜀

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 121건 통과
- ☑ 위험도별 Alert 생성 (12종 룰 · CRITICAL/WARNING/INFO) · 우선순위 정렬(단가 · 결품 영향 · 남은 시간)
- ☑ 스케줄러 — `vercel.json` cron 6시간마다 · 관리자 화면의 [지금 스캔]
- ☐ **`sql/20-alert.sql` 실행** + `alter database postgres set app.cron_secret = '…'`
- ☐ `select * from core.scan_alerts();` 를 **두 번 연속** 실행 → 두 번째는 `n_new = 0` (중복 생성 안 됨)
- ☐ Vercel 에 `CRON_SECRET` 환경변수 등록
- ☑ 검토 2회 통과 — **Critical 1건 수정**: `scan_alerts` 인증 게이트가 SQL 3값 논리로 열려 있었음(`app.cron_secret` 미설정 시 anon 이 통과). error.md #20 참조
- ★ **`EXCESS_INVENTORY` 는 결품이 없는 품목에 대해 잉여 재고를 직접 비교**합니다. 전개 길이로 포화된 `months_of_supply` 를 쓰면 건강한 품목 전부에 알림이 뜹니다
- ★ **한 유형이 이번 스캔에서 한 건도 안 나오면 그 유형의 기존 알림을 닫지 않습니다** (룰이 조용히 실패했을 때 이력이 통째로 닫히는 것을 방지). 유형이 진짜로 해소되면 수동으로 닫습니다 — 쿼리는 `sql/20` 주석에

---

#### STEP 15. Dashboard
**할 일** — PRD 28장. 상단 KPI 12종 + 하단 위젯 7종. STEP 7·10·13·14 의 결과를 조합만 하므로 여기 배치합니다.

**실행 파일** — `sql/21-dashboard.sql` · 지시서 `docs/prompts/step-15-dashboard.md` · 화면 `/dashboard` (`app/page.tsx` 가 여기로 보냅니다)

**설계 결정 (2026-09-03)**
- **새 계산을 만들지 않습니다.** KPI 12종이 전부 `analytics.v_dashboard_kpi` 에서 오고, 화면은 자르고 정렬만 합니다. 같은 숫자를 두 번 정의하면 카드와 목록이 어긋납니다
- **과잉 재고는 `EXCESS_INVENTORY` 알림 수로 셉니다** — `months_of_supply` 로 다시 계산하면 건강한 품목이 전부 잡힙니다 (STEP 14 참조)
- KPI 카드는 다른 화면으로 가는 **링크**(`href`)이며, 링크한 목록이 카드와 **같은 수**를 보이도록 필터를 맞췄습니다
- **Bias 부호** — `+` 는 과대예측, `−` 는 과소예측 (`sql/13` 정의 Σ(F−A)/ΣA). 검토에서 대시보드만 반대로 적혀 있던 것을 바로잡고, 문구가 다시 뒤집히면 실패하는 테스트를 넣었습니다
- LLM 없이 완전히 동작합니다. 우측 레일은 뷰 값으로 조립한 정적 문장입니다

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · `npm test` 206건 통과 · 검토 2회 통과
- ☑ KPI 12종 · 하단 위젯 7종 · 스파크라인 · `sql/21` 미적용 시 0 이 아니라 조회 실패로 표시
- ☐ **`sql/21-dashboard.sql` 실행**
- ☐ 적용 후 정확도 랭킹 패널이 "정확한 5 · 부정확한 5" 를 모두 보이는지 육안 확인 (PostgREST `.or()` 조건은 라이브로 미검증)

---

### PHASE 4 — AI 계층

> **전제 (PRD 31.4)** — LLM 실패가 SCM 계산을 중단시키면 안 됩니다. AI 는 **부가 계층**이며 핵심 경로가 아닙니다.

#### STEP 16. AI Agent (Tool Calling)
**할 일**
- 구조 — `User → LLM Intent → Tool Calling → Backend Function → Structured Result → LLM Explanation`
- **LLM 은 숫자를 계산하지 않습니다.** Tool 은 **화면이 쓰는 것과 동일한 `lib/scm.ts` 함수**를 호출합니다 (PRD 32장: 두 경로에서 다른 숫자가 나오면 신뢰가 무너짐)
- SCM Tool 10종 — `getDemandForecast` · `getForecastAccuracy` · `getInventoryProjection` · `getStockoutRisk` · `getLeadtimeStats` · `getSafetyStock` · `calcOrderQuantity` · `getOpenPO` · `getAlerts` · `simulateScenario`
- **Guardrail** — Structured Outputs 스키마 강제 · Tool 반환값에 없는 수치 응답 금지 · 후처리 수치 일치 검증 · 계산 불가는 "산출할 수 없음" + 사유
- Role 별 호출 가능 Tool 집합 제한 (서버에서 검증)

**실행 파일** — `sql/22-agent.sql` · 지시서 `docs/prompts/step-16-ai-agent.md` · 화면 `/agent` · 우측 레일 `components/ui/ai-rail.tsx`

**설계 결정 (2026-09-03)**
- **OpenAI 호환 `/chat/completions` 를 fetch 로 직접 호출** (SDK 미도입). `OPENAI_BASE_URL` · `OPENAI_API_KEY` · `OPENAI_MODEL`. 2단계(고객사 사내 vLLM·Ollama)에서는 **base URL 만 바꿉니다**
- 툴 10종은 전부 **화면이 쓰는 lib 함수를 그대로 호출**합니다 — `lib/agent/` 안에 Supabase 질의가 없습니다(대화 저장 파일 1곳 제외). 두 경로에서 다른 숫자가 나오면 신뢰가 무너집니다 (PRD 32)
- **Guardrail** — 답변 속 모든 숫자가 툴이 돌려준 값 사전에 있어야 통과. 없으면 1회 재생성, 그래도 실패하면 "산출할 수 없음". 검토에서 **조작 숫자 통과율을 실측**해 14/100 → 5/100(전부 실제 툴 값, 조작값 0)으로 개선
- **알려진 한계** — 값만 대조하고 필드·단위는 확인하지 않습니다. 예: `moq 100` 이 "100일 뒤" 를 뒷받침할 수 있습니다 (PRD 26.3 설계 자체의 한계. 가드레일 헤더에 명시)
- 역할별 툴 집합은 **서버(orchestrator)에서** 두 번 검증합니다
- 미설정(`OPENAI_*` 없음)이어도 빌드와 모든 화면이 정상이며 `/agent` 만 안내를 띄웁니다

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공(환경변수 없이) · `npm test` 205건 통과 · 검토 2회 통과
- ☑ AI 응답의 모든 수치가 툴 반환값과 일치 (Guardrail 강제 · 16개 테스트)
- ☑ **LLM 이 없어도 Dashboard·Forecast·Recommendation 이 정상 동작** — `runAgent` 는 `/agent` 액션에서만 호출되고, SKU Detail 의 AI 레일은 뷰 값만 씁니다
- ☑ 대화 저장 RLS — 본인 대화만 조회·기록
- ☐ **`sql/22-agent.sql` 실행**
- ☐ `OPENAI_API_KEY` 등 3종 환경변수 등록 후 실제 모델로 첫 호출 확인 (`response_format` + `tools` 호환성)

---

#### STEP 17. 영업 SCM Agent + ATP + Soft Allocation
**할 일**
```
ATP = 가용재고 + 확정 입고예정 − 확정수주 − 가예약 − 보호 안전재고
```
- 기간별 산출 — 즉시 / 2주 내 / 1개월 내 / 그 이후(신규 발주 리드타임 반영)
- `core.soft_allocation` — 가예약(기본 7일) → 확정 전환 → 만료 자동 해제. **가예약 수량은 ATP 에서 차감되어 이중 약속을 방지**
- 영업 Tool 6종 — `checkOrderFeasibility` · `getATP` · `getEarliestDelivery` · `getAlternativeItems` · `createSoftAllocation` · `getSupplyStatus`
- 응답 상태 4종 — `AVAILABLE` / `CONDITIONALLY_AVAILABLE` / `UNAVAILABLE` / `UNKNOWN`
- `core.sales_inquiry` 문의 이력 — 문의 빈도는 수요 증가 신호, UNAVAILABLE 다수는 기회 손실
- **정보 접근 범위 (PRD 4.5)** — 영업은 단가·공급처 상세·리드타임 통계·예측 정확도를 볼 수 없음. **서버에서 필드 단위 차단**
- 영업용 대시보드 (PRD 28.3)

**실행 파일** — `sql/23-atp-sales.sql` · 지시서 `docs/prompts/step-17-sales-agent-atp.md` · 화면 `/sales`

**설계 결정 (2026-09-03)**
- **영업 판정은 `core.app_user.department`** — '영업' 으로 시작하거나 'SALES' 포함. 앱은 `lib/agent/redact.ts` 의 `isSalesActor`, DB 는 `core.is_sales()`. **관리자는 영업 부서여도 영업이 아닙니다** (PRD 4.2 — ADMIN 은 모든 USER 기능 포함)
- **가예약은 `pg_advisory_xact_lock` 으로 직렬화합니다.** 잠금 없이는 동시 요청 두 건이 각각 ATP 전체를 가져가 재고를 이중으로 약속합니다 (검토에서 재현됨: ATP 139 에 278 예약)
- **정보 차단은 3중** — ① 메뉴에서 감춤(`lib/menu.ts` 의 `SALES_HIDDEN`) ② 서버 컴포넌트가 열·카드를 아예 조회·전달하지 않음(정확도 전용 화면 2개는 403) ③ DB 뷰가 `case when core.is_sales() then null`(`sql/29`)
- Guardrail 에 **날짜 검사**를 더했습니다. 영업 답변은 대부분 날짜라, 수량만 검사하면 납기일을 지어내도 통과합니다. 툴이 `dates` 를 낼 때만 켜져 SCM 경로는 그대로입니다

**완료 판정**
- ☑ 코드·SQL 작성 완료 · 검토 2회 통과 · 하네스 25/25
- ☑ ATP 응답에 상태 4종 포함 · 한 달 이후 납기도 판정(이전에는 UNKNOWN)
- ☑ **가예약 후 다른 문의에서 해당 수량이 제외됨** (동시 요청 실증)
- ☑ 영업 role 로 단가 필드가 응답·화면·DB 어디에도 포함되지 않음
- ☐ **`sql/23-atp-sales.sql` 실행** (그리고 `sql/29` · `sql/28` 순서로)

**보류** — 문의 이력이 사람의 질문이 아니라 툴 호출마다 1행 (전환율·INQUIRY_SPIKE 가 부풀 수 있음) · `getAlternativeItems` 의 자유 텍스트 `note` 는 키 이름 기반 가림이 볼 수 없음

---

#### STEP 18. What-If Simulation
**할 일**
- 시나리오 7종 — 수요 ±20% · 리드타임 변경 · Open PO 지연 · Service Level 변경 · 공급처 변경/불가 · 대형 계약 추가 · 프로모션
- Base Scenario 와 나란히 비교 출력
- **실제 데이터를 변경하지 않음.** 시뮬레이션 컨텍스트에서만 계산
- 자연어 요청을 파라미터로 변환 ("A공급처 리드타임이 두 배가 되면?")

**완료 판정** — ☐ 시뮬레이션 후 DB 원본이 그대로다

---

### PHASE 5 — 확장

#### STEP 19. External API (Inbound · Outbound) + API Key
**왜 마지막인가** — PRD 34장: *"내부 기능이 안정된 뒤 외부에 연다."*

**할 일**
- Inbound 11종 — items · suppliers · demand-history · inventory · purchase-orders · receipts · open-po · events · sales-order · bulk 2종
- **API 입력도 File Upload 와 동일한 Validation Pipeline 통과** (STEP 4 의 `lib/import/validate.ts` 재사용)
- 부분 성공 허용 + `strict:true` 전량 거부 + **멱등성**(같은 요청 반복 시 중복 적재 없음)
- Outbound 7종 — forecast · inventory-projection · stockout-risk · order-recommendation · leadtime · atp · alerts
- `core.api_key` — `key_hash` 저장, **원문은 생성 시 1회만 노출**, scope 6종, `expires_at` · `last_used_at`
- 페이징 · Rate limit · OpenAPI/Swagger 문서
- Admin > API Management (Keys · Integrations · Logs · Documentation)

**완료 판정** — PRD 35 데이터 항목 중 API 관련 6개

---

#### STEP 20. Admin 강화 · 운영 모니터링
**할 일** — Model Versions · Forecast Runs 상세 · System Logs · API Logs · **데이터 갱신 후 예측 stale 표시**(PRD 8.6·31.5) · 대량 변경 시 관리자 통지

**실행 파일** — `sql/27-admin-ops.sql` · 지시서 `docs/prompts/step-20-admin-operations.md`

**설계 결정 (2026-09-03)**
- ★ **검증 실행과 운영 실행을 나눕니다.** `train_end` 까지 학습한 예측은 **과거 구간**을 예측하므로, 재고전개·발주추천이 "오늘 이후" 예측을 못 찾아 전부 `NO_FORECAST` 가 됩니다. 운영에서는 최신 데이터까지 학습한 **PRODUCTION** 실행이 필요합니다
  - `core.v_ai_forecast` 는 PRODUCTION 실행을 **우선** 고릅니다 · 백테스트와 가상운영은 **VALIDATION 실행만** 채점합니다 (섞으면 시스템이 스스로를 훨씬 나쁘게 평가합니다)
  - **처음 적용한 뒤 `/admin/forecast-runs` 에서 "운영 실행" 을 한 번 돌려야** 재고전개·발주추천 화면에 숫자가 나옵니다
- **stale 체인** — 적재 → `core.v_data_loaded_at` 갱신 → `is_stale` → 다섯 화면의 배너 → 운영 실행 → 해제. 사용 실적뿐 아니라 **완료된 모든 적재 배치**를 봅니다
- 대량 적재(기본 1,000행 이상)는 `BULK_DATA_CHANGE` 알림으로 알리고, 운영 실행이 성공하면 자동으로 닫힙니다
- STEP 11 에서 이월된 결함 해소 — 실행이 실패해도 이력 행이 `FAILED` 로 남습니다

**완료 판정**
- ☑ 코드·SQL 작성 완료 · `npm run build` 성공 · 검토 2회 통과 · 하네스 26/26 (양쪽 pass)
- ☑ 관리자 화면 5개 — 모델 버전 · 실행 상세 · 시스템 로그 · 이상치 규칙 · 예측 기본 설정(운영 학습 종료일)
- ☑ `components/ui/planned.tsx` 를 쓰는 화면이 **0개** — 모든 메뉴가 실제 화면
- ☐ **`sql/27-admin-ops.sql` 실행** (그 뒤 `29` → `28` 순서로)
- ☐ 적용 후 **운영 실행 1회** — 그래야 재고전개·발주추천에 숫자가 나옵니다

---

## 3. 단계별 산출물 요약

| STEP | 신규 DB 객체 | 신규 화면 | PRD |
|---|---|---|---|
| 1 | — | 셸·메뉴 재편 | 30 |
| 2 | `app_user` · `audit_log` · RLS 전면 | 로그인 · Users | 4 · 31.1 |
| 3 | raw 3 · core 4 · `v_train_demand` | — | 6 · 7 |
| 4 | `upload_batch` · `column_mapping` · `validation_error` | Data Management 4 | 8 |
| 5 | `v_sku_demand_profile` | 수요 패턴 | 10 |
| 6 | `model_config` · `model_version` · `forecast_run` · `model_forecast_result` | Forecast Settings · Runs | 11 · 12 |
| 7 | `model_performance` · `champion_model` · `backtest_run` | Model Comparison · Evaluation | 13 · 14 · 16 |
| 8 | — (Python 서비스) | — | 33.1 |
| 9 | `v_inventory_projection` · 리드타임 정책 이력 | Inventory Projection · Lead Time 정책 | 18 · 19 · 20 |
| 10 | `service_level` · `v_safety_stock` · `purchase_recommendation` | Purchase Recommendation · SKU Detail | 21 · 22 · 29 |
| 11 | `simulation_result` | 가상 운영 결과 | 13.2 ★ |
| 12 | `forecast_override` | Forecast Override | 17 |
| 13 | `approval` + Snapshot | Approval · Decision History | 23 |
| 14 | `alert` | Alert Center | 24 |
| 15 | — | Dashboard | 28 |
| 16 | — | AI Agent | 26 |
| 17 | `soft_allocation` · `sales_inquiry` | 영업 화면 | 27 |
| 18 | — | What-If | 25 |
| 19 | `api_key` · `api_log` | API Management 4 | 9 |
| 20 | — | System Logs 등 | 30.1 |

---

## 4. 먼저 결정해야 할 기술 선택

| 항목 | 쟁점 | 권고 |
|---|---|---|
| **차트** | 현재 차트 라이브러리가 없음. PRD 16·19·13.2·25·28 다섯 화면군이 차트를 요구 | **`recharts@3.10.1` 확정.** 화면은 `components/chart/` 래퍼만 사용. 상세는 §4.1 |
| **디자인·CSS** | 라이트 프로토타입 → 다크 관제 콘솔로 전면 교체 | **`design.md` 확정.** 순수 CSS + 토큰 유지(Tailwind 미도입, 사유는 `design.md` §13.1). 스타일 4파일로 분리 |
| **Python 서비스 호스팅** | Railway 비용·운영 주체 | STEP 8 전 확정. 지연되면 STEP 6~7 Baseline 만으로 진행 가능 |
| **Mutation 경로** | 현재 서버 컴포넌트 조회만 있음. 쓰기 경로가 전무 | Server Actions 로 통일하고 첫 줄에서 `requireUser()` 호출 |
| **`public.*` 6개 테이블** | PRD CORE 계층과 중복 | STEP 3 에서 `core` 흡수 또는 폐기 결정 |

### 4.1 차트 — 무엇을 결정하는가

**결정 항목 다섯 가지 — ①② 는 확정, ③④⑤ 는 준수 규칙입니다.**

**① 라이브러리를 쓸 것인가, 직접 만들 것인가**

PRD 16.2 가 요구하는 Model Comparison 차트는 단순 선그래프가 아닙니다.

```
☑ Actual            굵은 실선          ← 다중 시리즈 Overlay
☑ Seasonal Naive
☑ Holt-Winters                        ← 체크·해제 시 재실행 없이 즉시 갱신
☑ LightGBM
검증 구간 음영 처리                     ← 특정 X 구간 배경 강조
Prediction Interval (P50·P80·P90) 밴드  ← 상·하한 영역 채움
```

축·틱·범례·툴팁·밴드·음영·반응형을 순수 SVG 로 직접 만들면, 재사용 차트 컴포넌트 하나에 상당한 비용이 듭니다.
그리고 **차트가 필요한 화면은 하나가 아닙니다.**

| 화면 | 필요한 차트 | PRD |
|---|---|---|
| Model Comparison | 다중선 Overlay + 검증구간 음영 + P50/P80/P90 밴드 | 16.2 |
| Inventory Projection | 기간별 예상재고 선 + 0선 교차(결품 시점) | 19.2 |
| 가상 운영 결과 ★ | 실제 vs 시뮬레이션 재고 추이 비교 | 13.2 |
| What-If | Base vs 시나리오 나란히 비교 | 25.2 |
| Dashboard | 스파크라인 · 정확도 랭킹 바 | 28 |

다섯 곳에서 재사용되므로 초기 도입 비용이 회수됩니다. → **라이브러리 도입 권고**

**② 어느 라이브러리인가 → `recharts@3.10.1` 확정 (2026-08-27)**

PRD 16.2 의 네 가지 요구를 후보별로 대조한 결과입니다. 모두 React 19 를 지원하므로 호환성이 아니라 **요구 충족도**로 갈립니다.

| 후보 | ① 다중 Overlay | ② 검증구간 음영 | ③ P50/P80/P90 밴드 | ④ 토글 갱신 | 종합 |
|---|---|---|---|---|---|
| **Recharts 3.10.1** | `Line` 다중 | **`ReferenceArea` 기본 제공** | `Area` (baseline 지정) | state 로 조건부 렌더 | **네 가지 모두 기본 API. 채택** |
| Nivo 0.99 | 기본 | 커스텀 layer 자작 | 커스텀 layer 자작 | 데이터 필터 | ②③ 을 직접 만들어야 함 |
| Chart.js 4.5 | 기본 | `annotation` 플러그인 별도 설치 | `fill:'+1'` 우회 | 기본 | canvas · 명령형. ② 에 플러그인 추가 필요 |
| ECharts 6.1 | 기본 | `markArea` 기본 제공 | 가능 | 기본 | 기능은 충분하나 option 객체 명령형 API · 패키지 60MB |
| visx 4.0 | 직접 조립 | 직접 | 직접 | 직접 | 통제력 최고 · 조립 비용도 최고 |
| 순수 SVG 자작 | 직접 | 직접 | 직접 | 직접 | 의존성 0 이지만 축·툴팁까지 전부 자작 |

**Recharts 를 고른 이유 네 가지**

1. **`ReferenceArea` 가 결정적** — "검증 구간 음영"은 다른 후보에서 플러그인 또는 커스텀 layer 를 요구합니다. Recharts 는 기본 컴포넌트입니다.
2. **선언적 JSX API** — 여러 명이 화면을 나눠 만드는 구조(`AGENTS.md`)에서 학습 비용이 가장 낮습니다. 기존 코드가 이미 선언적 React 입니다.
3. **SVG 출력** — 순수 CSS 프로젝트와 맞고, CSS 변수로 테마를 통일할 수 있으며, 보고자료 화면(PRD 28)에서 인쇄·확대에 강합니다. canvas 는 이 세 가지가 모두 불리합니다.
4. **데이터 규모가 작습니다** — 월 단위 12~36포인트 × 모델 5~6개. canvas 계열의 성능 이점이 발생하지 않는 구간입니다.

**정직하게 짚어둘 단점**
- SVG 후보 중 번들이 가장 큽니다. (npm 패키지 7.4MB 는 소스맵·ESM/CJS 포함 크기이며 브라우저 전송량과 다릅니다. 실제 비용은 STEP 7 에서 `npm run build` 결과로 측정합니다.)
- 3.x 에서 2.x 대비 API 변경이 있어, 검색으로 나오는 예제가 구버전일 수 있습니다. **버전을 정확히 고정**합니다.

```bash
npm install recharts@3.10.1
```

**③ 라이브러리를 화면에서 직접 쓰지 않는다 ★**

각 화면이 `recharts` 를 직접 import 하면, 12개 화면에서 축 포맷·색·툴팁이 제각각이 되고 나중에 교체가 불가능해집니다.
**`components/chart/` 만 `recharts` 를 import 합니다.**

```
components/chart/forecast-overlay-chart.tsx   다중모델 + 검증구간 + 예측구간 밴드
components/chart/projection-chart.tsx         예상재고 추이 + 0선 교차
components/chart/comparison-chart.tsx         Base vs 시나리오
components/chart/sparkline.tsx                Dashboard 소형
lib/chart-colors.ts                           모델별 색상 고정 매핑
```

화면은 이 래퍼만 씁니다. 라이브러리 교체 시 고칠 파일이 `components/chart/` 안으로 한정됩니다.

**④ AGENTS.md 규칙 반영 — 완료 (2026-08-27)**

`AGENTS.md` 규칙 1 이 금지하는 것은 **CSS 프레임워크**(Tailwind · styled-components · CSS Modules)이며 차트 라이브러리는 대상이 아닙니다.
디자인 전면 교체와 함께 `AGENTS.md` 를 갱신해 **규칙 9(차트는 `components/chart/` 를 거친다)** 를 추가했고, 기술 스택에 `recharts@3.10.1` 을 명시했습니다.
차트 시각 규칙(선 종류 · 시리즈 색 · 검증구간 음영 · 예측구간 밴드)은 `design.md` §7 에 있습니다.

**⑤ 서버 컴포넌트 원칙과의 정합**

차트는 `'use client'` 가 필요합니다. 현재 조회는 전부 서버 컴포넌트입니다. 경계를 이렇게 고정합니다.

```
서버 컴포넌트   lib/scm.ts 로 데이터 조회 · 정규화
      ↓ props
클라이언트 컴포넌트  components/chart/*.tsx  ← 렌더링과 토글만 담당
```

**차트 컴포넌트 안에서 계산하지 않습니다.** `AGENTS.md` 규칙 2(계산은 SQL) 를 그대로 유지합니다.
모델별 색상은 `lib/chart-colors.ts` 에 **고정 매핑**합니다. 화면마다 같은 모델이 다른 색으로 보이면 안 됩니다.

**결정 시점** — STEP 7 착수 전. 그 전까지는 표 기반 화면만 만들므로 영향이 없습니다.


---

## 5. 착수 전 확정해야 할 업무 사항

STEP 3 이전에 답이 없으면 그 뒤가 전부 흔들립니다.

**확인 완료 (2026-08-27)**
- ☑ **2023~2025 3년치 수요 실적 보유** → STEP 6~11 진행 가능
- ☑ **2025년 실제 발주 실적 보유** → STEP 11(가상 운영 결과) 의 비교 대상 확보

  ※ 두 데이터는 현재 Supabase 의 `raw.usage_history`(영업일 385일치) 와 별개입니다.
  **STEP 3 의 선행 작업으로 실데이터 적재 범위와 기간을 먼저 확정**해야 합니다.

**데이터 (남은 항목)**
- ☐ 2025 격리 방식과 접근 통제 주체
- ☐ **Granularity — 월 / 주** (모델 선택에 직결. 월이면 품목당 24개, 주면 104개)
- ☐ 품목 수 · 등급 체계 · 간헐수요 품목 비중
- ☐ MOQ · Pack Size · 대체품 마스터 확보 여부
- ☐ 확정 수주 데이터 연동 방식 (ERP · 수기)

**운영**
- ☐ Forecast 갱신 주기 · Champion Metric 기본값(WAPE 권장) · 등급별 Service Level
- ☐ 가예약 유효기간 · 납기 안내 여유일 · Cron 실행 환경

**조직·권한**
- ☐ 초기 계정 발급 방식 · 영업 정보 공개 범위 · 일반 사용자 업로드 허용 여부

**레거시**
- ☐ `components/workflow/*` 6단계 데모를 유지할 것인가 폐기할 것인가

---

## 6. 각 단계 공통 작업 규칙

`AGENTS.md` 를 그대로 따릅니다. PRD 32장 설계원칙과 일치합니다.

1. 계산은 SQL 이 한다 — 화면 컴포넌트에서 평균·분위수를 구하지 않는다
2. 화면은 `analytics` 만 조회한다 — `raw` 직접 조회 금지
3. 조회 오류와 빈 결과를 구분한다
4. **계산 불가를 숫자로 채우지 않는다** — `null` + 사유 코드
5. 정책값을 코드에 하드코딩하지 않는다 — `core` 테이블로 관리
5-1. **색·간격을 화면에 하드코딩하지 않는다** — `design.md` 의 CSS 토큰만 쓴다
6. 화면과 AI Agent 가 **동일한 함수**를 호출한다
7. 권한은 서버에서 검증한다 — 화면 숨김만으로는 부족하다
8. 한 번에 하나씩 만들고, 변경 후 `npm run build` 를 실행한다
9. 한국어로 쓴다 (컬럼명·변수명은 영어)
10. 에러가 나면 `error.md` 를 먼저 확인하고, 해결 후 기록을 갱신한다
