-- 실습 데이터 0b · 5회차 더미 사용 이력 정리 (되돌릴 수 있습니다)
--
-- ★ 실행 시점 — 00-open-dataset.sql **뒤**, 04-usage-history.sql **앞**.
--   실습 데이터 적재와 독립적으로 실행·되돌리기가 가능합니다.
--
-- ══ 무엇을, 왜 ═════════════════════════════════════════════════════
--
-- 배포 DB의 raw.usage_history에는 5회차 실습 더미 7,038행이 batch_id = null(출처 없음)로 남아
-- 있습니다. Task 9b의 원천 게이트는 학습·검증 기간에 출처 없는 행이 한 줄이라도 걸치면
-- (정상적으로) 발주량 계산을 막습니다. 그래서 지금까지는 실습 학습 기간을 그 더미 **뒤로** 밀어야
-- 했고, 그 결과 실습 기준월이 실제 달력보다 미래가 되는 부작용이 있었습니다.
--
-- 출처 없는 행을 보관소로 옮기면 그 제약이 사라져 **학습 기간이 실제 달력 월에 놓입니다.**
--
-- ══ 안전장치 ═══════════════════════════════════════════════════════
--
-- 1. **지우지 않습니다.** 원본 행을 `core.retired_usage_history`에 jsonb로 그대로 보관합니다.
-- 2. **자동으로 되돌아옵니다.** 실습 묶음을 제거하면(99-remove.sql) `core.remove_practice_dataset`이
--    보관된 행을 raw.usage_history로 되돌리고 보관소를 비웁니다.
-- 3. **출처가 있는 행은 한 줄도 건드리지 않습니다.** 판정 조건이 원천 게이트가 보는 것과 같습니다.
-- 4. 정리·복구 모두 `core.audit_log`에 남습니다.
--
-- ⚠️ 그래도 **실행 전에 백업을 받으세요.** 이 스크립트는 사용자가 만들지 않은 기존 데이터를 옮깁니다.
--
-- ══ 선행 조건 ══════════════════════════════════════════════════════
--   supabase/migrations/20260912000600_practice_retire_legacy_usage.sql 적용
--   supabase/practice-data/00-open-dataset.sql 실행(묶음이 열려 있어야 합니다)

\set ON_ERROR_STOP on

-- ── 1. 정리 전 현황 — 이 숫자를 메모해 두세요 ──────────────────────

select count(*)      as unverified_rows,
       min(use_date) as min_use_date,
       max(use_date) as max_use_date
  from raw.usage_history u
  left join core.upload_batch b on b.batch_id = u.batch_id
 where b.batch_id is null
    or b.status <> 'IMPORTED'
    or b.import_type <> 'usage_history'
    or u.source_type is distinct from 'FILE_UPLOAD';
-- 기대(배포 DB): 7,038행 내외. 복구 후 이 값이 그대로 돌아와야 합니다.

select count(*) as verified_rows_untouched
  from raw.usage_history u
  join core.upload_batch b on b.batch_id = u.batch_id
 where b.status = 'IMPORTED' and b.import_type = 'usage_history' and u.source_type = 'FILE_UPLOAD';
-- 이 행들은 정리 대상이 아닙니다. 정리 후에도 값이 같아야 합니다.


-- ── 2. 정리 ────────────────────────────────────────────────────────

do $$
declare
  v_admin uuid;
  v_result jsonb;
begin
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자(ADMIN) 계정을 찾을 수 없습니다.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  if not exists (select 1 from core.practice_dataset where label = 'PRACTICE-2026-09' and active) then
    raise exception '열려 있는 실습 묶음이 없습니다. 00-open-dataset.sql을 먼저 실행하세요.';
  end if;

  v_result := core.retire_unverified_usage_history('PRACTICE-2026-09', p_confirm => true);
  raise notice E'정리 결과\n%', jsonb_pretty(v_result);
end $$;


-- ── 3. 정리 후 확인 ────────────────────────────────────────────────

select count(*) as remaining_unverified_rows
  from raw.usage_history u
  left join core.upload_batch b on b.batch_id = u.batch_id
 where b.batch_id is null
    or b.status <> 'IMPORTED'
    or b.import_type <> 'usage_history'
    or u.source_type is distinct from 'FILE_UPLOAD';
-- ★ 기대: 0
--   0이 아니면 04-usage-history.sql의 학습 기간이 여전히 그 행 뒤로 밀립니다.

select * from analytics.v_practice_retired_usage;
-- 기대: retired_rows가 1번에서 본 값과 같고, min/max use_date도 같습니다.

-- 정리 후 04-usage-history.sql이 고를 기간 미리보기 — 실제 달력 월에 놓여야 합니다.
select (date_trunc('month', (clock_timestamp() at time zone 'Asia/Seoul')) - interval '11 months')::date as train_start,
       (date_trunc('month', (clock_timestamp() at time zone 'Asia/Seoul')) - interval '3 months' + interval '1 month - 1 day')::date as train_end,
       (date_trunc('month', (clock_timestamp() at time zone 'Asia/Seoul')) - interval '2 months')::date as test_start,
       (date_trunc('month', (clock_timestamp() at time zone 'Asia/Seoul')) + interval '1 month - 1 day')::date as test_end,
       (date_trunc('month', (clock_timestamp() at time zone 'Asia/Seoul')) + interval '1 month')::date as plan_month;
-- 기대: plan_month = **다음 달**. 04가 실제로 고른 값은 04 실행 시 notice로 출력됩니다.


-- ── 4. 되돌리기 ────────────────────────────────────────────────────
--
-- 실습 묶음을 제거하면 자동으로 돌아옵니다(99-remove.sql이 부르는 함수가 함께 처리합니다).
--
--   select jsonb_pretty(core.remove_practice_dataset('PRACTICE-2026-09', p_confirm => true));
--   select count(*) from raw.usage_history u
--     left join core.upload_batch b on b.batch_id = u.batch_id
--    where b.batch_id is null or b.status <> 'IMPORTED' or b.import_type <> 'usage_history'
--       or u.source_type is distinct from 'FILE_UPLOAD';
--   -- 기대: 1번에서 메모한 값과 같음
--
-- ★ 실습 데이터를 남긴 채 더미만 되돌리고 싶다면, 지금은 전용 명령을 두지 않았습니다.
--   묶음을 제거했다가 다시 적재하는 것이 안전한 경로입니다(라벨은 새로 지어야 합니다 — README 참고).
