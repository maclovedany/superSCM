# SuperSCM 아키텍처

> 기준 시점: 2026-08-27 · STEP 1(디자인 시스템 · 라우팅) 완료, STEP 2(인증 · 권한) 코드 완료 · DB 적용 대기
> 함께 읽을 문서 — `renew.prd`(요구사항) · `step.md`(구현 순서) · `design.md`(디자인) · `AGENTS.md`(작업 규칙) · `SCHEMA.md`(데이터)

## 1. 문서 개요

이 문서는 한국후지필름BI의 SCM 의사결정 플랫폼 **SuperSCM**의 **현재 저장소 구조**를 설명한다. 앞으로의 계획이 아니라 지금 코드에 있는 것을 기술한다. 계획은 `step.md`에 있다.

현재 저장소에는 세 가지 성격의 코드가 함께 있다.

- **디자인 시스템과 셸**: `design.md`를 코드로 옮긴 토큰·컴포넌트·레이아웃. 앞으로 만들 모든 화면의 기반이다.
- **실데이터 분석 화면 2개**: `analytics` 뷰를 서버에서 읽는 리드타임 격차와 재고 소진 위험 화면이다.
- **미구현 화면 24개**: `renew.prd` 30장의 메뉴를 라우트로 먼저 만들어 둔 자리다. 빈 페이지가 아니라 어느 단계에서 무엇이 들어오는지 밝힌다.

여기에 폐기 예정인 **레거시 데모**(`/workflow`)가 격리되어 남아 있다.

## 2. 전체 구조 요약

| 경로 | 기능 요약 | 주요 파일 |
|---|---|---|
| `middleware.ts` | 세션 갱신과 미로그인 리다이렉트 | 저장소 루트 |
| `app/` | App Router 라우트 그룹, 루트 레이아웃, 토큰 CSS, API 라우트 | `layout.tsx`, `(user)/`, `(admin)/`, `(auth)/`, `(legacy)/`, `globals.css` |
| `components/shell/` | 사이드바·탑바·페이지 헤더 등 앱 껍데기 | `app-shell.tsx`, `sidebar.tsx`, `topbar.tsx`, `page-header.tsx` |
| `components/ui/` | 디자인 시스템 컴포넌트 | `kpi-card.tsx`, `panel.tsx`, `badge.tsx`, `data-table.tsx`, `empty-value.tsx` 등 |
| `components/chart/` | 차트 래퍼. `recharts`를 import하는 **유일한 위치** | (STEP 7에서 생성) |
| `components/workflow/` | **레거시 데모**. 폐기 예정이며 수정하지 않는다 | `procurement-app.tsx` 및 6개 스텝 |
| `lib/` | 인증·권한, 도메인 모델, 상태 코드, 메뉴, Supabase 조회 | `auth.ts`, `audit.ts`, `auth-actions.ts`, `scm.ts`, `status.ts`, `menu.ts` |
| `styles/` | 셸·컴포넌트·차트·레거시 CSS | `shell.css`, `components.css`, `chart.css`, `legacy.css` |
| `sql/` | 권한, 인증 스키마, RLS | `01-grants.sql`, `03-auth.sql`, `04-rls.sql`, `05-first-admin.sql` |
| `supabase/` | 로컬 설정과 마이그레이션 | `config.toml`, `migrations/` |
| `docs/`, `outputs/` | 실습 안내, 초기 PRD, 생성 산출물 | 런타임 코드가 아니다 |

## 3. 런타임 구조와 데이터 흐름

```text
브라우저
  ├─ /                      → app/page.tsx → redirect('/dashboard')
  │
  ├─ /dashboard 외 22개      → app/(user)|(admin)/**/page.tsx
  │                            → components/ui/planned.tsx
  │                            → 미구현 안내 (DB 미접속)
  │
  ├─ /analysis/leadtime      → app/(user)/analysis/leadtime/page.tsx
  │  /analysis/stockout        → lib/scm.ts
  │                            → lib/supabase/server.ts
  │                            → Supabase analytics.v_*
  │                            → lib/scm-model.ts 정규화
  │                            → components/ui/* 렌더링
  │
  ├─ /login                  → app/(auth)/login/page.tsx (껍데기)
  ├─ /workflow               → app/(legacy)/ (샘플값, 폐기 예정)
  └─ /api/health/supabase    → app/api/health/supabase/route.ts

Supabase PostgreSQL
  raw 원본 → core 정제·기준 → analytics 화면·AI용 뷰
```

핵심 원칙은 세 가지다. `raw`를 화면에서 직접 읽지 않는다. 조회 함수는 `lib/scm.ts`에 모은다. 숫자 계산은 SQL이 끝내고 화면은 그리기만 한다.

## 4. 폴더별 상세 구조

### 4.1 `app/` — 라우팅

라우트 그룹으로 권한 경계를 나눈다. 그룹 이름은 URL에 나타나지 않는다.

| 그룹 | URL | 레이아웃 | 역할 |
|---|---|---|---|
| `(auth)` | `/login` | 없음 | 로그인. STEP 2에서 Supabase Auth를 붙인다 |
| `(user)` | `/dashboard`, `/forecast`, `/analysis/*` 등 | `AppShell role="USER"` | 일반 사용자 화면 11개 + 분석 2개 |
| `(admin)` | `/admin/**` | `AppShell role="ADMIN"` | 관리자 화면 14개 |
| `(legacy)` | `/workflow` | `styles/legacy.css` | 레거시 데모. 신규 화면은 쓰지 않는다 |

#### 파일별 역할

| 파일 | 역할 |
|---|---|
| `app/layout.tsx` | Root Layout. 토큰 CSS 4개를 순서대로 import하고, Pretendard·Inter·JetBrains Mono를 로드한다. Inter에는 한글 글리프가 없어 Pretendard를 함께 쓴다. |
| `app/page.tsx` | `/`의 진입점. `/dashboard`로 redirect만 한다. |
| `app/globals.css` | **디자인 토큰**과 리셋, 타입 스케일. 색·간격·글꼴의 단일 출처다. `design.md` §3·§4와 1:1로 대응한다. |
| `app/(user)/layout.tsx` | `AppShell`에 `role="USER"`를 넘긴다. STEP 2에서 `requireUser()`가 들어갈 자리다. |
| `app/(admin)/layout.tsx` | 같은 구조. STEP 2에서 `requireAdmin()`이 들어간다. |
| `app/(legacy)/layout.tsx` | `styles/legacy.css`를 import하고 `.legacy-root`로 감싼다. 다크 테마와 충돌하지 않게 격리한다. |
| `app/(user)/analysis/leadtime/page.tsx` | `analytics.v_leadtime_gap` 조회. 공급처별 마스터 리드타임·실적 평균·P80·격차를 표시한다. |
| `app/(user)/analysis/stockout/page.tsx` | `analytics.v_stockout_risk`·`v_stockout_kpi` 조회. 품목별 소진 위험을 표시하고 산출 불가 품목을 `—`와 사유 코드로 구분한다. |
| `app/api/health/supabase/route.ts` | 환경변수 설정 여부만 확인해 `{ configured }`를 반환한다. |

두 분석 화면은 `dynamic = 'force-dynamic'`으로 캐시된 정적 결과를 피한다.

미구현 화면 24개는 모두 `components/ui/planned.tsx` 한 컴포넌트를 쓴다. 화면이 완성되면 이 컴포넌트를 쓰지 않게 되고, `lib/menu.ts`의 `ready`를 `true`로 바꾼다.

### 4.2 `components/shell/` — 앱 껍데기

| 파일 | 역할 |
|---|---|
| `app-shell.tsx` | 사이드바 + 탑바 + 콘텐츠 골격. 모든 화면이 이 안에 들어간다. |
| `sidebar.tsx` | 클라이언트 컴포넌트. `usePathname`으로 활성 메뉴를 판정하고 `lib/menu.ts`의 정의를 그린다. 활성 표시는 초록(상태)이며 파랑은 행동에만 쓴다. |
| `topbar.tsx` | 검색·AI Agent·전체 알림·아바타. 현재 전부 비활성이다. |
| `page-header.tsx` | 제목·부제·메타 칩·액션 버튼. `MetaChip`을 함께 export한다. |

### 4.3 `components/ui/` — 디자인 시스템 컴포넌트

| 파일 | 역할 |
|---|---|
| `empty-value.tsx` | **계산 불가 표기**. `—`와 사유 코드를 렌더링한다. 값이 없는 모든 자리는 이 컴포넌트만 쓴다. |
| `kpi-card.tsx` | KPI 카드. 값이 `null`이면 숫자를 지어내지 않고 `EmptyValue`를 쓴다. `default`·`warn`·`crit` 변형이 있다. |
| `panel.tsx` | 패널 카드. 제목·헤더 액션·본문. 표처럼 자체 여백이 있는 내용은 `flush`로 패딩을 없앤다. |
| `badge.tsx` | 배지와 `StatusBadge`. 상태→문구·색 매핑은 `lib/status.ts`에 있다. |
| `data-table.tsx` | 제네릭 표. 컬럼 정의(`variant`로 code·num·strong 지정)를 받아 그린다. 계산은 하지 않는다. |
| `alert-row.tsx` | 알림 행. 좌측 3px 상태 바가 상태 스파인이다. |
| `insight-banner.tsx` | AI 인사이트 배너. 없어도 화면이 성립해야 한다. |
| `state.tsx` | `ErrorState`와 `EmptyState`. 조회 실패와 빈 결과를 다른 문구로 구분한다. |
| `planned.tsx` | 미구현 화면 안내. 어느 STEP에서 무엇이 들어오는지 밝힌다. |

### 4.4 `components/workflow/` — 레거시 데모 (폐기 예정)

`procurement-app.tsx`와 6개 스텝 파일은 초기 프로토타입이다. 전부 하드코딩 샘플이며 DB에 연결되지 않는다. `/workflow`에서만 살아 있고 `styles/legacy.css`로 격리되어 있다.

**수정 대상이 아니다.** `renew.prd`의 화면으로 대체되며, 폐기 시점은 `step.md` §5의 미결 항목이다.

### 4.5 `lib/` — 도메인 모델과 데이터 접근

| 파일 | 역할 |
|---|---|
| `auth.ts` | 권한 검증의 단일 출처. `getSession`이 "로그인 안 함 / 프로필 없음 / 비활성 / 오류 / 정상" 다섯 상태를 구분하고, `requireUser`·`requireAdmin`·`requireAdminOrThrow`가 이를 강제한다. Supabase의 `getUser()`로 매번 토큰을 검증한다. 쿠키를 그대로 믿는 `auth.getSession()`은 권한 판정에 쓰지 않는다. |
| `auth-actions.ts` | 로그인·로그아웃 Server Action. Supabase 오류 원문을 화면 문구로 바꾸고, 비활성 계정은 세션을 끊고, 로그인 시 `last_login_at`을 갱신한다. |
| `audit.ts` | 감사 로그 기록. 기록 실패가 본 작업을 막지 않되 서버 로그에는 남긴다. |
| `users.ts` | `core.app_user` 조회. |
| `scm-model.ts` | 화면용 타입(`LeadtimeGap`, `StockoutRisk`, `StockoutKpi`)과 정규화 함수. 뷰 컬럼명이 영문·별칭·한국어 중 무엇이든 후보 배열로 흡수하고, 숫자 파싱 실패는 `null`로 처리한다. |
| `status.ts` | 상태와 사유 코드의 단일 출처. `RiskStatus` 4종, `ReasonCode` 4종, 한국어 라벨, `Tone` 매핑, `nullsLast` 정렬 함수를 제공한다. 현재 뷰가 돌려주는 `NO_USAGE`·`UNKNOWN`을 `renew.prd` 20.2 코드로 정규화한다. |
| `menu.ts` | `renew.prd` 30장의 ADMIN/USER 메뉴 정의. `ready` 플래그로 미구현 화면을 표시한다. 메뉴는 이 파일 한 곳에만 있다. |
| `chart-colors.ts` | 차트 시리즈 색 고정 매핑. 화면마다 같은 모델이 다른 색으로 보이지 않게 한다. |
| `scm.ts` | 조회의 단일 진입점. `getLeadtimeGap`·`getStockoutRisks`·`getStockoutKpi`가 `analytics` 뷰를 읽고 화면 모델로 정규화한다. 오류는 `{ rows/data, error }`로 반환한다. |
| `scm-model.test.ts` | 정규화 함수의 컬럼명 후보·별칭·상태 코드 변환을 검증하는 Node 테스트 7건. |
| `supabase/env.ts` | `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 읽는다. secret 키는 다루지 않는다. |
| `supabase/server.ts` | `@supabase/ssr`의 쿠키 세션 클라이언트. 세션이 쿠키에 있어야 RLS의 `auth.uid()`가 동작한다. 쿠키 쓰기는 Server Action과 Route Handler에서만 되므로, 서버 컴포넌트에서는 조용히 무시하고 `middleware.ts`가 갱신을 맡는다. |
| `supabase/client.ts` | 클라이언트 컴포넌트용 클라이언트. |

`lib/status.ts`는 `lib/scm-model.ts`에서 `./status.ts`로 확장자를 붙여 import한다. `node --test`가 ESM 확장자를 요구하기 때문이다.

### 4.6 `styles/` — CSS

화면별 CSS 파일을 만들지 않는다. 네 개가 전부다.

| 파일 | 역할 |
|---|---|
| `shell.css` | 사이드바·탑바·페이지 골격·그리드·반응형 |
| `components.css` | 카드·KPI·배지·버튼·표·알림·배너·레일·계산 불가 표기·상태 메시지 |
| `chart.css` | 차트 컨테이너·범례 칩·주석 박스와 차트 토큰 |
| `legacy.css` | 구 라이트 테마. `.legacy-root` 아래로 스코프되어 있다. 신규 화면은 쓰지 않는다 |

색과 간격은 전부 `app/globals.css`의 CSS 변수를 참조한다. 하드코딩된 hex는 레거시를 제외하면 없다.

### 4.7 `sql/` — 권한과 RLS

| 파일 | 역할 |
|---|---|
| `01-grants.sql` | `anon`·`authenticated`에 `core`·`analytics` 읽기 권한을 부여한다. `raw`는 열지 않는다. |
| `02-policies.sql` | **폐기됨.** `anon`에게 `for all using(true)`를 주던 수업용 정책이다. 실행하지 않는다. |
| `03-auth.sql` | `core.app_user`, `auth.users` 트리거, `core.is_admin()`, `core.audit_log`와 각각의 RLS. `is_admin()`을 `security definer`로 두는 이유는 `app_user` 정책 안에서 다시 `app_user`를 읽을 때의 재귀를 피하기 위해서다. |
| `04-rls.sql` | 02의 수업용 정책을 지우고 역할 기반으로 교체한다. `core.leadtime_plan`·`usage_profile`의 쓰기를 ADMIN으로 제한하고 `anon`의 쓰기 권한을 회수한다. 읽기는 남긴다. `analytics` 뷰가 `security definer`로 이 테이블을 대신 읽기 때문이다. |
| `05-first-admin.sql` | 첫 관리자 지정 템플릿. 이후 역할 변경은 `/admin/users` 화면에서 한다. |

### 4.8 `supabase/` — 설정과 마이그레이션

`config.toml`은 로컬 프로젝트 설정이다. `migrations/20260813000100_create_procurement_demand_core.sql`은 초기 수요확정 구조를 `public`에 만든다(`planning_runs`, `ol_demand`, `sfdc_pipeline`, `bulk_deals`, `historical_actuals`, `demand_confirmations`). 이 구조는 화면과 연결되어 있지 않으며, `renew.prd`의 CORE 계층과 역할이 겹친다. 정리 여부는 `step.md` STEP 3에서 결정한다.

### 4.9 저장소 루트의 문서

| 파일 | 역할 |
|---|---|
| `renew.prd` | **현재 기준 요구사항.** 36장 + 부록. 예측·백테스트·발주추천·AI까지 전체 범위를 정의한다. |
| `step.md` | 구현 순서. STEP 1~20과 각 단계의 완료 판정. |
| `design.md` | 디자인 시스템. 색·글꼴·컴포넌트·상태 표현·금지 사항. |
| `AGENTS.md` | 작업 규칙 10개. 기술 스택, 데이터 규칙, 코드 구조, 검증 방법. |
| `SCHEMA.md` | Supabase 스키마·뷰 컬럼·기대 행 수. |
| `error.md` | 발생한 오류와 해결책 기록. 오류가 나면 먼저 확인한다. |
| `2026-08-13-procurement-planning-mvp-prd.md`, `docs/superpowers/**` | **초기 MVP 문서.** `renew.prd`로 대체되었으며 이력 참고용이다. |
| `outputs/`, `build_*.mjs` | 프로세스 정의서 엑셀과 생성 스크립트. 런타임 코드가 아니다. |

## 5. 디자인 시스템 아키텍처

`design.md`가 기준이고, 코드는 다음 세 층으로 그것을 구현한다.

```text
app/globals.css          토큰 — 색 · 서피스 · 텍스트 · 상태 · 간격 · 반경 · 글꼴
        ↓ var(--*)
styles/*.css             클래스 — .panel · .kpi · .badge · .table · .alert-row
        ↓ className
components/ui/*          컴포넌트 — 타입이 붙은 재사용 단위
        ↓ props
app/**/page.tsx          화면 — 조회 결과를 컴포넌트에 넘긴다
```

화면에서 색과 간격을 직접 쓰지 않는다. 새 시각 요소가 필요하면 `design.md`에 스펙을 먼저 추가하고 `styles/components.css`에 클래스를 만든다.

### 상태 표현

`renew.prd` 20장의 4상태를 `lib/status.ts`가 단일 출처로 관리한다.

| 상태 | 배지 | 색 |
|---|---|---|
| `SAFE` | 안정 | 초록 |
| `WARNING` | 주의 | 노랑 |
| `CRITICAL` | 위험 | 빨강 |
| `CALCULATION_UNAVAILABLE` | 산출 불가 | **회색(무채색)** |

산출 불가에 색을 주지 않는 것이 의도다. 초록·노랑·빨강 중 하나로 보이면 판단을 오염시킨다.

값이 없는 자리는 `EmptyValue`가 `—`와 사유 코드를 그리고, `nullsLast`가 정렬에서 맨 뒤로 보낸다. `0`으로 취급하면 가장 급한 품목처럼 보인다.

현재 `analytics.v_stockout_risk`는 `SAFE`·`CRITICAL`·`UNKNOWN` 3종만 돌려준다. `WARNING`은 STEP 9에서 Forecast 기반으로 뷰를 재작성할 때 채워진다.

## 6. 새 화면을 만드는 순서

```text
1  SQL 뷰                    analytics 에 계산 결과를 만든다
2  lib/scm-model.ts          타입과 정규화 함수
3  lib/scm.ts                조회 함수
4  app/(user|admin)/**/page.tsx   서버 컴포넌트로 조회
5  components/ui/*           design.md 의 컴포넌트를 조립
6  lib/menu.ts               ready 를 true 로
```

계산은 1번에서 끝난다. 4·5번에서 평균을 내거나 분위수를 구하지 않는다.

서버와 클라이언트 경계는 이렇게 고정한다.

```text
서버 컴포넌트       lib/scm.ts 로 조회 · (STEP 2 이후) 권한 검증
      ↓ props
클라이언트 컴포넌트   차트 · 토글 · 폼만 'use client'
```

조회 오류와 빈 결과는 다르게 다룬다. 오류는 `ErrorState`로 원인 메시지까지 보여주고, 오류 없이 행이 없으면 `EmptyState`를 쓴다. 빈 배열을 "데이터 없음"으로만 표시하면 Exposed schemas 누락 같은 문제를 놓친다.

## 7. Supabase 데이터 계층

### `raw`

CSV 원본. `shipment_log`, `usage_history`, `inventory`, `item_master`, `supplier_master`, `purchase_order`, `goods_receipt`. 앱에서 직접 조회하지 않는다.

### `core`

정제 규칙과 회사 기준. `v_fact_shipment`, `v_shipment_valid`, `v_leadtime_stat`, `v_leadtime_effective`, `v_usage_effective`, `v_item_master`, `v_stock_on_hand`, `v_inbound_qty`와 확정값 테이블 `leadtime_plan`, `usage_profile`이 있다.

`core.leadtime_plan`을 바꾸면 화면 코드를 고치지 않아도 판정이 즉시 달라진다. 정책과 코드를 분리하는 지점이다.

### `analytics`

화면과 AI가 읽는 결과 계층. `v_leadtime_gap`, `v_stockout_risk`, `v_stockout_kpi`, `v_usage_profile`, `v_usage_anomaly`. 현재 화면이 쓰는 것은 앞의 세 개다.

### 별도 `public` 구조

초기 MVP의 수요확정 입력 테이블 6개가 `public`에 있다. 화면과 연결되어 있지 않다.

## 8. 환경변수·보안·권한

- 브라우저 공개 환경변수는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`다.
- `sb_secret_...` 키는 클라이언트 코드에 넣지 않는다.
- `sql/01-grants.sql`은 `raw`를 노출하지 않고 `core`·`analytics`만 읽게 한다.

### 3중 방어

`renew.prd` 32장 — 화면 숨김만으로는 부족하다. 세 층이 각각 독립적으로 막는다.

| 층 | 위치 | 하는 일 |
|---|---|---|
| Frontend | `lib/menu.ts` | 역할별 메뉴만 그린다 |
| Backend | `middleware.ts` · `app/(admin)/layout.tsx` · Server Action | 미로그인은 `/login`으로, USER의 관리자 화면 접근은 403. 액션은 첫 줄에서 `requireAdminOrThrow()` |
| Database | `sql/03-auth.sql` · `04-rls.sql`의 RLS | 앞의 두 층을 우회해도 DB가 거부한다 |

역할 검증을 `middleware.ts`에서 하지 않는 이유는 매 요청에 DB 조회가 붙기 때문이다. middleware는 세션 갱신과 미로그인 차단만 맡고, 역할은 서버 레이아웃이 판정한다.

middleware는 로그인한 사용자를 `/login`에서 되돌려보내지 **않는다.** middleware는 auth 세션만 알기 때문에, `core.app_user` 행이 없는 계정이 `/login`과 `/dashboard`를 무한히 오가게 된다. 이 경우 `requireUser()`가 `?reason=no_profile`을 붙이고 로그인 화면이 원인을 설명한다.

### 계정 발급

계정은 Supabase Auth가 만들고, 트리거가 `core.app_user`에 `USER`로 넣는다. 역할 상향은 `/admin/users`에서 하며 감사 로그에 남는다. 첫 관리자만 `sql/05-first-admin.sql`로 지정한다.

관리자는 자기 계정의 역할과 활성 상태를 스스로 바꿀 수 없다. 관리자가 0명이 되는 상태를 막기 위해서다.

## 9. 테스트·검증·배포

### 테스트

`npm test`는 `lib/**/*.test.ts`를 Node 내장 러너로 실행한다. 현재 정규화·상태 코드 변환 테스트 7건이 있다. `npm run build`는 타입 검사와 프로덕션 빌드를 수행하는 필수 검증 명령이다.

### 운영 확인 순서

1. `.env.local`에 Supabase URL과 publishable key를 입력한다.
2. Supabase API의 Exposed schemas에 `core`, `analytics`를 추가한다.
3. 덤프를 복원했다면 `sql/01-grants.sql`을 실행한다.
4. `/api/health/supabase`와 `/analysis/leadtime`을 확인한다.
5. 화면 행 수가 DB와 일치하는지 센다. 리드타임 12행, 재고 소진 20행이 기대값이다.
6. `npm test`와 `npm run build`를 실행한다.

### 배포

`vercel.json`이 Next.js 프레임워크를 지정한다. `.env.local`은 커밋하지 않고 Vercel 환경변수로 같은 값을 설정한다.

폰트는 CDN에서 받는다(Pretendard는 jsDelivr, Inter·JetBrains Mono는 Google Fonts). 빌드 시점에 네트워크를 요구하지 않는다.

## 10. 현재 제약과 다음 단계

| 제약 | 해소 시점 |
|---|---|
| **인증 SQL이 아직 적용되지 않았다.** `sql/03-auth.sql`·`04-rls.sql`을 Supabase에서 실행해야 로그인이 동작한다 | 즉시 |
| 계정 발급이 수동이다. 초대·비밀번호 재설정 흐름이 없다 | 미정 |
| 데이터를 넣는 수단이 없다. 업로드·검증·적재 이력이 없다 | STEP 4 |
| 예측·백테스트·Champion이 없다 | STEP 6~8 |
| 재고 소진 계산이 `가용재고 ÷ 일평균`이다. `renew.prd` 19장의 기간별 전개가 아니다 | STEP 9 |
| `WARNING` 상태가 뷰에서 나오지 않는다 | STEP 9 |
| 차트가 없다. `recharts`는 아직 설치하지 않았다 | STEP 7 |
| 미구현 화면 24개가 안내만 표시한다 | STEP 2~20 |
| 레거시 데모의 폐기 여부가 미정이다 | `step.md` §5 |

## 11. 한 문장 요약

SuperSCM은 `design.md`의 다크 관제 콘솔 디자인 시스템 위에 `renew.prd`의 ADMIN/USER 라우트 골격과 3중 권한 검증을 세우고, Supabase `raw → core → analytics` 계층을 `lib`의 조회·정규화 계층으로 연결해 화면을 하나씩 채워 나가는 SCM 의사결정 플랫폼이다.
