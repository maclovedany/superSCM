-- core.v_part_linkage 팬아웃 결함 수정 — 중복 related_item이 출고량을 두 배로 합산하던 문제
--
-- ★ 정본은 supabase/realdata/04-core-views.sql:73(core.v_part_linkage)이다. 이 파일에서
--   core.v_shipment_by_hoc(:94)·core.v_item(:36) 등 다른 core 뷰도 같은 파일에 있지만, 이번에
--   고치는 것은 v_part_linkage 하나뿐이다 — 이 뷰가 core.v_fact_shipment 부류(03b-missing-objects.sql
--   과 이중 정의)와 달리 저장소에 정의가 **한 곳뿐**이라 "두 계층 동기화" 규칙이 다른 형태로
--   적용된다: 03b류처럼 여러 파일에 흩어진 정의를 맞추는 게 아니라, realdata 원본(04-core-views.sql)
--   과 이 마이그레이션 둘 다 **같은 새 정의**로 맞춰야 한다 — 그래야 처음부터 realdata만 적용해
--   DB를 만드는 경로와, 배포 DB처럼 realdata 위에 이 마이그레이션까지 적용하는 경로가 같은 결과를
--   낸다. **이 뷰를 다시 고칠 때는 반드시 두 파일을 함께 고친다.**
-- ★ 열 구성(related_item, hoc_item)은 바꾸지 않는다 — CASCADE 없이 create or replace만으로
--   재정의된다. core.v_shipment_by_hoc가 이 뷰를 left join하고, 그 위에
--   analytics.v_shipment_trend·v_item_demand_profile·v_item_demand_kpi·v_realdata_kpi·
--   v_shipment_monthly_rollup·v_shipment_monthly_item이 쌓여 있다 — 이 파일은 drop을 전혀 쓰지
--   않는다(CASCADE가 이 소비자 전부를 지운다, 20260912000800/000900 머리 주석과 같은 경고).
--
-- ── 실측(이 세션이 로컬 스크래치 DB에 realdata 01~05를 그대로 적재해 직접 확인, 팀장 요약을
--    근거로 삼지 않고 raw.bridge_xcn·04-core-views.sql 원본을 직접 읽고 재현했다) ──────────
--
--   raw.bridge_xcn 20,760행. core.v_part_linkage(현재 정의, select distinct related_item,
--   hoc_item)도 20,760행이지만 distinct related_item은 20,306개 — 454개 related_item이 서로
--   다른 hoc_item 두 개에 걸쳐 있다(관계가 아니라 결함 — 아래 근거).
--
--   454건을 원본(raw.bridge_xcn) 행 단위로 나눠 보면:
--     451건 — 정확히 2행, "family·설명 중 하나 이상 채워진 행 1 + 전부 빈 행 1"의 단일 서명.
--             빈 행은 서로 다른 hoc_item을 가리키는데 아무 근거(가족·설명)가 없다 — 데이터
--             입력 잔재로 보인다.
--       1건 — 2행 다 일부 필드(family)만 채워지고 설명은 둘 다 빔(051K40992). family가 채워진
--             쪽이 더 완전한 행이라 같은 규칙(완전성 우선)으로 해소된다.
--       2건 — 진짜 모호. 285K38666은 두 행 다 family·설명 전부 빔(선택 근거가 아예 없다).
--             893K40191은 두 행 다 family·설명이 전부 채워져 있지만 서로 다른 기종
--             (MDL158 LOW "PIPE ASSY-ROTARY DIS" vs MDL069 HIGH "ROLL ASSY-TRS D")의 서로
--             다른 부품을 가리킨다 — 완전성으로 못 가른다. 임의로 하나를 고르지 않는다(아래
--             해소 규칙이 이 2건을 걸러 낸다 — v_part_linkage에서 통째로 빠진다. 발주 코드
--             정본(raw.dim_item.hoc_code, core.v_item)에는 영향이 없다 — 이 뷰는 출고 Trend용
--             부가 합산 경로일 뿐이다).
--
--   해소 규칙 — related_item별로 family·related_desc·hoc_desc 세 칸 중 채워진 칸 수("완전성")가
--   가장 큰 행만 남긴다. 그 최댓값을 유일한 hoc_item 하나가 차지하면 그 매핑을 쓰고, 최댓값을
--   가진 행이 서로 다른 hoc_item을 가리키면(위 285K38666·893K40191처럼 완전성으로도 못 가르면)
--   그 related_item 전체를 뷰에서 뺀다 — core.v_shipment_by_hoc의 coalesce(x.hoc_item,
--   f.item_code)가 그 2개 품목을 XCN 미적용(자기 자신이 대표코드)으로 되돌릴 뿐이라, 총량이
--   틀어지지 않는다(단지 그 2개 옛 코드만 XCN 합산에서 빠진다 — 20,306개 중 2개, 0.01%).
--
--   재현(스크래치 DB, 이 마이그레이션 적용 전/후) — 신·구 화면이 함께 옳아지는지가 핵심 증거다:
--     raw.fact_shipment sum(qty)                 4,710,425.0000  (불변, 원본)
--     core.v_shipment_by_hoc sum(qty)  수정 전    4,711,381.0000  (+956, 팬아웃)
--                             수정 후    4,710,425.0000  (일치)
--     analytics.v_shipment_trend sum(total_qty)  수정 전 4,711,381.0  → 수정 후 4,710,425.0(일치)
--   +956은 중복 매핑 454건 중 PART 출고 실적이 걸리는 것들의 초과 합산분과 정확히 일치한다
--   (related_item이 두 hoc_item에 동시에 합산되면 그 related_item의 실적 전량이 두 번 세어진다).
create or replace view core.v_part_linkage as
with scored as (
  select
    related_item,
    hoc_item,
    (
      (case when nullif(btrim(coalesce(family,       '')), '') is not null then 1 else 0 end) +
      (case when nullif(btrim(coalesce(related_desc, '')), '') is not null then 1 else 0 end) +
      (case when nullif(btrim(coalesce(hoc_desc,     '')), '') is not null then 1 else 0 end)
    ) as completeness
  from raw.bridge_xcn
  where related_item is not null
    and hoc_item     is not null
),
ranked as (
  select related_item, hoc_item,
         rank() over (partition by related_item order by completeness desc) as rnk
  from scored
),
winners as (
  -- rnk = 1 — 그 related_item에서 완전성이 가장 높은 행(들). 같은 hoc_item을 가리키는 완전
  -- 중복 행은 여기서 이미 하나로 뭉친다(distinct).
  select distinct related_item, hoc_item
  from ranked
  where rnk = 1
),
winner_counts as (
  select related_item, count(distinct hoc_item) as n_distinct_hoc
  from winners
  group by related_item
)
-- n_distinct_hoc = 1인 related_item만 남긴다 — 완전성 최댓값이 서로 다른 hoc_item에 걸려
-- 있으면(진짜 모호, 실측 2건) 임의로 하나를 고르지 않고 그 related_item을 통째로 뺀다.
select w.related_item, w.hoc_item
from winners w
join winner_counts c
  on c.related_item = w.related_item
 and c.n_distinct_hoc = 1;

comment on view core.v_part_linkage is
  'XCN 연계(구/연계 코드 → 대표코드). 정본은 supabase/realdata/04-core-views.sql — 고칠 때 두
  파일을 함께 고친다. fix round(20260912001100) — raw.bridge_xcn에서 같은 related_item이 서로
  다른 hoc_item 두 개를 가리키는 454건(전체 20,306개 related_item 중)을 완전성(family·
  related_desc·hoc_desc 중 채워진 칸 수) 최댓값 기준으로 해소한다. 완전성으로도 못 가르는
  진짜 모호 2건(285K38666·893K40191)은 임의로 고르지 않고 뷰에서 뺀다(core.v_shipment_by_hoc가
  그 2개 코드를 XCN 미적용으로 처리 — 총량은 그대로 보존된다). 수정 전 이 뷰의 팬아웃이
  raw.fact_shipment 합계보다 956 많은 값을 core.v_shipment_by_hoc·analytics.v_shipment_trend에
  냈다(실측, 스크래치 DB) — 이 수정으로 셋이 모두 일치한다';
