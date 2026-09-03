# STEP 7 구현 프롬프트 — 백테스트 · Champion · 모델 비교

> 아래 `---` 사이를 그대로 복사해 AI 에게 주세요.
> 마지막 §부록에 다른 단계에 재사용하는 방법이 있습니다.

---

## 무엇을 만들 것인가

SuperSCM 프로젝트의 **STEP 7 (Backtest + Champion + Model Comparison)** 을 구현해줘.

예측 결과를 검증 구간 실적과 대조해 채점하고, 품목마다 가장 잘 맞은 모델을 Champion 으로 뽑고,
그 결과를 차트와 표로 보여주는 것까지가 이번 단계다.

## 먼저 읽을 것 (이 순서로)

| 파일 | 왜 |
|---|---|
| `AGENTS.md` | 작업 규칙 12개. **여기 어긋나면 반려된다** |
| `design.md` | 화면 디자인. §6.4(카드 필터) · §7(차트) · §8(계산 불가) |
| `SCHEMA.md` | Supabase 스키마 구조 |
| `step.md` | 전체 구현 순서. STEP 7 항목 |
| `renew.prd` | 13장(Backtest) · 14장(Champion) · 16장(Model Comparison) |
| `error.md` | **이미 겪은 오류 11건.** 같은 데서 막히지 마라 |

기존 화면 중 `app/(user)/analysis/stockout/page.tsx` 와
`app/(admin)/admin/forecast-runs/page.tsx` 를 본보기로 삼아라. 같은 구조로 만든다.

## 지금까지 되어 있는 것 (전제)

STEP 6 까지 끝났다. 다음이 이미 있다.

```
core.forecast_setting     학습/검증 경계 (train_start·train_end·test_start·test_end·champion_metric)
core.v_train_demand       ★ 학습 전용. train_end 이후를 내보내지 않는다
core.v_test_actual        검증 구간 실적. 백테스트 채점에만 쓴다
core.model_config         모델 레지스트리 (enabled · is_default · parameters)
core.forecast_run         예측 실행 이력 (run_id · model_version · data_snapshot_at)
core.forecast_result      run_id × model_id × item_id × period 별 예측 (predicted_qty·p50·p80·p90·sigma)
analytics.v_sku_demand_profile   품목별 수요 패턴 (demand_type)
lib/auth.ts               requireUser() · requireAdminOrThrow()
lib/audit.ts              writeAuditLog()
lib/filter.ts             KPI 카드 필터 (readFilter · applyFilter · FilterSpec)
components/ui/*           KpiCard · Panel · DataTable · Badge · EmptyValue · FilterNotice · InsightBanner · state
components/shell/*        PageHeader · MetaChip
```

`components/chart/` 는 **아직 없다.** recharts 도 설치되어 있지 않다. 이번에 처음 만든다.

## 만들 것

### 1. `sql/13-backtest.sql`

**테이블 (전부 `core` 에 만든다. `analytics` 에는 뷰만 둔다)**

```
core.backtest_run       backtest_run_id · forecast_run_id · status · champion_metric ·
                        baseline_model · test_start · test_end · n_models · n_items · n_rows ·
                        started_at · finished_at · duration_ms · triggered_by · note · message

core.model_performance  backtest_run_id · model_id · model_version · item_id · n_periods ·
                        actual_sum · wape · mape · bias · rmse · mae ·
                        baseline_improvement · metric_value · rank · reason
                        PK (backtest_run_id, model_id, item_id)

core.champion_model     item_id(PK) · backtest_run_id · champion_model_id · model_version ·
                        champion_metric · metric_value · wape · mape · bias · rmse · mae ·
                        baseline_improvement · candidates(jsonb) · selection_method(AUTO/MANUAL) ·
                        reason · selected_at · selected_by
```

**지표 계산** — `core.forecast_result` 를 `core.v_test_actual` 과 `item_id, period` 로 조인해서
품목 × 모델별로 계산한다.

```
WAPE = Σ|실적−예측| ÷ Σ실적            ← 핵심 KPI
MAPE = avg(|실적−예측| ÷ 실적)          ← 실적 0 인 기간은 제외 (발산 방지)
Bias = Σ(예측−실적) ÷ Σ실적             ← 부호 유지. + 는 과대예측
RMSE = sqrt(avg((실적−예측)²))
MAE  = avg(|실적−예측|)
기준선 대비 = (기준선 WAPE − 모델 WAPE) ÷ 기준선 WAPE
```

기준선은 `core.model_config.is_default = true` 인 모델이다.
순위는 `core.forecast_setting.champion_metric`(기본 WAPE) 기준으로 품목별 `rank()` 를 매긴다.

**함수 두 개**

- `core.run_backtest(p_forecast_run_id text default null, p_note text default null)`
  - `p_forecast_run_id` 가 없으면 가장 최근 성공한 예측 실행을 채점한다
  - 지표를 계산해 `model_performance` 에 넣고, 1등을 `champion_model` 에 넣는다
  - **후보 전체 성능을 `candidates` jsonb 에 함께 저장한다** (renew.prd 14.2)
  - `ON CONFLICT` 로 갱신하되 **`selection_method = 'MANUAL'` 인 행은 덮어쓰지 않는다**
- `core.set_champion_manual(p_item_id text, p_model_id text, p_reason text)`
  - **사유가 비어 있으면 거부한다** (renew.prd 14.3)

두 함수 모두 `security definer` 이고 첫 줄에서 `core.is_admin()` 을 확인한다.

**뷰**

```
analytics.v_item_series        v_train_demand + v_test_actual 을 UNION. segment 로 TRAIN/TEST 구분 (차트 음영용)
analytics.v_backtest_run
analytics.v_model_performance  model_name · item_name · is_champion 을 붙인다
analytics.v_champion_model     model_name · item_name · demand_type 을 붙인다
analytics.v_backtest_kpi       요약 한 줄
```

권한은 기존 SQL 파일들과 같은 방식으로 — `authenticated` 읽기, 관리자만 쓰기, `anon` 은 전부 회수, RLS 켜기.

### 2. `lib/backtest.ts`

조회 함수. 화면에서 supabase 를 직접 부르지 않는다.

```
getChampions()            품목별 Champion 목록
getBacktestKpi()          요약
getItemPerformance(itemId)  한 품목의 모델별 성능 (비교표용)
getItemSeries(itemId)     한 품목의 실적 시계열 (차트용)
```

기존 `lib/forecast.ts` 와 같은 모양으로 만들어라 — `{ rows, error }` 반환, `num()` 정규화, try/catch.

### 3. `components/chart/forecast-overlay-chart.tsx`

`npm install recharts@3.10.1` 후 만든다. **`'use client'`.**

`design.md` §7 을 그대로 따른다.

| 요소 | 표현 |
|---|---|
| 실적 | 잉크 블랙(`ACTUAL_COLOR`) 2.5px **실선** · 항상 가장 진하게 |
| 모델 예측 | 시리즈 색 2px **파선** (`strokeDasharray="4 4"`) |
| 검증 구간 | `ReferenceArea` 음영 (`CHART_TOKENS.validationBand`) |
| P80 / P90 밴드 | `Area` · 시리즈 색 알파 `.12` / `.06` |
| 가로선만 | `CartesianGrid vertical={false}` |

**★ 범례 칩을 누르면 모델이 켜지고 꺼진다. 재조회하지 않는다** (renew.prd 16.5).
클라이언트 상태(`useState`)로 처리한다.

색은 `lib/chart-colors.ts` 의 `colorMap()` · `ACTUAL_COLOR` · `CHART_TOKENS` 를 쓴다.
**차트 안에서 계산하지 않는다.** 이미 계산된 값을 props 로 받아 그리기만 한다.

### 4. 화면 두 개

**`app/(user)/model-evaluation/`** — 백테스트 실행 + Champion 목록
- KPI 4장: Champion 선정 / 기준선보다 나음 / 수동 지정 / 평균 WAPE
- 백테스트 실행 폼 — **관리자에게만 보인다**
- 품목별 Champion 표: 수요 패턴 · Champion · WAPE · Bias · 기준선 대비 · **선정 근거**
- 품목을 누르면 `/model-comparison?item=...` 으로 간다

**`app/(user)/model-comparison/`** — 차트 + 비교표
- 품목 선택 칩 (`?item=` 쿼리)
- KPI 4장: Champion / WAPE / Bias / 기준선 대비
- **오버레이 차트**
- 성능 비교표 (순위 · 모델 · WAPE · MAPE · Bias · RMSE · 기준선 대비 · 채점 기간)
- **CSV 내보내기** → `app/api/backtest/performance.csv/route.ts`
- **Champion 수동 지정 폼 — 관리자에게만, 사유 필수**

Server Action 은 `app/(user)/model-evaluation/actions.ts` 에 두고,
상수와 타입은 **같은 폴더의 `state.ts`** 에 둔다 (`error.md` #10 참조).

### 5. `lib/menu.ts`

`/model-comparison` 과 `/model-evaluation` 의 `ready` 를 `true` 로 바꾼다.

## 반드시 지킬 규칙

`AGENTS.md` 전체를 따르되, 이번 단계에서 특히 걸리는 것들:

1. **계산은 SQL 이 한다** (규칙 2) — WAPE·Bias 를 TypeScript 에서 계산하지 마라. SQL 이 끝낸다
2. **계산 불가를 숫자로 채우지 않는다** (규칙 5) — 검증 구간 실적 합계가 0 이면 WAPE 를 낼 수 없다.
   `null` + 사유 코드(`NO_ACTUAL` · `INSUFFICIENT_SAMPLE`)를 돌려주고 화면은 `EmptyValue` 로 그린다.
   **0 이나 999 로 채우면 그 모델이 1등이 된다**
3. **권한은 서버에서 검증한다** (규칙 8) — 액션 첫 줄에서 `requireAdminOrThrow()`
4. **KPI 카드는 눌러서 목록을 좁힌다** (규칙 9) — `lib/filter.ts` 의 `FilterSpec` 을 쓴다.
   카드가 목록의 부분집합이 아니면 `// kpi-filter: 없음 — <이유>` 를 파일에 적는다
5. **차트는 `components/chart/` 를 거친다** (규칙 11) — 화면에서 `recharts` 를 직접 import 하지 마라
6. **`design.md` 의 토큰만 쓴다** (규칙 1) — 화면 파일에 hex 색과 px 간격을 쓰지 마라
7. **한국어로 쓴다** (규칙 7) — 화면 문구·주석 모두. 컬럼명·변수명은 영어
8. 변경 후 `npm run build` 와 `npm test` 를 **반드시 실행한다** (규칙 12)

## 이미 밟은 함정 (`error.md` 참조)

새로 밟지 마라.

| 함정 | 내용 |
|---|---|
| **#11 column is ambiguous** | `RETURNS TABLE (backtest_run_id ...)` 의 컬럼 이름은 함수 안에서 **변수**가 된다. 테이블에 같은 이름의 컬럼이 있으면 `where backtest_run_id = v_id` 가 모호해진다. **함수 안에서 테이블 컬럼은 항상 별칭으로 한정하라** (`where p.backtest_run_id = v_id`) |
| **#10 use server** | `'use server'` 파일은 **async 함수만** export 할 수 있다. 상수·타입은 같은 폴더 `state.ts` 로 뺀다 |
| **#9 raw 미노출** | `raw` 스키마는 REST API 에 노출하지 않는다. 앱에서 `supabase.schema('raw')` 를 부르지 마라 |
| **#8 dev 서버 캐시** | `.next` 를 지웠으면 dev 서버를 반드시 재기동하라 |
| PostgREST 1000행 상한 | 결과가 1,000행을 넘으면 조용히 잘린다. **집계는 SQL 뷰에서 끝내라** |
| `round(double precision, int)` | PostgreSQL 에 없다. `sqrt()` · `regr_slope()` 결과는 `::numeric` 으로 캐스팅한 뒤 `round` 하라 |
| set-returning 함수 | `select generate_series(...) , generate_series(...)` 처럼 select 목록에 두 번 쓰지 마라. `from` 절로 옮겨라 |

## 완료 판정

전부 통과해야 끝이다.

- [ ] `npm run build` 성공 · `npm test` 통과
- [ ] 화면에서 `recharts` 직접 import **0건** (`grep -rn "from 'recharts'" app components | grep -v components/chart/`)
- [ ] 화면 파일에 하드코딩 hex 색 **0건**
- [ ] WAPE · MAPE · Bias · RMSE 가 산출된다
- [ ] SKU별 Champion 이 자동 선정되고 **후보 전체 성능(`candidates`)이 저장된다**
- [ ] 관리자 수동 지정 시 **사유가 필수**이고, 이후 자동 선정이 그 행을 덮어쓰지 않는다
- [ ] 범례를 토글하면 **재조회 없이** 차트가 갱신된다
- [ ] 성능 비교표를 CSV 로 내려받을 수 있다 (Excel 용 BOM 포함)
- [ ] 채점할 수 없는 품목이 `—` + 사유 코드로 표시된다

## 작업 순서

한 번에 하나씩 만들고, 각 단계에서 `npx tsc --noEmit` 로 확인하라 (`AGENTS.md` 규칙 6).

```
1  sql/13-backtest.sql          테이블 → 함수 → 뷰 → 권한
2  lib/backtest.ts              조회 함수
3  npm install recharts@3.10.1
4  components/chart/forecast-overlay-chart.tsx
5  app/(user)/model-evaluation/  state → actions → form → page
6  app/(user)/model-comparison/  page → champion-form
7  app/api/backtest/performance.csv/route.ts
8  lib/menu.ts                   ready 플래그
9  npm run build · npm test
10 step.md 완료 판정 갱신
```

SQL 은 내가 Supabase SQL Editor 에서 직접 실행한다. 파일만 만들어 주고, 실행 순서를 알려줘.
파일 끝에 결과를 확인할 수 있는 `select` 를 붙여줘.

---

## 부록 — 다른 단계에 재사용하기

위 프롬프트의 뼈대는 이렇다. STEP 번호와 내용만 바꾸면 된다.

```
1  무엇을 만들 것인가        한 문단. 이 단계가 끝나면 무엇이 되는지
2  먼저 읽을 것              문서와 "왜 읽는지". 본보기로 삼을 기존 파일
3  지금까지 되어 있는 것      이미 있는 테이블·뷰·lib·컴포넌트 목록
4  만들 것                   파일 경로별로 구체적으로. 컬럼명까지
5  반드시 지킬 규칙          AGENTS.md 중 이번에 특히 걸리는 것만 골라서
6  이미 밟은 함정            error.md 에서 관련된 것
7  완료 판정                 체크박스. 검증 명령까지 적는다
8  작업 순서                 한 번에 하나씩. 중간 확인 방법
```

**3번(전제)과 6번(함정)이 품질을 가른다.**
전제를 안 주면 이미 있는 것을 다시 만들고, 함정을 안 주면 같은 데서 또 막힌다.

`error.md` 를 계속 쌓아 두면 6번이 저절로 채워진다.
