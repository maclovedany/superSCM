-- 실습 데이터 0 · 묶음 열기와 "되돌릴 값" 기록
--
-- ★ 반드시 가장 먼저 실행합니다. 뒤 스크립트가 운영 마스터(법인 출항 준비기간)와 Forecast 설정을
--   실습용으로 바꾸는데, 그 **변경 전 값을 여기서 먼저 기록**해 두어야 제거할 때 되돌릴 수 있습니다.
--   이 파일을 건너뛰고 01부터 돌리면 원래 값을 영영 모릅니다.
--
-- ★ 이 스크립트는 관리자(ADMIN) 자격으로 돕니다. Supabase SQL Editor는 postgres 역할로 실행되고
--   auth.uid()가 비어 있으므로, core.is_admin()이 참이 되도록 실습 관리자 계정의 uuid를 세션 JWT
--   claim 자리에 넣습니다. 권한 검사를 끄는 것이 아니라 "누가 하는 일인지" 알려 주는 것입니다 —
--   감사 이력(core.audit_log)에도 이 사람이 남습니다.
--
-- 다시 실행해도 안전합니다(같은 라벨이면 기존 묶음을 그대로 씁니다).

\set ON_ERROR_STOP on

do $$
declare
  v_admin uuid;
  v_prep  jsonb;
  v_prev_setting uuid;
  v_label text := 'PRACTICE-2026-09';
begin
  -- ── 실습 관리자 계정 확인 ────────────────────────────────────────
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자 계정(insightdany@naver.com)을 찾을 수 없습니다. docs/stage1-supabase-수동적용.md §9를 먼저 수행하세요.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  -- ── 되돌릴 값 1: 법인별 현재 출항 준비기간 ───────────────────────
  -- 0은 "아직 현업에서 못 받은 값"이라는 뜻입니다(STEP 18). 실습이 이 자리에 임시 숫자를 넣으므로,
  -- 제거할 때 반드시 원래 값(대개 0)으로 되돌려야 "못 받은 값"이 받은 값처럼 남지 않습니다.
  select coalesce(jsonb_object_agg(entity_id, prep_days), '{}'::jsonb) into v_prep
    from core.supply_entity;

  -- ── 되돌릴 값 2: 지금 활성인 Forecast 설정 ───────────────────────
  -- core.forecast_setting은 활성 행이 하나뿐이라는 부분 유니크 인덱스가 있습니다. 실습이 새 설정을
  -- 활성화하려면 기존 것을 비활성으로 내려야 하므로, 제거할 때 되살릴 수 있게 id를 남깁니다.
  select setting_id into v_prev_setting from core.forecast_setting where active order by updated_at desc limit 1;

  perform core.open_practice_dataset(
    v_label,
    '4회차 수업 실습용 데이터. 수요→승인→배정→발주계획→일정 전 구간 시연용이며 실제 실적이 아닙니다.',
    jsonb_build_object('supply_entity_prep_days', v_prep)
      || case when v_prev_setting is null then '{}'::jsonb
              else jsonb_build_object('previous_forecast_setting_id', v_prev_setting) end
  );

  raise notice '실습 묶음 % 준비 완료. 되돌릴 준비기간=% · 이전 Forecast 설정=%',
    v_label, v_prep, coalesce(v_prev_setting::text, '(없음)');
end $$;

-- 확인 — 1행, active = true
select label, active, restore_payload, created_at from core.practice_dataset where label = 'PRACTICE-2026-09';
