-- 실습 데이터 1 · 마스터 — 법인 출항 준비기간 · 공급처 · 출항일 규칙 · 한국 공휴일
--
-- ★ 전부 Task 10a의 관리자 편집 함수를 그대로 씁니다(core.upsert_supply_entity 등). 표에 직접
--   INSERT하지 않는 이유는, 그 함수들이 변경 전·후·행위자·사유를 core.audit_log에 남기고 관리자
--   화면(/admin/master)이 그 이력을 보여주기 때문입니다. 실습 값도 "누가 왜 넣었는지"가 남아야
--   수업 중에 학생이 바꾼 것과 구분됩니다.
-- ★ 여기서 넣는 준비기간·리드타임은 **실제 현업 값이 아닙니다.** 사유 문구에 그렇게 적습니다.
--
-- 다시 실행해도 안전합니다(upsert + 등기 재등록 안전).

\set ON_ERROR_STOP on

do $$
declare
  v_admin uuid;
  v_label text := 'PRACTICE-2026-09';
  v_entity record;
  v_supplier record;
  v_departure_id bigint;
  v_holiday record;
  v_month record;
begin
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자 계정을 찾을 수 없습니다. 00-open-dataset.sql을 먼저 실행하세요.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  if not exists (select 1 from core.practice_dataset where label = v_label and active) then
    raise exception '열려 있는 실습 묶음(%)이 없습니다. 00-open-dataset.sql을 먼저 실행하세요.', v_label;
  end if;

  -- ══ 1. 해외법인 출항 준비기간 ════════════════════════════════════
  -- 발주일 = 공급처 출항일 − 준비기간 (stage1 §8). 0이면 Task 10b가 PREP_DAYS_UNSET으로 멈춥니다.
  for v_entity in
    select * from (values
      ('JP', '일본',     7),
      ('CN', '중국',    10),
      ('VN', '베트남',  12),
      ('SG', '싱가포르', 9),
      ('NL', '네덜란드',14)
    ) as t(entity_id, entity_name, prep_days)
  loop
    perform core.upsert_supply_entity(
      v_entity.entity_id, v_entity.entity_name, v_entity.entity_id, v_entity.prep_days,
      true, null, null, '실습용 값(현업 확정값 아님)',
      '[실습용 ' || v_label || '] 수업 시연을 위한 임시 출항 준비기간'
    );
    perform core.register_practice_object(v_label, 'SUPPLY_ENTITY', v_entity.entity_id,
      '준비기간만 실습값으로 변경 — 제거 시 원래 값으로 되돌림');
  end loop;

  -- ══ 2. 공급처 5곳 (법인당 1곳) ═══════════════════════════════════
  for v_supplier in
    select * from (values
      ('PRC-SUP-JP', '실습 공급처 · 일본',     'JP', 21),
      ('PRC-SUP-CN', '실습 공급처 · 중국',     'CN', 18),
      ('PRC-SUP-VN', '실습 공급처 · 베트남',   'VN', 25),
      ('PRC-SUP-SG', '실습 공급처 · 싱가포르', 'SG', 16),
      ('PRC-SUP-NL', '실습 공급처 · 네덜란드', 'NL', 35)
    ) as t(supplier_id, supplier_name, entity_id, lead_time_days)
  loop
    perform core.upsert_supplier(
      v_supplier.supplier_id, v_supplier.supplier_name, v_supplier.entity_id, v_supplier.lead_time_days,
      true, null, null, '실습용 공급처',
      '[실습용 ' || v_label || '] 수업 시연용 공급처 등록'
    );
    perform core.register_practice_object(v_label, 'SUPPLIER', v_supplier.supplier_id, null);

    -- 출항일 규칙 — 공급처마다 다른 요일/주차로 두어 "주차별로 묶어 발주한다"가 보이게 합니다.
    -- 같은 날짜에 두 규칙이 겹치면 Task 10b가 DEPARTURE_RULE_AMBIGUOUS로 멈추므로 하나만 둡니다.
    select departure_id into v_departure_id
      from core.supplier_departure where supplier_id = v_supplier.supplier_id and active limit 1;
    v_departure_id := core.set_supplier_departure_rule(
      v_departure_id, v_supplier.supplier_id,
      case v_supplier.entity_id when 'JP' then 2 when 'CN' then 3 when 'VN' then 4
                                when 'SG' then 2 else 5 end,          -- 요일(0=일)
      case v_supplier.entity_id when 'SG' then 3 else 2 end,          -- 매월 N번째 주
      null, null, null, '실습용 출항일 규칙',
      '[실습용 ' || v_label || '] 수업 시연용 출항일 규칙'
    );
    perform core.register_practice_object(v_label, 'SUPPLIER_DEPARTURE', v_departure_id::text, null);
  end loop;

  -- ══ 3. 한국 공휴일 2026 ══════════════════════════════════════════
  -- ★ Task 10b는 달력이 "준비됨"으로 표시된 달만 영업일 보정을 합니다(core.confirm_kr_business_day).
  --   공휴일을 추정하지 않기 위한 규칙이므로, 넣은 달만 준비됨으로 표시합니다.
  for v_holiday in
    select * from (values
      ('2026-01-01'::date, '신정'),
      ('2026-02-16'::date, '설날 연휴'),
      ('2026-02-17'::date, '설날'),
      ('2026-02-18'::date, '설날 연휴'),
      ('2026-03-01'::date, '삼일절'),
      ('2026-03-02'::date, '삼일절 대체공휴일'),
      ('2026-05-05'::date, '어린이날'),
      ('2026-05-24'::date, '부처님오신날'),
      ('2026-05-25'::date, '부처님오신날 대체공휴일'),
      ('2026-06-06'::date, '현충일'),
      ('2026-08-15'::date, '광복절'),
      ('2026-08-17'::date, '광복절 대체공휴일'),
      ('2026-09-24'::date, '추석 연휴'),
      ('2026-09-25'::date, '추석'),
      ('2026-09-26'::date, '추석 연휴'),
      ('2026-10-03'::date, '개천절'),
      ('2026-10-05'::date, '개천절 대체공휴일'),
      ('2026-10-09'::date, '한글날'),
      ('2026-12-25'::date, '성탄절')
    ) as t(calendar_date, holiday_name)
  loop
    perform core.add_business_holiday('KR', v_holiday.calendar_date, v_holiday.holiday_name,
      '[실습용 ' || v_label || '] 2026년 한국 공휴일');
    perform core.register_practice_object(v_label, 'BUSINESS_CALENDAR',
      'KR:' || v_holiday.calendar_date::text, v_holiday.holiday_name);
  end loop;

  -- ★ fix round 1 — 공휴일을 실제로 넣은 **2026년만** 준비됨으로 표시합니다. 이전 판에서는 실습
  --   계획월이 2027년으로 밀릴 경우를 대비해 2027년까지 준비됨으로 표시했는데, 2027 공휴일을
  --   넣지 않은 채 준비됨으로 두면 영업일 보정이 주말만 보고 **공휴일을 평일로 취급**합니다.
  --   그것은 "공휴일 자료가 없는 국가는 추정하지 않는다"(Task 10b 판정 1)를 정면으로 어깁니다.
  --   준비 표시를 하지 않으면 Task 10b가 CALENDAR_NOT_READY로 정직하게 멈춥니다.
  --
  --   ⚠️ 04-usage-history.sql이 고른 실습 기간이 2026년을 벗어나면, 그 해 공휴일을 관리자 화면
  --   (/admin/master)에서 넣고 그 달을 준비됨으로 표시해야 발주 일정이 계산됩니다. 넣기 전까지는
  --   일정이 CALENDAR_NOT_READY로 보이는 것이 정상입니다(추정보다 낫습니다).
  for v_month in
    select gs::date as month_start
      from generate_series('2026-01-01'::date, '2026-12-01'::date, interval '1 month') gs
  loop
    perform core.set_calendar_month_ready('KR',
      extract(year from v_month.month_start)::int, extract(month from v_month.month_start)::int, true,
      '[실습용 ' || v_label || '] 2026년 공휴일 입력 완료');
    perform core.register_practice_object(v_label, 'CALENDAR_READINESS',
      'KR:' || to_char(v_month.month_start, 'YYYY-MM'), null);
  end loop;

  raise notice '마스터 준비 완료 — 법인 5 · 공급처 5 · 2026 공휴일 19일 · 달력 준비 2026년 12개월';
  raise notice '★ 실습 기간이 2026년을 벗어나면 그 해 공휴일을 /admin/master 에서 넣고 준비됨으로 표시하세요';
end $$;

-- 확인
select * from analytics.v_master_readiness;
-- 기대: n_prep_days_unset 0 · n_suppliers 5 · n_departure_rules 5 · n_calendar_months_ready 12

select supplier_id, supplier_name, entity_id, lead_time_days, n_departure_rules, reason_code
  from analytics.v_supplier order by supplier_id;
-- 기대: 5행, reason_code 전부 null
