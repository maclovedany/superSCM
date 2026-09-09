-- ═══════════════════════════════════════════════════════════════════
-- analytics 복구 런북 — 2026-09-10
--
-- 증상
--   /analysis/demand-profile   column v_sku_demand_profile.item_id does not exist
--   /analysis/model-comparison Could not find the table 'analytics.v_model_comparison_detail'
--
-- 확인된 원인
--   이 데이터베이스에는 STEP 2 와 STEP 16 만 올라가 있습니다. STEP 3 · 4 · 5 · 6 · 7 이
--   통째로 빠졌습니다. 그런데 analytics 스키마에는 예전 프로젝트가 만든
--   v_sku_demand_profile · v_demand_profile_kpi 가 같은 이름으로 남아 있습니다
--   (같은 스키마의 v_ol_accuracy · v_bom_requirement 가 그 흔적입니다).
--
--   ★ create or replace view 는 컬럼 이름 · 타입 · 순서가 다르면 갈아끼우지 못하고
--     42P16 으로 스크립트 전체를 중단시킵니다. 그래서 옛 뷰를 먼저 옆으로 옮겨야
--     STEP 5 가 끝까지 돌고, 그래야 STEP 6 · 7 도 올라갑니다.
--
-- 사용법
--   Supabase SQL Editor 에서 ── 단계 N ── 을 하나씩, 위에서부터 실행합니다.
--   각 단계 밑의 "기대" 를 확인한 뒤 다음 단계로 갑니다.
--   ★ 지우는 문장은 하나도 없습니다. 옛 것은 이름만 바꿔 보관합니다.
-- ═══════════════════════════════════════════════════════════════════


-- ── 단계 1. 원본 데이터가 있는지 봅니다 (읽기 전용) ────────────────
--
-- STEP 3 은 raw 테이블에 열을 덧붙입니다. 없는 테이블에는 덧붙일 수 없어
-- 여기가 비어 있으면 STEP 3 이 그 줄에서 죽습니다.

select to_regclass('raw.usage_history')    as usage_history,
       to_regclass('raw.shipment_log')     as shipment_log,
       to_regclass('raw.inventory')        as inventory,
       to_regclass('raw.item_master')      as item_master,
       to_regclass('raw.supplier_master')  as supplier_master,
       to_regclass('raw.purchase_order')   as purchase_order,
       to_regclass('raw.goods_receipt')    as goods_receipt,
       to_regclass('raw.forecast')         as forecast,
       to_regclass('core.v_item_master')   as v_item_master;

-- 기대  usage_history ~ v_item_master 가 모두 이름으로 나옵니다.
--       null 인 칸이 있으면 → 그 칸이 goods_receipt 나 forecast 면 단계 2 로,
--       usage_history · item_master · v_item_master 면 여기서 멈추고
--       4회차 CSV 임포트부터 다시 해야 합니다 (적용방법.md).


-- ── 단계 1-b. 원본에 실데이터가 있는지 셉니다 (읽기 전용) ─────────
--
-- 테이블이 있는 것과 데이터가 든 것은 다릅니다. 여기서 0 이 나오면 뒤 단계를
-- 다 해도 화면은 빈 표입니다 — 그때는 CSV 임포트부터 다시 해야 합니다.
-- ★ 이번 복구는 raw 의 행을 하나도 건드리지 않습니다. 세어 보기만 합니다.

select 'usage_history'   as 테이블, count(*) as 행수 from raw.usage_history
union all select 'shipment_log',    count(*) from raw.shipment_log
union all select 'item_master',     count(*) from raw.item_master
union all select 'supplier_master', count(*) from raw.supplier_master
union all select 'purchase_order',  count(*) from raw.purchase_order
union all select 'inventory',       count(*) from raw.inventory
order by 테이블;

-- 기대 (SCHEMA.md 기준)
--   usage_history 7,038 · shipment_log 2,864 · purchase_order 92
--   inventory 43 · item_master 23 · supplier_master 13
--   숫자가 크게 다르거나 0 이면 임포트 상태부터 확인해야 합니다.

-- 수요 기간도 함께 봅니다. 단계 10 에서 학습/검증 기간을 이 범위로 잡습니다.
select min(use_date) as 처음, max(use_date) as 마지막,
       count(distinct item_id) as 품목수
  from raw.usage_history;


-- ── 단계 2. (조건부) 빠진 raw 테이블만 만듭니다 ────────────────────
--
-- 단계 1 에서 goods_receipt 또는 forecast 가 null 일 때만 실행합니다.
-- 둘 다 읽는 코드가 없습니다. STEP 3 의 alter 문이 넘어가도록 자리만 만듭니다.

create schema if not exists raw;

create table if not exists raw.goods_receipt (
  goods_receipt_id uuid primary key default gen_random_uuid(),
  receipt_no       text,
  receipt_date     date,
  item_id          text,
  supplier_id      text,
  quantity         numeric,
  note             text
);

create table if not exists raw.forecast (
  forecast_id   uuid primary key default gen_random_uuid(),
  item_id       text,
  period        date,
  qty           numeric,
  model_id      text,
  note          text
);

-- 기대  Success. no rows returned


-- ── 단계 3. 옛 뷰가 정말 다른 모양인지 눈으로 봅니다 (읽기 전용) ───

select table_name, ordinal_position, column_name, data_type
  from information_schema.columns
 where table_schema = 'analytics'
   and table_name in ('v_sku_demand_profile', 'v_demand_profile_kpi')
 order by table_name, ordinal_position;

-- 기대  v_sku_demand_profile 목록에 item_id 가 없습니다. 그것이 화면 오류의 원인입니다.
--       (혹시 item_id 가 있다면 단계 4 는 건너뛰고 단계 5 로 갑니다)


-- ── 단계 4. 옛 뷰를 옆으로 옮깁니다 (지우지 않습니다) ──────────────
--
-- 이름 뒤에 시각을 붙여 보관합니다. 옛 화면이 그것을 보고 있을 수 있고,
-- 지운 것은 되돌릴 수 없기 때문입니다. 확인한 뒤 필요 없으면 그때 사람이 지웁니다.
-- (STEP 16 마이그레이션에서 쓴 것과 같은 방법입니다 — error.md #12)

do $legacy$
declare
  v_stamp text := to_char(now(), 'YYYYMMDDHH24MI');
  v_kind  "char";
  v_new   text;
  v_row   record;
begin
  for v_row in
    select * from (values
      ('v_sku_demand_profile', 'item_id'),
      ('v_demand_profile_kpi', 'total_items')
    ) as t(view_name, must_have)
  loop
    select c.relkind into v_kind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'analytics' and c.relname = v_row.view_name;

    if v_kind is null then
      raise notice '% 은 없습니다. 새로 만들면 됩니다.', v_row.view_name;
      continue;
    end if;

    -- 새 정의와 같은 모양이면 그대로 둡니다. create or replace 가 통과합니다.
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'analytics'
         and table_name = v_row.view_name
         and column_name = v_row.must_have
    ) then
      raise notice '% 는 이미 새 모양입니다 (% 있음). 그대로 둡니다.', v_row.view_name, v_row.must_have;
      continue;
    end if;

    v_new := v_row.view_name || '_legacy_' || v_stamp;

    if v_kind = 'v' then
      execute format('alter view analytics.%I rename to %I', v_row.view_name, v_new);
    elsif v_kind = 'm' then
      execute format('alter materialized view analytics.%I rename to %I', v_row.view_name, v_new);
    elsif v_kind = 'r' then
      execute format('alter table analytics.%I rename to %I', v_row.view_name, v_new);
    else
      raise exception '% 의 종류를 모르겠습니다 (relkind=%). 사람이 확인해 주세요.', v_row.view_name, v_kind;
    end if;

    raise notice '옛 % 를 % 로 옮겼습니다.', v_row.view_name, v_new;
  end loop;
end;
$legacy$;

-- 기대  Notices 에 "옛 v_sku_demand_profile 를 v_sku_demand_profile_legacy_… 로 옮겼습니다"


-- ── 단계 5 ~ 9. 마이그레이션 파일을 순서대로 실행합니다 ─────────────
--
-- 아래 파일의 **전체 내용**을 SQL Editor 에 붙여넣고 한 파일씩 실행합니다.
-- 한 파일이 Success 로 끝난 것을 확인한 뒤 다음 파일로 갑니다.
--
--   단계 5   supabase/migrations/20260828000200_step3_data_isolation.sql    (STEP 3)
--   단계 6   supabase/migrations/20260828000300_step4_import_pipeline.sql   (STEP 4)
--   단계 7   supabase/migrations/20260828000400_step5_sku_demand_profile.sql(STEP 5)
--   단계 8   supabase/migrations/20260828000500_step6_baseline_forecast.sql (STEP 6)
--   단계 9   supabase/migrations/20260828000600_step7_backtest_champion.sql (STEP 7)
--
-- ★ 순서를 지켜야 합니다. STEP 5 는 STEP 3 이 만드는 core.policy_config 와
--   core.v_train_demand 를, STEP 6 · 7 은 STEP 5 의 결과를 씁니다.
-- ★ 도중에 실패하면 그 파일에서 멈추고 오류 문구를 그대로 가져오세요.
--   42P16(cannot change name of view column) 이면 단계 4 를 그 이름으로 한 번 더 돌리면 됩니다.


-- ── 단계 10. 학습 · 검증 기간을 정합니다 ───────────────────────────
--
-- 이것이 비어 있으면 오류는 없지만 화면이 **빈 표**로 나옵니다.
-- core.v_train_demand 가 활성 설정의 기간만 읽기 때문입니다.

-- (10-a) 지금 설정을 봅니다
select setting_id, active, train_start, train_end, test_start, test_end, granularity
  from core.forecast_setting
 order by updated_at desc;

-- (10-b) 활성 설정이 없으면, 데이터 기간에서 마지막 3개월을 검증으로 떼어 넣습니다
insert into core.forecast_setting (active, train_start, train_end, test_start, test_end, granularity)
select true,
       date_trunc('month', min(u.use_date))::date,
       (date_trunc('month', max(u.use_date)) - interval '3 months' - interval '1 day')::date,
       (date_trunc('month', max(u.use_date)) - interval '3 months')::date,
       max(u.use_date),
       'MONTH'
  from raw.usage_history u
-- ★ where 가 아니라 having 입니다. 집계 함수는 조건이 거짓이어도 null 한 줄을 만들어
--   내기 때문에, where 로 막으면 날짜가 전부 null 인 설정이 들어갑니다.
having min(u.use_date) is not null
   and not exists (select 1 from core.forecast_setting where active);

-- (10-c) 넣은 값이 규칙을 통과하는지 확인합니다
select train_start, train_end, test_start, test_end, granularity,
       core.is_valid_forecast_window(train_start, train_end, test_start, test_end, granularity) as valid
  from core.forecast_setting
 where active;

-- 기대  valid = true. false 면 기간이 겹치거나 비어 있는 것이니 날짜를 직접 고칩니다.


-- ── 단계 11. PostgREST 스키마 캐시를 새로 읽게 합니다 ──────────────
--
-- 새로 만든 뷰를 API 가 아직 모를 수 있습니다 (PGRST205 가 그 증상입니다).

notify pgrst, 'reload schema';

-- 기대  Success. no rows returned


-- ── 단계 12. 최종 확인 ─────────────────────────────────────────────

select to_regclass('core.policy_config')                  as step3_policy_config,
       to_regclass('core.upload_batch')                   as step4_upload_batch,
       to_regclass('analytics.v_sku_demand_profile')      as step5_profile,
       to_regclass('core.forecast_run')                   as step6_forecast_run,
       to_regclass('analytics.v_model_comparison_detail') as step7_comparison;

-- 기대  다섯 칸 모두 이름이 나옵니다 (null 없음)

select count(*) as 프로파일_행수 from analytics.v_sku_demand_profile;
select count(*) as 비교_행수     from analytics.v_model_comparison_detail;

-- 기대  프로파일_행수 > 0
--       비교_행수 = 0 은 정상입니다. 아직 예측 · 백테스트를 돌리지 않았기 때문입니다.
--       화면은 오류 대신 빈 표로 열립니다.


-- ── 단계 13. 화면에서 확인 ─────────────────────────────────────────
--
--   /analysis/demand-profile    표가 채워집니다
--   /analysis/model-comparison  빈 표로 열립니다 (오류 아님)
--
-- 비교 화면을 채우려면 관리자로 로그인해 순서대로 실행합니다.
--   /admin/forecast-runs   예측 실행  → core.run_baseline_forecast()
--   /admin/backtest-runs   백테스트 실행 → core.run_backtest()
--   /admin/champion-models Champion 확인
