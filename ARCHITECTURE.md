# SuperSCM 아키텍처

## 1. 문서 개요

이 문서는 한국후지필름BI의 월간 발주계획 시스템 프로토타입인 SuperSCM의 현재 저장소 구조를 설명한다. 각 폴더와 파일을 먼저 짧게 요약하고, 뒤에서 책임·호출 관계·데이터 흐름을 자세히 기술한다.

이 저장소는 두 가지 성격의 기능이 함께 있다.

- **업무 흐름 프로토타입**: 홈 대시보드부터 수요 확정, 재고·공급, 마스터 검증, 발주량 계산, 보고자료까지를 샘플값과 브라우저 상태로 보여준다.
- **실데이터 분석 화면**: Supabase의 `analytics` 뷰를 서버에서 읽어 공급처별 리드타임 격차를 표시한다.

따라서 현재는 모든 화면이 하나의 완성된 영속 업무 시스템으로 연결된 상태가 아니다. 워크플로우 화면은 대부분 샘플·로컬 상태 기반이고, `/analysis/leadtime`만 `lib/scm.ts`를 통해 Supabase와 연결되어 있다.

## 2. 전체 구조 요약

| 경로 | 기능 요약 | 주요 파일 |
|---|---|---|
| `app/` | Next.js App Router의 라우트, 전역 레이아웃, 전역 CSS, API 라우트 | `layout.tsx`, `page.tsx`, `analysis/`, `api/`, `globals.css` |
| `components/` | 화면을 구성하는 React 컴포넌트. 업무 흐름과 분석 공통 UI로 분리 | `procurement-app.tsx`, `workflow/`, `analysis/` |
| `lib/` | 도메인 모델, 데이터 정규화, Supabase 조회·클라이언트 생성 | `scm-model.ts`, `scm.ts`, `supabase/` |
| `sql/` | Supabase 권한과 수업용 쓰기 정책을 적용하는 SQL | `01-grants.sql`, `02-policies.sql` |
| `supabase/` | 로컬 Supabase 설정과 PostgreSQL 마이그레이션 | `config.toml`, `migrations/` |
| `docs/` | 실습 운영 안내와 Superpowers 작업 문서 | `04-실습안내.md`, `superpowers/` |
| `outputs/` | 스프레드시트 생성 스크립트가 만든 미리보기 이미지·엑셀 산출물 | `019ff8.../` |
| 저장소 루트 | 프로젝트 규칙, 스키마, PRD, 실행 설정, 데이터·엑셀 생성 스크립트 | `AGENTS.md`, `SCHEMA.md`, `package.json` 등 |
| `.next-stale*/`, `.sheet_runtime/` | Next.js 및 스프레드시트 실행 과정의 생성 캐시·런타임 파일 | 소스 아키텍처에는 포함하지 않음 |

## 3. 런타임 구조와 데이터 흐름

```text
브라우저
  ├─ /                         → app/page.tsx
  │                              → components/procurement-app.tsx
  │                              → components/workflow/*
  │                              → 샘플값 + React 상태
  │
  ├─ /analysis/leadtime        → app/analysis/layout.tsx
  │                              → app/analysis/leadtime/page.tsx
  │                              → lib/scm.ts
  │                              → lib/supabase/server.ts
  │                              → Supabase analytics.v_leadtime_gap
  │                              → lib/scm-model.ts 정규화
  │                              → components/analysis/*
  │
  └─ /api/health/supabase       → app/api/health/supabase/route.ts
                                 → lib/supabase/env.ts

Supabase PostgreSQL
  raw 원본 데이터
    → core 정제·기준·계산 뷰/테이블
      → analytics 화면·AI용 뷰
```

핵심 원칙은 `raw`를 화면에서 직접 읽지 않고 `core`와 `analytics`를 경유하는 것이다. 화면의 조회 함수는 `lib/scm.ts`에 모으고, 뷰 컬럼명과 화면 모델의 차이는 `lib/scm-model.ts`에서 흡수한다.

## 4. 폴더별 상세 구조

### 4.1 `app/` — 라우팅과 애플리케이션 진입점

#### 요약

`app/`은 Next.js 15 App Router의 라우트 트리다. 루트 업무 화면, 분석 화면의 공통 레이아웃, Supabase 상태 확인 API, 전역 스타일을 제공한다.

#### 파일별 역할

| 파일 | 역할 |
|---|---|
| `app/layout.tsx` | 모든 라우트에 적용되는 Root Layout. `globals.css`를 import하고 한국어 문서 언어, 페이지 제목·설명을 설정한다. |
| `app/page.tsx` | `/` 라우트의 얇은 진입점. `ProcurementApp`을 렌더링한다. |
| `app/globals.css` | 순수 CSS 기반의 전역 디자인 시스템. 레이아웃, 카드, 배지, 버튼, 표, 워크플로우, 분석 화면 스타일을 모두 포함한다. Tailwind나 CSS Modules는 사용하지 않는다. |
| `app/analysis/layout.tsx` | `/analysis/*` 하위 라우트의 공통 껍데기. 홈 이동 링크와 `AnalysisTabs`를 렌더링하고 각 분석 페이지의 콘텐츠를 삽입한다. |
| `app/analysis/leadtime/page.tsx` | `analytics.v_leadtime_gap`을 조회해 공급처별 마스터 리드타임·실적 평균·P80·격차를 보여주는 서버 페이지. 오류 화면, KPI 카드, 데이터 표를 담당한다. `dynamic = 'force-dynamic'`으로 캐시된 정적 결과를 피한다. |
| `app/api/health/supabase/route.ts` | `GET /api/health/supabase` API. 실제 DB 쿼리 대신 필요한 두 환경변수의 존재 여부를 확인해 `{ configured: true/false }`를 반환한다. |

#### 라우트별 현재 상태

- `/`: 업무 플로우 프로토타입의 시작 화면이다.
- `/analysis/leadtime`: 실제 Supabase 분석 화면이다.
- `/analysis/stockout`: `analytics.v_stockout_risk`와 `analytics.v_stockout_kpi`를 조회해 품목별 소진 위험과 KPI를 표시한다.
- `/api/health/supabase`: Supabase 환경변수 설정 상태 확인용 API다.

### 4.2 `components/` — 재사용 React UI

#### 요약

`components/`는 라우트와 분리된 화면 구성 요소다. `workflow/`는 홈의 6단계 업무 흐름, `analysis/`는 Supabase 분석 페이지 공통 UI를 담당한다.

### 4.2.1 `components/workflow/` — 업무 단계 프로토타입

#### 파일별 역할

| 파일 | 역할 |
|---|---|
| `procurement-app.tsx` | 클라이언트 셸. `StepId`와 6단계 목록을 정의하고 현재 단계, 이전·다음 이동, 진행 표시, 사이드바, 분석 링크를 관리한다. 단계 컴포넌트를 선택적으로 렌더링한다. |
| `workflow/step-frame.tsx` | 각 단계 하단의 이전·다음 내비게이션을 공통 제공하는 프레임이다. |
| `workflow/dashboard-step.tsx` | 전체 현황 대시보드. 총 발주금액, 수요 상태, 예외, 보고자료, 프로세스 준비상태와 샘플 발주계획 목록을 표시한다. |
| `workflow/demand-step.tsx` | 수요 입력·확정 프로토타입. OL, SFDC Pipeline, Bulk-deal, 실적 Trend, 수급회의 탭과 월 선택, 행 편집·추가, 검증, 확정 상태를 브라우저 상태로 처리한다. 현재 DB 저장과 실제 파일 업로드는 연결되지 않았다. |
| `workflow/supply-step.tsx` | 재고·Open PO·선적 등 공급 상태를 보여주는 샘플 화면이다. 실제 재고 조회·저장 로직은 아직 연결되지 않았다. |
| `workflow/master-step.tsx` | 품목·기종, BOM·Common품, 장착율·사용량, MOQ, Lead Time, Flexibility Rule 등 마스터 관리 항목과 업로드/검증 안내를 보여주는 샘플 화면이다. |
| `workflow/calculation-step.tsx` | 순소요량, MOQ, Flex 예외, 총 금액 등을 보여주는 발주량 계산 결과 미리보기다. 숫자와 예외는 현재 하드코딩 샘플이며 계산 서비스와 연결되지 않았다. |
| `workflow/report-step.tsx` | 발주금액·수량 비교와 보고자료 다운로드 UI를 보여주는 샘플 화면이다. Excel/PDF 생성·다운로드는 아직 구현되지 않았다. |

#### 컴포넌트 간 관계

`ProcurementApp`이 `active` 단계와 이동 콜백을 소유하고, 각 단계에 `onNext`·`onBack`을 전달한다. `DashboardStep`은 `onOpenStep`으로 임의 단계 진입을 지원한다. 각 단계는 `StepFrame`을 재사용하지만 실제 데이터 저장이나 라우터 기반 단계 URL은 사용하지 않는다.

### 4.2.2 `components/analysis/` — 분석 공통 UI

#### 파일별 역할

| 파일 | 역할 |
|---|---|
| `analysis/analysis-frame.tsx` | 분석 페이지의 제목·설명·`SUPABASE LIVE` 표시를 감싸는 공통 프레임이다. |
| `analysis/analysis-tabs.tsx` | 분석 탭 목록과 준비 상태를 관리하는 클라이언트 컴포넌트. `usePathname`으로 현재 탭을 활성화하고, 미구현 화면은 404 대신 회색 `오후 실습` 상태로 보여준다. 새 분석 화면을 만들 때 목록을 추가하는 지점이다. |
| `analysis/data-table.tsx` | 제네릭 컬럼 정의를 받아 표를 그리는 재사용 컴포넌트. 사용자 정의 셀 렌더링, 정렬 방향, 빈 결과 문구, 행 키를 지원한다. `formatNumber`는 `null`을 `—`로 표시하고 숫자를 화면용으로 포맷한다. |

### 4.3 `lib/` — 도메인 모델과 외부 데이터 접근

#### 요약

`lib/`은 화면에서 Supabase 호출과 계산·정규화를 분리하는 계층이다. 현재 리드타임 분석을 구현하고, 이후 재고 소진 위험·사용 프로파일 등의 분석 조회가 확장될 자리다.

#### 파일별 역할

| 파일 | 역할 |
|---|---|
| `lib/scm-model.ts` | 화면용 `LeadtimeGap` 타입과 `normalizeLeadtimeGap`을 정의한다. Supabase 뷰의 영문 컬럼, 예전 별칭, 한국어 컬럼을 후보 배열로 읽어 화면 모델로 변환하고 숫자 파싱 실패를 `null`로 처리한다. |
| `lib/scm.ts` | 분석 데이터 조회의 단일 진입점. `getLeadtimeGap`은 `analytics.v_leadtime_gap`, `getStockoutRisks`는 `analytics.v_stockout_risk`, `getStockoutKpi`는 `analytics.v_stockout_kpi`를 읽어 화면 모델로 정규화한다. 조회 오류는 `{ rows/data, error }` 형태로 반환한다. |
| `lib/scm-model.test.ts` | `normalizeLeadtimeGap`의 실제 컬럼명, 별칭, 한국어 컬럼명과 기본값을 검증하는 Node 테스트다. |
| `lib/supabase.ts` | 브라우저·서버 클라이언트와 환경변수 함수를 재-export하는 짧은 진입점이다. |
| `lib/supabase/env.ts` | `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 읽는다. 값이 없으면 `getSupabaseEnv`는 `null`, `requireSupabaseEnv`는 한국어 오류를 발생시킨다. secret 키는 다루지 않는다. |
| `lib/supabase/client.ts` | 클라이언트 컴포넌트용 Supabase JS 클라이언트를 생성한다. publishable key를 사용한다. |
| `lib/supabase/server.ts` | 서버 컴포넌트·서버 조회용 클라이언트를 생성한다. 읽기 중심이므로 세션 유지와 자동 토큰 갱신을 끈다. |

#### 데이터 접근 규칙

화면 컴포넌트가 Supabase를 직접 호출하지 않고 `lib/scm.ts`의 조회 함수를 호출한다. 조회 시 `.schema('analytics')` 또는 필요한 `core` 스키마를 명시해야 하며, `raw`는 직접 조회하지 않는다. 숫자 계산과 집계는 SQL 뷰에서 수행하고 화면은 결과를 표시하는 데 집중한다.

### 4.4 `sql/` — 권한과 RLS 정책

#### 요약

덤프 복원 뒤 Supabase API에서 `core`·`analytics`를 안전하게 읽고, 수업용으로 확정값 테이블을 쓸 수 있게 하는 운영 SQL이다.

#### 파일별 역할

| 파일 | 역할 |
|---|---|
| `sql/01-grants.sql` | `anon`·`authenticated`에 `core`·`analytics` 스키마 사용 권한과 뷰/테이블 조회 권한을 부여한다. `raw`는 일부러 열지 않으며, 마지막에 `has_schema_privilege`와 `has_table_privilege` 확인 쿼리를 실행한다. |
| `sql/02-policies.sql` | `core.leadtime_plan`과 `core.usage_profile`에 수업용 전체 허용 RLS 정책과 쓰기 권한을 추가한다. 실제 운영에서는 `auth.uid()` 등으로 정책을 제한해야 한다. |

### 4.5 `supabase/` — 로컬 설정과 데이터베이스 변경 이력

#### 파일별 역할

| 파일 | 역할 |
|---|---|
| `supabase/config.toml` | 로컬 Supabase 프로젝트 ID, API/Studio 활성화, PostgreSQL 15 버전을 설정한다. |
| `supabase/migrations/20260813000100_create_procurement_demand_core.sql` | 초기 수요확정 도메인의 PostgreSQL 구조를 생성한다. `public.planning_runs`, `ol_demand`, `sfdc_pipeline`, `bulk_deals`, `historical_actuals`, `demand_confirmations` 테이블, 외래키·체크 제약·인덱스·`updated_at` 트리거를 정의한다. |
| `supabase/.temp/` | Supabase CLI가 생성하는 임시 상태 디렉터리다. 애플리케이션 런타임 코드가 아니다. |

#### 현재 데이터베이스 구조

실습용 `dump.sql`에는 `raw`, `core`, `analytics` 스키마가 별도로 존재한다. `raw`는 CSV 원본, `core`는 정제·기준·계산, `analytics`는 화면·AI 조회용이다. 별도의 마이그레이션 파일은 현재 수요확정 핵심 테이블을 `public`에 생성하므로, 실습 분석 뷰 구조(`raw/core/analytics`)와는 관리 목적이 다르다.

### 4.6 `docs/` — 요구사항과 운영 문서

#### 요약

`docs/`에는 실습 참가자가 시스템을 실행하고 분석 과제를 수행하는 방법, 그리고 Superpowers 형식의 PRD·구현 계획이 있다.

#### 파일별 역할

| 파일 | 역할 |
|---|---|
| `docs/04-실습안내.md` | 4회차 실습의 목표, 실행 순서, Supabase 확인 항목, 오전·오후 산출물, 현재 구현된 분석 화면을 안내한다. |
| `docs/superpowers/specs/2026-08-13-procurement-planning-mvp-prd.md` | 제품 목적, 비목표, 업무 흐름, 기능 요구사항, 계산 규칙, 데이터 모델, 오류 처리, 테스트와 Supabase 전환 방향을 정의하는 기준 PRD다. |
| `docs/superpowers/plans/2026-08-13-procurement-planning-mvp-plan.md` | 초기 MVP를 단계별로 구현하기 위한 작업 계획. 앱 스캐폴딩, 업무 셸, 단계 화면, 시각 검증 순서를 기록한다. |

### 4.7 `outputs/` — 생성된 비소스 산출물

#### 요약

`outputs/019ff8b7-725b-7b41-99a2-f3b7bc66ee76/`는 스프레드시트 생성 작업의 결과를 보관한다. 애플리케이션이 런타임에 읽는 파일이 아니라 검토·교육용 산출물이다.

#### 파일별 역할

| 파일 유형 | 역할 |
|---|---|
| `preview_00_사용안내.png` ~ `preview_11_FXLIVE연계정의.png` | 프로세스 정의서의 각 시트를 이미지로 미리 본 결과다. |
| `기기_옵션_월간발주_프로세스정의서.xlsx` | 프로세스맵, 상세 프로세스, 계산 규칙, 데이터 정의, RACI, KPI, 발주 계산 템플릿, 시스템 입력사항, 정책 결정표, FX-LIVE 연계를 담은 실무 정의서다. |
| `기기_옵션_월간발주_프로세스정의서.xlsx.inspect.ndjson` | 스프레드시트 검사 결과를 NDJSON으로 저장한 검증 산출물이다. |

### 4.8 저장소 루트의 파일

#### 프로젝트 규칙·설계·안내

| 파일 | 역할 |
|---|---|
| `AGENTS.md` | Codex 작업 규칙. 기술 스택, 데이터 계층, CSS·한국어·검증 규칙과 새 분석 화면 작성 순서를 정의한다. |
| `SCHEMA.md` | Supabase `raw/core/analytics` 역할, 기대 행 수, 주요 뷰 컬럼, 리드타임·재고 소진 데이터 정의, 접속 방법을 설명한다. |
| `README.md` | 설치·실행, 현재 Phase 1 범위, 향후 구현 방향, Supabase 연결과 마이그레이션 배포 방법을 설명한다. |
| `README_배포전_확인.md` | 참가자 배포 전 파일 복사, 정답 코드 유출 여부, Supabase 권한, 빌드·실행 확인 절차를 안내한다. |
| `2026-08-13-procurement-planning-mvp-prd.md` | 루트에 있는 PRD 사본. 제품 요구사항과 계산 규칙의 원본 문서 역할을 한다. |
| `적용방법.md` | 4회차 준비 커밋을 저장소에 적용하고 Supabase·권한·실행 상태를 점검하는 강사용 절차 문서다. |

#### 빌드·실행 설정

| 파일 | 역할 |
|---|---|
| `package.json` | 프로젝트 이름, Next/React/Supabase/Lucide 의존성, `dev`, `build`, `start`, Node 테스트 스크립트를 정의한다. |
| `package-lock.json` | npm 의존성의 재현 가능한 버전 잠금 파일이다. |
| `next.config.ts` | Next.js 설정. 현재 `reactStrictMode: true`만 활성화한다. |
| `tsconfig.json` | 엄격한 TypeScript, bundler 모듈 해석, JSX preserve, `@/*` 경로 별칭과 Next 타입 포함을 설정한다. |
| `vercel.json` | Vercel이 Next.js 프레임워크로 배포하도록 지정한다. |
| `.env.local` | 저장소에 커밋하지 않는 로컬 환경변수 파일. Supabase URL과 publishable key를 보관한다. 현재 목록에 보이지 않더라도 운영 시 필수다. |

#### 데이터·생성 스크립트

| 파일 | 역할 |
|---|---|
| `dump.sql` | 실습용 Supabase 데이터베이스 덤프. `raw` 원본 테이블, `core` 정제·기준 뷰/테이블, `analytics` 분석 뷰와 샘플 데이터를 포함한다. 직접 수정 대상이 아니다. |
| `build_dummy_demand_data.mjs` | `@oai/artifact-tool`로 2025년 OL, SFDC, Bulk-deal, 실적 Trend, 수급회의 확정수요, 월별 요약 더미 엑셀과 미리보기를 생성한다. |
| `build_workbook.mjs` | 프로세스맵·상세 프로세스·계산 규칙·데이터 정의·RACI·KPI·발주계산 템플릿·시스템 입력사항·정책 결정표·FX-LIVE 연계가 포함된 정의서 엑셀을 생성하고 검사·렌더링한다. |

## 5. 업무 플로우 아키텍처

현재 홈 화면의 순서는 `ProcurementApp`의 `steps` 배열이 단일 기준이다.

```text
dashboard 전체 현황
  → demand 수요 확정
  → supply 재고·공급
  → master 마스터 검증
  → calculation 발주량 계산
  → report 보고자료
```

각 단계의 현재 데이터 소유 방식은 다음과 같다.

| 단계 | 현재 상태 관리 | 현재 데이터 출처 |
|---|---|---|
| 전체 현황 | `ProcurementApp`의 `active` | 샘플 상수 |
| 수요 확정 | `useState`, `useMemo` | 컴포넌트 내부 더미 행 |
| 재고·공급 | 컴포넌트 표시 구조 | 샘플값 |
| 마스터 검증 | 컴포넌트 표시 구조 | 샘플값 |
| 발주량 계산 | 컴포넌트 표시 구조 | 하드코딩 계산 결과 미리보기 |
| 보고자료 | 컴포넌트 표시 구조 | 샘플값 |

PRD가 정의한 최종 흐름은 발주계획 생성, 입력·검증, 계산, 예외 검토, 수동 조정, 보고서 생성·다운로드까지를 영속 데이터로 연결하는 것이다. 이를 위해 현재 프로토타입의 각 단계는 향후 `planning_runs`와 하위 입력·결과 테이블 또는 뷰로 교체될 수 있다.

## 6. 분석 화면 아키텍처

분석 화면은 새 기능을 추가할 때 다음 순서를 따르는 구조다.

```text
lib/scm-model.ts
  타입 + 정규화 함수
        ↓
lib/scm.ts
  Supabase analytics/core 조회 함수
        ↓
app/analysis/<name>/page.tsx
  서버 페이지 + 오류/빈 결과 처리
        ↓
components/analysis/*
  공통 프레임·탭·표
```

`leadtime` 화면의 경우 `getLeadtimeGap()`이 서버에서 `analytics.v_leadtime_gap`을 조회하고, `normalizeLeadtimeGap()`이 화면 모델로 정규화한다. `stockout` 화면은 같은 패턴으로 `getStockoutRisks()`와 `getStockoutKpi()`를 호출하고, `normalizeStockoutRisk()`와 `normalizeStockoutKpi()`를 사용한다.

```ts
type LeadtimeGap = {
  supplier: string;
  country: string;
  masterLeadTime: number | null;
  sampleCount: number;
  actualAverage: number | null;
  p80: number | null;
  gap: number | null;
};
```

조회 오류와 빈 결과는 서로 다르게 다룬다. 오류는 `조회에 실패했습니다`와 원인 메시지를 보여주고, 오류가 없으면서 행이 없으면 표 컴포넌트의 빈 결과 문구를 보여준다. `null` 값은 숫자 0이나 임의의 큰 수로 대체하지 않고 `—`로 표시한다.

## 7. Supabase 데이터 계층

### `raw`

CSV 원본을 보관하는 계층이다. `shipment_log`, `usage_history`, `inventory`, `item_master`, `supplier_master`, `purchase_order`, `goods_receipt`, `forecast` 등이 있다. 앱 화면에서 직접 조회하지 않는다.

### `core`

정제 규칙과 회사 기준을 모으는 계층이다. 대표적으로 `v_fact_shipment`, `v_shipment_valid`, `v_leadtime_stat`, `v_leadtime_effective`, `v_usage_effective`, `v_item_master`, `v_stock_on_hand`, `v_inbound_qty`가 있으며, 오전 분석에서 확정하는 `leadtime_plan`, `usage_profile` 테이블도 이 계층에 있다.

### `analytics`

화면과 AI가 읽는 결과 계층이다. 현재 확인 대상은 `v_leadtime_gap`, `v_stockout_risk`, `v_stockout_kpi`, `v_usage_profile`, `v_usage_anomaly`다. `app/analysis/leadtime/page.tsx`는 이 중 `v_leadtime_gap`을 사용한다. `getStockoutKpi`는 준비되어 있지만 소진 위험 페이지는 아직 없다.

### 별도 `public` 수요확정 구조

`supabase/migrations/20260813000100_create_procurement_demand_core.sql`은 초기 MVP의 수요확정 입력을 `public`에 생성한다. 이 구조는 PRD의 로컬 SQLite 모델을 Supabase PostgreSQL로 옮기는 기반이며, 실습용 `analytics` 뷰와 같은 객체를 중복 정의하지 않는다.

## 8. 환경변수·보안·권한

- 필요한 브라우저 공개 환경변수는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`다.
- `sb_secret_...` 키는 클라이언트 코드에 넣지 않는다.
- `sql/01-grants.sql`은 `raw`를 노출하지 않고 `core`·`analytics`만 읽도록 권한을 부여한다.
- `sql/02-policies.sql`은 수업용 전체 허용 정책이므로 실제 운영에 그대로 사용하면 안 된다.
- 현재 애플리케이션에는 인증·사용자별 권한이 없으며, PRD에서도 MVP 비목표로 분류되어 있다.

## 9. 테스트·검증·배포

### 테스트

`npm test`는 `lib/**/*.test.ts`를 Node의 내장 테스트 러너로 실행하며, 현재는 모델 정규화 테스트가 있다. `npm run build`는 Next.js 타입 검사와 프로덕션 빌드를 수행하는 필수 검증 명령이다.

### 운영 확인 순서

1. `.env.local`에 Supabase URL과 publishable key를 입력한다.
2. Supabase API의 Exposed schemas에 `core`, `analytics`를 추가한다.
3. 덤프를 복원했다면 `sql/01-grants.sql`을 실행한다.
4. 앱을 실행해 `/api/health/supabase`와 `/analysis/leadtime`을 확인한다.
5. 리드타임 화면의 행 수가 `analytics.v_leadtime_gap`과 일치하는지 확인한다.
6. `npm test`와 `npm run build`를 실행한다.

### 배포

`vercel.json`이 Next.js 프레임워크를 지정하므로 Vercel 배포를 전제로 한다. 배포 환경에는 `.env.local`을 커밋하지 않고 Vercel 프로젝트 환경변수로 동일한 공개 환경변수를 설정해야 한다.

## 10. 현재 제약과 향후 확장 지점

- 업무 플로우 화면의 샘플값을 Supabase의 `public` 입력 테이블과 연결해야 한다.
- 수요 확정, 재고·Open PO, 마스터 검증, 계산, 수동 조정, 보고서 생성은 아직 저장·조회·다운로드 기능이 아니다.
- 화면 컴포넌트에 있는 샘플 계산을 향후 `lib`의 순수 모델 함수와 SQL 뷰로 이동해야 한다.
- `/analysis/stockout`은 `v_stockout_risk`와 `v_stockout_kpi`를 사용한다. 이후 상태 필터와 공급처 필터를 추가할 수 있다.
- 분석 탭에 새 화면을 추가할 때 `components/analysis/analysis-tabs.tsx`의 `ready` 상태와 실제 페이지를 함께 갱신해야 한다.
- `core.leadtime_plan` 또는 `core.usage_profile` 값을 바꾸면 분석 뷰의 결과가 달라질 수 있으므로, 확정값 변경 이력과 권한 정책을 운영 단계에서 보강해야 한다.

## 11. 한 문장 요약

SuperSCM은 Next.js App Router 위에 샘플 기반 월간 발주 업무 플로우를 제공하고, Supabase의 `raw → core → analytics` 데이터 계층을 `lib`의 조회·정규화 계층으로 연결해 분석 화면을 확장하는 프로토타입이다.
