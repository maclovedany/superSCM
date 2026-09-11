-- Task 9b · 목표 DoS와 최종 발주량 계산
--
-- stage1 §4(예측 조정 범위 · 수량 선택 우선순위) · §5(추가 수요) · §6(DoS · 목표 DoS 미설정 시 확정 차단) ·
-- §7(MOQ 올림) · §9(품목담당자 확정 → SCM팀장 승인, 이력)를 구현한다. Champion Forecast를 입력으로만 읽고,
-- 최종 발주량은 별도 표에 저장한다 — Forecast · Backtest · Champion 결과는 읽기만 하고 절대 바꾸지 않는다.
--
-- 여기서 만드는 것
--   core.procurement_plan                       기준월 · 버전 · Forecast Run · 원천 판정 · 상태 · 확정자 · 승인자
--   core.procurement_plan_line                  품목 × 1~6개월차 계산 단계별 수량 · 입력 스냅샷 · 사유
--   core.procurement_plan_event                 생성 · 대체 · 확정 차단 · 확정 · 승인 · 반려 · 승인 취소 이력(append-only)
--   core.calculate_procurement_plan_month(...)  한 달 계산 순수 함수(lib/procurement/model.ts가 같은 규칙을 거울로 둔다)
--   core.procurement_forecast_source_status()   원천 게이트 — 검증된 적재 배치에서 온, 실행이 실제로 쓴 입력인가
--   core.usage_input_fingerprint(split) + 트리거 Forecast Run · Backtest가 SUCCESS가 될 때 입력 지문 기록(fix round 1)
--   core.build_procurement_plan(p_plan_month, p_forecast_run_id)
--   core.confirm_procurement_plan(p_plan_id)
--   core.approve_procurement_plan(p_plan_id, p_approval_id)  core.decide_approval을 부르는 얇은 포장 — 실제 반영은 훅
--   core.apply_procurement_plan_decision()      PURCHASE_PLAN 승인 결정 트랜잭션에서만 최종본을 만든다
--   analytics.v_procurement_plan · v_procurement_plan_line · v_procurement_plan_kpi · v_procurement_plan_event ·
--   v_procurement_plan_blocker(확정 차단 사유 — 확정 함수와 화면이 같은 뷰를 읽는다)
--
-- ★ 원천 게이트(컨트롤러 판정 1) — 현재 Forecast 파이프라인은 core.v_train_demand ← raw.usage_history(5회차 더미
--   7,038행)로 학습한다. 발주량은 원천이 추적 가능한 실데이터에서만 만든다. 판정은 실행 단위로 한다:
--     ① 실행이 없거나 SUCCESS · MONTH가 아니면                        FORECAST_SOURCE_UNVERIFIED
--     ② 활성 학습 기간 설정이 실행의 학습 기간과 다르거나, 이 실행의 Champion을 채점한 Backtest의 검증 기간이 활성
--        검증 기간과 다르면                                             FORECAST_WINDOW_CHANGED
--        (core.v_train_demand · core.v_test_actual이 더 이상 그 실행 · 채점의 입력이 아니다 — raw를 직접 읽지 않는다)
--     ③ 학습 행이 0건이거나, 학습 행 또는 Champion 채점에 쓴 test 기간 행(core.v_test_actual)이 한 행이라도
--        IMPORTED usage_history 적재 배치(core.upload_batch) · FILE_UPLOAD 출처가 아니면
--                                                                    FORECAST_SOURCE_UNVERIFIED
--        (pre-review fix — 더미 Actual로 채점해 고른 Champion은 더미 기반 모델 선택이다)
--     ④ 입력 지문(fix round 1) — Forecast Run · Backtest가 SUCCESS가 될 때 트리거가 그때의 학습 · 검증 기간 입력 행
--        지문(행 수 · 수량 합 · 최대 loaded_at · 정렬한 (품목, 일자, 수량, 배치)의 md5)을 기록한다. 계획 생성 시 같은
--        기간을 다시 지문 떠서 비교한다. 실행 · Champion을 채점한 Backtest에 지문이 없으면(이 마이그레이션 전 실행)
--                                                                    FORECAST_INPUT_UNTRACED
--        지문이 다르면(실행 뒤 더미 삭제 · 행 추가 · 수량 수정)            FORECAST_INPUT_CHANGED
--        "지금 남은 행이 모두 검증됐다"만으로는 실행이 실제로 쓴 행을 증명하지 못하기 때문이다. STEP 6 is_stale은 보지
--        않는다 — 수주 · 이벤트 같은 무관한 적재로도 켜진다. 사용 이력 변경은 지문이 잡는다.
--   통과하지 못하면 그 계획의 모든 라인이 CALCULATION_UNAVAILABLE + 위 사유이고 Forecast 유래 수량은 null이다.
--   5회차 더미 행은 batch_id가 null이므로 ③에서 걸린다 — 현재 배포 DB에서는 모든 라인이 계산 불가인 것이 정상이다.
--
-- ★ 계산 규칙(컨트롤러 판정 2~5)
--   horizon 6개월, 1개월차 = 기준월(출항 준비기간 + 선적 약 1주 < 1개월, stage1 §8).
--   6개월 합 = 그 실행의 학습 시계열(core.v_train_demand)의 마지막 6개월 합, 평균사용량 = 합 ÷ 6(표시 · 스냅샷용).
--     기록 없는 달은 0, 원본 null이 하나라도 있거나 학습 기간이 6개월보다 짧으면 null(AVG_USAGE_UNAVAILABLE).
--     core.v_test_actual은 계산에 읽지 않는다(원천 게이트의 출처 · 지문 확인에만 쓴다).
--   조정 후보 = 기준월 취합 주기의 AGREED 부서 제출 합계(오류 없는 줄, 해당 필요월) → 없으면 기준(Champion) Forecast.
--   1개월차 기준 × [0.8, 1.2], 2~3개월차 × [0.7, 1.3]로 클램프, 4~6개월차 미적용. 승인 추가 수요
--     (analytics.v_approved_demand_monthly — 확정 수주 · 승인 수급회의 · 승인 이벤트)는 클램프 뒤에 더한다.
--   1개월차 시작재고 = 생성 시점 analytics.v_available_stock.available_qty, k개월차 = k−1개월차 예상 월말재고.
--   stockout_prevention = max(0, 수요 − 시작), dos_required = max(0, 수요 + 목표DoS × 6개월 합 ÷ 180 − 시작),
--   selected = 둘 중 큰 값(같으면 INVENTORY_VALUE_MIN), final = ceil(selected ÷ coalesce(MOQ,1)) × coalesce(MOQ,1),
--   예상 월말 = 시작 + final − 수요, 예상 DoS = 예상 월말 × 180 ÷ 6개월 합(반올림 없이 저장, 합 0이면 null + AVG_USAGE_ZERO),
--   ★ 정밀도(fix round 1) — 목표DoS ÷ 30 × (합 ÷ 6)을 합 ÷ 6부터 나누면 numeric 반복소수 반올림으로 정수여야 할 필요량이
--     100.0000000000000001이 되어 올림이 한 단위를 더 붙였다. 나눗셈을 180 한 번으로 줄이고, 두 필요량은 올림 직전에
--     소수 6자리로 반올림한다(수량 단위보다 한참 작은 오차만 지운다).
--   예상 재고금액 = 예상 월말 × 단가. pack_size · min_order_amount는 스냅샷 · 표시만 한다(stage1 §7).
--
-- ★ 승인된 정책 값만(pre-review fix) — 목표 DoS · 단가 · MOQ · 목표재고는 core.item_policy 운영값이 아니라 "그 필드를
--   제안한(제안값 not null) 가장 최근 APPROVED core.item_policy_revision"의 값을 쓴다. 9a 이전에 직접 들어간 값은 승인이
--   아니다(9a의 target_dos_approved와 같은 판단). analytics.v_item_policy 끝에 approved_* 열과 사유 코드를 덧붙여
--   9b와 Task 12가 한 곳에서 읽는다. 승인 단가 없음 → UNIT_PRICE_UNSET(계산 불가), 승인 MOQ 없음 → 1,
--   승인 목표 DoS 없음 → TARGET_DOS_UNSET(계산 불가), 승인 목표재고 없음 → null + TARGET_STOCK_UNSET(9b 계산에는 안 씀).
--
-- ★ 확정 · 승인(컨트롤러 판정 6~7)
--   라인 중 하나라도 CALCULATION_UNAVAILABLE이거나 TARGET_DOS_UNSET이면 확정을 거절하고 사유 목록을 돌려준다(이력은 남긴다).
--   확정(PLAN_CONFIRM)은 PURCHASE_PLAN 승인 요청을 만들고, 승인(PLAN_APPROVE, 요청자 ≠ 승인자 — Task 2가 판정)은
--   core.apply_procurement_plan_decision 훅에서만 APPROVED가 된다. 반려는 REJECTED(미확정)로 되돌리고 의견을 남긴다.
--   생성 시 모든 입력값을 라인에 스냅샷하고, 승인본은 트리거로 불변이다. 다시 계산하면 같은 달의 새 버전을 만든다 —
--   작업 중(DRAFT · PENDING_APPROVAL · REJECTED) 계획은 달마다 하나뿐이고(부분 유니크 인덱스), 새 버전이 이전 작업본을
--   SUPERSEDED로 바꾼다(승인 대기였다면 승인 요청을 취소한다). APPROVED 계획은 새 버전이 생겨도 건드리지 않는다 —
--   Task 10은 analytics.v_procurement_plan.is_latest_approved인 계획만 읽는다.
--
-- ★ 잠금 순서 — 승인 요청 행 → 계획 행. core.decide_approval(승인 요청 FOR UPDATE) → 훅(계획 FOR UPDATE)과 같다.
--   core.build_procurement_plan은 같은 기준월에 advisory lock을 먼저 잡고, 승인 대기 계획을 대체할 때도 승인 요청을
--   먼저 잠근 뒤 계획을 잠근다.
--
-- ★ 알림 dedupe_key는 Task 3 공통 결과 알림(approval:<id>:decision:<status>)과 다르게 둔다(error.md #23).
--
-- 다시 실행해도 안전합니다. 운영 테이블에 예시 데이터를 넣지 않습니다. 실제 Supabase 적용은 사용자가 SQL Editor에서
-- 수동으로 수행합니다.


-- ══ 1. 발주계획 · 라인 · 이력 ═════════════════════════════════════

create table if not exists core.procurement_plan (
  plan_id                    uuid primary key default gen_random_uuid(),
  plan_month                 date not null check (extract(day from plan_month) = 1),
  version                    integer not null check (version > 0),
  status                     text not null default 'DRAFT' check (status in (
                               'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED'
                             )),
  horizon_months             integer not null default 6 check (horizon_months = 6),
  forecast_run_id            uuid references core.forecast_run(run_id) on delete restrict,
  forecast_train_start       date,
  forecast_train_end         date,
  forecast_data_snapshot_at  timestamptz,
  source_status              text not null constraint procurement_plan_source_status_check check (source_status in (
                               'VERIFIED', 'FORECAST_SOURCE_UNVERIFIED', 'FORECAST_WINDOW_CHANGED',
                               'FORECAST_INPUT_UNTRACED', 'FORECAST_INPUT_CHANGED'
                             )),
  built_by                   uuid not null references auth.users(id) on delete restrict,
  built_by_name              text not null check (btrim(built_by_name) <> ''),
  built_at                   timestamptz not null default clock_timestamp(),
  confirmed_by               uuid references auth.users(id) on delete restrict,
  confirmed_by_name          text,
  confirmed_at               timestamptz,
  approval_id                uuid references core.approval_request(approval_id) on delete restrict,
  decided_by                 uuid references auth.users(id) on delete restrict,
  decider_name               text,
  decided_at                 timestamptz,
  decision_comment           text,
  superseded_by_plan_id      uuid references core.procurement_plan(plan_id) on delete restrict deferrable initially deferred,
  superseded_at              timestamptz,
  unique (plan_month, version),
  unique (approval_id),
  constraint procurement_plan_status_fields_check check (
    (status <> 'APPROVED' or (approval_id is not null and confirmed_by is not null and decided_by is not null
                              and nullif(btrim(decider_name), '') is not null and decided_at is not null))
    and (status <> 'REJECTED' or (decided_by is not null and decided_at is not null
                                  and nullif(btrim(decision_comment), '') is not null))
    and (status <> 'SUPERSEDED' or superseded_at is not null)
  )
);

-- 한 달에 작업 중(미확정 · 승인 대기 · 반려) 계획은 하나뿐이다. 승인본과 대체본은 이력으로 남는다.
create unique index if not exists procurement_plan_one_open_idx
  on core.procurement_plan (plan_month) where status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED');
create index if not exists procurement_plan_month_idx on core.procurement_plan (plan_month desc, version desc);

-- fix round 1 — 원천 판정 코드 변경(FORECAST_RUN_STALE 제거, 입력 지문 두 코드 추가). 이미 만든 표에도 재실행으로 반영한다.
alter table core.procurement_plan drop constraint if exists procurement_plan_source_status_check;
alter table core.procurement_plan add constraint procurement_plan_source_status_check check (source_status in (
  'VERIFIED', 'FORECAST_SOURCE_UNVERIFIED', 'FORECAST_WINDOW_CHANGED', 'FORECAST_INPUT_UNTRACED', 'FORECAST_INPUT_CHANGED'
));

comment on table core.procurement_plan is
  'Task 9b — 월별 발주계획 버전. APPROVED만 최종본이며 변경할 수 없다. 재계산은 새 버전을 만든다';
comment on column core.procurement_plan.source_status is
  '생성 시점 Forecast 원천 판정(core.procurement_forecast_source_status). VERIFIED가 아니면 모든 라인이 계산 불가다';

create table if not exists core.procurement_plan_line (
  line_id                    uuid primary key default gen_random_uuid(),
  plan_id                    uuid not null references core.procurement_plan(plan_id) on delete restrict,
  item_id                    text not null check (btrim(item_id) <> ''),
  item_name                  text,
  month_no                   smallint not null check (month_no between 1 and 6),
  target_month               date not null check (extract(day from target_month) = 1),

  -- Forecast · 조정 후보 스냅샷
  champion_model_id          text,
  model_version              uuid,
  base_forecast_qty          numeric,
  department_agreed_qty      numeric,
  candidate_source           text check (candidate_source is null or candidate_source in ('DEPARTMENT_AGREED', 'BASE_FORECAST')),
  candidate_qty              numeric,
  flex_min_qty               numeric,
  flex_max_qty               numeric,
  flex_applied               boolean not null default false,
  adjusted_demand_qty        numeric,

  -- 승인 추가 수요(Task 8) 스냅샷
  confirmed_order_qty        numeric,
  meeting_qty                numeric,
  event_qty                  numeric,
  approved_added_qty         numeric,
  demand_qty                 numeric,

  -- 재고 스냅샷(Task 4 · 5) — 1개월차 시작재고는 available_qty, 이후는 전월 예상 월말재고
  normal_stock_qty           numeric,
  allocated_qty              numeric,
  available_qty              numeric,
  stock_snapshot_at          timestamptz,
  start_stock_qty            numeric,

  -- 품목 정책(Task 9a) 스냅샷
  target_dos_days            numeric,
  target_dos_approved        boolean not null default false,
  unit_price                 numeric,
  moq                        numeric,
  pack_size                  numeric,
  min_order_amount           numeric,
  avg_usage_6m               numeric,

  -- 계산 결과
  stockout_prevention_qty    numeric,
  dos_required_qty           numeric,
  selected_qty               numeric,
  selection_reason           text check (selection_reason is null or selection_reason in (
                               'STOCKOUT_PREVENTION', 'DOS_TARGET', 'INVENTORY_VALUE_MIN'
                             )),
  effective_moq              numeric not null check (effective_moq > 0),
  final_order_qty            numeric,
  projected_month_end_qty    numeric,
  projected_dos_days         numeric,
  projected_inventory_value  numeric,
  calculation_status         text not null check (calculation_status in ('CALCULATED', 'CALCULATION_UNAVAILABLE')),
  reason_code                text,
  reason_codes               text[] not null default '{}',
  created_at                 timestamptz not null default clock_timestamp(),
  unique (plan_id, item_id, month_no),
  -- 계산된 라인은 발주량이 반드시 있고, 계산 불가 라인은 임의 수량을 갖지 않는다(AGENTS.md 5번)
  constraint procurement_plan_line_result_check check (
    (calculation_status = 'CALCULATED'
      and start_stock_qty is not null and demand_qty is not null and stockout_prevention_qty is not null
      and dos_required_qty is not null and selected_qty is not null and selection_reason is not null
      and final_order_qty is not null and projected_month_end_qty is not null and projected_inventory_value is not null)
    or (calculation_status = 'CALCULATION_UNAVAILABLE' and reason_code is not null
      and stockout_prevention_qty is null and dos_required_qty is null and selected_qty is null and selection_reason is null
      and final_order_qty is null and projected_month_end_qty is null and projected_dos_days is null
      and projected_inventory_value is null)
  ),
  constraint procurement_plan_line_reason_check check (reason_code is not distinct from reason_codes[1])
);

create index if not exists procurement_plan_line_plan_idx on core.procurement_plan_line (plan_id, item_id, month_no);

comment on table core.procurement_plan_line is
  'Task 9b — 품목 × 1~6개월차 계산 단계별 수량과 입력 스냅샷. 생성 후 수정 · 삭제할 수 없다';
comment on column core.procurement_plan_line.reason_codes is
  '확인 순서대로 모은 모든 사유. reason_code는 첫 번째 사유다. AVG_USAGE_ZERO만 정보성이고 나머지는 확정을 막는다';

create table if not exists core.procurement_plan_event (
  event_id         bigint generated always as identity primary key,
  plan_id          uuid not null references core.procurement_plan(plan_id) on delete restrict,
  event_type       text not null check (event_type in (
                     'BUILT', 'SUPERSEDED', 'CONFIRM_BLOCKED', 'CONFIRMED', 'APPROVED', 'REJECTED', 'APPROVAL_CANCELLED'
                   )),
  previous_status  text,
  next_status      text not null,
  actor            uuid not null references auth.users(id) on delete restrict,
  actor_name       text not null,
  approval_id      uuid,
  comment          text,
  payload          jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  at               timestamptz not null default clock_timestamp()
);

create index if not exists procurement_plan_event_plan_idx on core.procurement_plan_event (plan_id, at, event_id);

comment on table core.procurement_plan_event is
  'Task 9b — 발주계획 생성 · 대체 · 확정 차단 · 확정 · 승인 · 반려 · 승인 취소 append-only 이력(stage1 §9)';


-- ══ 2. 불변 가드 ══════════════════════════════════════════════════

create or replace function core.guard_procurement_plan_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '발주계획은 삭제할 수 없습니다. 새 버전을 계산하세요.' using errcode = '42501';
  end if;
  if old.status = 'APPROVED' then
    raise exception '승인된 발주계획은 변경할 수 없습니다. 새 버전을 계산하세요.' using errcode = '42501';
  end if;
  if old.status = 'SUPERSEDED' then
    raise exception '새 버전으로 대체된 발주계획은 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if (new.plan_id, new.plan_month, new.version, new.horizon_months, new.forecast_run_id, new.forecast_train_start,
      new.forecast_train_end, new.forecast_data_snapshot_at, new.source_status, new.built_by, new.built_by_name, new.built_at)
     is distinct from
     (old.plan_id, old.plan_month, old.version, old.horizon_months, old.forecast_run_id, old.forecast_train_start,
      old.forecast_train_end, old.forecast_data_snapshot_at, old.source_status, old.built_by, old.built_by_name, old.built_at) then
    raise exception '발주계획의 계산 근거(기준월 · 버전 · Forecast · 생성자)는 변경할 수 없습니다.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'DRAFT' and new.status in ('PENDING_APPROVAL', 'SUPERSEDED'))
    or (old.status = 'PENDING_APPROVAL' and new.status in ('APPROVED', 'REJECTED', 'DRAFT'))
    or (old.status = 'REJECTED' and new.status in ('PENDING_APPROVAL', 'SUPERSEDED'))
  ) then
    raise exception '허용되지 않는 발주계획 상태 전환입니다: % → %', old.status, new.status using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists procurement_plan_guard on core.procurement_plan;
create trigger procurement_plan_guard
  before update or delete on core.procurement_plan
  for each row execute function core.guard_procurement_plan_mutation();

create or replace function core.guard_procurement_plan_line_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception '발주계획 라인은 생성 후 수정하거나 삭제할 수 없습니다. 새 버전을 계산하세요.' using errcode = '42501';
  end if;
  -- 라인은 방금 만든(아직 한 번도 확정되지 않은) 작성 계획에만 붙는다 — 승인본 · 대체본에 끼워 넣을 수 없다
  if not exists (
    select 1 from core.procurement_plan p
     where p.plan_id = new.plan_id and p.status = 'DRAFT' and p.confirmed_at is null
  ) then
    raise exception '발주계획 라인은 방금 계산한 작성(DRAFT) 계획에만 추가할 수 있습니다.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists procurement_plan_line_guard on core.procurement_plan_line;
create trigger procurement_plan_line_guard
  before insert or update or delete on core.procurement_plan_line
  for each row execute function core.guard_procurement_plan_line_mutation();

create or replace function core.reject_procurement_plan_event_mutation()
returns trigger
language plpgsql
set search_path = core, pg_temp
as $$
begin
  raise exception '발주계획 이력은 수정하거나 삭제할 수 없습니다.' using errcode = '42501';
end;
$$;

drop trigger if exists procurement_plan_event_append_only on core.procurement_plan_event;
create trigger procurement_plan_event_append_only
  before update or delete on core.procurement_plan_event
  for each row execute function core.reject_procurement_plan_event_mutation();


-- ══ 3. 한 달 계산 — 순수 함수 ════════════════════════════════════
--
-- 기준 Forecast가 null이면 아무것도 계산하지 않는다. 시작재고 · 목표 DoS · 6개월 합 · 단가 중 하나라도 null이면
-- 수요 쪽(후보 · Flex · 수요)만 계산하고 발주 쪽은 null로 둔다 — 호출자가 계산 불가 라인에는 시작재고를 null로 넘긴다.
--
-- fix round 1 — 7번째 인자를 평균사용량에서 6개월 합(p_usage_6m_total)으로 바꿨다(정밀도). 인자 이름이 바뀌면
-- create or replace가 거절하므로 먼저 지우고 다시 만든다(plpgsql 호출부는 실행 시점에 찾으므로 의존 객체가 없다).

drop function if exists core.calculate_procurement_plan_month(integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric);

create function core.calculate_procurement_plan_month(
  p_month_no integer,
  p_base_forecast_qty numeric,
  p_department_agreed_qty numeric,
  p_approved_added_qty numeric,
  p_start_stock_qty numeric,
  p_target_dos_days numeric,
  p_usage_6m_total numeric,
  p_moq numeric,
  p_unit_price numeric
)
returns table (
  candidate_source text,
  candidate_qty numeric,
  flex_min_qty numeric,
  flex_max_qty numeric,
  flex_applied boolean,
  adjusted_demand_qty numeric,
  demand_qty numeric,
  stockout_prevention_qty numeric,
  dos_required_qty numeric,
  selected_qty numeric,
  selection_reason text,
  effective_moq numeric,
  final_order_qty numeric,
  projected_month_end_qty numeric,
  projected_dos_days numeric,
  projected_inventory_value numeric,
  dos_reason_code text
)
language plpgsql
immutable
set search_path = core, pg_temp
as $$
declare
  -- stage1 §4 — 1개월차 ±20%, 2~3개월차 ±30%, 4~6개월차 미적용
  v_band numeric := case when p_month_no = 1 then 0.2 when p_month_no in (2, 3) then 0.3 end;
begin
  flex_applied := false;
  effective_moq := coalesce(p_moq, 1);
  if p_base_forecast_qty is null then
    return next;
    return;
  end if;

  candidate_source := case when p_department_agreed_qty is null then 'BASE_FORECAST' else 'DEPARTMENT_AGREED' end;
  candidate_qty := coalesce(p_department_agreed_qty, p_base_forecast_qty);
  if v_band is null then
    adjusted_demand_qty := candidate_qty;
  else
    flex_min_qty := least(p_base_forecast_qty * (1 - v_band), p_base_forecast_qty * (1 + v_band));
    flex_max_qty := greatest(p_base_forecast_qty * (1 - v_band), p_base_forecast_qty * (1 + v_band));
    flex_applied := candidate_qty < flex_min_qty or candidate_qty > flex_max_qty;
    adjusted_demand_qty := least(greatest(candidate_qty, flex_min_qty), flex_max_qty);
  end if;
  -- ★ 승인된 추가 수요는 클램프 뒤에 더한다(stage1 §5 — 이벤트성 대량 거래는 조정 범위를 벗어날 수 있다)
  demand_qty := adjusted_demand_qty + coalesce(p_approved_added_qty, 0);

  if p_start_stock_qty is null or p_target_dos_days is null or p_usage_6m_total is null or p_unit_price is null then
    return next;
    return;
  end if;

  -- ★ 정밀도 — 목표DoS ÷ 30 × (합 ÷ 6) = 목표DoS × 합 ÷ 180. 나눗셈은 한 번만 하고, 올림 직전에 소수 6자리로
  --   반올림해 numeric 반올림 꼬리(…0000000001)가 MOQ 올림을 한 단위 넘기지 않게 한다.
  stockout_prevention_qty := greatest(0, round(demand_qty - p_start_stock_qty, 6));
  dos_required_qty := greatest(0, round(demand_qty + p_target_dos_days * p_usage_6m_total / 180 - p_start_stock_qty, 6));
  selected_qty := greatest(stockout_prevention_qty, dos_required_qty);
  -- 1순위 품절 방지 · 2순위 목표 DoS 충족 최소수량 · 두 기준이 같으면 그 최소수량이 곧 월말 재고금액 최소(3순위)
  selection_reason := case
    when stockout_prevention_qty > dos_required_qty then 'STOCKOUT_PREVENTION'
    when dos_required_qty > stockout_prevention_qty then 'DOS_TARGET'
    else 'INVENTORY_VALUE_MIN'
  end;
  -- stage1 §7 — MOQ 단위 올림(120, MOQ 50 → 150), 미설정이면 1
  final_order_qty := ceil(selected_qty / effective_moq) * effective_moq;
  projected_month_end_qty := p_start_stock_qty + final_order_qty - demand_qty;
  -- stage1 §6 — DoS = 월말 재고 ÷ 월평균사용량 × 30 = 월말 재고 × 180 ÷ 6개월 합.
  -- 반올림하지 않고 저장한다(fix round 1 — 표시할 때만 반올림, Task 12가 원값으로 비교한다)
  projected_dos_days := case when p_usage_6m_total > 0 then projected_month_end_qty * 180 / p_usage_6m_total end;
  dos_reason_code := case when p_usage_6m_total = 0 then 'AVG_USAGE_ZERO' end;
  projected_inventory_value := projected_month_end_qty * p_unit_price;
  return next;
end;
$$;

comment on function core.calculate_procurement_plan_month(integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) is
  'Task 9b — 한 품목 한 달의 Flex · 수요 · 선택 수량 · MOQ 올림 · 예상 월말재고 · DoS · 재고금액. 입력만 보는 순수 함수. '
  '7번째 인자는 학습 기간 최근 6개월 사용량 합이다(평균이 아니다)';


-- ══ 3b. 입력 지문 — Forecast · Backtest가 실제로 쓴 사용 이력(fix round 1) ══
--
-- 실행 결과 행은 지우거나 덮어쓰지 않는다. STEP 6 · 7 함수도 고치지 않는다 — 두 표에 열을 덧붙이고, 실행이 SUCCESS가
-- 되는 순간(같은 트랜잭션) 트리거가 그때 core.v_train_demand(실행) · core.v_test_actual(Backtest)의 지문을 기록한다.
-- 이 마이그레이션 전에 끝난 실행은 지문이 없다(null) — 계획 생성이 FORECAST_INPUT_UNTRACED로 막고 재실행을 요구한다.

alter table core.forecast_run add column if not exists train_input_row_count bigint;
alter table core.forecast_run add column if not exists train_input_qty_sum numeric;
alter table core.forecast_run add column if not exists train_input_max_loaded_at timestamptz;
alter table core.forecast_run add column if not exists train_input_md5 text;
alter table core.forecast_run add column if not exists train_input_fingerprinted_at timestamptz;

alter table core.backtest_run add column if not exists test_input_row_count bigint;
alter table core.backtest_run add column if not exists test_input_qty_sum numeric;
alter table core.backtest_run add column if not exists test_input_max_loaded_at timestamptz;
alter table core.backtest_run add column if not exists test_input_md5 text;
alter table core.backtest_run add column if not exists test_input_fingerprinted_at timestamptz;

comment on column core.forecast_run.train_input_md5 is
  'Task 9b — 실행이 SUCCESS가 될 때 core.v_train_demand 행의 md5(정렬한 품목 · 일자 · 수량 · 배치). null이면 입력 추적 불가';
comment on column core.backtest_run.test_input_md5 is
  'Task 9b — Backtest가 SUCCESS가 될 때 core.v_test_actual 행의 md5(정렬한 품목 · 일자 · 수량 · 배치). null이면 입력 추적 불가';

-- 지금 활성 기간의 학습(TRAIN) 또는 검증(TEST) 입력 행 지문. 일자는 세션 DateStyle · timezone에 흔들리지 않게
-- timestamp로 바꿔 YYYY-MM-DD로 쓰고, 순서를 고정해 같은 행 집합이면 언제 떠도 같은 md5가 나온다.
create or replace function core.usage_input_fingerprint(p_split text)
returns table (row_count bigint, qty_sum numeric, max_loaded_at timestamptz, input_md5 text)
language sql
stable
security definer
set search_path = core, pg_temp
as $$
  with input_rows as (
    select t.item_id, t.use_date, t.qty, t.batch_id, t.loaded_at from core.v_train_demand t where p_split = 'TRAIN'
    union all
    select t.item_id, t.use_date, t.qty, t.batch_id, t.loaded_at from core.v_test_actual t where p_split = 'TEST'
  )
  select count(*),
         sum(r.qty),
         max(r.loaded_at),
         md5(coalesce(string_agg(
           concat_ws('|', coalesce(r.item_id, '-'), coalesce(to_char(r.use_date::timestamp, 'YYYY-MM-DD'), '-'),
                     coalesce(r.qty::text, '-'), coalesce(r.batch_id::text, '-')),
           E'\n' order by r.item_id, r.use_date, r.qty, r.batch_id::text), ''))
    from input_rows r;
$$;

create or replace function core.record_forecast_run_input_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = core, pg_temp
as $$
begin
  if new.status = 'SUCCESS' and new.train_input_md5 is null and (tg_op = 'INSERT' or old.status is distinct from 'SUCCESS') then
    select f.row_count, f.qty_sum, f.max_loaded_at, f.input_md5
      into new.train_input_row_count, new.train_input_qty_sum, new.train_input_max_loaded_at, new.train_input_md5
      from core.usage_input_fingerprint('TRAIN') f;
    new.train_input_fingerprinted_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists forecast_run_input_fingerprint on core.forecast_run;
create trigger forecast_run_input_fingerprint
  before insert or update of status on core.forecast_run
  for each row execute function core.record_forecast_run_input_fingerprint();

create or replace function core.record_backtest_run_input_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = core, pg_temp
as $$
begin
  if new.status = 'SUCCESS' and new.test_input_md5 is null and (tg_op = 'INSERT' or old.status is distinct from 'SUCCESS') then
    select f.row_count, f.qty_sum, f.max_loaded_at, f.input_md5
      into new.test_input_row_count, new.test_input_qty_sum, new.test_input_max_loaded_at, new.test_input_md5
      from core.usage_input_fingerprint('TEST') f;
    new.test_input_fingerprinted_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists backtest_run_input_fingerprint on core.backtest_run;
create trigger backtest_run_input_fingerprint
  before insert or update of status on core.backtest_run
  for each row execute function core.record_backtest_run_input_fingerprint();


-- ══ 4. 원천 게이트 ════════════════════════════════════════════════

create or replace function core.procurement_forecast_source_status(p_run_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = core, analytics, public, pg_temp
as $$
declare
  -- analytics.v_forecast_run은 select r.*로 만들어져 3b에서 덧붙인 지문 열이 없다 — 원본 표를 읽는다
  v_run core.forecast_run%rowtype;
  v_train_start date;
  v_train_end date;
  v_test_start date;
  v_test_end date;
  v_train_print record;
  v_test_print record;
begin
  if p_run_id is null then
    return 'FORECAST_SOURCE_UNVERIFIED';
  end if;

  select * into v_run from core.forecast_run where run_id = p_run_id;
  if not found or v_run.status <> 'SUCCESS' or v_run.granularity is distinct from 'MONTH' then
    return 'FORECAST_SOURCE_UNVERIFIED';
  end if;

  select s.train_start, s.train_end, s.test_start, s.test_end into v_train_start, v_train_end, v_test_start, v_test_end
    from core.forecast_setting s
   where s.active and core.is_valid_forecast_window(s.train_start, s.train_end, s.test_start, s.test_end, s.granularity)
   order by s.updated_at desc
   limit 1;
  if v_train_start is distinct from v_run.train_start or v_train_end is distinct from v_run.train_end then
    return 'FORECAST_WINDOW_CHANGED';
  end if;

  -- 이 실행의 Champion(품목별 최신 선정)을 채점한 Backtest의 검증 기간이 지금 core.v_test_actual의 기간과 같아야
  -- 아래 출처 확인이 "채점에 쓴 Actual"을 본다
  if exists (
    select 1
      from analytics.v_champion_model c
      join core.backtest_run br on br.backtest_run_id = c.backtest_run_id
     where br.forecast_run_id = p_run_id
       and (br.test_start is distinct from v_test_start or br.test_end is distinct from v_test_end)
  ) then
    return 'FORECAST_WINDOW_CHANGED';
  end if;

  -- 학습 행과 Champion 채점에 쓴 test 기간 행 모두 검증된 적재 배치 출처여야 한다(pre-review fix)
  if not exists (select 1 from core.v_train_demand)
     or exists (
       select 1
         from (
           select tr.batch_id, tr.source_type from core.v_train_demand tr
           union all
           select te.batch_id, te.source_type from core.v_test_actual te
         ) t
         left join core.upload_batch b on b.batch_id = t.batch_id
        where b.batch_id is null
           or b.status <> 'IMPORTED'
           or b.import_type <> 'usage_history'
           or t.source_type is distinct from 'FILE_UPLOAD'
     ) then
    return 'FORECAST_SOURCE_UNVERIFIED';
  end if;

  -- ④ 입력 지문(fix round 1) — 지금 남은 행이 아니라 실행 · 채점이 실제로 쓴 행과 같은지 확인한다.
  --   STEP 6 is_stale은 보지 않는다(무관한 수주 · 이벤트 적재로도 켜진다) — 사용 이력 변경은 지문이 잡는다.
  if v_run.train_input_md5 is null
     or exists (
       select 1
         from analytics.v_champion_model c
         join core.backtest_run br on br.backtest_run_id = c.backtest_run_id
        where br.forecast_run_id = p_run_id and br.test_input_md5 is null
     ) then
    return 'FORECAST_INPUT_UNTRACED';
  end if;

  select * into v_train_print from core.usage_input_fingerprint('TRAIN');
  if (v_train_print.row_count, v_train_print.qty_sum, v_train_print.max_loaded_at, v_train_print.input_md5)
     is distinct from
     (v_run.train_input_row_count, v_run.train_input_qty_sum, v_run.train_input_max_loaded_at, v_run.train_input_md5) then
    return 'FORECAST_INPUT_CHANGED';
  end if;

  select * into v_test_print from core.usage_input_fingerprint('TEST');
  if exists (
    select 1
      from analytics.v_champion_model c
      join core.backtest_run br on br.backtest_run_id = c.backtest_run_id
     where br.forecast_run_id = p_run_id
       and (br.test_input_row_count, br.test_input_qty_sum, br.test_input_max_loaded_at, br.test_input_md5)
           is distinct from
           (v_test_print.row_count, v_test_print.qty_sum, v_test_print.max_loaded_at, v_test_print.input_md5)
  ) then
    return 'FORECAST_INPUT_CHANGED';
  end if;

  return 'VERIFIED';
end;
$$;

comment on function core.procurement_forecast_source_status(uuid) is
  'Task 9b 원천 게이트 — VERIFIED · FORECAST_SOURCE_UNVERIFIED · FORECAST_WINDOW_CHANGED · FORECAST_INPUT_UNTRACED · '
  'FORECAST_INPUT_CHANGED';


-- ══ 4b. 승인된 정책 값 — analytics.v_item_policy 확장 ══════════════
--
-- ★ Task 9a(20260911000850)의 열 16개를 이름 · 순서 · 식 그대로 먼저 두고 끝에만 덧붙인다(error.md #16).
--   target_dos_approved · order_blocked · reason_code의 의미는 바꾸지 않는다.
-- ★ 승인값 = 그 필드를 제안한(제안값 not null) APPROVED 변경안 중 가장 최근에 결정된 것의 제안값.
--   9a 승인 반영은 coalesce(제안값, 현재값)이라 제안하지 않은 필드는 직접 넣은 옛 값이 운영값에 남는다 — 그 값은 승인이 아니다.

create or replace view analytics.v_item_policy as
select p.item_id,
       p.target_dos_days, p.allocation_mode, p.target_stock_qty,
       p.unit_price, p.unit_price_basis,
       p.moq, p.pack_size, p.min_order_amount, p.item_grade, p.service_level,
       p.updated_at,
       coalesce(p.moq, 1) as effective_moq,
       not exists (
         select 1 from core.item_policy_revision r
          where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_target_dos_days is not null
       ) as order_blocked,
       case when not exists (
         select 1 from core.item_policy_revision r
          where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_target_dos_days is not null
       ) then 'TARGET_DOS_UNSET' end as reason_code,
       exists (
         select 1 from core.item_policy_revision r
          where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_target_dos_days is not null
       ) as target_dos_approved,
       -- ── pre-review fix(Task 9b) 덧붙인 열 ──
       av.approved_target_dos_days,
       av.approved_unit_price,
       case when av.approved_unit_price is null then 'UNIT_PRICE_UNSET' end as unit_price_reason_code,
       av.approved_moq,
       coalesce(av.approved_moq, 1) as approved_effective_moq,
       case when av.approved_moq is null then 'MOQ_UNSET' end as moq_reason_code,
       av.approved_target_stock_qty,
       case when av.approved_target_stock_qty is null then 'TARGET_STOCK_UNSET' end as target_stock_reason_code
  from core.item_policy p
  left join lateral (
    select
      (select r.proposed_target_dos_days from core.item_policy_revision r
        where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_target_dos_days is not null
        order by r.decided_at desc, r.requested_at desc limit 1) as approved_target_dos_days,
      (select r.proposed_unit_price from core.item_policy_revision r
        where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_unit_price is not null
        order by r.decided_at desc, r.requested_at desc limit 1) as approved_unit_price,
      (select r.proposed_moq from core.item_policy_revision r
        where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_moq is not null
        order by r.decided_at desc, r.requested_at desc limit 1) as approved_moq,
      (select r.proposed_target_stock_qty from core.item_policy_revision r
        where r.item_id = p.item_id and r.status = 'APPROVED' and r.proposed_target_stock_qty is not null
        order by r.decided_at desc, r.requested_at desc limit 1) as approved_target_stock_qty
  ) av on true;

comment on view analytics.v_item_policy is
  'Task 9a — target_dos_approved · order_blocked는 승인된 core.item_policy_revision 이력으로 판정한다. '
  'Task 9b — approved_* 열은 그 필드를 제안한 최신 승인 변경안의 값이다(직접 넣은 운영값은 승인이 아니다). '
  '발주계획 계산과 Task 12는 approved_* 열만 쓴다';

grant select on analytics.v_item_policy to authenticated;
revoke all on analytics.v_item_policy from anon;


-- ══ 5. 계획 생성 — SCM 품목담당자(PLAN_CONFIRM) ═══════════════════

create or replace function core.build_procurement_plan(p_plan_month date, p_forecast_run_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = core, analytics, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_month date;
  v_run core.forecast_run%rowtype;
  v_source_status text;
  v_verified boolean;
  v_open core.procurement_plan%rowtype;
  v_locked_approval_id uuid;
  v_plan_id uuid := gen_random_uuid();
  v_version integer;
  v_cycle_id uuid;
  v_item record;
  v_calc record;
  v_month_no integer;
  v_target date;
  v_total numeric;
  v_base numeric;
  v_dept numeric;
  v_confirmed numeric;
  v_meeting numeric;
  v_event numeric;
  v_added numeric;
  v_start numeric;
  v_reasons text[];
  v_unavailable boolean;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 발주계획을 만들 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('PLAN_CONFIRM', v_actor) then
    raise exception '발주계획 생성 권한(PLAN_CONFIRM)이 없습니다.' using errcode = '42501';
  end if;
  if p_plan_month is null then
    raise exception 'PLAN_MONTH_REQUIRED: 기준월은 필수입니다.' using errcode = '22023';
  end if;
  v_month := make_date(extract(year from p_plan_month)::integer, extract(month from p_plan_month)::integer, 1);
  v_actor_name := core.order_actor_name(v_actor);

  if p_forecast_run_id is not null then
    select * into v_run from core.forecast_run where run_id = p_forecast_run_id;
    if not found then
      raise exception 'FORECAST_RUN_NOT_FOUND: Forecast Run을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
    if v_run.status <> 'SUCCESS' then
      raise exception 'FORECAST_RUN_NOT_SUCCESS: 성공한 Forecast Run만 발주계획에 쓸 수 있습니다(현재 %).', v_run.status
        using errcode = '22023';
    end if;
  else
    -- 비워 두면 최신 성공 실행. 없으면 v_run이 비어 원천 판정이 FORECAST_SOURCE_UNVERIFIED가 된다(컨트롤러 판정 1)
    select * into v_run from core.forecast_run where status = 'SUCCESS' order by finished_at desc nulls last, started_at desc limit 1;
  end if;

  v_source_status := core.procurement_forecast_source_status(v_run.run_id);
  v_verified := v_source_status = 'VERIFIED';

  -- 같은 기준월 생성을 직렬화한다(버전 번호 · 작업본 대체)
  perform pg_advisory_xact_lock(hashtextextended('core.procurement_plan:' || to_char(v_month, 'YYYY-MM-DD'), 0));

  select * into v_open
    from core.procurement_plan
   where plan_month = v_month and status in ('DRAFT', 'PENDING_APPROVAL', 'REJECTED');
  if found then
    if v_open.status = 'PENDING_APPROVAL' then
      -- 잠금 순서: 승인 요청 → 계획(core.decide_approval과 같다)
      perform 1 from core.approval_request where approval_id = v_open.approval_id for update;
      v_locked_approval_id := v_open.approval_id;
    end if;
    select * into v_open from core.procurement_plan where plan_id = v_open.plan_id for update;

    if v_open.status = 'PENDING_APPROVAL' then
      if v_locked_approval_id is distinct from v_open.approval_id then
        raise exception '같은 기준월 계획이 방금 확정되었습니다. 다시 계산해 주세요.' using errcode = '40001';
      end if;
      -- 승인 대기 중인 이전 버전은 승인 요청을 취소한다. Task 5의 범용 취소 헬퍼를 그대로 쓴다(Task 9a와 같다) —
      -- 그 UPDATE가 Task 3 반복 알림 취소와 아래 훅(계획 → DRAFT, APPROVAL_CANCELLED 이력)을 같은 트랜잭션에서 연쇄시킨다.
      perform core.cancel_alloc_priority_approval(v_open.approval_id, v_actor, '새 버전 계산으로 승인 요청을 취소합니다.');
      select * into v_open from core.procurement_plan where plan_id = v_open.plan_id;
    end if;

    if v_open.status in ('DRAFT', 'REJECTED') then
      update core.procurement_plan
         set status = 'SUPERSEDED', superseded_by_plan_id = v_plan_id, superseded_at = clock_timestamp()
       where plan_id = v_open.plan_id;
      insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, payload)
      values (v_open.plan_id, 'SUPERSEDED', v_open.status, 'SUPERSEDED', v_actor, v_actor_name,
              jsonb_build_object('superseded_by_plan_id', v_plan_id));
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from core.procurement_plan where plan_month = v_month;

  insert into core.procurement_plan (
    plan_id, plan_month, version, status, forecast_run_id, forecast_train_start, forecast_train_end,
    forecast_data_snapshot_at, source_status, built_by, built_by_name
  ) values (
    v_plan_id, v_month, v_version, 'DRAFT', v_run.run_id, v_run.train_start, v_run.train_end,
    v_run.data_snapshot_at, v_source_status, v_actor, v_actor_name
  );

  -- 조정 후보는 이 기준월 취합 주기(가장 최근에 연 주기)의 합의본에서만 읽는다
  select c.cycle_id into v_cycle_id
    from core.planning_cycle c
   where c.plan_month = v_month
   order by c.is_active desc, c.opened_at desc
   limit 1;

  for v_item in
    with champion as (
      -- 품목별 최신 Champion이 이 Forecast Run의 Backtest에서 나온 경우만 쓴다
      select c.item_id, c.champion_model_id, c.model_version
        from analytics.v_champion_model c
        join core.backtest_run br on br.backtest_run_id = c.backtest_run_id
       where br.forecast_run_id = v_run.run_id
         and c.champion_model_id is not null
    ), items as (
      select p.item_id from core.item_policy p
      union
      select ch.item_id from champion ch
    )
    select i.item_id,
           im.item_name,
           ip.item_id is not null as has_policy,
           -- ★ 승인값만 쓴다(pre-review fix) — core.item_policy에 직접 들어간 운영값은 승인이 아니다
           ip.approved_target_dos_days as target_dos_days,
           coalesce(ip.target_dos_approved, false) as target_dos_approved,
           ip.approved_unit_price as unit_price,
           ip.approved_moq as moq,
           ip.pack_size, ip.min_order_amount,
           ch.champion_model_id, ch.model_version,
           st.item_id is not null as has_stock_row,
           st.normal_warehouse_qty,
           st.temporary_allocated_qty + st.firm_allocated_qty + st.approval_hold_qty as allocated_qty,
           st.available_qty,
           st.snapshot_at as stock_snapshot_at,
           st.reason_code as stock_reason_code
      from items i
      left join core.v_item_master im on im.item_id = i.item_id
      left join analytics.v_item_policy ip on ip.item_id = i.item_id
      left join champion ch on ch.item_id = i.item_id
      left join analytics.v_available_stock st on st.item_id = i.item_id
     order by i.item_id
  loop
    -- 최근 6개월 사용량 합 — 그 실행의 학습 시계열만(원천 게이트가 기간 · 지문 일치를 이미 확인했다).
    -- 평균(합 ÷ 6)은 스냅샷 · 표시용으로만 저장하고, 계산은 합을 그대로 넘긴다(정밀도, fix round 1)
    v_total := null;
    if v_verified then
      select case
               when date_trunc('month', v_run.train_start::timestamp) > date_trunc('month', v_run.train_end::timestamp) - interval '5 months'
                 then null
               when count(*) filter (where t.qty is null) > 0 then null
               else coalesce(sum(t.qty), 0)
             end
        into v_total
        from core.v_train_demand t
       where t.item_id = v_item.item_id
         and t.use_date >= (date_trunc('month', v_run.train_end::timestamp) - interval '5 months')::date;
    end if;

    v_start := v_item.available_qty;

    for v_month_no in 1..6 loop
      v_target := (v_month + make_interval(months => v_month_no - 1))::date;
      v_reasons := array[]::text[];
      v_unavailable := false;

      v_base := null;
      if v_verified and v_item.champion_model_id is not null then
        select f.predicted_qty into v_base
          from core.forecast_result f
         where f.run_id = v_run.run_id and f.model_id = v_item.champion_model_id
           and f.item_id = v_item.item_id and f.period = v_target;
      end if;

      select sum(l.qty) into v_dept
        from core.demand_submission s
        join core.demand_submission_line l on l.submission_id = s.submission_id
       where s.cycle_id = v_cycle_id and s.status = 'AGREED'
         and l.item_id = v_item.item_id and l.need_month = v_target
         and l.qty is not null and jsonb_array_length(l.issues) = 0;

      select coalesce(sum(m.confirmed_order_qty), 0), coalesce(sum(m.supply_meeting_qty), 0),
             coalesce(sum(m.event_demand_qty), 0), coalesce(sum(m.approved_qty), 0)
        into v_confirmed, v_meeting, v_event, v_added
        from analytics.v_approved_demand_monthly m
       where m.plan_month = v_target and m.item_id = v_item.item_id;

      -- 사유 확인 순서 = lib/procurement/model.ts buildPlanItemLines · PLAN_REASON_PRIORITY
      if not v_verified then
        v_reasons := array_append(v_reasons, v_source_status);
        v_unavailable := true;
      else
        if v_item.champion_model_id is null then
          v_reasons := array_append(v_reasons, 'CHAMPION_UNAVAILABLE');
          v_unavailable := true;
        elsif v_base is null then
          v_reasons := array_append(v_reasons, 'BASE_FORECAST_UNAVAILABLE');
          v_unavailable := true;
        end if;
        if v_total is null or v_total < 0 then
          v_reasons := array_append(v_reasons, 'AVG_USAGE_UNAVAILABLE');
          v_unavailable := true;
        end if;
      end if;

      if v_month_no = 1 then
        if not v_item.has_stock_row then
          v_reasons := array_append(v_reasons, 'AVAILABLE_STOCK_UNAVAILABLE');
          v_unavailable := true;
        elsif v_item.available_qty is null then
          v_reasons := array_append(v_reasons, coalesce(v_item.stock_reason_code, 'AVAILABLE_STOCK_UNAVAILABLE'));
          v_unavailable := true;
        end if;
      elsif v_start is null then
        v_reasons := array_append(v_reasons, 'PRIOR_MONTH_UNAVAILABLE');
        v_unavailable := true;
      end if;

      if not v_item.has_policy then
        v_reasons := array_append(v_reasons, 'ITEM_POLICY_MISSING');
        v_unavailable := true;
      else
        if v_item.unit_price is null then
          v_reasons := array_append(v_reasons, 'UNIT_PRICE_UNSET');
          v_unavailable := true;
        end if;
        if v_item.target_dos_days is null then
          -- 승인된 목표 DoS가 없다(직접 넣은 운영값만 있어도 마찬가지)
          v_reasons := array_append(v_reasons, 'TARGET_DOS_UNSET');
          v_unavailable := true;
        end if;
      end if;

      select * into v_calc
        from core.calculate_procurement_plan_month(
          v_month_no, v_base, v_dept, v_added,
          case when v_unavailable then null else v_start end,
          v_item.target_dos_days, v_total, v_item.moq, v_item.unit_price
        );
      if not v_unavailable and v_calc.dos_reason_code is not null then
        v_reasons := array_append(v_reasons, v_calc.dos_reason_code);
      end if;

      insert into core.procurement_plan_line (
        plan_id, item_id, item_name, month_no, target_month,
        champion_model_id, model_version, base_forecast_qty, department_agreed_qty, candidate_source, candidate_qty,
        flex_min_qty, flex_max_qty, flex_applied, adjusted_demand_qty,
        confirmed_order_qty, meeting_qty, event_qty, approved_added_qty, demand_qty,
        normal_stock_qty, allocated_qty, available_qty, stock_snapshot_at, start_stock_qty,
        target_dos_days, target_dos_approved, unit_price, moq, pack_size, min_order_amount, avg_usage_6m,
        stockout_prevention_qty, dos_required_qty, selected_qty, selection_reason, effective_moq, final_order_qty,
        projected_month_end_qty, projected_dos_days, projected_inventory_value,
        calculation_status, reason_code, reason_codes
      ) values (
        v_plan_id, v_item.item_id, v_item.item_name, v_month_no, v_target,
        case when v_verified then v_item.champion_model_id end, case when v_verified then v_item.model_version end,
        v_base, v_dept, v_calc.candidate_source, v_calc.candidate_qty,
        v_calc.flex_min_qty, v_calc.flex_max_qty, v_calc.flex_applied, v_calc.adjusted_demand_qty,
        v_confirmed, v_meeting, v_event, v_added, v_calc.demand_qty,
        v_item.normal_warehouse_qty, v_item.allocated_qty, v_item.available_qty, v_item.stock_snapshot_at, v_start,
        v_item.target_dos_days, v_item.target_dos_approved, v_item.unit_price, v_item.moq, v_item.pack_size,
        v_item.min_order_amount, v_total / 6,
        v_calc.stockout_prevention_qty, v_calc.dos_required_qty, v_calc.selected_qty, v_calc.selection_reason,
        v_calc.effective_moq, v_calc.final_order_qty,
        v_calc.projected_month_end_qty, v_calc.projected_dos_days, v_calc.projected_inventory_value,
        case when v_unavailable then 'CALCULATION_UNAVAILABLE' else 'CALCULATED' end, v_reasons[1], v_reasons
      );

      v_start := case when v_unavailable then null else v_calc.projected_month_end_qty end;
    end loop;
  end loop;

  insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, payload)
  select v_plan_id, 'BUILT', null, 'DRAFT', v_actor, v_actor_name,
         jsonb_build_object(
           'version', v_version, 'forecast_run_id', v_run.run_id, 'source_status', v_source_status,
           'planning_cycle_id', v_cycle_id, 'n_items', count(distinct l.item_id), 'n_lines', count(l.line_id),
           'n_unavailable_lines', count(l.line_id) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE')
         )
    from core.procurement_plan_line l
   where l.plan_id = v_plan_id;

  return v_plan_id;
end;
$$;

comment on function core.build_procurement_plan(date, uuid) is
  'Task 9b — 기준월 발주계획 새 버전 계산(PLAN_CONFIRM). 입력값을 라인에 스냅샷하고, 같은 달 작업본은 SUPERSEDED로 대체한다. '
  'p_forecast_run_id가 null이면 최신 SUCCESS 실행을 쓴다';


-- ══ 6. 확정 — SCM 품목담당자(PLAN_CONFIRM) ═══════════════════════

create or replace function core.confirm_procurement_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_plan core.procurement_plan%rowtype;
  v_n_lines integer;
  v_blockers jsonb;
  v_approval_id uuid;
  v_payload jsonb;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 발주계획을 확정할 수 있습니다.' using errcode = '42501';
  end if;
  if not core.has_permission('PLAN_CONFIRM', v_actor) then
    raise exception '발주계획 확정 권한(PLAN_CONFIRM)이 없습니다.' using errcode = '42501';
  end if;

  select * into v_plan from core.procurement_plan where plan_id = p_plan_id for update;
  if not found then
    raise exception '발주계획을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_plan.status not in ('DRAFT', 'REJECTED') then
    raise exception '확정할 수 있는 상태가 아닙니다(현재 %).', v_plan.status using errcode = '22023';
  end if;
  v_actor_name := core.order_actor_name(v_actor);

  select count(*) into v_n_lines from core.procurement_plan_line where plan_id = p_plan_id;

  -- 화면이 보여주는 차단 사유(analytics.v_procurement_plan_blocker)와 같은 판정을 쓴다
  select coalesce(
           jsonb_agg(jsonb_build_object('reason_code', b.reason_code, 'line_count', b.line_count, 'item_count', b.item_count)
                     order by b.reason_rank, b.reason_code),
           '[]'::jsonb)
    into v_blockers
    from analytics.v_procurement_plan_blocker b
   where b.plan_id = p_plan_id;

  if v_n_lines = 0 then
    v_blockers := jsonb_build_array(jsonb_build_object('reason_code', 'PLAN_HAS_NO_LINES', 'line_count', 0, 'item_count', 0));
  end if;

  if jsonb_array_length(v_blockers) > 0 then
    insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, payload)
    values (p_plan_id, 'CONFIRM_BLOCKED', v_plan.status, v_plan.status, v_actor, v_actor_name,
            jsonb_build_object('blocking_reasons', v_blockers));
    return jsonb_build_object('status', 'BLOCKED', 'plan_id', p_plan_id, 'blocking_reasons', v_blockers);
  end if;

  update core.procurement_plan
     set status = 'PENDING_APPROVAL', confirmed_by = v_actor, confirmed_by_name = v_actor_name, confirmed_at = clock_timestamp(),
         approval_id = null, decided_by = null, decider_name = null, decided_at = null, decision_comment = null
   where plan_id = p_plan_id;

  select jsonb_build_object(
           'plan_id', p_plan_id, 'plan_month', v_plan.plan_month, 'version', v_plan.version,
           'forecast_run_id', v_plan.forecast_run_id, 'n_items', count(distinct l.item_id),
           'month1_final_order_qty', sum(l.final_order_qty) filter (where l.month_no = 1),
           'month1_projected_inventory_value', sum(l.projected_inventory_value) filter (where l.month_no = 1)
         )
    into v_payload
    from core.procurement_plan_line l
   where l.plan_id = p_plan_id;

  -- Task 2 공통 승인 엔진 — PLAN_CONFIRM으로 요청, PLAN_APPROVE · 요청자 ≠ 승인자는 core.decide_approval이 판정한다
  v_approval_id := core.request_approval(
    'PURCHASE_PLAN', 'PROCUREMENT_PLAN', p_plan_id::text, v_payload, 'PURCHASE_PLAN_CONFIRM',
    format('%s 발주계획 v%s 확정', to_char(v_plan.plan_month, 'YYYY-MM'), v_plan.version)
  );

  update core.procurement_plan set approval_id = v_approval_id where plan_id = p_plan_id;

  insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, approval_id, payload)
  values (p_plan_id, 'CONFIRMED', v_plan.status, 'PENDING_APPROVAL', v_actor, v_actor_name, v_approval_id, v_payload);

  return jsonb_build_object('status', 'PENDING_APPROVAL', 'plan_id', p_plan_id, 'approval_id', v_approval_id);
end;
$$;

comment on function core.confirm_procurement_plan(uuid) is
  'Task 9b — 발주계획 확정(PLAN_CONFIRM). 계산 불가 · 목표 DoS 미승인 라인이 있으면 {status: BLOCKED, blocking_reasons}를 '
  '돌려주고 이력만 남긴다. 통과하면 PURCHASE_PLAN 승인 요청을 만들고 {status: PENDING_APPROVAL, approval_id}를 돌려준다';


-- ══ 7. PURCHASE_PLAN 승인 — 요청 가드 · 결정 훅 · 승인 포장 함수 ═══

create or replace function core.guard_purchase_plan_approval_request()
returns trigger
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
begin
  if new.approval_type <> 'PURCHASE_PLAN' then
    return new;
  end if;
  if new.target_type <> 'PROCUREMENT_PLAN'
     or not exists (
       select 1 from core.procurement_plan p
        where p.plan_id::text = new.target_id and p.status = 'PENDING_APPROVAL' and p.approval_id is null
     ) then
    raise exception '최종 발주계획 승인은 core.confirm_procurement_plan()이 확정한 계획에만 요청할 수 있습니다.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_plan_request_guard on core.approval_request;
create trigger purchase_plan_request_guard
  before insert on core.approval_request
  for each row execute function core.guard_purchase_plan_approval_request();

create or replace function core.apply_procurement_plan_decision()
returns trigger
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_plan core.procurement_plan%rowtype;
begin
  if new.approval_type <> 'PURCHASE_PLAN' or old.status <> 'PENDING' or new.status not in ('APPROVED', 'REJECTED', 'CANCELLED') then
    return new;
  end if;

  select * into v_plan from core.procurement_plan where approval_id = new.approval_id for update;
  if not found then
    raise exception '최종 발주계획 승인과 연결된 계획을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'PENDING_APPROVAL' then
    raise exception '승인 대기 상태가 아닌 발주계획입니다(현재 %).', v_plan.status using errcode = '22023';
  end if;

  if new.status = 'CANCELLED' then
    -- 새 버전 계산이 승인 요청을 취소했다 — 계획은 미확정으로 돌아가고, 호출한 생성 함수가 곧바로 SUPERSEDED로 바꾼다
    update core.procurement_plan set status = 'DRAFT' where plan_id = v_plan.plan_id;
    insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, approval_id, comment)
    values (v_plan.plan_id, 'APPROVAL_CANCELLED', 'PENDING_APPROVAL', 'DRAFT', new.decided_by, new.decider_name,
            new.approval_id, new.decision_comment);
    return new;
  end if;

  -- ★ 최종본은 여기서만 만들어진다(승인 결정과 같은 트랜잭션)
  update core.procurement_plan
     set status = new.status, decided_by = new.decided_by, decider_name = new.decider_name,
         decided_at = new.decided_at, decision_comment = new.decision_comment
   where plan_id = v_plan.plan_id;

  insert into core.procurement_plan_event (plan_id, event_type, previous_status, next_status, actor, actor_name, approval_id, comment)
  values (v_plan.plan_id, new.status, 'PENDING_APPROVAL', new.status, new.decided_by, new.decider_name,
          new.approval_id, new.decision_comment);

  if new.status = 'APPROVED' then
    insert into core.audit_log (actor, action, target_type, target_id, before, after)
    values (new.decided_by, 'PROCUREMENT_PLAN_APPROVED', 'procurement_plan', v_plan.plan_id::text, to_jsonb(v_plan),
            (select to_jsonb(p) from core.procurement_plan p where p.plan_id = v_plan.plan_id));
  end if;

  -- Task 3 공통 결과 알림과 다른 dedupe_key(error.md #23) — 확정자는 두 알림을 모두 받는다
  perform core.enqueue_order_notice(
    'procurement_plan:' || v_plan.plan_id || ':approval:' || new.approval_id || ':decision:' || new.status,
    'PROCUREMENT_PLAN_DECIDED',
    array[new.requested_by],
    jsonb_build_object(
      'title', case new.status when 'APPROVED' then '발주계획이 승인되었습니다(최종본)'
                               else '발주계획이 반려되었습니다' end,
      'message', format('%s 발주계획 v%s · 결과 %s · 팀장 의견: %s',
                        to_char(v_plan.plan_month, 'YYYY-MM'), v_plan.version,
                        case new.status when 'APPROVED' then '승인' else '반려(미확정으로 복귀)' end,
                        coalesce(nullif(btrim(new.decision_comment), ''), '없음')),
      'target_id', v_plan.plan_id::text, 'plan_id', v_plan.plan_id, 'plan_month', v_plan.plan_month,
      'version', v_plan.version, 'decision', new.status, 'decision_comment', new.decision_comment,
      'decider_name', new.decider_name, 'decided_at', new.decided_at
    )
  );

  return new;
end;
$$;

drop trigger if exists procurement_plan_decision_apply on core.approval_request;
create trigger procurement_plan_decision_apply
  after update of status on core.approval_request
  for each row
  when (new.approval_type = 'PURCHASE_PLAN' and old.status = 'PENDING' and new.status <> 'PENDING')
  execute function core.apply_procurement_plan_decision();

-- 계획 화면에서 승인할 때 쓰는 포장 함수. 권한(PLAN_APPROVE) · 요청자 ≠ 승인자 · 상태 전환은 core.decide_approval과
-- 위 훅이 그대로 판정한다 — 여기서는 "이 승인 요청이 이 계획의 것인가"만 확인한다. 반려는 core.decide_approval을 직접 쓴다.
create or replace function core.approve_procurement_plan(p_plan_id uuid, p_approval_id uuid, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_plan core.procurement_plan%rowtype;
begin
  if auth.uid() is null or not core.is_active_user(auth.uid()) then
    raise exception '로그인한 활성 사용자만 발주계획을 승인할 수 있습니다.' using errcode = '42501';
  end if;
  select * into v_plan from core.procurement_plan where plan_id = p_plan_id;
  if not found then
    raise exception '발주계획을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if v_plan.approval_id is distinct from p_approval_id then
    raise exception '이 계획의 승인 요청이 아닙니다.' using errcode = '22023';
  end if;
  if v_plan.status <> 'PENDING_APPROVAL' then
    raise exception '승인 대기 상태가 아닙니다(현재 %).', v_plan.status using errcode = '22023';
  end if;
  return core.decide_approval(p_approval_id, 'APPROVED', p_comment);
end;
$$;


-- ══ 8. 조회 뷰 ════════════════════════════════════════════════════

create or replace view analytics.v_procurement_plan
with (security_invoker = true)
as
select
  p.plan_id, p.plan_month, p.version, p.status, p.horizon_months,
  p.forecast_run_id, p.forecast_train_start, p.forecast_train_end, p.forecast_data_snapshot_at, p.source_status,
  p.built_by, p.built_by_name, p.built_at, p.confirmed_by, p.confirmed_by_name, p.confirmed_at,
  p.approval_id, p.decided_by, p.decider_name, p.decided_at, p.decision_comment,
  p.superseded_by_plan_id, p.superseded_at,
  (p.status = 'APPROVED') as is_final,
  not exists (
    select 1 from core.procurement_plan newer where newer.plan_month = p.plan_month and newer.version > p.version
  ) as is_latest_version,
  (p.status = 'APPROVED' and not exists (
    select 1 from core.procurement_plan newer
     where newer.plan_month = p.plan_month and newer.status = 'APPROVED' and newer.version > p.version
  )) as is_latest_approved,
  coalesce(s.n_items, 0) as n_items,
  coalesce(s.n_lines, 0) as n_lines,
  coalesce(s.n_calculated_lines, 0) as n_calculated_lines,
  coalesce(s.n_unavailable_lines, 0) as n_unavailable_lines,
  coalesce(s.n_target_dos_unset_items, 0) as n_target_dos_unset_items,
  (p.status in ('DRAFT', 'REJECTED') and coalesce(s.n_lines, 0) > 0 and coalesce(s.n_blocking_lines, 0) = 0) as confirmable
from core.procurement_plan p
left join lateral (
  select count(distinct l.item_id) as n_items,
         count(*) as n_lines,
         count(*) filter (where l.calculation_status = 'CALCULATED') as n_calculated_lines,
         count(*) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE') as n_unavailable_lines,
         count(distinct l.item_id) filter (where 'TARGET_DOS_UNSET' = any(l.reason_codes)) as n_target_dos_unset_items,
         count(*) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE' or 'TARGET_DOS_UNSET' = any(l.reason_codes)) as n_blocking_lines
    from core.procurement_plan_line l
   where l.plan_id = p.plan_id
) s on true;

comment on view analytics.v_procurement_plan is
  'Task 9b — 발주계획 버전 목록. is_final = 승인본, is_latest_approved = 그 달의 최신 승인본(Task 10이 읽는다), '
  'confirmable = 확정 가능(미확정이고 차단 라인 0)';

create or replace view analytics.v_procurement_plan_line
with (security_invoker = true)
as
select
  l.line_id, l.plan_id, p.plan_month, p.version, p.status as plan_status, (p.status = 'APPROVED') as is_final,
  l.item_id, l.item_name, l.month_no, l.target_month,
  l.champion_model_id, l.model_version, l.base_forecast_qty, l.department_agreed_qty, l.candidate_source, l.candidate_qty,
  l.flex_min_qty, l.flex_max_qty, l.flex_applied, l.adjusted_demand_qty,
  l.confirmed_order_qty, l.meeting_qty, l.event_qty, l.approved_added_qty, l.demand_qty,
  l.normal_stock_qty, l.allocated_qty, l.available_qty, l.stock_snapshot_at, l.start_stock_qty,
  l.target_dos_days, l.target_dos_approved, l.unit_price, l.moq, l.pack_size, l.min_order_amount, l.avg_usage_6m,
  l.stockout_prevention_qty, l.dos_required_qty, l.selected_qty, l.selection_reason, l.effective_moq, l.final_order_qty,
  l.projected_month_end_qty, l.projected_dos_days, l.projected_inventory_value,
  l.calculation_status, l.reason_code, l.reason_codes, l.created_at
from core.procurement_plan_line l
join core.procurement_plan p on p.plan_id = l.plan_id;

comment on view analytics.v_procurement_plan_line is
  'Task 9b — 계획 라인(계산 단계별 수량 · 입력 스냅샷 · 사유). 화면은 이 값을 다시 계산하지 않고 그대로 보여준다';

-- 계획 기대값 KPI — Task 12가 실제 월말 KPI와 비교할 "계획 쪽" 값이다(실적과 섞지 않고 별도 객체로 둔다).
-- 계산 불가 라인이 하나라도 있는 달은 합계를 만들지 않는다(부분 합계를 전체처럼 보이지 않게).
create or replace view analytics.v_procurement_plan_kpi
with (security_invoker = true)
as
select
  p.plan_id, p.plan_month, p.version, p.status as plan_status, (p.status = 'APPROVED') as is_final,
  l.month_no, l.target_month,
  count(distinct l.item_id) as n_items,
  count(*) filter (where l.calculation_status = 'CALCULATED') as n_calculated_lines,
  count(*) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE') as n_unavailable_lines,
  case when count(*) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE') = 0 then sum(l.final_order_qty) end
    as total_final_order_qty,
  case when count(*) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE') = 0 then sum(l.projected_month_end_qty) end
    as total_projected_month_end_qty,
  case when count(*) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE') = 0 then sum(l.projected_inventory_value) end
    as total_projected_inventory_value,
  case
    when count(*) filter (where l.calculation_status = 'CALCULATED') = 0 then 'CALCULATION_UNAVAILABLE'
    when count(*) filter (where l.calculation_status = 'CALCULATION_UNAVAILABLE') > 0 then 'PARTIAL_CALCULATION'
  end as kpi_reason_code
from core.procurement_plan p
join core.procurement_plan_line l on l.plan_id = p.plan_id
group by p.plan_id, p.plan_month, p.version, p.status, l.month_no, l.target_month;

comment on view analytics.v_procurement_plan_kpi is
  'Task 9b — 계획 · 월별 기대값 합계(발주량 · 예상 월말재고 · 예상 재고금액). 계산 불가 라인이 있으면 합계 null + kpi_reason_code';

create or replace view analytics.v_procurement_plan_event
with (security_invoker = true)
as
select e.event_id, e.plan_id, e.event_type, e.previous_status, e.next_status, e.actor, e.actor_name,
       e.approval_id, e.comment, e.payload, e.at
from core.procurement_plan_event e;

-- 확정 차단 사유(컨트롤러 판정 6) — 계산 불가 라인 또는 목표 DoS 미승인 라인의 사유별 라인 · 품목 수.
-- core.confirm_procurement_plan이 이 뷰를 그대로 읽는다(화면과 확정 판정이 같은 값을 쓴다). 라인이 0건인 계획의
-- PLAN_HAS_NO_LINES는 확정 함수가 따로 더한다. reason_rank = lib/procurement/model.ts PLAN_REASON_PRIORITY 순서.
create or replace view analytics.v_procurement_plan_blocker
with (security_invoker = true)
as
select
  l.plan_id,
  u.code as reason_code,
  count(*) as line_count,
  count(distinct l.item_id) as item_count,
  coalesce(array_position(array[
    'FORECAST_SOURCE_UNVERIFIED', 'FORECAST_WINDOW_CHANGED', 'FORECAST_INPUT_UNTRACED', 'FORECAST_INPUT_CHANGED',
    'CHAMPION_UNAVAILABLE', 'BASE_FORECAST_UNAVAILABLE', 'AVG_USAGE_UNAVAILABLE', 'INVENTORY_SCOPE_UNCLASSIFIED',
    'AVAILABLE_STOCK_UNAVAILABLE',
    'PRIOR_MONTH_UNAVAILABLE', 'ITEM_POLICY_MISSING', 'UNIT_PRICE_UNSET', 'TARGET_DOS_UNSET'
  ]::text[], u.code), 99) as reason_rank
from core.procurement_plan_line l
cross join lateral unnest(l.reason_codes) as u(code)
where (l.calculation_status = 'CALCULATION_UNAVAILABLE' or 'TARGET_DOS_UNSET' = any(l.reason_codes))
  and u.code <> 'AVG_USAGE_ZERO'
group by l.plan_id, u.code;


-- ══ 9. RLS와 실행 권한 ════════════════════════════════════════════

alter table core.procurement_plan enable row level security;
alter table core.procurement_plan_line enable row level security;
alter table core.procurement_plan_event enable row level security;

drop policy if exists procurement_plan_read on core.procurement_plan;
create policy procurement_plan_read on core.procurement_plan
  for select to authenticated
  using (core.has_permission('PLAN_CONFIRM') or core.has_permission('PLAN_APPROVE') or core.is_admin());

drop policy if exists procurement_plan_line_read on core.procurement_plan_line;
create policy procurement_plan_line_read on core.procurement_plan_line
  for select to authenticated
  using (exists (select 1 from core.procurement_plan p where p.plan_id = procurement_plan_line.plan_id));

drop policy if exists procurement_plan_event_read on core.procurement_plan_event;
create policy procurement_plan_event_read on core.procurement_plan_event
  for select to authenticated
  using (exists (select 1 from core.procurement_plan p where p.plan_id = procurement_plan_event.plan_id));

revoke all on core.procurement_plan, core.procurement_plan_line, core.procurement_plan_event from anon, public;
revoke insert, update, delete on core.procurement_plan, core.procurement_plan_line, core.procurement_plan_event from authenticated;
grant select on core.procurement_plan, core.procurement_plan_line, core.procurement_plan_event to authenticated;

revoke all on analytics.v_procurement_plan, analytics.v_procurement_plan_line, analytics.v_procurement_plan_kpi,
  analytics.v_procurement_plan_event, analytics.v_procurement_plan_blocker from anon, public;
grant select on analytics.v_procurement_plan, analytics.v_procurement_plan_line, analytics.v_procurement_plan_kpi,
  analytics.v_procurement_plan_event, analytics.v_procurement_plan_blocker to authenticated;

revoke all on function core.build_procurement_plan(date, uuid) from public, anon;
grant execute on function core.build_procurement_plan(date, uuid) to authenticated;
revoke all on function core.confirm_procurement_plan(uuid) from public, anon;
grant execute on function core.confirm_procurement_plan(uuid) to authenticated;
revoke all on function core.approve_procurement_plan(uuid, uuid, text) from public, anon;
grant execute on function core.approve_procurement_plan(uuid, uuid, text) to authenticated;

revoke all on function core.calculate_procurement_plan_month(integer, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric)
  from public, anon, authenticated;
revoke all on function core.procurement_forecast_source_status(uuid) from public, anon, authenticated;
revoke all on function core.usage_input_fingerprint(text) from public, anon, authenticated;
revoke all on function core.record_forecast_run_input_fingerprint() from public, anon, authenticated;
revoke all on function core.record_backtest_run_input_fingerprint() from public, anon, authenticated;
revoke all on function core.guard_procurement_plan_mutation() from public, anon, authenticated;
revoke all on function core.guard_procurement_plan_line_mutation() from public, anon, authenticated;
revoke all on function core.reject_procurement_plan_event_mutation() from public, anon, authenticated;
revoke all on function core.guard_purchase_plan_approval_request() from public, anon, authenticated;
revoke all on function core.apply_procurement_plan_decision() from public, anon, authenticated;


-- ══ 10. 수동 적용 후 확인 쿼리(SQL Editor 전용 — 주석을 풀어 실행) ══════

-- (a) 현재 Forecast Run의 원천 판정 · 입력 지문. 5회차 더미 사용 이력(batch_id null)만 있으면 FORECAST_SOURCE_UNVERIFIED,
--     이 마이그레이션 전에 끝난 실행은 지문이 없어(train_input_md5 null) 출처가 검증돼도 FORECAST_INPUT_UNTRACED가 정상이다.
-- select r.run_id, r.status, r.train_start, r.train_end, r.train_input_row_count, r.train_input_md5,
--        core.procurement_forecast_source_status(r.run_id)
--   from core.forecast_run r order by r.started_at desc limit 5;
-- select b.backtest_run_id, b.forecast_run_id, b.test_input_row_count, b.test_input_md5 from core.backtest_run b order by b.started_at desc limit 5;

-- (b) 출처 없는 학습 · test 기간 행 수(둘 다 0이 되기 전에는 발주량이 계산되지 않는다).
-- select split, count(*) as unverified_rows
--   from (select 'TRAIN' as split, batch_id, source_type from core.v_train_demand
--         union all select 'TEST', batch_id, source_type from core.v_test_actual) t
--   left join core.upload_batch b on b.batch_id = t.batch_id
--  where b.batch_id is null or b.status <> 'IMPORTED' or b.import_type <> 'usage_history' or t.source_type is distinct from 'FILE_UPLOAD'
--  group by split;

-- (b-1) 승인된 정책 값 — 직접 넣은 운영값만 있고 승인값이 없는 품목(발주계획은 승인값만 쓴다).
-- select item_id, target_dos_days, approved_target_dos_days, unit_price, approved_unit_price, unit_price_reason_code,
--        moq, approved_moq, approved_effective_moq, target_stock_qty, approved_target_stock_qty, target_stock_reason_code
--   from analytics.v_item_policy order by item_id;

-- (c) 한 달 계산 손검산(7번째 인자는 6개월 합) — 필요량 120 · MOQ 50 → 150, MOQ null → 1, 반복소수 평균에서도 정수 필요량.
-- select selected_qty, selection_reason, effective_moq, final_order_qty, projected_month_end_qty, projected_dos_days
--   from core.calculate_procurement_plan_month(1, 100, null, 0, 80, 30, 600, 50, 1000);
-- 기대: 120 · DOS_TARGET · 50 · 150 · 130 · 39
-- select effective_moq, final_order_qty from core.calculate_procurement_plan_month(1, 100, null, 0, 80, 30, 603, null, 1000);
-- 기대: 1 · 121
-- select dos_required_qty, final_order_qty from core.calculate_procurement_plan_month(4, 75, null, 0, 0, 45, 100, null, 1);
-- 기대: 100 · 100 (평균 16.666…이어도 101이 아니다)
-- select flex_min_qty, flex_max_qty, adjusted_demand_qty, flex_applied, demand_qty
--   from core.calculate_procurement_plan_month(1, 100, 150, 50, 1000, 30, 600, null, 200);
-- 기대: 80 · 120 · 120 · true · 170

-- (d) 계획 목록과 확정 가능 여부(SCM 품목담당자 계정으로 로그인해 실행).
-- select plan_month, version, status, source_status, n_lines, n_unavailable_lines, confirmable, is_final, is_latest_approved
--   from analytics.v_procurement_plan order by plan_month desc, version desc;

-- (e) 계산 불가 사유 분포.
-- select reason_code, count(*) from analytics.v_procurement_plan_line where plan_id = '<plan_id>' group by reason_code;

-- (f) 트리거 실행 순서 확인(error.md #23) — 도메인 결과 알림은 공통 알림과 다른 dedupe_key를 쓴다.
-- select tgname from pg_trigger where tgrelid = 'core.approval_request'::regclass and not tgisinternal order by tgname;

-- (g) 뷰 security_invoker 확인.
-- select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'analytics' and c.relname like 'v_procurement_plan%';
-- 기대: 다섯 뷰(plan · line · kpi · event · blocker) 모두 security_invoker=true
