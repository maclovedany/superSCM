-- ★ 영업 가림막 — analytics.v_sku_detail (아래 뷰들을 통해 간접적으로) 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- STEP 13 · Approval Workflow + 근거 Snapshot + Decision History
--
-- renew.prd 23장
--   "추천 확인 → 필요시 수정 → 수정 사유 입력 → 승인"                        (23)
--   "recommendation_id · recommended_qty · approved_qty · adjustment
--    reason_code · reason_text · approved_by · approved_at"                  (23.1)
--   "승인 시점의 계산 근거를 함께 저장한다.
--    Forecast · Inventory · Open PO · Lead Time · Safety Stock
--    model_version · run_id · data_snapshot_at
--    이후 데이터가 바뀌어도 당시 무엇을 보고 결정했는지 재현할 수 있어야 한다."  (23.2)
-- renew.prd 31.2  "모든 Forecast·Recommendation·Override·Approval 은
--                  run_id 또는 version 기준으로 추적 가능해야 한다."
-- renew.prd 32    "추천과 승인 분리 — AI 가 추천하고 사람이 최종 승인한다."
--                 "모든 추천에 근거 저장 — Recommendation Snapshot 을 보존한다."
--
-- 여기서 만드는 것
--   core       approval                       승인 · 반려 · 보류 이력 + 근거 Snapshot
--   core       approval_reason_label()        승인 사유 코드의 한국어 라벨
--   core       decision_label()               결정의 한국어 라벨
--   core       override_reason_label()        보정 사유 코드의 한국어 라벨 (결정 이력 요약용)
--   core       approve_recommendation()       승인 입력 (로그인 사용자 누구나 · renew.prd 4.3)
--   analytics  v_approval                     승인 목록 (snapshot 제외 — 무겁습니다)
--   analytics  v_approval_snapshot            approval_id · snapshot (재조회 전용)
--   analytics  v_sku_detail ★                 sql/16 의 정의를 옮겨 오고 승인 컬럼을 더합니다
--   analytics  v_purchase_recommendation_with_approval ★  발주 추천 + 승인 상태
--   analytics  v_decision_history             승인 · 보정 · Champion · 리드타임 통합 이력
--   analytics  v_approval_kpi                 승인 요약 한 줄
--
-- ★ sql/18-forecast-override.sql 까지 먼저 실행하세요.
--   analytics.v_purchase_recommendation · v_sku_detail · v_safety_stock 은 sql/16 이,
--   analytics.v_forecast_override 는 sql/18 이, core.leadtime_plan_history 는 sql/15 가,
--   core.champion_model 은 sql/13 이 이미 만들었습니다.
--
-- ★ analytics.v_sku_detail 의 최종 정의는 이 파일에 있습니다.
--   sql/16 의 정의는 그대로 두었습니다 — 이 파일을 실행하면 그 위에 덮어씁니다.
--   뷰는 자기 자신을 참조할 수 없어(`select d.* from analytics.v_sku_detail d`)
--   승인 컬럼을 덧붙이려면 정의 본문을 옮겨 오는 수밖에 없습니다.
--
-- ★★ sql/16 을 다시 실행한 뒤에는 **반드시 이 파일을 이어서 실행하세요.**
--   승인 컬럼이 조용히 사라지는 정도가 아닙니다. sql/16 은 이 파일이 만든
--   v_approval_kpi · v_purchase_recommendation_with_approval 을 먼저 지운 뒤에야
--   v_purchase_recommendation 을 다시 만들 수 있어(그러지 않으면 "cannot drop … because
--   other objects depend on it" 로 멈춥니다), 실행이 끝난 시점에는 그 두 뷰와
--   v_sku_detail 의 승인 컬럼이 **모두 없는 상태**입니다.
--   그대로 두면 발주 추천 화면과 결정 이력 화면이 조회 실패로 죽습니다.
--   (sql/16 §3 의 drop 목록에 그 두 줄을 넣어 두었습니다.)
--
-- ★ analytics.v_purchase_recommendation 은 건드리지 않습니다.
--   승인 컬럼이 필요한 화면은 새 뷰 v_purchase_recommendation_with_approval 을 읽습니다.
--   기존 뷰를 읽는 CSV 라우트 · STEP 16 · STEP 19 의 이름이 바뀌지 않습니다.
--
-- ★★ 다시 실행할 때 (재실행 규칙) — 반드시 읽으세요
--
--   이 파일의 `drop view` 는 전부 **cascade** 입니다. cascade 가 없으면 뒤 번호
--   파일이 이 파일의 뷰 위에 뷰를 만들어 둔 순간부터
--   "cannot drop … because other objects depend on it" 으로 재실행 자체가
--   막혔습니다. 그래서 cascade 를 붙였습니다.
--
--   대신 값을 치릅니다. cascade 는 **뒤 파일이 만든 뷰까지 말없이 함께 지웁니다.**
--   analytics.v_approval_kpi 를 지우면 sql/21 의 v_dashboard_kpi 가,
--   analytics.v_approval 을 지우면 sql/21 의 v_dashboard_recent_approvals 가
--   같이 사라집니다.
--
--   그래서 규칙은 하나뿐입니다.
--
--       이 파일을 다시 실행했으면, 이 파일보다 번호가 큰 파일을 전부
--       순서대로 다시 실행하세요. (순서는 sql/README.md)
--
--   빠뜨리면 오류는 나지 않고 화면만 조용히 비어 보입니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. 테이블 ══════════════════════════════════════════════════
--
-- renew.prd 23.1 의 필드에 status 와 snapshot 을 더했습니다.
--
-- ★ recommended_qty 는 사람이 보낸 값이 아니라 승인 시점의 추천값을 함수가 직접 읽어
--   저장합니다. 화면이 보낸 숫자를 그대로 믿으면 "AI 는 1,000 을 추천했다" 는 기록이
--   조작될 수 있습니다 (sql/18 의 set_forecast_override 와 같은 원칙).
--
-- ★ 행을 지우거나 덮어쓰지 않습니다. 같은 품목에 새 결정이 오면 이전 행을 SUPERSEDED 로
--   바꾸고 새 행을 넣습니다. 결정 이력이 남아야 renew.prd 31.2 의 추적성이 성립합니다.
create table if not exists core.approval (
  approval_id           bigserial primary key,
  item_id               text not null,
  -- 승인의 근거가 된 예측 실행. renew.prd 31.2 의 "run_id 기준 추적" 입니다.
  recommendation_run_id text,
  -- 승인 시점의 AI 추천 수량. 산출 불가였다면 null 입니다 (0 으로 채우지 않습니다).
  recommended_qty       numeric,
  approved_qty          numeric,
  -- approved − recommended. 추천이 null 이면 조정량도 null 입니다.
  adjustment            numeric,
  decision              text not null
                        check (decision in ('APPROVED', 'REJECTED', 'DEFERRED')),
  -- renew.prd 23.1 — 사유는 코드 체계로 저장합니다. 라벨은 core.approval_reason_label().
  reason_code           text not null
                        check (reason_code in ('AS_RECOMMENDED', 'BUDGET', 'SUPPLIER_CAPACITY',
                                               'LEAD_TIME', 'DEMAND_INFO', 'DATA_ERROR', 'OTHER')),
  reason_text           text,
  -- renew.prd 23.2 — 승인 시점의 계산 근거 전부. 아래 approve_recommendation() 이 조립합니다.
  snapshot              jsonb not null,
  approved_by           uuid references auth.users(id) on delete set null,
  approved_email        text,
  approved_at           timestamptz not null default now(),
  status                text not null default 'ACTIVE'
                        check (status in ('ACTIVE', 'SUPERSEDED'))
);

comment on table core.approval is
  'renew.prd 23장 — 발주 추천에 대한 사람의 최종 결정과 그때의 근거 Snapshot';

comment on column core.approval.snapshot is
  'renew.prd 23.2 — 승인 시점의 추천 · SKU 요약 · 재고 전개 · Consensus · 안전재고 · 리드타임 · Champion';

-- 한 품목에 ACTIVE 결정은 하나뿐입니다.
-- 두 사람이 동시에 승인하면 나중에 커밋하는 쪽이 여기 걸리고,
-- 함수가 그것을 잡아 한국어 안내로 바꿉니다 (sql/18 과 같은 방식).
create unique index if not exists approval_active_idx
  on core.approval(item_id) where status = 'ACTIVE';

create index if not exists approval_item_idx
  on core.approval(item_id, approved_at desc);

create index if not exists approval_at_idx
  on core.approval(approved_at desc);

-- ══ 2. 표시 함수 ═══════════════════════════════════════════════
--
-- 결정 이력의 요약 한 줄을 SQL 이 조립합니다 (sql/16 의 explanation 과 같은 이유).
-- 화면 · CSV · AI Agent · API 가 같은 문장을 쓰려면 한 곳에서 만들어야 합니다.

-- renew.prd 23.1 의 사유 코드 7종.
-- ★ lib/approval-model.ts 의 APPROVAL_REASON_CODES 와 같은 문구여야 합니다.
--   lib/approval.test.ts 가 그 목록을 검사합니다.
create or replace function core.approval_reason_label(p_code text)
returns text
language sql
immutable
as $$
  select case p_code
           when 'AS_RECOMMENDED'     then '추천대로'
           when 'BUDGET'             then '예산 제약'
           when 'SUPPLIER_CAPACITY'  then '공급처 생산능력'
           when 'LEAD_TIME'          then '리드타임 변동'
           when 'DEMAND_INFO'        then '현장 수요 정보'
           when 'DATA_ERROR'         then '데이터 오류'
           when 'OTHER'              then '기타'
           else p_code
         end;
$$;

create or replace function core.decision_label(p_decision text)
returns text
language sql
immutable
as $$
  select case p_decision
           when 'APPROVED' then '승인'
           when 'REJECTED' then '반려'
           when 'DEFERRED' then '보류'
           else p_decision
         end;
$$;

-- renew.prd 17.2 의 보정 사유 코드 8종.
-- ★ lib/override-model.ts 의 REASON_CODES 와 같은 문구여야 합니다.
--   결정 이력의 요약 문장이 영문 코드로 새지 않게 하려고 여기 둡니다 (design.md §12).
--   lib/approval.test.ts 가 두 목록이 같은지 검사합니다.
create or replace function core.override_reason_label(p_code text)
returns text
language sql
immutable
as $$
  select case p_code
           when 'NEW_CONTRACT'   then '신규 계약'
           when 'PROMOTION'      then '프로모션'
           when 'NEW_PRODUCT'    then '신제품 출시'
           when 'DISCONTINUED'   then '단종'
           when 'PROJECT'        then '프로젝트성 수요'
           when 'MARKET_CHANGE'  then '시장 변화'
           when 'DATA_ERROR'     then '데이터 오류 보정'
           when 'OTHER'          then '기타'
           else p_code
         end;
$$;

revoke all on function core.approval_reason_label(text) from public, anon;
revoke all on function core.decision_label(text)        from public, anon;
revoke all on function core.override_reason_label(text) from public, anon;
grant execute on function core.approval_reason_label(text) to authenticated;
grant execute on function core.decision_label(text)        to authenticated;
grant execute on function core.override_reason_label(text) to authenticated;

-- ══ 3. 함수 — 승인 ═════════════════════════════════════════════
--
-- renew.prd 4.3 · 32 — 담당자(USER)가 승인합니다. 관리자 전용이 아닙니다.
--
-- ★ Snapshot 은 이 함수 안에서 뷰를 to_jsonb 로 담아 만듭니다.
--   화면이 근거를 보내오게 하면 "그때 무엇을 보고 결정했나" 가 사람이 고칠 수 있는 값이 됩니다.
--
-- ★ 반환 컬럼 approval_id 는 함수 안에서 변수가 됩니다. 같은 이름의 테이블 컬럼을
--   한정하지 않고 쓰면 "column reference is ambiguous" 로 멈춥니다 (error.md #11).
--   그래서 insert 에 별칭(as ap)을 붙이고, 안에서 쓰는 값은 전부 v_ 로 시작하는 변수입니다.

create or replace function core.approve_recommendation(
  p_item_id      text,
  p_approved_qty numeric,
  p_decision     text,
  p_reason_code  text,
  p_reason_text  text
)
returns table (ok boolean, approval_id bigint, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid           uuid := auth.uid();
  v_email         text;
  v_recommended   numeric;
  v_run_id        text;
  v_snapshot_at   timestamptz;
  v_supplier_id   text;
  v_approved      numeric;
  v_adjustment    numeric;
  v_reason_text   text;
  v_model_version text;
  v_rec           jsonb;
  v_sku           jsonb;
  v_projection    jsonb;
  v_consensus     jsonb;
  v_safety        jsonb;
  v_leadtime      jsonb;
  v_champion      jsonb;
  v_snapshot      jsonb;
  v_new_id        bigint;
  v_found         boolean := false;
begin
  -- renew.prd 4.3 — 로그인한 사용자 누구나 승인할 수 있습니다.
  if v_uid is null then
    return query select false, null::bigint, '로그인이 필요합니다'::text;
    return;
  end if;

  if p_item_id is null or btrim(p_item_id) = '' then
    return query select false, null::bigint, '품목을 선택해주세요'::text;
    return;
  end if;

  if p_decision is null or p_decision not in ('APPROVED', 'REJECTED', 'DEFERRED') then
    return query select false, null::bigint, '결정을 선택해주세요'::text;
    return;
  end if;

  if p_reason_code is null or p_reason_code not in
       ('AS_RECOMMENDED', 'BUDGET', 'SUPPLIER_CAPACITY',
        'LEAD_TIME', 'DEMAND_INFO', 'DATA_ERROR', 'OTHER') then
    return query select false, null::bigint, '사유 코드를 확인해주세요'::text;
    return;
  end if;

  -- renew.prd 23.1 — 기타 를 고르면 무엇이 기타인지 적어야 집계가 가능합니다.
  if p_reason_code = 'OTHER' and (p_reason_text is null or btrim(p_reason_text) = '') then
    return query select false, null::bigint, '기타 를 고르면 사유를 직접 적어야 합니다'::text;
    return;
  end if;

  -- 추천이 없는 품목은 승인할 것이 없습니다.
  -- 이 조회가 추천 수량 · run_id · 기준 시각의 출처입니다 — 화면이 보낸 값을 믿지 않습니다.
  select pr.final_recommended_qty, pr.run_id, pr.data_snapshot_at, pr.supplier_id
    into v_recommended, v_run_id, v_snapshot_at, v_supplier_id
    from analytics.v_purchase_recommendation pr
   where pr.item_id = p_item_id
   limit 1;

  if not found then
    return query select false, null::bigint,
      '이 품목의 발주 추천이 없습니다. 발주 추천 화면에서 먼저 확인해주세요'::text;
    return;
  end if;

  -- 반려 · 보류는 수량을 0 으로 둡니다 (renew.prd 23.1 의 approved_qty).
  --
  -- ★ 보낸 값을 쓰지 않고 0 을 강제합니다. coalesce(p_approved_qty, 0) 로 두면
  --   화면이 추천 수량을 그대로 담아 보냈을 때 "1,000 을 반려했는데 승인 수량 1,000"
  --   으로 남습니다. 조정량도 0 이 되어 이력이 '반려 · 수량 1,000 · 추천 1,000' 으로
  --   읽히고, ACTIVE 행의 approved_qty 를 합산하는 뒤 단계가 아무도 승인하지 않은
  --   수량을 셉니다. 반려 · 보류는 "이만큼 승인했다" 가 없는 결정입니다.
  if p_decision = 'APPROVED' then
    if p_approved_qty is null then
      return query select false, null::bigint, '승인 수량을 입력해주세요'::text;
      return;
    end if;
    if p_approved_qty < 0 then
      return query select false, null::bigint, '승인 수량은 0 보다 작을 수 없습니다'::text;
      return;
    end if;
    v_approved := p_approved_qty;
  else
    v_approved := 0;
  end if;

  -- adjustment = 승인 − 추천. 추천을 산출하지 못한 품목은 조정량도 모릅니다 (0 이 아닙니다).
  if v_recommended is null then
    v_adjustment := null;
  else
    v_adjustment := v_approved - v_recommended;
  end if;

  -- renew.prd 23 — "필요시 수정 → 수정 사유 입력".
  -- '추천대로' 는 추천 수량을 그대로 승인했을 때만 쓸 수 있습니다.
  if p_reason_code = 'AS_RECOMMENDED' then
    if p_decision <> 'APPROVED' then
      return query select false, null::bigint,
        '추천대로 는 승인일 때만 고를 수 있습니다. 반려 · 보류 사유를 골라주세요'::text;
      return;
    end if;
    if v_recommended is null then
      return query select false, null::bigint,
        ('이 품목은 추천 수량을 산출하지 못했습니다. 추천대로 대신 다른 사유를 골라주세요')::text;
      return;
    end if;
    if v_adjustment <> 0 then
      return query select false, null::bigint,
        ('추천 ' || core.fmt_qty(v_recommended) || ' 와 승인 ' || core.fmt_qty(v_approved) ||
         ' 가 다릅니다. 수정한 사유를 골라주세요')::text;
      return;
    end if;
  end if;

  select au.email into v_email
    from core.app_user au
   where au.user_id = v_uid;

  -- ── renew.prd 23.2 — 근거 Snapshot ────────────────────────────
  --
  -- 뷰 한 행을 통째로 담습니다. 컬럼을 골라 담으면 뷰가 넓어질 때마다 여기도 고쳐야 하고,
  -- 고치는 것을 잊으면 "그때 무엇을 보고 결정했나" 에서 항목이 조용히 빠집니다.
  select to_jsonb(pr) into v_rec
    from analytics.v_purchase_recommendation pr
   where pr.item_id = p_item_id;

  select to_jsonb(sd) into v_sku
    from analytics.v_sku_detail sd
   where sd.item_id = p_item_id;

  select jsonb_agg(to_jsonb(ip) order by ip.period) into v_projection
    from analytics.v_inventory_projection ip
   where ip.item_id = p_item_id;

  select jsonb_agg(to_jsonb(cf) order by cf.period) into v_consensus
    from analytics.v_consensus_forecast cf
   where cf.item_id = p_item_id;

  select to_jsonb(ss) into v_safety
    from analytics.v_safety_stock ss
   where ss.item_id = p_item_id;

  -- 리드타임은 품목이 아니라 공급처에 붙습니다. 공급처를 모르면 null 입니다.
  if v_supplier_id is not null then
    select to_jsonb(lp) into v_leadtime
      from analytics.v_leadtime_policy lp
     where lp.supplier_id = v_supplier_id;
  end if;

  select to_jsonb(cm), cm.model_version into v_champion, v_model_version
    from analytics.v_champion_model cm
   where cm.item_id = p_item_id;

  -- renew.prd 23.2 의 항목 그대로입니다.
  -- captured_at 은 Snapshot 을 뜬 시각, data_snapshot_at 은 그 계산이 본 데이터의 기준 시각입니다.
  v_snapshot := jsonb_build_object(
    'recommendation',   v_rec,
    'sku_detail',       v_sku,
    'projection',       coalesce(v_projection, '[]'::jsonb),
    'consensus',        coalesce(v_consensus, '[]'::jsonb),
    'safety_stock',     v_safety,
    'leadtime',         v_leadtime,
    'champion',         v_champion,
    'run_id',           v_run_id,
    'model_version',    v_model_version,
    'data_snapshot_at', v_snapshot_at,
    'captured_at',      now()
  );

  v_reason_text := nullif(btrim(coalesce(p_reason_text, '')), '');

  -- 이전 ACTIVE 결정을 대체하고 새 결정을 넣습니다.
  -- 부분 유니크 인덱스가 있어 update 가 먼저여야 합니다.
  --
  -- 두 사람이 같은 품목을 동시에 결정하면 위 update 가 각자의 트랜잭션에서만 보이므로,
  -- 나중에 커밋하는 쪽의 insert 가 부분 유니크 인덱스에 걸립니다.
  -- Postgres 원문을 사용자에게 보이지 않습니다.
  --
  -- ★ update 를 이 블록 안에 둡니다. 밖에 두면 insert 가 걸렸을 때 insert 의 하위
  --   트랜잭션만 되돌아가고 update 는 남아, 그 품목에 ACTIVE 결정이 하나도 없는 상태가
  --   이론적으로 가능해집니다. 둘을 한 블록에 두면 실패할 때 함께 되돌아갑니다.
  begin
    update core.approval ap
       set status = 'SUPERSEDED'
     where ap.item_id = p_item_id
       and ap.status  = 'ACTIVE';

    v_found := found;

    insert into core.approval as ap
      (item_id, recommendation_run_id, recommended_qty, approved_qty, adjustment,
       decision, reason_code, reason_text, snapshot, approved_by, approved_email)
    values
      (p_item_id, v_run_id, v_recommended, v_approved, v_adjustment,
       p_decision, p_reason_code, v_reason_text, v_snapshot, v_uid, v_email)
    returning ap.approval_id into v_new_id;
  exception
    when unique_violation then
      return query select false, null::bigint,
        '방금 다른 사람이 이 품목을 결정했습니다. 새로고침 후 다시 확인해주세요'::text;
      return;
  end;

  -- ★ 숫자 바로 뒤에 조사를 붙이지 않습니다 (sql/16 의 explanation 과 같은 규칙).
  --   '항목 값 · 항목 값 → 결과' 골격만 씁니다.
  return query select true, v_new_id,
    (core.decision_label(p_decision)
     || ' · 수량 ' || core.fmt_qty(v_approved)
     || ' · 추천 ' || core.fmt_qty(v_recommended)
     || case when v_adjustment is null or v_adjustment = 0 then ''
             else ' · 조정 ' || case when v_adjustment > 0 then '+' else '' end
                  || core.fmt_qty(v_adjustment) end
     || ' · 사유 ' || core.approval_reason_label(p_reason_code)
     || case when v_found then ' — 이전 결정을 대체했습니다' else ' — 저장했습니다' end)::text;
end;
$$;

revoke all on function core.approve_recommendation(text, numeric, text, text, text)
  from public, anon;
grant execute on function core.approve_recommendation(text, numeric, text, text, text)
  to authenticated;

comment on function core.approve_recommendation(text, numeric, text, text, text) is
  'renew.prd 23장 — 사람이 최종 결정하고, 그 시점의 계산 근거를 Snapshot 으로 함께 남깁니다';

-- ══ 4. analytics 뷰 ════════════════════════════════════════════
--
-- 의존 역순으로 먼저 지웁니다 (공통규칙 15 — create or replace 로는 컬럼을 더할 수 없습니다).

drop view if exists analytics.v_approval_kpi cascade;
drop view if exists analytics.v_decision_history cascade;
drop view if exists analytics.v_purchase_recommendation_with_approval cascade;
drop view if exists analytics.v_approval_snapshot cascade;
drop view if exists analytics.v_approval cascade;
drop view if exists analytics.v_sku_detail cascade;

-- ── 4-1. 승인 목록 ────────────────────────────────────────────
--
-- snapshot 은 뺐습니다. 품목 하나의 Snapshot 이 수십 KB 라 목록에 실으면 화면이 느려집니다.
-- 다시 볼 때는 아래 v_approval_snapshot 을 approval_id 로 한 행만 읽습니다.
create view analytics.v_approval as
select a.approval_id,
       a.item_id,
       im.item_name,
       -- 공급처는 품목 마스터에서 읽습니다. v_purchase_recommendation 을 조인하면
       -- 목록 한 줄을 그리려고 발주 추천 전체를 다시 계산하게 됩니다.
       im.supplier_id,
       a.recommendation_run_id,
       a.recommended_qty,
       a.approved_qty,
       a.adjustment,
       a.decision,
       a.reason_code,
       a.reason_text,
       a.approved_by,
       a.approved_email,
       a.approved_at,
       a.status,
       -- 화면이 status 문자열을 다시 비교하지 않도록 뷰가 판정합니다.
       (a.status = 'ACTIVE') as is_active
  from core.approval a
  left join core.v_item_master im on im.item_id = a.item_id;

comment on view analytics.v_approval is
  'renew.prd 23.1 — 승인 · 반려 · 보류 이력. snapshot 은 v_approval_snapshot 에서 따로 읽습니다';

-- ── 4-2. 근거 Snapshot 재조회 ─────────────────────────────────
--
-- renew.prd 23.2 · 31.3 — 데이터가 바뀐 뒤에도 그때의 근거를 그대로 돌려줍니다.
-- 이 뷰는 계산하지 않습니다. 저장된 jsonb 를 꺼내 줄 뿐입니다.
create view analytics.v_approval_snapshot as
select a.approval_id,
       a.snapshot
  from core.approval a;

comment on view analytics.v_approval_snapshot is
  'renew.prd 23.2 — 승인 시점의 계산 근거. 화면이 approval_id 로 한 행만 읽습니다';

-- ── 4-3. SKU Detail ★ ─────────────────────────────────────────
--
-- renew.prd 29장 — 28개 항목을 한 흐름으로 보여주는 화면이 읽는 요약 한 줄입니다.
-- 기간별 값(실적 · 예측 · 전개 · Consensus)은 각각의 뷰에서 따로 읽습니다.
--
-- ★ 본문은 sql/16 §4-6 의 정의를 그대로 옮겨 왔습니다. 뒤에 승인 컬럼 5개를 더합니다.
--   뷰는 자기 자신을 참조할 수 없어(create or replace 로 `select d.* from 자기 자신`)
--   컬럼을 덧붙이려면 정의를 옮기는 수밖에 없습니다. sql/16 쪽은 손대지 않았습니다.
create view analytics.v_sku_detail as
select rec.item_id,
       rec.item_name,
       rec.supplier_id,
       rec.supplier_name,
       le.country,
       dp.demand_type,
       ch.champion_model_id,
       ch.model_name        as champion_model_name,
       ch.wape              as champion_wape,
       ch.bias              as champion_bias,
       ch.selection_method  as champion_selection_method,
       rec.run_id           as forecast_run_id,
       sr.forecast_source,
       rec.data_snapshot_at,
       fr.is_stale,
       rec.current_inventory,
       rec.incoming_qty,
       rec.incoming_eta,
       -- 발주 식이 실제로 빼는 값은 전량이 아니라 창(리드타임 + 검토 주기) 안에
       -- 도착하는 몫입니다 (renew.prd 22.1 · sql/16). 근거 표의 뺄셈이 맞아떨어지려면
       -- 화면이 이 세 컬럼을 봐야 합니다.
       rec.incoming_window_end,
       rec.incoming_in_window_qty,
       rec.incoming_after_window_qty,
       -- SKU Detail §4 의 "추천 근거 표" 가 창 수요 → 안전재고 → 현재고 → 입고예정 →
       -- 필요량 순으로 식을 펴야 하는데, 첫 항이 없으면 근거가 끊깁니다 (renew.prd 22.3).
       rec.consensus_forecast,
       rec.stockout_date,
       sr.stockout_days,
       sr.first_negative_period,
       rec.lead_time,
       le.source            as lead_time_source,
       rec.lead_time_confidence,
       rec.safety_stock,
       ss.service_level,
       ss.z_value,
       ss.sigma_dlt,
       rec.required_order_date,
       rec.is_urgent,
       rec.raw_recommended_qty,
       rec.final_recommended_qty,
       rec.moq,
       rec.pack_size,
       rec.unit_price,
       rec.recommended_amount,
       rec.risk,
       rec.reason_code,
       rec.explanation,
       coalesce(ov.n_overrides, 0) as n_overrides,
       -- ★ STEP 13 이 더한 승인 컬럼. 한 품목의 ACTIVE 결정은 하나뿐입니다
       --   (core.approval 의 부분 유니크 인덱스). 없으면 전부 null 이고
       --   has_active_approval 만 false 입니다 — "모른다" 가 아니라 "아직 결정하지 않았다" 입니다.
       ap.decision          as last_decision,
       ap.approved_qty      as last_approved_qty,
       ap.approved_at       as last_approved_at,
       ap.approved_email    as last_approved_email,
       (ap.approval_id is not null) as has_active_approval
  from analytics.v_purchase_recommendation rec
  left join analytics.v_stockout_risk      sr on sr.item_id    = rec.item_id
  left join analytics.v_champion_model     ch on ch.item_id    = rec.item_id
  left join analytics.v_sku_demand_profile dp on dp.item_id    = rec.item_id
  left join analytics.v_safety_stock       ss on ss.item_id    = rec.item_id
  left join core.v_leadtime_effective      le on le.supplier_id = rec.supplier_id
  left join analytics.v_forecast_run       fr on fr.run_id     = rec.run_id
  left join (
    select o.item_id, count(*) as n_overrides
      from core.forecast_override o
     where o.superseded_at is null
     group by o.item_id
  ) ov on ov.item_id = rec.item_id
  left join core.approval ap
    on ap.item_id = rec.item_id
   and ap.status  = 'ACTIVE';

comment on view analytics.v_sku_detail is
  'renew.prd 29장 — 품목 하나의 예측 · 재고 · 발주 · 승인 요약. 최종 정의는 sql/19-approval.sql 에 있습니다';

-- ── 4-4. 발주 추천 + 승인 상태 ★ ──────────────────────────────
--
-- renew.prd 32 — "추천과 승인 분리". 목록에서 "무엇이 아직 결정되지 않았는가" 를 봅니다.
--
-- ★ analytics.v_purchase_recommendation 을 고치지 않고 새 뷰로 감쌉니다.
--   CSV 라우트 · STEP 16 툴 · STEP 19 API 가 읽는 이름이 바뀌지 않습니다.
create view analytics.v_purchase_recommendation_with_approval as
select r.*,
       ap.approval_id,
       ap.decision        as approval_status,
       ap.approved_qty,
       ap.adjustment,
       ap.approved_email,
       ap.approved_at,
       (ap.approval_id is not null) as has_active_approval,
       -- ★ "승인 대기" 를 뷰가 판정합니다. 화면과 KPI 가 같은 조건을 봐야
       --   카드 숫자와 목록 건수가 어긋나지 않습니다 (design.md §6.4).
       --   추천 수량을 산출하지 못한 품목은 발주가 필요한지도 모릅니다 — false 가 아니라 null 입니다.
       case when r.final_recommended_qty is null then null
            else (r.final_recommended_qty > 0 and ap.approval_id is null)
       end as is_pending
  from analytics.v_purchase_recommendation r
  left join core.approval ap
    on ap.item_id = r.item_id
   and ap.status  = 'ACTIVE';

comment on view analytics.v_purchase_recommendation_with_approval is
  'renew.prd 22장 + 23장 — 발주 추천에 ACTIVE 결정을 붙인 목록. 승인 화면이 읽습니다';

-- ── 4-5. 통합 결정 이력 ★ ─────────────────────────────────────
--
-- renew.prd 31.2 — "모든 Forecast·Recommendation·Override·Approval 은 추적 가능해야 한다".
-- 사람이 시스템에 남긴 결정을 한 표로 모읍니다.
--
--   APPROVAL  core.approval                     발주 승인 · 반려 · 보류
--   OVERRIDE  analytics.v_forecast_override     예측 보정 (renew.prd 17장)
--   CHAMPION  core.champion_model MANUAL        Champion 수동 지정 (renew.prd 14장)
--   LEADTIME  core.leadtime_plan_history        계획 리드타임 변경 (renew.prd 18.3)
--
-- ★ 리드타임 변경은 품목이 아니라 공급처에 붙습니다. item_id 는 null 이고 supplier_id 만 있습니다.
--   품목 하나로 한 건을 여러 행으로 펴면(공급처에 품목 50개면 50행) 전체 이력의 건수가 부풀어
--   "이 시스템에서 내려진 결정 수" 가 사실과 달라집니다.
--   품목 화면은 `item_id = ? or (kind = 'LEADTIME' and supplier_id = ?)` 로 함께 읽습니다.
--
-- ★ decision · adjustment 는 승인 행에만 있습니다. 결정 이력 화면의 KPI 카드가
--   목록과 같은 배열로 세려면 필요합니다 (design.md §6.4).
create view analytics.v_decision_history as
select 'APPROVAL'::text            as kind,
       a.approval_id::text         as ref_id,
       a.item_id,
       im.item_name,
       -- 공급처는 품목 마스터에서 읽습니다 (v_approval 과 같은 이유).
       -- v_purchase_recommendation 을 조인하면 이력 한 줄을 그리려고
       -- 발주 추천 전체(결품 판정 · 재고 전개 · 예측)를 다시 계산하게 됩니다.
       im.supplier_id,
       a.approved_email            as actor_email,
       a.approved_at               as "at",
       a.decision,
       a.adjustment,
       a.reason_code,
       (core.decision_label(a.decision)
        || ' · 수량 ' || core.fmt_qty(a.approved_qty)
        || ' · 추천 ' || core.fmt_qty(a.recommended_qty)
        || case when a.adjustment is null or a.adjustment = 0 then ''
                else ' · 조정 ' || case when a.adjustment > 0 then '+' else '' end
                     || core.fmt_qty(a.adjustment) end
        || ' · 사유 ' || core.approval_reason_label(a.reason_code)
        || case when a.reason_text is null then '' else ' (' || a.reason_text || ')' end
       )                           as summary
  from core.approval a
  left join core.v_item_master im on im.item_id = a.item_id

union all

select 'OVERRIDE'::text,
       o.id::text,
       o.item_id,
       o.item_name,
       null::text,
       o.created_email,
       o.created_at,
       null::text,
       null::numeric,
       o.reason_code,
       ('예측 보정 · 기간 ' || to_char(o.period, 'YYYY-MM')
        || ' · 증감 ' || case when o.override_qty > 0 then '+' else '' end
             || core.fmt_qty(o.override_qty)
        || ' · Consensus ' || core.fmt_qty(o.consensus_forecast)
        || ' · 사유 ' || core.override_reason_label(o.reason_code)
        || case when o.reason_text is null then '' else ' (' || o.reason_text || ')' end
        || case when o.superseded_at is null then '' else ' — 해제·대체됨' end
       )
  from analytics.v_forecast_override o

union all

select 'CHAMPION'::text,
       c.item_id,
       c.item_id,
       im.item_name,
       null::text,
       au.email,
       c.selected_at,
       null::text,
       null::numeric,
       null::text,
       ('Champion 수동 지정 · 모델 ' || coalesce(mc.model_name, c.champion_model_id, '—')
        || case when c.wape is null then ''
                else ' · WAPE ' || round(c.wape * 100, 1)::text || '%' end
        || case when c.reason is null then '' else ' · 사유 ' || c.reason end
       )
  from core.champion_model c
  left join core.v_item_master im on im.item_id  = c.item_id
  left join core.model_config  mc on mc.model_id = c.champion_model_id
  left join core.app_user      au on au.user_id  = c.selected_by
 where c.selection_method = 'MANUAL'

union all

select 'LEADTIME'::text,
       h.id::text,
       null::text,
       null::text,
       h.supplier_id,
       h.changed_email,
       h.changed_at,
       null::text,
       null::numeric,
       null::text,
       ('계획 리드타임 변경 · 공급처 ' || h.supplier_id
        || ' · ' || coalesce(h.lead_time_before::text, '—')
        || ' → ' || coalesce(h.lead_time_after::text, '—') || '일'
        || case when h.basis is null then '' else ' · 근거 ' || h.basis end
        || ' · 사유 ' || h.reason
       )
  from core.leadtime_plan_history h;

comment on view analytics.v_decision_history is
  'renew.prd 31.2 — 승인 · 예측 보정 · Champion 수동 지정 · 리드타임 변경을 한 표로 모은 결정 이력';

-- ── 4-6. 승인 요약 ────────────────────────────────────────────
--
-- ★ pending 은 "발주가 필요한데 ACTIVE 결정이 없는 품목" 입니다.
--   목록이 결정 이력이 아니라 발주 추천이라 결정 이력 화면에서는 필터를 걸지 않습니다.
--   v_purchase_recommendation_with_approval.is_pending 과 같은 조건입니다.
create view analytics.v_approval_kpi as
select (count(*) filter (where a.status = 'ACTIVE'))::int                     as n_active,
       (count(*) filter (where a.status = 'ACTIVE'
                           and a.decision = 'APPROVED'))::int                 as n_approved,
       (count(*) filter (where a.status = 'ACTIVE'
                           and a.decision = 'REJECTED'))::int                 as n_rejected,
       (count(*) filter (where a.status = 'ACTIVE'
                           and a.decision = 'DEFERRED'))::int                 as n_deferred,
       -- 추천을 그대로 승인하지 않고 수량을 고친 건수. 조정량을 모르는 행(추천 산출 불가)은 뺍니다.
       --
       -- ★ 승인 행만 셉니다. 반려 · 보류는 승인 수량이 0 이라 조정량이 −추천값으로 남는데,
       --   그것을 "수량을 고쳤다" 로 세면 반려가 전부 수정 승인으로 잡힙니다.
       --   결정 이력 화면의 '수정 승인' 카드도 같은 조건(승인 + 조정량 ≠ 0)입니다.
       (count(*) filter (where a.status = 'ACTIVE'
                           and a.decision = 'APPROVED'
                           and a.adjustment is not null
                           and a.adjustment <> 0))::int                       as n_adjusted,
       (select count(*)
          from analytics.v_purchase_recommendation_with_approval w
         where w.is_pending)::int                                             as pending,
       -- 이번 달에 내려진 결정 수입니다. 대체된 행도 셉니다 — 그날 결정한 사실은 남습니다.
       (count(*) filter (where a.approved_at >= date_trunc('month', current_date)))::int
                                                                              as this_month
  from core.approval a;

comment on view analytics.v_approval_kpi is
  'renew.prd 23장 — 승인 요약. pending 은 발주가 필요한데 아직 결정하지 않은 품목 수입니다';

-- ══ 5. 권한 ════════════════════════════════════════════════════
--
-- ★ insert 를 authenticated 에게 주지 않습니다.
--   승인 행은 core.approve_recommendation(security definer) 만 넣습니다.
--   화면이 직접 insert 할 수 있으면 Snapshot 없이도 행이 생겨 근거가 비게 됩니다 (renew.prd 23.2).
--   그래서 시퀀스 권한도 주지 않습니다 — 함수는 소유자 권한으로 돌아 필요하지 않습니다.

grant select, update on core.approval to authenticated;
revoke insert, delete on core.approval from authenticated;
revoke all on core.approval from anon;

alter table core.approval enable row level security;

drop policy if exists approval_read on core.approval;
create policy approval_read on core.approval
  for select to authenticated
  using (true);

-- 수정은 관리자만 할 수 있습니다. 잘못 저장된 결정을 바로잡는 경로입니다.
-- 일반 사용자는 새 결정을 넣어 이전 행을 SUPERSEDED 로 만드는 방식으로 바꿉니다.
drop policy if exists approval_write_admin on core.approval;
create policy approval_write_admin on core.approval
  for update to authenticated
  using (core.is_admin())
  with check (core.is_admin());

grant select on analytics.v_approval                              to authenticated;
grant select on analytics.v_approval_snapshot                     to authenticated;
grant select on analytics.v_sku_detail                            to authenticated;
grant select on analytics.v_purchase_recommendation_with_approval to authenticated;
grant select on analytics.v_decision_history                      to authenticated;
grant select on analytics.v_approval_kpi                          to authenticated;

-- ══ 6. 확인 ════════════════════════════════════════════════════

select * from analytics.v_approval_kpi;

-- 승인 목록 (아직 아무도 승인하지 않았다면 0행이 정상입니다)
select approval_id, item_id, decision, recommended_qty, approved_qty, adjustment,
       reason_code, approved_email, approved_at, status
  from analytics.v_approval
 order by approved_at desc
 limit 20;

-- 통합 결정 이력. 승인이 없어도 보정 · Champion · 리드타임 행은 나옵니다
select kind, item_id, supplier_id, actor_email, "at", summary
  from analytics.v_decision_history
 order by "at" desc
 limit 30;

-- 승인 대기 (발주가 필요한데 ACTIVE 결정이 없는 품목)
select item_id, item_name, final_recommended_qty, required_order_date,
       approval_status, is_pending
  from analytics.v_purchase_recommendation_with_approval
 where is_pending
 order by required_order_date nulls last
 limit 20;

-- SKU Detail 에 승인 컬럼이 붙었는지
select item_id, final_recommended_qty,
       last_decision, last_approved_qty, last_approved_at, has_active_approval
  from analytics.v_sku_detail
 order by has_active_approval desc, item_id
 limit 20;

-- Snapshot 이 renew.prd 23.2 의 항목을 전부 담았는지 (승인이 있어야 행이 나옵니다)
select approval_id,
       jsonb_object_keys(snapshot) as key
  from analytics.v_approval_snapshot
 order by approval_id desc
 limit 20;

-- ★ 함수를 직접 시험 (로그인 세션에서 실행하세요. anon 으로는 auth.uid() 가 null 입니다)
--
-- select * from core.approve_recommendation('ITEM001', 500, 'APPROVED', 'AS_RECOMMENDED', null);
--   → 추천 수량이 500 이 아니면 '추천 … 와 승인 … 가 다릅니다' 로 거절됩니다
-- select * from core.approve_recommendation('ITEM001', 800, 'APPROVED', 'BUDGET', '분기 예산 초과');
-- select * from core.approve_recommendation('ITEM001', 0, 'REJECTED', 'DEMAND_INFO', '고객 주문 취소');
--   → 이전 행이 SUPERSEDED 로 바뀌고 새 행이 ACTIVE 가 됩니다
-- select * from core.approve_recommendation('없는품목', 1, 'APPROVED', 'BUDGET', null);
--   → '이 품목의 발주 추천이 없습니다 …'
