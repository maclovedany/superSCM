-- 실습 데이터 제거 — 문서화된 한 번의 명령
--
-- ★ core.remove_practice_dataset은 등기부(core.practice_object)에 올라 있는 것만 지웁니다.
--   실데이터는 등기부에 없으므로 **구조적으로 지워질 수 없습니다.** 적재 원본은 batch_id로만
--   지우므로 batch_id가 null인 5회차 더미·실데이터 행은 어떤 경우에도 걸리지 않습니다.
--
-- ★ 지우지 못하는 것은 사유와 함께 blocked 목록으로 돌려주고, 그 객체의 등기는 **남깁니다.**
--   그래야 살아남은 실습 발주계획이 화면에서 계속 "실습용"으로 표시됩니다 — 제거했다는 이유로
--   실습 숫자가 실적처럼 보이면 안 됩니다.
--
--   PLAN_IMMUTABLE_HISTORY    승인 기록은 설계상 불변입니다(Task 9b 트리거가 DELETE를 막습니다)
--   ACTED_ON_BY_USER          학생이 그 품목으로 주문·배정·긴급발주·수급회의·이벤트 수요를 만들었습니다
--   SCHEDULE_ACTUAL_RECORDED  실제 입고일이 입력된 발주 일정이 그 공급처를 참조합니다
--   FK_IN_USE                 그 밖에 다른 행이 참조하고 있습니다

\set ON_ERROR_STOP on

-- ══ 1. 제거 전 — 실데이터 기준선을 먼저 적어 둡니다 ══════════════════
-- 이 숫자들을 메모해 두고 제거 뒤 3번에서 그대로인지 확인합니다.

select
  (select count(*) from raw.dim_item)                                   as dim_item,
  (select count(*) from raw.usage_history where batch_id is null)       as usage_legacy,
  (select count(*) from raw.item_master where batch_id is null)         as item_master_legacy,
  (select count(*) from raw.inventory where batch_id is null)           as inventory_legacy,
  (select count(*) from core.item_policy)                               as item_policy_total,
  (select count(*) from core.supplier)                                  as supplier_total;


-- ══ 2. 제거 ═════════════════════════════════════════════════════════

do $$
declare
  v_admin uuid;
  v_result jsonb;
begin
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자 계정을 찾을 수 없습니다.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  v_result := core.remove_practice_dataset('PRACTICE-2026-09', p_confirm => true);
  raise notice E'제거 결과\n%', jsonb_pretty(v_result);
end $$;

-- 제거 결과를 다시 보고 싶으면 감사 이력에서 꺼냅니다.
select jsonb_pretty(after) as remove_result
  from core.audit_log
 where action = 'PRACTICE_DATASET_REMOVED'
 order by at desc limit 1;


-- ══ 3. 제거 후 — 실데이터가 그대로인지 ═══════════════════════════════

select
  (select count(*) from raw.dim_item)                                   as dim_item,
  (select count(*) from raw.usage_history where batch_id is null)       as usage_legacy,
  (select count(*) from raw.item_master where batch_id is null)         as item_master_legacy,
  (select count(*) from raw.inventory where batch_id is null)           as inventory_legacy,
  (select count(*) from core.item_policy)                               as item_policy_total,
  (select count(*) from core.supplier)                                  as supplier_total;
-- ★ 기대: dim_item · *_legacy 는 1번과 **완전히 같아야** 합니다.
--   item_policy_total · supplier_total은 실습분만큼 줄어듭니다(실습 전 값으로 돌아갑니다).

select label, active, removed_at,
       (select count(*) from core.practice_object o where o.dataset_id = d.dataset_id) as residual_objects
  from core.practice_dataset d where d.label = 'PRACTICE-2026-09';
-- 기대: active = false · removed_at 기록됨 · residual_objects는 지우지 못한 객체 수(보통 발주계획 1건)

select object_kind, object_key, note from analytics.v_practice_object where label = 'PRACTICE-2026-09';
-- 남아 있는 등기 = 지우지 못한 객체. 이 목록이 비어 있지 않으면 그 화면에는 배너가 계속 보입니다.

select * from analytics.v_practice_data_status;
-- 기대: has_practice_data는 여전히 true일 수 있습니다(등기가 남았으면). active = false.
--       남은 것이 하나도 없으면 affects_* 가 전부 false가 됩니다.

-- 법인 출항 준비기간이 원래 값(대개 0 = "아직 못 받은 값")으로 돌아갔는지
select entity_id, prep_days, reason_code from analytics.v_supply_entity order by entity_id;
-- 기대: 00-open-dataset.sql이 기록한 값으로 복원(대개 prep_days 0 · PREP_DAYS_UNSET)

-- 실습 전 Forecast 설정이 되살아났는지
select setting_id, active, train_start, train_end, test_start, test_end from core.forecast_setting order by updated_at desc;
-- 기대: 실습 설정 행은 사라지고, 실습 전에 활성이던 설정이 있었다면 다시 active = true
