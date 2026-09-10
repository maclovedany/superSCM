# 실데이터 DB 적용 — SQL만으로

6회차 실습 전에 **반드시 먼저** 끝내야 하는 작업입니다.
Tool 4개가 읽을 뷰가 없으면 실습이 시작되지 않습니다.

**추가 프로그램이 필요 없습니다.** Supabase 대시보드의 SQL Editor 하나로 끝납니다.
수강생 전원이 **똑같은 파일을 똑같은 순서로** 실행합니다.

---

## 실행 순서 — 파일 15개를 번호대로

Supabase → **SQL Editor** → 파일 하나를 **통째로** 붙여넣고 **Run**. 다음 번호로.

| # | 파일 | 하는 일 | 크기 | 소요 |
|---|---|---|---:|---|
| 1 | `01-schema.sql` | 테이블 10개 + 인덱스 16개 + RLS | 10 KB | 10초 |
| 2 | `02-data-01.sql` | 데이터 ①  `dim_model` 145 · `dim_item` 27,500 | 1.9 MB | 30초 |
| 3 | `02-data-02.sql` | 데이터 ②  `dim_item` 28,000 | 1.9 MB | 30초 |
| 4 | `02-data-03.sql` | 데이터 ③  `dim_item` 28,000 | 1.9 MB | 30초 |
| 5 | `02-data-04.sql` | 데이터 ④  `dim_item` 나머지 · `fact_mc_plan_actual` · `fact_shipment` 시작 | 1.9 MB | 30초 |
| 6 | `02-data-05.sql` | 데이터 ⑤  `fact_shipment` 29,500 | 1.9 MB | 30초 |
| 7 | `02-data-06.sql` | 데이터 ⑥  `fact_shipment` 31,000 | 1.9 MB | 30초 |
| 8 | `02-data-07.sql` | 데이터 ⑦  `fact_shipment` 나머지 · `bridge_bom` 시작 | 1.9 MB | 30초 |
| 9 | `02-data-08.sql` | 데이터 ⑧  `bridge_*` 대부분 · `bridge_xcn` 18,000 | 1.9 MB | 30초 |
| 10 | `02-data-09.sql` | 데이터 ⑨  `bridge_xcn` 나머지 | 0.2 MB | 5초 |
| 11 | `03-verify.sql` | **행수·기간·고아키 검증** ★ 여기서 확인하고 넘어갑니다 | 5 KB | 20초 |
| 12 | `04-core-views.sql` | `core` 정제 뷰 — XCN 합산 · 기종 정리 · 달력 | 5 KB | 10초 |
| 13 | `05-analytics-views.sql` | `analytics` 뷰 — **Tool 4개가 읽는 최종 형태** | 19 KB | 20초 |
| 14 | `06-grants-and-lockdown.sql` | 권한 부여 + anon 잠금 · **항상 마지막** | 5 KB | 10초 |
| 15 | `07-deprecate-and-agent.sql` | 더미 뷰 폐기 표시 + 대화 저장 테이블 | 7 KB | 10초 |

**전부 합쳐 5분** 정도 걸립니다.

**선행 조건** — 5회차 STEP 2 (`sql/03-auth.sql` · `04-rls.sql`) 가 적용되어 있어야 합니다.
`core.is_admin()` 이 없으면 `07` 의 관리자 감사 정책만 건너뛰고 나머지는 정상 동작합니다.

---

## 왜 CSV 가 아니라 INSERT 파일인가

**SQL 로는 여러분 PC 의 CSV 를 읽을 수 없습니다.**

| 방법 | 왜 안 되나 |
|---|---|
| `COPY tbl FROM '/경로/파일.csv'` | **DB 서버**의 파일을 읽습니다. Supabase 서버에는 여러분 파일이 없습니다 |
| `\copy` | SQL 이 아니라 **psql 이라는 프로그램의 명령**입니다. SQL Editor 에서 안 됩니다 |
| 대시보드 CSV Import | 됩니다. 다만 테이블마다 클릭이 필요하고 사람마다 설정이 달라질 수 있습니다 |

그래서 데이터를 **INSERT 문으로 구워 두었습니다.**
`02-data-*.sql` 9개가 그것이고, 총 **230,302행 · 16 MB** 입니다.
**모두가 똑같은 파일을 실행하므로 결과가 같습니다.**

---

## 중간에 잘못됐을 때

**행수가 안 맞습니다** — `03-verify.sql` 에서 `*** 불일치 ***` 가 뜨면

| 상황 | 조치 |
|---|---|
| 실제 < 기대 | 데이터 파일을 **건너뛴 것**입니다. 빠진 번호를 찾아 실행 |
| 실제 > 기대 | 같은 파일을 **두 번 실행**한 것입니다. `01-schema.sql` 부터 다시 |

`01-schema.sql` 은 테이블을 `drop` 후 다시 만듭니다. **언제든 처음부터 다시 시작해도 안전합니다.**

**SQL Editor 가 느립니다** — 2 MB 파일은 붙여넣을 때 잠깐 멈춥니다. 정상입니다.
Run 을 누르고 30초쯤 기다리세요. 브라우저 탭을 닫지 마세요.

---

## 계층 설계

```
raw         CSV 원본 그대로. 적재 후 수정하지 않음
            ★ 앱에서 못 읽습니다 (RLS fail-closed + GRANT 없음)
   │
core        업무 규칙을 한 번 적용
            v_shipment_by_hoc  XCN 합산   ← 가장 중요
            v_model            기종 아닌 8행 제거 (145 → 137)
            v_item             발주코드 보정
            v_ym_calendar      희소 저장 보정용 달력
   │
analytics   화면과 AI Tool 이 조회하는 최종 형태
            v_shipment_trend       → getShipmentTrend
            v_item_demand_profile  → getDemandProfile
            v_ol_accuracy          → getOlAccuracy
            v_bom_requirement_x    → getBomRequirement
            v_part_linkage         → getPartLinkage (선택)
```

**뷰가 raw 를 읽을 수 있는 이유** — PostgreSQL 15 기준 뷰의 `security_invoker` 기본값은 `false` 입니다.
뷰는 **소유자 권한**으로 실행되므로, 사용자가 `raw` 를 못 읽어도 `analytics` 뷰는 정상 동작합니다.
이것이 "화면은 analytics 만 본다"를 DB 차원에서 강제하는 방법입니다.

---

## 자주 걸리는 것 5가지

| 증상 | 원인 | 조치 |
|---|---|---|
| 조회가 **에러 없이 빈 배열** | Supabase 스키마 노출 미설정 | Settings → API → Data API → Exposed schemas 에 `public, core, analytics` |
| 행수가 기대의 2배 | 같은 데이터 파일을 두 번 실행 | `01-schema.sql` 부터 다시 |
| 살아 있는 부품이 "단종"으로 보임 | `raw.fact_shipment` 를 직접 읽음 | `core.v_shipment_by_hoc` 를 쓸 것 (XCN 합산) |
| BOM 조인 결과가 거의 비어 있음 | `model_key` 로 조인함 | `model_base` 로 조인. 파일마다 표기가 다름 |
| `06` 실행 후에도 anon 이 읽힘 | 앞 파일을 나중에 다시 실행함 | **`06` 을 다시 실행**. default privileges 가 새 객체에 권한을 다시 뿌림 |

---

## SQL 로는 안 되는 설정 하나

```
Supabase 대시보드 → Project Settings → API → Data API → Exposed schemas
    public, core, analytics
```

> 🔴 이 설정이 없으면 앱에서 조회가 **"에러 없이 빈 배열"** 로 돌아옵니다.
> Tool 은 "데이터가 없습니다"라고 보고하는데 실제로는 권한 문제입니다.
> **실습에서 빈 결과가 나오면 여기부터 확인하세요.**

---

## 적용 후 반드시 눈으로 확인할 3가지

`05-analytics-views.sql` 파일 끝에 들어 있습니다. 결과가 아래와 같아야 합니다.

```sql
-- ① 러닝 예시 부품
select item_code, n_months, latest_qty, avg_3m, avg_6m, avg_12m
from analytics.v_shipment_trend where item_code = '602K02693';
-- 기대: 40 · 1049 · 779.0 · 785.2 · 772.3

-- ② OL 정확도
select fy_sheet, sales_wape, scm_wape, sales_bias, scm_bias
from analytics.v_ol_accuracy_fy order by fy_sheet;
-- 기대: FY23 0.417/0.519/-0.015/0.328  …  FY26 0.701/0.657/0.082/0.464

-- ③ 수요 유형 분포
select * from analytics.v_item_demand_kpi;
-- 기대: PART 의 INTERMITTENT 3,166 · LUMPY 454
```

**이 세 숫자가 강의 자료와 같으면 적용이 끝난 것입니다.**

---

## 실데이터에 없는 것 (현업 요청 목록)

이 SQL 로도 만들 수 없는 것들입니다. **데이터가 잘못된 게 아니라 아직 안 받은 것**입니다.

| 없는 것 | 없으면 못 하는 것 |
|---|---|
| 월말 재고 스냅샷 (시계열) | 재고 소진 예측 · 발주량 산출 |
| 공급처별 Lead time | 발주 시점 역산 |
| MOQ 마스터 | 발주 수량 올림 |
| 기기 장착율 | 옵션 수요 산출 |
| Bulkdeal 플래그 | 이벤트성 급증 제외 |
| Flexibility rule (공급처별) | 발주 변경 범위 적용 |
| EOL / EOS 목록 | 예측 대상 제외 |

이것들이 들어오면 `analytics.v_inventory_projection` · `v_safety_stock` ·
`v_purchase_recommendation` 을 만들 수 있고, 그때 Tool 이 10개로 늘어납니다.
