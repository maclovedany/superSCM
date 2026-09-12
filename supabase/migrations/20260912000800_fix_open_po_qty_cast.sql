-- 보정 · Open PO 참고 수량 계산이 발주수량 콤마 값 한 줄에 전체가 막히던 것을 고칩니다
--
-- ★ 증상 — STOCK_VIEW_ALL · STOCK_VIEW_PAPER · STOCK_VIEW_SUPPLY 권한을 가진 사용자가
--   analytics.v_available_stock을 전체 열로 조회하면 /inventory 화면 전체가 다음 오류로
--   막힙니다.
--       22P02: invalid input syntax for type numeric: "1,000"
--
-- ★ 원인 — raw.purchase_order에 5회차 실습 더미 한 줄(품목코드 ITEM007, 발주번호 PO20261024,
--   batch_id is null · source_type is null — 이 마이그레이션이 만들지 않은 기존 데이터)이
--   "발주수량"에 천단위 콤마가 섞인 텍스트 '1,000'을 갖고 있습니다. core.v_open_po_qty가
--   raw.purchase_order."발주수량"과 raw.goods_receipt."입고수량"을 곧바로
--   `nullif(..., '')::numeric`으로 캐스트하는데, PostgreSQL의 numeric 입력 파서는 콤마를
--   허용하지 않아 그 한 줄이 뷰 전체 집계(group by)를 실패시킵니다. 이 뷰는 analytics.
--   v_available_stock이 매 조회마다 참조하므로, 콤마 값이 있는 한 그 뷰를 부르는 화면
--   전체가 막힙니다(영업 전용 analytics.v_order_available_stock은 Open PO를 읽지 않아
--   영향이 없습니다).
--
-- ★ 해결 — 두 갈래.
--   1) core.parse_lenient_numeric(text) — 앞뒤 공백과 천단위 콤마를 제거한 뒤 숫자로 바꿉니다.
--      콤마·공백을 떼고 나면 '1,000' → 1000처럼 **원래 뜻한 숫자를 그대로 복원**합니다 —
--      값을 잃지 않습니다. 그래도(콤마·공백을 떼도) 숫자가 아니면 예외를 내지 않고 null을
--      돌려줍니다. 빈 값과 "정말 파싱 불가한 값"을 구분해서 판정해야 하므로(전자는 기존처럼
--      조용히 0으로 집계에서 빠지는 게 맞고, 후자는 그 자리만 조용히 빼고 계산한 부분합을
--      보여주면 "정확해 보이는 틀린 숫자"가 되므로 참고 열 전체를 null + 사유 코드로 바꿔야
--      합니다), 원본 텍스트가 비어 있지 않은데 파싱이 끝내 실패하는 경우만 "파싱 불가"로
--      표시합니다.
--   2) core.v_open_po_qty · core.apply_stock_receipts_from_batch(Task 6 최종본,
--      20260911000610)가 이 파서를 쓰도록 다시 정의합니다. core.v_open_po_qty는 품목별로
--      발주수량·입고수량 중 하나라도 "정말 파싱 불가"(콤마·공백을 떼도 숫자가 아님)이면
--      open_po_qty를 null로, 새 reason_code 열(끝에 추가 — error.md #16)을
--      'OPEN_PO_QTY_UNPARSEABLE'로 남깁니다. 부분합을 숫자로 보여주지 않습니다. 콤마·공백만
--      있던 값은 이 경로를 타지 않습니다 — 정상적으로 복원돼 계산에 들어갑니다.
--      analytics.v_available_stock(Task 4·5 최종본, 20260911000600)도 같은 방식으로 다시
--      정의해, 기존 열 순서는 그대로 두고 끝에 open_po_reason_code를 추가합니다.
--
-- ★ 영향받지 않는 숫자 — 이 콤마 한 줄을 제외한 나머지 91개 raw.purchase_order 행과 모든
--   raw.goods_receipt 행은 이미 아무 문제 없이 캐스트되고 있었습니다(그러지 않았다면 화면이
--   더 일찍 막혔을 것입니다). core.parse_lenient_numeric은 그 값들에 대해 기존
--   `nullif(...,'')::numeric`과 완전히 같은 결과를 돌려줍니다 — 콤마·앞뒤 공백이 없는
--   숫자 텍스트는 그대로 파싱됩니다. 그러므로 이 마이그레이션은 ITEM007을 포함해 어떤
--   품목의 open_po_qty 값도 "틀리게" 바꾸지 않습니다. ITEM007은 (이전: 조회 자체가 실패) →
--   (이후: 콤마가 떼어진 1,000으로 정상 계산됨)으로 바뀝니다 — null이나 사유 코드가 아니라
--   **실제 숫자**입니다. reason_code='OPEN_PO_QTY_UNPARSEABLE'은 콤마처럼 복원 가능한 값이
--   아니라, 그래도 정말 숫자로 바꿀 수 없는 값(예: "많음" 같은 임의 텍스트)이 있을 때만
--   나옵니다 — 지금 배포 DB의 raw.purchase_order·raw.goods_receipt에는 그런 행이 없습니다
--   (원인 절의 콤마 한 줄뿐입니다). 그래도 코드는 미래의 그런 행을 대비합니다.
--
-- ★ "발주수량 · 입고수량 · 단가" 세 열을 모두 훑었습니다. raw.purchase_order."단가"는
--   지금 어떤 core/analytics 뷰·함수도 참조하지 않습니다(캐스트 자체가 없습니다) — 고칠
--   대상이 없습니다. 나중에 단가를 쓰는 뷰를 추가할 때는 이 파서를 처음부터 쓰십시오.
--   core.v_inbound_qty(이동 중 수량 참고 열)는 이름은 비슷하지만 raw.shipment_log의
--   네이티브 numeric qty 열을 읽습니다 — raw.purchase_order·raw.goods_receipt의 텍스트
--   열과 무관해 이 보정 대상이 아닙니다(실데이터에는 그 표 자체가 비어 있습니다 — 메모리:
--   실데이터에 재고·리드타임이 없다).
-- ★ raw.inventory."현재고"(core.apply_stock_balance_from_batch가 캐스트) 는 이번 보정
--   범위 밖입니다 — 이번 사고의 증상·원인 모두 발주수량·입고수량에 한정되고, 팀리드가
--   지정한 세 열(발주수량·입고수량·단가)에도 포함되지 않습니다. 실데이터에 재고 자체가
--   없어(메모리 참고) 같은 방식의 결함이 실제로 나타난 적이 없습니다. 다만 같은 패턴의
--   무방비 캐스트이므로 별도 확인이 필요하면 추후 과제로 남겨 둡니다.
--
-- ★ 이미 적용된 파일(20260911000500 · 20260911000600 · 20260911000610)은 고치지 않습니다
--   (refactor.md §5-6). 아래 정의가 core.v_open_po_qty · analytics.v_available_stock ·
--   core.apply_stock_receipts_from_batch의 최종본이 됩니다. 기존 열 이름·순서는 모두
--   유지하고 끝에만 덧붙입니다(error.md #16 — create or replace view는 기존 열 사이에
--   끼워 넣거나 순서를 바꿀 수 없습니다).
--
-- 다시 실행해도 안전합니다(create or replace function/view, create table if not exists).
-- 이 마이그레이션 자체는 raw.purchase_order 데이터를 바꾸지 않습니다 — 데이터 정규화는
-- 아래 4절의 함수를 별도 스크립트(supabase/practice-data/00c-normalize-legacy-po-qty.sql)에서
-- 관리자가 명시적으로 호출할 때만 실행됩니다.


-- ══ 1. 관대한 숫자 파서 ═══════════════════════════════════════════
--
-- ★ 예외를 절대 밖으로 내보내지 않습니다 — 이 함수를 쓰는 자리는 집계 함수 안이라, 한
--   번이라도 예외가 나면 오늘 겪은 사고가 그대로 재현됩니다. 대신 파싱할 수 없으면
--   조용히 null을 돌려줍니다. "빈 값"과 "파싱 불가"를 구분하는 것은 호출하는 쪽의 책임입니다
--   (원본 텍스트가 비어 있지 않은데 이 함수가 null을 돌려주면 그때가 "파싱 불가"입니다).

create or replace function core.parse_lenient_numeric(p_raw text)
returns numeric
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  v_cleaned text;
begin
  if p_raw is null then
    return null;
  end if;

  -- 앞뒤 공백과 천단위 콤마만 제거합니다. 그 밖의 형식(괄호로 음수 표기 등)은 다루지
  -- 않습니다 — 실제로 관찰된 결함은 콤마 하나뿐이고, 넓게 손대면 "이미 파싱되던 값"까지
  -- 건드릴 위험이 커집니다.
  v_cleaned := btrim(replace(p_raw, ',', ''));
  if v_cleaned = '' then
    return null;
  end if;

  return v_cleaned::numeric;
exception
  when others then
    return null;
end;
$$;

comment on function core.parse_lenient_numeric(text) is
  '보정 — 앞뒤 공백·천단위 콤마를 제거한 뒤 숫자로 바꾼다. 그래도 숫자가 아니면(빈 문자열 '
  '포함) 예외 대신 null을 돌려준다. 원본이 비어 있지 않은데 null이 나오면 그것이 "파싱 '
  '불가"다 — 호출하는 쪽에서 그 경우를 reason_code로 구분해야 한다';

revoke all on function core.parse_lenient_numeric(text) from public, anon;
grant execute on function core.parse_lenient_numeric(text) to authenticated;


-- ══ 2. Open PO 참고 열 — 관대한 파서 + 파싱 불가 사유 코드 ════════════
--
-- ★ 20260911000500의 정의를 대체합니다(이후 재정의 없음 — 이 파일이 최종본). 열 이름·순서는
--   유지하고(item_id, open_po_qty) 끝에 reason_code를 추가합니다.
-- ★ 품목별로 발주수량·입고수량 중 하나라도 "파싱 불가"(원본이 비어 있지 않은데
--   core.parse_lenient_numeric이 null)이면 그 품목의 open_po_qty 전체를 null로 냅니다.
--   파싱 가능한 나머지 줄만 모아 부분합을 보여주지 않습니다 — 그러면 "정확해 보이는 틀린
--   숫자"가 되기 때문입니다(빠진 줄만큼 실제보다 작게 계산됩니다). 빈 값(공란)은 그대로
--   집계에서 빠집니다 — 기존 동작과 같습니다(발주 자체가 없는 품목이 0인 것과 같은 이유로,
--   빈 칸은 "쓰지 않았다"는 사실이지 오류가 아닙니다).

create or replace view core.v_open_po_qty as
with ordered as (
  select
    upper(regexp_replace(p."품목코드", '[\s\-_]', '', 'g')) as item_id,
    sum(core.parse_lenient_numeric(p."발주수량")) as ordered_qty,
    bool_or(
      p."발주수량" is not null and btrim(p."발주수량") <> ''
      and core.parse_lenient_numeric(p."발주수량") is null
    ) as has_unparseable
  from raw.purchase_order p
  group by upper(regexp_replace(p."품목코드", '[\s\-_]', '', 'g'))
),
received as (
  select
    upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g')) as item_id,
    sum(core.parse_lenient_numeric(g."입고수량")) as received_qty,
    bool_or(
      g."입고수량" is not null and btrim(g."입고수량") <> ''
      and core.parse_lenient_numeric(g."입고수량") is null
    ) as has_unparseable
  from raw.goods_receipt g
  where nullif(g."입고일", '') is not null
    and g.receipt_status = 'COMPLETED'
  group by upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g'))
)
select
  o.item_id,
  case when o.has_unparseable or coalesce(r.has_unparseable, false) then null
       else greatest(0, o.ordered_qty - coalesce(r.received_qty, 0))
  end as open_po_qty,
  case when o.has_unparseable or coalesce(r.has_unparseable, false)
       then 'OPEN_PO_QTY_UNPARSEABLE'
  end as reason_code
from ordered o
left join received r on r.item_id = o.item_id;

comment on view core.v_open_po_qty is
  '보정(2026-09-12) — 품목별 Open PO 참고 수량 = 발주수량 합 - 입고완료(입고일 존재 + '
  'receipt_status=COMPLETED) 합. 음수는 0으로 clamp한다. core.parse_lenient_numeric으로 '
  '콤마·공백을 허용하고, 원본이 비어 있지 않은데 그래도 파싱할 수 없는 줄이 하나라도 있으면 '
  '그 품목은 부분합 대신 null + reason_code=OPEN_PO_QTY_UNPARSEABLE을 낸다. 빈 값은 기존과 '
  '같이 조용히 0으로 집계된다. 가용재고 계산에는 더하지 않는 참고 열이다';

grant select on core.v_open_po_qty to authenticated;
revoke all on core.v_open_po_qty from anon, public;


-- ══ 3. 입고 반영 함수 — 관대한 파서 ═══════════════════════════════
--
-- ★ Task 6 최종본(20260911000610)의 정의를 대체합니다. 자동 배정 · MANUAL 알림 로직은
--   그대로 두고, 숫자 캐스트만 core.parse_lenient_numeric으로 바꿉니다.
-- ★ 이 함수는 core.commit_import_batch(goods_receipt 분기)만 부르고, 그 경로는 이미
--   lib/import/validate.ts가 kind:'number' 필드를 업로드 시점에 검증합니다
--   (Number.isFinite(Number(value))는 '1,000' 같은 콤마 값을 이미 거절합니다) — 그래서
--   화면 업로드로는 이 함수가 콤마 값을 볼 일이 정상적으로는 없습니다. 그래도 raw에 직접
--   넣힌 값(과거 더미 데이터 등)을 이 배치가 우연히 다시 반영하려는 경우까지 대비해 같은
--   패턴을 적용합니다 — 파싱 불가한 줄은 기존에 이미 있던 다른 제외 조건(미완료 · 수량 0
--   이하 · 입고일 없음)과 같은 방식으로 조용히 원장에서 빠집니다. 그 줄들에도 원래
--   reason_code가 없었으므로(원장은 "반영된 사실"만 쌓는 append-only 표입니다) 여기서도
--   새로 만들지 않습니다 — 사유를 보여줘야 할 자리는 조회 시점의 analytics 뷰입니다.

create or replace function core.apply_stock_receipts_from_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_count integer;
  v_item_ids text[];
  v_new_receipts jsonb;
  v_receipt jsonb;
  v_ledger_id bigint;
  v_item_id text;
  v_qty numeric;
  v_mode text;
begin
  with completed as (
    select
      upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g')) as item_id,
      core.parse_lenient_numeric(g."입고수량") as qty,
      nullif(g."입고일", '')::timestamptz as completed_at,
      g.source_record_id
    from raw.goods_receipt g
    where g.batch_id = p_batch_id
      and g.receipt_status = 'COMPLETED'
      and nullif(g."입고일", '') is not null
      and core.parse_lenient_numeric(g."입고수량") is not null
      and core.parse_lenient_numeric(g."입고수량") > 0
      and g.source_record_id is not null
  ),
  inserted as (
    insert into core.stock_receipt_ledger (item_id, source_record_id, qty, completed_at, source_batch_id)
    select item_id, source_record_id, qty, completed_at, p_batch_id
      from completed
    on conflict (source_record_id, item_id) do nothing
    returning ledger_id, item_id, qty
  )
  select array_agg(distinct item_id),
         coalesce(jsonb_agg(jsonb_build_object('ledger_id', ledger_id, 'item_id', item_id, 'qty', qty) order by ledger_id), '[]'::jsonb)
    into v_item_ids, v_new_receipts
    from inserted;

  v_count := jsonb_array_length(v_new_receipts);

  -- core.stock_balance에 아직 행이 없는 품목은 이 호출이 그냥 건너뛴다(update 대상 0행).
  if v_item_ids is not null then
    perform core.recompute_stock_balance_totals(v_item_ids);
  end if;

  -- Task 6: normal_qty가 새 입고를 반영한 뒤에야 후속 배정을 계산해야 한다 — 그래서 위 재계산이
  -- 끝난 다음 원장 행마다 돈다.
  for v_receipt in select * from jsonb_array_elements(v_new_receipts)
  loop
    v_ledger_id := (v_receipt ->> 'ledger_id')::bigint;
    v_item_id := v_receipt ->> 'item_id';
    v_qty := (v_receipt ->> 'qty')::numeric;

    v_mode := coalesce((select p.allocation_mode from core.item_policy p where p.item_id = v_item_id), 'AUTO');

    if v_mode = 'MANUAL' then
      perform core.notify_manual_allocation_needed(v_item_id, v_ledger_id, v_qty);
    else
      perform core.allocate_new_stock(v_item_id, v_ledger_id);
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function core.apply_stock_receipts_from_batch(uuid) is
  'Task 6 원본 + 보정(2026-09-12): 입고수량 캐스트를 core.parse_lenient_numeric으로 바꿔 '
  '콤마·공백이 섞인 값도 예외 없이 처리한다(그래도 파싱 불가면 기존의 다른 제외 조건과 '
  '같은 방식으로 원장에서 빠진다). 권한 검사가 없는 내부 계산 — core.commit_import_batch만 '
  '부른다. 같은 (source_record_id, item_id) 조합은 두 번 반영되지 않는다. 새로 반영된 원장 '
  '행마다 AUTO 품목은 core.allocate_new_stock, MANUAL 품목은 처리 필요 알림을 같은 '
  '트랜잭션에서 실행한다';

revoke all on function core.apply_stock_receipts_from_batch(uuid) from public, anon, authenticated;


-- ══ 4. 가용재고 상세 뷰 — Open PO 파싱 불가 사유 노출 ═══════════════
--
-- ★ Task 4·5 최종본(20260911000600)의 정의를 대체합니다. 배정 합계 로직(core.v_item_allocation_qty
--   조인)은 그대로 두고, 기존 열 순서를 유지한 채 끝에 open_po_reason_code 하나만 더합니다
--   (error.md #16). 기존 reason_code 열은 정상 창고재고 분류(core.stock_balance) 사유이고,
--   open_po_reason_code는 그와 독립적인 참고 열(Open PO)의 사유다 — 한 열에 두 사유를
--   욱여넣지 않는다(한 사유가 다른 사유를 가리는 문제를 피한다).

create or replace view analytics.v_available_stock
with (security_invoker = true)
as
select
  im.item_id,
  im.item_name,
  im.item_type,
  coalesce(ivr.visibility_scope, 'GENERAL') as visibility_scope,
  sb.normal_qty as normal_warehouse_qty,
  sb.snapshot_at,
  coalesce(aq.temporary_allocated_qty, 0::numeric) as temporary_allocated_qty,
  coalesce(aq.firm_allocated_qty, 0::numeric) as firm_allocated_qty,
  coalesce(aq.approval_hold_qty, 0::numeric) as approval_hold_qty,
  case when sb.normal_qty is null then null
       else sb.normal_qty - coalesce(aq.committed_qty, 0::numeric)
  end as available_qty,
  po.open_po_qty,
  ib.inbound_qty as in_transit_qty,
  case when sb.item_id is null then 'INVENTORY_SCOPE_UNCLASSIFIED' end as reason_code,
  po.reason_code as open_po_reason_code
from core.v_item_master im
left join core.item_visibility_rule ivr on ivr.raw_item_type = im.item_type
left join core.stock_balance sb on sb.item_id = im.item_id
left join core.v_item_allocation_qty aq on aq.item_id = im.item_id
left join core.v_inbound_qty ib on ib.item_id = im.item_id
left join core.v_open_po_qty po on po.item_id = im.item_id
where
  core.has_permission('STOCK_VIEW_ALL')
  or (core.has_permission('STOCK_VIEW_PAPER') and coalesce(ivr.visibility_scope, 'GENERAL') = 'PAPER_CARD_READER')
  or (core.has_permission('STOCK_VIEW_SUPPLY') and coalesce(ivr.visibility_scope, 'GENERAL') = 'CONSUMABLE');

comment on view analytics.v_available_stock is
  'Task 4·5 원본 + 보정(2026-09-12) — 부서 권한과 품목 범위로 제한한 정상 창고재고·가용재고 '
  '상세. 가용재고 = 정상 창고재고 − 임시배정 − 확정배정 − 승인대기 확보. 분류 불가 품목은 '
  'null + reason_code=INVENTORY_SCOPE_UNCLASSIFIED. Open PO가 파싱 불가 발주수량/입고수량을 '
  '만나면 open_po_qty는 null + open_po_reason_code=OPEN_PO_QTY_UNPARSEABLE(정상 창고재고 '
  '분류와는 별개 사유). security_invoker로 호출자 RLS를 그대로 적용한다';

grant select on analytics.v_available_stock, analytics.v_order_available_stock to authenticated;
revoke all on analytics.v_available_stock, analytics.v_order_available_stock from anon, public;


-- ══ 5. 데이터 정규화 — 콤마 발주수량 되돌릴 수 있게 고치기 ═══════════
--
-- ★ 위 1~4절만으로 화면은 이미 정상입니다(ITEM007도 콤마가 자동으로 제거된 1,000으로
--   정상 계산됩니다 — null이나 사유 코드가 아닙니다). 이 5절은 그것과 별개로, raw.purchase_order에
--   남아 있는 잘못된 텍스트 자체를 정리해 두는 선택적 데이터 위생 조치입니다 —
--   core.parse_lenient_numeric을 거치지 않는 어떤 미래 코드(BI 쿼리 등)가 같은 함정에
--   다시 걸리지 않도록 합니다.
-- ★ 지우지 않습니다. core.purchase_order_qty_normalized에 원본 행 전체를 jsonb로 보관하고,
--   되돌리는 함수를 짝으로 둡니다(00b-retire-legacy-usage.sql · core.restore_retired_usage_history와
--   같은 관례 — supabase/practice-data/README.md 참고).
-- ★ 대상은 출처 없는 행(batch_id is null)만이고, 그중에서도 "지금 그대로는 숫자 캐스트가
--   실패하지만(콤마 등으로 이미 깨끗한 숫자 형식이 아니고) core.parse_lenient_numeric으로는
--   값을 복원할 수 있는" 행만입니다. 이미 깨끗한 값은 다시 쓰지 않고(불필요한 재포맷 금지),
--   콤마를 떼어도 여전히 숫자가 아닌 값(진짜 알 수 없는 값)도 건드리지 않습니다 — 무엇을
--   써야 할지 모르는 값을 함부로 채우지 않습니다.
-- ★ 이 마이그레이션은 함수·표만 만듭니다. 실제 정규화 실행은
--   supabase/practice-data/00c-normalize-legacy-po-qty.sql에서 관리자가 p_confirm => true로
--   명시적으로 부릅니다 — 운영 반영은 사용자가 검토 후 SQL Editor에서 수행합니다.

create table if not exists core.purchase_order_qty_normalized (
  normalize_id     bigint generated by default as identity primary key,
  -- 정규화 전 raw.purchase_order 원본 행 전체(to_jsonb) — 되돌릴 때 발주수량을 제외한
  -- 나머지 열이 모두 같은 행을 찾는 데 쓴다.
  row_data         jsonb not null check (jsonb_typeof(row_data) = 'object'),
  original_qty     text not null,
  normalized_qty   text not null,
  normalized_by    uuid references auth.users(id) on delete set null,
  normalized_at    timestamptz not null default now()
);

comment on table core.purchase_order_qty_normalized is
  '보정(2026-09-12) — 출처 없는(batch_id is null) raw.purchase_order 행 중 콤마 등으로 숫자 '
  '캐스트가 실패하던 발주수량을 정규화하며 원본을 보관한 표. '
  'core.restore_normalized_purchase_order_qty로 되돌린다. 지우지 않는다';

create or replace function core.normalize_legacy_purchase_order_qty(p_confirm boolean default false)
returns jsonb
language plpgsql security definer set search_path = core, raw, public, pg_temp
as $$
declare
  v_ids bigint[];
  v_archived bigint;
  v_updated bigint;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception '정규화를 실행하려면 p_confirm => true 를 명시해야 합니다.' using errcode = '22023';
  end if;

  -- 판정: 출처 없음 + 지금 형태로는 순수 숫자 텍스트가 아님(콤마 등) + 관대한 파서로는
  -- 복원 가능. 셋 다 맞는 행만 대상이다.
  with ins as (
    insert into core.purchase_order_qty_normalized (row_data, original_qty, normalized_qty, normalized_by)
    select to_jsonb(p), p."발주수량", core.parse_lenient_numeric(p."발주수량")::text, auth.uid()
      from raw.purchase_order p
     where p.batch_id is null
       and p."발주수량" is not null
       and btrim(p."발주수량") !~ '^-?[0-9]+(\.[0-9]+)?$'
       and core.parse_lenient_numeric(p."발주수량") is not null
    returning normalize_id
  )
  select array_agg(normalize_id) into v_ids from ins;
  v_archived := coalesce(array_length(v_ids, 1), 0);

  if v_archived = 0 then
    return jsonb_build_object('normalized_rows', 0, 'normalize_ids', '[]'::jsonb, 'message', '대상 행이 없습니다');
  end if;

  -- ★★ 보관과 수정은 같은 술어를 써야 한다(00b와 같은 이유) — 아래 건수 비교가 불일치를
  --   소리 내어 막는다. 발주수량을 뺀 나머지 모든 열이 보관한 원본과 같은 행만 고친다.
  update raw.purchase_order p
     set "발주수량" = n.normalized_qty
    from core.purchase_order_qty_normalized n
   where n.normalize_id = any(v_ids)
     and p.batch_id is null
     and p."발주수량" = n.original_qty
     and (to_jsonb(p) - '발주수량') = (n.row_data - '발주수량');
  get diagnostics v_updated = row_count;

  if v_updated is distinct from v_archived then
    raise exception '보관 건수(%)와 정규화 건수(%)가 다릅니다 — 복구 시 불일치가 생기므로 중단합니다.',
      v_archived, v_updated using errcode = '22023';
  end if;

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), 'LEGACY_PO_QTY_NORMALIZED', 'purchase_order_qty_normalized', array_to_string(v_ids, ','), null,
          jsonb_build_object('rows', v_archived, 'normalize_ids', v_ids));

  return jsonb_build_object('normalized_rows', v_archived, 'normalize_ids', to_jsonb(v_ids));
end;
$$;

comment on function core.normalize_legacy_purchase_order_qty(boolean) is
  '보정(2026-09-12) — ADMIN. 출처 없는 raw.purchase_order 행 중 콤마 등으로 숫자 캐스트가 '
  '실패하지만 관대한 파서로 복원 가능한 발주수량만 정규화한다. 이미 깨끗한 값과 완전히 알 '
  '수 없는 값은 건드리지 않는다. p_confirm => true 필수. core.restore_normalized_purchase_order_qty로 '
  '되돌린다';

create or replace function core.restore_normalized_purchase_order_qty(p_normalize_id bigint default null)
returns bigint
language plpgsql security definer set search_path = core, raw, public, pg_temp
as $$
declare
  v_ids bigint[];
  v_restored bigint;
begin
  if not core.is_admin() then
    raise exception '관리자 권한이 필요합니다.' using errcode = '42501';
  end if;

  select coalesce(array_agg(normalize_id), '{}') into v_ids
    from core.purchase_order_qty_normalized
   where p_normalize_id is null or normalize_id = p_normalize_id;

  if array_length(v_ids, 1) is null then
    return 0;
  end if;

  update raw.purchase_order p
     set "발주수량" = n.original_qty
    from core.purchase_order_qty_normalized n
   where n.normalize_id = any(v_ids)
     and p.batch_id is null
     and p."발주수량" = n.normalized_qty
     and (to_jsonb(p) - '발주수량') = (n.row_data - '발주수량');
  get diagnostics v_restored = row_count;

  if v_restored is distinct from array_length(v_ids, 1) then
    raise exception '복구 대상(%)과 실제 복구된 행(%)이 다릅니다 — 복구를 중단합니다.',
      array_length(v_ids, 1), v_restored using errcode = '22023';
  end if;

  delete from core.purchase_order_qty_normalized where normalize_id = any(v_ids);

  insert into core.audit_log (actor, action, target_type, target_id, before, after)
  values (auth.uid(), 'LEGACY_PO_QTY_RESTORED', 'purchase_order_qty_normalized', array_to_string(v_ids, ','), null,
          jsonb_build_object('rows', v_restored));

  return v_restored;
end;
$$;

comment on function core.restore_normalized_purchase_order_qty(bigint) is
  '보정(2026-09-12) — ADMIN. core.normalize_legacy_purchase_order_qty가 고친 발주수량을 '
  '원본 텍스트로 되돌리고 보관소에서 지운다. p_normalize_id를 생략하면 보관된 모든 행을 '
  '되돌린다';

alter table core.purchase_order_qty_normalized enable row level security;
drop policy if exists purchase_order_qty_normalized_read on core.purchase_order_qty_normalized;
create policy purchase_order_qty_normalized_read on core.purchase_order_qty_normalized
  for select to authenticated using (core.is_admin());

revoke all on core.purchase_order_qty_normalized from anon, public;
revoke insert, update, delete on core.purchase_order_qty_normalized from authenticated;
grant select on core.purchase_order_qty_normalized to authenticated;

revoke all on function core.normalize_legacy_purchase_order_qty(boolean) from public, anon;
grant execute on function core.normalize_legacy_purchase_order_qty(boolean) to authenticated;
revoke all on function core.restore_normalized_purchase_order_qty(bigint) from public, anon;
grant execute on function core.restore_normalized_purchase_order_qty(bigint) to authenticated;


-- ══ 6. 수동 적용 후 확인 쿼리 ═══════════════════════════════════════

-- (a) 콤마 값이 있어도 조회 자체가 실패하지 않고, 실제로는 콤마가 제거된 숫자로 계산되는지
-- — 관리자 계정으로 실행.
-- select item_id, open_po_qty, reason_code from core.v_open_po_qty where item_id = 'ITEM007';
-- 기대: 예외 없이 1행, open_po_qty = (발주수량 1,000을 콤마 없이 더한 값 − 입고완료분), reason_code is null
--       (콤마는 복원 가능한 값이라 OPEN_PO_QTY_UNPARSEABLE이 아니다 — 아래 (a-1) 참고)

-- (a-1) 정말 파싱 불가한 값(콤마를 떼도 숫자가 아님)이 있을 때만 사유 코드가 나오는지 — 임시로
-- 확인용 행을 넣고 지운다(SQL Editor에서만).
-- begin;
--   insert into raw.purchase_order ("발주번호","품목코드","발주수량") values ('PO-CHECK-JUNK','ITEM007','많음');
--   select item_id, open_po_qty, reason_code from core.v_open_po_qty where item_id = 'ITEM007';
--   -- 기대: open_po_qty is null · reason_code = 'OPEN_PO_QTY_UNPARSEABLE'
--   --       (정상 파싱되는 1,000 행이 있어도 정크 행 하나가 전체를 null로 만든다 — 부분합 아님)
-- rollback;

-- (b) 화면이 실제로 읽는 뷰도 마찬가지인지 — STOCK_VIEW_ALL 권한 계정으로 실행.
-- select item_id, open_po_qty, open_po_reason_code, reason_code
--   from analytics.v_available_stock where item_id = 'ITEM007';
-- 기대: 예외 없이 조회되고, open_po_qty가 숫자로 나오고 open_po_reason_code is null.
--       reason_code(정상 창고재고 분류 사유)는 별개이며 ITEM007의 재고 분류 여부에 따라 다르다.

-- (c) 콤마가 없는 나머지 품목은 값이 그대로인지(회귀 확인) — 적용 전후 비교.
-- select count(*), sum(open_po_qty) from core.v_open_po_qty where reason_code is null;

-- (d) 파서 자체 동작 확인.
-- select core.parse_lenient_numeric('1,000');   -- 기대: 1000
-- select core.parse_lenient_numeric('  500 ');  -- 기대: 500
-- select core.parse_lenient_numeric('');        -- 기대: null
-- select core.parse_lenient_numeric(null);      -- 기대: null
-- select core.parse_lenient_numeric('많음');     -- 기대: null (예외 없음)

-- (e) 뷰의 security_invoker · 열 순서 확인.
-- select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'analytics' and c.relname = 'v_available_stock';
-- 기대: reloptions에 security_invoker=true
-- \d analytics.v_available_stock
-- 기대: 마지막 열이 open_po_reason_code (기존 12개 열 순서는 그대로)

-- (f) 데이터 정규화 실행 전 — 대상 행 미리보기(아무것도 바꾸지 않는다).
-- select "발주번호", "품목코드", "발주수량" from raw.purchase_order
--  where batch_id is null and "발주수량" is not null
--    and btrim("발주수량") !~ '^-?[0-9]+(\.[0-9]+)?$'
--    and core.parse_lenient_numeric("발주수량") is not null;
-- 기대(배포 DB): PO20261024 · ITEM007 · '1,000' 1행

-- (g) 데이터 정규화 실행과 확인 — supabase/practice-data/00c-normalize-legacy-po-qty.sql 참고.
-- select jsonb_pretty(core.normalize_legacy_purchase_order_qty(p_confirm => true));
-- select "발주수량" from raw.purchase_order where "발주번호" = 'PO20261024' and "품목코드" = 'ITEM007';
-- 기대: '1000' (콤마 제거, 값 자체는 이미 (a)에서 확인한 것과 같다 — 정규화는 raw 텍스트
--       모양만 정리할 뿐, open_po_qty 계산값은 정규화 전후로 바뀌지 않는다).

-- (h) 되돌리기.
-- select core.restore_normalized_purchase_order_qty();
-- select "발주수량" from raw.purchase_order where "발주번호" = 'PO20261024' and "품목코드" = 'ITEM007';
-- 기대: '1,000' (원본 그대로)
