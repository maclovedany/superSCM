-- 보정 · Open PO 참고 수량 계산이 발주수량 콤마 값 한 줄에 전체가 막히던 것을 고칩니다
--
-- ★ 증상 — STOCK_VIEW_ALL · STOCK_VIEW_PAPER · STOCK_VIEW_SUPPLY 권한을 가진 사용자가
--   analytics.v_available_stock을 전체 열로 조회하면 /inventory 화면 전체가 다음 오류로
--   막힙니다.
--       22P02: invalid input syntax for type numeric: "1,000"
--
-- ★ 원인 — raw.purchase_order에 5회차 실습 더미 한 줄(품목코드 ITEM007, 발주번호 PO20261024,
--   batch_id is null · source_type is null)이 "발주수량"에 천단위 콤마가 섞인 텍스트
--   '1,000'을 갖고 있습니다. core.v_open_po_qty가 raw.purchase_order."발주수량"과
--   raw.goods_receipt."입고수량"을 곧바로 `nullif(..., '')::numeric`으로 캐스트하는데,
--   PostgreSQL의 numeric 입력 파서는 콤마를 허용하지 않아 그 한 줄이 뷰 전체 집계
--   (group by)를 실패시킵니다. 이 뷰는 analytics.v_available_stock이 매 조회마다
--   참조하므로, 콤마 값이 있는 한 그 뷰를 부르는 화면 전체가 막힙니다(영업 전용
--   analytics.v_order_available_stock은 Open PO를 읽지 않아 영향이 없습니다).
--   배포 DB 확인(2026-09-12): 이 정확한 정의(NULLIF(...)::numeric)가 배포 core.v_open_po_qty와
--   저장소 20260911000500의 정의가 그대로 일치합니다 — 저장소·배포 사이 괴리는 없습니다.
--
-- ★ 해결 — 단순히 캐스트만 관대하게 바꾸는 것으로는 불충분합니다(아래 "출처 게이트"
--   항목 참고). 세 갈래로 고칩니다.
--
--   1) core.parse_lenient_numeric(text) — 읽기 경로 전용. 앞뒤 공백·천단위 콤마를 뗀 뒤
--      숫자로 바꿉니다. 그래도 숫자가 아니면 예외 대신 null을 돌려줍니다(집계 함수 안에서
--      쓰이므로 절대 예외를 밖으로 던지면 안 됩니다 — 던지면 오늘 사고가 재현됩니다).
--
--   2) core.require_lenient_numeric(text, label) — 적재 경로 전용. 같은 방식으로 콤마·
--      공백은 관대하게 받아들이되, 그래도 파싱할 수 없으면(빈 값이 아닌데 숫자가 아님)
--      **명확한 한국어 예외를 던져 배치 전체를 거부**합니다. 화면 경로와 적재 경로는
--      판단이 달라야 합니다 — 화면은 과거에 쌓인 raw 전체를 매번 다시 읽으므로 남 옛
--      더미 행 하나 때문에 죽으면 안 되지만(관용적으로 읽고 null+사유코드로 드러낸다),
--      적재는 "지금 이 배치"만 다루므로 조용히 통과시키면 틀린 값이 정본 표
--      (core.stock_balance · core.stock_receipt_ledger · core.month_end_inventory_snapshot)에
--      그대로 들어앉습니다 — 명확한 오류로 막아 업로더가 즉시 고치게 합니다.
--
--   3) **출처 게이트(가장 중요)** — 파싱을 관대하게 만드는 것만으로는 부족합니다.
--      raw.purchase_order 92행 · raw.goods_receipt 81행은 배포 DB에서 전부 batch_id가
--      null입니다(둘 다 출처가 전혀 없는 5회차 더미). 파싱만 고치면 이 더미 20개 품목의
--      발주 텍스트가 전부 숫자로 읽혀 Open PO 열에 실제 발주량처럼 보입니다(확인한 값:
--      더미 20품목 합계 28,800 — ITEM007만 봐도 이 품목의 다른 발주 행까지 합쳐 2,400).
--      **출처 없는 더미 숫자가 실데이터처럼 화면에 앉는 것은 죽는 화면보다 나쁩니다** —
--      이 저장소의 구속 원칙("지어낸 숫자가 실데이터처럼 보이면 안 된다")과 Task 9b
--      원천 게이트(raw.usage_history 학습 기간에 출처 없는 행이 있으면 발주량 계산을
--      막는 것과 완전히 같은 종류의 규칙), 그리고 memory("실데이터에 재고·리드타임이
--      없다")에 정면으로 어긋납니다. 그래서 core.v_open_po_qty는 발주수량·입고수량 중
--      하나라도 batch_id가 없는 행이 기여하면(파싱 가능 여부와 무관하게) 그 품목의
--      open_po_qty를 null로 냅니다 — 부분 합계도, 부분 출처 인정도 하지 않습니다
--      (usage_history 원천 게이트와 같은 전부-또는-전무 판정). 지금 배포 DB는 두 raw 표
--      전부 출처가 없으므로, 이 마이그레이션을 적용해도 **어떤 품목의 Open PO도 숫자로
--      보이지 않습니다** — 실제 발주 데이터가 정식 업로드 경로(core.commit_import_batch,
--      이때 batch_id가 채워집니다)로 들어올 때까지는 전부 null이 맞는 값입니다.
--
--      파싱 불가(콤마를 떼도 숫자가 아님)는 출처 게이트와 **별개**로 판정합니다(출처가
--      있는 행에서만 의미가 있으므로 출처 없는 행의 파싱 여부는 따지지 않습니다 — 어차피
--      그 행은 신뢰하지 않기 때문입니다). 두 판정 모두 null 하나로 합쳐지고, 사유를
--      구분해 보여주는 것은 열이 아니라 4-1절의 별도 상태 뷰입니다.
--
-- ★ core.v_open_po_qty · core.apply_stock_receipts_from_batch(Task 6 최종본,
--   20260911000610)를 다시 정의합니다. **열은 더하지 않습니다** — docs/stage1-판정기록.md
--   Task 16 판정: analytics.v_available_stock · core.v_open_po_qty에 사유 코드용 열을
--   추가하면 "전체를 파일명 순서로 다시 적용"하는 표준 복구 절차의 재실행 확인 단계가
--   "cannot drop columns from view"로 멈춥니다(error.md #24와 같은 현상 — 실제로 확인된
--   대가는 재실행 2회차가 20260911000500·20260911000600에서 멈추는 것이었습니다). 출처
--   게이트가 걸리면 기존 open_po_qty 열이 그대로 null이 되므로 스키마를 넓힐 필요가
--   없습니다. 사유는 **새 열이 아니라 새 객체**(허용됨)로 화면 수준에서 한 번만
--   안내합니다 — analytics.v_open_po_data_status(아래 4절) + OpenPoStatusBanner 컴포넌트,
--   이 저장소가 이미 practice-banner에 쓰는 것과 같은 패턴입니다.
--
-- ★ "발주수량 · 입고수량 · 단가" 세 열을 모두 훑었습니다(저장소 전체에서 정규식이 아니라
--   실제 참조 목록으로 — 아래 6절 확인 쿼리 (g) 참고). raw.purchase_order."단가"는 지금
--   core/analytics 어떤 뷰·함수도 참조하지 않습니다 — 배포 DB 전수조사에서도 이 열의
--   파싱 불가 행은 0건입니다. core.v_inbound_qty는 이름이 비슷하지만 raw.shipment_log의
--   네이티브 numeric qty 열을 읽습니다(raw.shipment_log.qty 컬럼 타입 자체가 numeric —
--   schema-dump로 확인) — raw 텍스트 캐스트가 전혀 없어 이 보정 대상이 아닙니다.
--
-- ★ 같은 패턴의 두 번째 사고 지점을 찾았습니다 — core.v_stock_on_hand(4~5회차 수업에서
--   SQL Editor로 직접 만든 뷰, supabase/realdata/03b-missing-objects.sql에 원본이 있고
--   2026-09-12 최신 배포 덤프에도 그대로 있습니다)가 raw.inventory."현재고"를 같은 방식
--   (`sum(nullif(...,'')::numeric)`, 출처 게이트 없음)으로 캐스트하고,
--   analytics.v_stockout_risk(/analysis 재고 소진 위험 화면)가 이 뷰를 직접 조인합니다.
--   raw.inventory도 43행 전부 출처 없는 5회차 더미입니다(20260911000500 주석). 이번
--   지시 범위(발주수량·입고수량·단가, analytics.v_available_stock 의존)에는 포함되지
--   않지만 같은 사고가 재발할 수 있는 지점이라 core.v_stock_on_hand만 같은 방식(관대한
--   파싱 + 출처 게이트)으로 함께 고칩니다. analytics.v_stockout_risk 자체는 건드리지
--   않습니다(그 뷰를 넓히는 것은 이번 판단 범위 밖이고, 이미 `coalesce(current_stock,
--   0)`으로 0 대체를 하고 있어 — 이 마이그레이션이 만든 동작이 아니라 기존 동작 —
--   core.v_stock_on_hand가 더 이상 죽지만 않으면 그 화면도 더 이상 죽지 않습니다).
--   raw.inventory."현재고"에 실제로 파싱 불가 행이 있는지는 확인하지 못했습니다(제 접근
--   범위에서는 배포 DB 데이터를 직접 조회할 수 없습니다) — 발주수량·입고수량·단가와 같은
--   방식으로 한 번 훑어봐 주시길 요청합니다.
--
-- ★ 이미 적용된 파일(20260911000500 · 20260911000600 · 20260911000610)은 고치지 않습니다.
--   아래 정의가 core.v_open_po_qty · core.apply_stock_receipts_from_batch ·
--   core.apply_stock_balance_from_batch · core.apply_month_end_inventory_snapshot_from_batch ·
--   core.v_stock_on_hand의 최종본이 됩니다. analytics.v_available_stock은 여기서 다시
--   정의하지 않습니다 — 20260911000600의 정의가 그대로 최종본이고, core.v_open_po_qty만
--   고쳐도 값이 자동으로 전파됩니다(아래 4절).
--
-- 다시 실행해도 안전합니다. 이 마이그레이션은 raw 데이터를 바꾸지 않습니다.
--
-- ★ 콤마 텍스트 자체의 데이터 정규화는 만들지 않습니다 — 출처 게이트가 걸리면 그 값을
--   정규화해도 화면·계산이 하나도 바뀌지 않습니다(raw.purchase_order 92행 전부 출처가
--   없으므로 콤마 여부와 무관하게 이미 null입니다). 운영 DB에 정규화용 표·함수를 남길
--   이유가 없어 만들지 않습니다(docs/stage1-판정기록.md Task 16 판정 — 1차 초안이 만들었던
--   보관·복원 기계는 화면 숫자에 영향이 없는데도 표면만 남기는 것이었고, 그 안전장치의
--   "건수 불일치 시 중단" 보장도 리뷰에서 신뢰할 수 없다는 지적을 받았습니다).


-- ══ 1. 숫자 파서 — 읽기 경로(관대) · 적재 경로(거부) ═══════════════════

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
  '읽기 경로 전용. 앞뒤 공백·천단위 콤마를 제거한 뒤 숫자로 바꾼다. 그래도 숫자가 아니면 '
  '(빈 문자열 포함) 예외 대신 null을 돌려준다 — 절대 예외를 던지지 않는다(집계 함수 안에서 '
  '쓰인다). 적재 경로에서 파싱 불가를 배치 거부로 다루려면 core.require_lenient_numeric을 '
  '쓴다';

revoke all on function core.parse_lenient_numeric(text) from public, anon;
grant execute on function core.parse_lenient_numeric(text) to authenticated;

-- 적재 경로 전용 — core.parse_lenient_numeric과 같은 방식으로 콤마·공백은 받아들이되,
-- 그래도 파싱할 수 없으면 명확한 한국어 예외를 던진다. 이 배치가 지금 막 적재하려는
-- 행에만 적용된다(과거에 쌓인 raw 전체를 매번 다시 읽는 화면 경로와 다르다) — 조용히
-- 통과시키면 틀린 값이 core.stock_balance 등 정본 표에 그대로 들어앉는다.
create or replace function core.require_lenient_numeric(p_raw text, p_label text default '값')
returns numeric
language plpgsql
immutable
set search_path = core, pg_temp
as $$
declare
  v_value numeric;
begin
  if p_raw is null or btrim(p_raw) = '' then
    return null;
  end if;
  v_value := core.parse_lenient_numeric(p_raw);
  if v_value is null then
    raise exception '%을(를) 숫자로 바꿀 수 없습니다: "%"', p_label, p_raw using errcode = '22P02';
  end if;
  return v_value;
end;
$$;

comment on function core.require_lenient_numeric(text, text) is
  '적재 경로 전용. core.parse_lenient_numeric과 같이 콤마·공백을 허용하지만, 그래도 '
  '파싱할 수 없는 비어있지 않은 값을 만나면 명확한 한국어 예외를 던져 그 배치 커밋 '
  '전체를 거부한다(errcode 22P02). commit_import_batch가 감싸지 않으므로 예외가 그대로 '
  '전파돼 트랜잭션이 롤백된다';

revoke all on function core.require_lenient_numeric(text, text) from public, anon, authenticated;


-- ══ 2. Open PO 참고 열 — 관대한 파싱 + 출처 게이트 ═══════════════════
--
-- ★ 20260911000500의 정의를 대체합니다(이후 재정의 없음 — 이 파일이 최종본). 열 이름·순서는
--   그대로 유지합니다(item_id, open_po_qty) — 사유 열은 더하지 않습니다(파일 머리말·
--   docs/stage1-판정기록.md Task 16 판정 참고). 두 조건 중 하나라도 걸리면 그 품목의
--   open_po_qty 전체를 null로 냅니다(부분 합계 금지 — 위 헤더 "출처 게이트" 참고).
--     a) 파싱 불가 — 출처 있는(batch_id not null) 행 중 원본이 비어 있지 않은데 콤마·공백을
--        떼도 숫자가 아닌 행이 하나라도 있음
--     b) 출처 없음 — 발주수량·입고수량에 기여하는 행 중 batch_id가 null인 행이 하나라도
--        있음(파싱 가능 여부와 무관)
--   빈 값(공란)은 그대로 집계에서 빠집니다 — 기존과 같은 동작입니다. 두 조건을 구분해서
--   보여주는 사유는 4절의 analytics.v_open_po_data_status가 별도로 제공합니다.

create or replace view core.v_open_po_qty as
with ordered as (
  select
    upper(regexp_replace(p."품목코드", '[\s\-_]', '', 'g')) as item_id,
    sum(core.parse_lenient_numeric(p."발주수량")) filter (where p.batch_id is not null) as ordered_qty,
    bool_or(p.batch_id is null) as has_unverified_source,
    bool_or(
      p.batch_id is not null
      and p."발주수량" is not null and btrim(p."발주수량") <> ''
      and core.parse_lenient_numeric(p."발주수량") is null
    ) as has_unparseable
  from raw.purchase_order p
  group by upper(regexp_replace(p."품목코드", '[\s\-_]', '', 'g'))
),
received as (
  select
    upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g')) as item_id,
    sum(core.parse_lenient_numeric(g."입고수량")) filter (where g.batch_id is not null) as received_qty,
    bool_or(g.batch_id is null) as has_unverified_source,
    bool_or(
      g.batch_id is not null
      and g."입고수량" is not null and btrim(g."입고수량") <> ''
      and core.parse_lenient_numeric(g."입고수량") is null
    ) as has_unparseable
  from raw.goods_receipt g
  where nullif(g."입고일", '') is not null
    and g.receipt_status = 'COMPLETED'
  group by upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g'))
)
select
  o.item_id,
  case when o.has_unparseable or coalesce(r.has_unparseable, false)
         or o.has_unverified_source or coalesce(r.has_unverified_source, false)
       then null
       else greatest(0, o.ordered_qty - coalesce(r.received_qty, 0))
  end as open_po_qty
from ordered o
left join received r on r.item_id = o.item_id;

comment on view core.v_open_po_qty is
  '보정(2026-09-12) — 품목별 Open PO 참고 수량 = 발주수량 합 - 입고완료(입고일 존재 + '
  'receipt_status=COMPLETED) 합. 출처 없는(batch_id is null) 행이 하나라도 기여하거나, '
  '출처 있는 행 중 파싱 불가한 행이 있으면 부분 합계 대신 null(사유 구분은 '
  'analytics.v_open_po_data_status 참고 — 이 뷰 자체에는 사유 열을 두지 않는다, '
  'docs/stage1-판정기록.md Task 16). 음수는 0으로 clamp한다. 가용재고 계산에는 더하지 '
  '않는 참고 열이다';

grant select on core.v_open_po_qty to authenticated;
revoke all on core.v_open_po_qty from anon, public;


-- ══ 3. 적재 함수 세 곳 — 관대한 파싱 + 파싱 불가 시 배치 거부 ══════════
--
-- ★ 아래 세 함수는 core.commit_import_batch(관리자 전용) · core.refresh_stock_balance만
--   부르는 권한 검사 없는 내부 함수다. 처리하는 행은 전부 `batch_id = p_batch_id`로
--   필터링된, 지금 막 커밋되는 배치 소속이다 — 그 배치 자체가 출처이므로 여기서는 출처
--   게이트를 적용하지 않는다(출처 게이트는 과거에 쌓인 raw 전체를 다시 읽는 core.v_open_po_qty·
--   core.v_stock_on_hand 같은 읽기 경로에만 해당한다).

-- 3-1. core.apply_stock_balance_from_batch — 20260911000500 정의를 대체한다(이후 재정의
--   없음). 현재고 캐스트만 core.require_lenient_numeric으로 바꾼다. 나머지 로직은 원본과
--   동일하다.
create or replace function core.apply_stock_balance_from_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_count integer;
  v_item_ids text[];
begin
  with classified as (
    select
      upper(regexp_replace(i."품목코드", '[\s\-_]', '', 'g')) as item_id,
      core.require_lenient_numeric(i."현재고", '현재고') as qty,
      i.snapshot_at,
      core.classify_inventory_scope(i.warehouse_code, i.inventory_status) as scope_code
    from raw.inventory i
    where i.batch_id = p_batch_id
      and i.warehouse_code is not null
      and nullif(i."현재고", '') is not null
      and i.snapshot_at is not null
  ),
  classified_only as (
    select * from classified where scope_code is not null
  ),
  aggregated as (
    select
      item_id,
      coalesce(sum(qty) filter (where scope_code = 'NORMAL'), 0) as snapshot_qty,
      max(snapshot_at) filter (where scope_code = 'NORMAL') as snapshot_at
    from classified_only
    group by item_id
  ),
  upserted as (
    insert into core.stock_balance (item_id, snapshot_qty, normal_qty, snapshot_at, source_batch_id, updated_at)
    select item_id, snapshot_qty, snapshot_qty, snapshot_at, p_batch_id, now()
      from aggregated
    on conflict (item_id) do update
      set snapshot_qty    = excluded.snapshot_qty,
          snapshot_at     = excluded.snapshot_at,
          source_batch_id = excluded.source_batch_id,
          updated_at      = now()
    returning item_id
  )
  select array_agg(item_id) into v_item_ids from upserted;

  v_count := coalesce(array_length(v_item_ids, 1), 0);

  if v_item_ids is not null then
    perform core.recompute_stock_balance_totals(v_item_ids);
  end if;

  return v_count;
end;
$$;

comment on function core.apply_stock_balance_from_batch(uuid) is
  'Task 4 원본 + 보정(2026-09-12): 현재고 캐스트를 core.require_lenient_numeric으로 바꿔 '
  '콤마·공백은 받아들이고, 그래도 파싱 불가면 배치 커밋 전체를 명확한 오류로 거부한다 '
  '(조용히 건너뛰지 않는다). 권한 검사가 없는 내부 계산 — core.refresh_stock_balance와 '
  'core.commit_import_batch를 거친다';

revoke all on function core.apply_stock_balance_from_batch(uuid) from public, anon, authenticated;

-- 3-2. core.apply_month_end_inventory_snapshot_from_batch — 20260911001150 정의를
--   대체한다(이후 재정의 없음). 같은 처리.
create or replace function core.apply_month_end_inventory_snapshot_from_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_count integer;
begin
  with classified as (
    select
      upper(regexp_replace(i."품목코드", '[\s\-_]', '', 'g')) as item_id,
      core.require_lenient_numeric(i."현재고", '현재고') as qty,
      i.snapshot_at,
      core.classify_inventory_scope(i.warehouse_code, i.inventory_status) as scope_code
    from raw.inventory i
    where i.batch_id = p_batch_id
      and i.warehouse_code is not null
      and nullif(i."현재고", '') is not null
      and i.snapshot_at is not null
  ),
  normal_only as (
    select item_id, qty, snapshot_at from classified where scope_code = 'NORMAL'
  ),
  aggregated as (
    select
      item_id,
      date_trunc('month', snapshot_at at time zone 'Asia/Seoul')::date as plan_month,
      sum(qty) as normal_qty,
      max(snapshot_at) as snapshot_at
    from normal_only
    group by item_id, date_trunc('month', snapshot_at at time zone 'Asia/Seoul')::date
  ),
  upserted as (
    insert into core.month_end_inventory_snapshot (plan_month, item_id, normal_qty, snapshot_at, source_batch_id, updated_at)
    select plan_month, item_id, normal_qty, snapshot_at, p_batch_id, now()
      from aggregated
    on conflict (plan_month, item_id) do update
       set normal_qty      = excluded.normal_qty,
           snapshot_at     = excluded.snapshot_at,
           source_batch_id = excluded.source_batch_id,
           updated_at      = now()
     where excluded.snapshot_at >= core.month_end_inventory_snapshot.snapshot_at
    returning item_id
  )
  select count(*) into v_count from upserted;
  return coalesce(v_count, 0);
end;
$$;

comment on function core.apply_month_end_inventory_snapshot_from_batch(uuid) is
  'Task 12 원본 + 보정(2026-09-12): 현재고 캐스트를 core.require_lenient_numeric으로 바꿔 '
  '콤마·공백은 받아들이고, 그래도 파싱 불가면 배치 커밋 전체를 명확한 오류로 거부한다. '
  '권한 검사 없음 — commit_import_batch · refresh_stock_balance만 부른다';

revoke all on function core.apply_month_end_inventory_snapshot_from_batch(uuid) from public, anon, authenticated;

-- 3-3. core.apply_stock_receipts_from_batch — Task 6 최종본(20260911000610)을 대체한다.
--   자동 배정 · MANUAL 알림 로직은 그대로 두고, 입고수량 처리만 바꾼다.
--   ★ 이전 초안(리뷰에서 지적됨)은 파싱 불가 행을 "조용히" 원장에서 뺐다 — 이는 잘못된
--     판단이다: 적재 경로는 화면 경로와 달리 지금 이 배치만 다루므로, 파싱 불가를
--     조용히 넘기면 사용자가 모르는 사이 입고 한 건이 통째로 누락된 채 배치가 "성공"으로
--     끝난다. 이번 정의는 core.require_lenient_numeric으로 바꿔 파싱 불가면 배치 전체를
--     명확한 오류로 거부한다 — 다른 제외 조건(미완료 상태·수량 0 이하·입고일 없음)은
--     여전히 조용히 제외한다(그건 "이 행은 아직 완료되지 않았다/유효하지 않다"는 사실이지
--     데이터 오류가 아니기 때문이다).
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
  with candidate as (
    -- "창고 입고 완료" = 입고일이 있고 receipt_status가 COMPLETED인 건. 수량이 비어
    -- 있으면(공란) 조용히 제외한다 — 아직 수량을 안 적었다는 사실이지 오류가 아니다.
    -- 수량이 있는데 숫자로 바꿀 수 없으면(콤마를 떼도 안 됨) require_lenient_numeric이
    -- 예외를 던져 이 배치 커밋 전체를 거부한다.
    select
      upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g')) as item_id,
      core.require_lenient_numeric(g."입고수량", '입고수량') as qty,
      nullif(g."입고일", '')::timestamptz as completed_at,
      g.source_record_id
    from raw.goods_receipt g
    where g.batch_id = p_batch_id
      and g.receipt_status = 'COMPLETED'
      and nullif(g."입고일", '') is not null
      and nullif(g."입고수량", '') is not null
      and g.source_record_id is not null
  ),
  completed as (
    -- ★ fix round 3(원본) — 수량 0(또는 그 이하)인 완료 입고는 잔액을 바꾸지 않으므로
    --   원장에 남기지 않는다. 이건 오류가 아니라 "0을 적었다"는 사실이다.
    select * from candidate where qty > 0
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
  'Task 6 원본 + 보정(2026-09-12): 입고수량 캐스트를 core.require_lenient_numeric으로 바꿔 '
  '콤마·공백은 받아들이고, 그래도 파싱 불가면 배치 커밋 전체를 명확한 오류로 거부한다 '
  '(조용히 원장에서 빼지 않는다 — 리뷰 반영: 이전 초안의 조용한 제외를 되돌렸다). 권한 검사가 '
  '없는 내부 계산 — core.commit_import_batch만 부른다. 같은 (source_record_id, item_id) '
  '조합은 두 번 반영되지 않는다. 새로 반영된 원장 행마다 AUTO 품목은 core.allocate_new_stock, '
  'MANUAL 품목은 처리 필요 알림을 같은 트랜잭션에서 실행한다';

revoke all on function core.apply_stock_receipts_from_batch(uuid) from public, anon, authenticated;


-- ══ 4. 가용재고 상세 뷰 — 다시 정의하지 않는다 ══════════════════════════
--
-- ★ analytics.v_available_stock은 이 마이그레이션이 건드리지 않습니다 — 건드릴 필요가
--   없습니다. 그 뷰는 `po.open_po_qty`를 core.v_open_po_qty에서 그대로 가져올 뿐이고,
--   PostgreSQL은 뷰를 쿼리 실행 시점에 하위 뷰 정의로 풀어내므로, 2절에서 core.v_open_po_qty
--   를 고친 것만으로 analytics.v_available_stock도 자동으로 크래시 없는 값을 돌려줍니다.
--   열을 추가하지 않기로 한 판단(docs/stage1-판정기록.md Task 16)과 함께, 이 뷰의 DDL
--   자체를 전혀 재정의하지 않아 "cannot drop columns from view" 위험도 원천적으로 없습니다.


-- ══ 4-1. Open PO 상태 안내 — 별도 객체(열이 아니라 새 뷰) ═════════════════
--
-- ★ 화면에 사유를 알려야 하지만 기존 뷰에 열을 더하지 않기로 했으므로(위 3절·머리말 참고),
--   이 저장소가 practice-data에 이미 쓰는 패턴(별도 상태 뷰 + 배너 컴포넌트, error.md #18
--   근처 practice-banner 참고)을 그대로 따라 **새 뷰**를 만듭니다. 이 뷰는 core.v_open_po_qty의
--   판정 조건을 그대로 다시 계산해(같은 술어) 지금 Open PO가 출처 미확인·파싱 불가 데이터에
--   걸려 있는지 화면 전체 기준으로 한 번만 알려줍니다(품목별이 아니라 요약 한 줄). 새 객체이므로
--   나중에 열을 자유롭게 늘릴 수 있습니다 — 앞 마이그레이션과의 재실행 충돌이 없습니다.

-- ★ authenticated는 raw 테이블에 직접 GRANT가 없으므로(SCHEMA.md), security_invoker 뷰가
--   raw를 직접 참조하면 permission denied가 난다(error.md #22). core.v_open_po_qty와 같은
--   자리에 소유자 권한 core 뷰를 먼저 두고, analytics 뷰는 그 결과만 읽는다.
create or replace view core.v_open_po_data_status as
select
  exists (select 1 from raw.purchase_order p where p.batch_id is null)
    or exists (
      select 1 from raw.goods_receipt g
       where g.batch_id is null and g.receipt_status = 'COMPLETED' and nullif(g."입고일", '') is not null
    ) as has_unverified_source,
  exists (
    select 1 from raw.purchase_order p
     where p.batch_id is not null and p."발주수량" is not null and btrim(p."발주수량") <> ''
       and core.parse_lenient_numeric(p."발주수량") is null
  ) or exists (
    select 1 from raw.goods_receipt g
     where g.batch_id is not null and g.receipt_status = 'COMPLETED' and nullif(g."입고일", '') is not null
       and g."입고수량" is not null and btrim(g."입고수량") <> '' and core.parse_lenient_numeric(g."입고수량") is null
  ) as has_unparseable;

comment on view core.v_open_po_data_status is
  '보정(2026-09-12) — core.v_open_po_qty와 같은 판정 조건으로 Open PO 계산이 지금 출처
  미확인 또는 파싱 불가 데이터에 걸려 있는지 화면 전체 기준 한 줄로 요약한다. 소유자 권한
  으로 raw를 직접 읽는다 — analytics.v_open_po_data_status가 권한 필터를 얹어 감싼다';

grant select on core.v_open_po_data_status to authenticated;
revoke all on core.v_open_po_data_status from anon, public;

create or replace view analytics.v_open_po_data_status
with (security_invoker = true)
as
select s.has_unverified_source, s.has_unparseable
  from core.v_open_po_data_status s
 where core.has_permission('STOCK_VIEW_ALL')
    or core.has_permission('STOCK_VIEW_PAPER')
    or core.has_permission('STOCK_VIEW_SUPPLY');

comment on view analytics.v_open_po_data_status is
  '보정(2026-09-12) — 화면 배너 전용 요약(품목별이 아님). core.v_open_po_data_status를 재고
  상세 권한(STOCK_VIEW_ALL·STOCK_VIEW_PAPER·STOCK_VIEW_SUPPLY)으로만 연다. 권한이 없으면
  0행 — OpenPoStatusBanner는 이 뷰가 0행이면 아무것도 표시하지 않는다. security_invoker로
  호출자 RLS를 그대로 적용한다';

grant select on analytics.v_open_po_data_status to authenticated;
revoke all on analytics.v_open_po_data_status from anon, public;


-- ══ 4-2. 두 번째 사고 지점 — core.v_stock_on_hand ═══════════════════
--
-- ★ 이번 지시 범위(발주수량·입고수량·단가, v_available_stock 의존)에는 없지만, 같은
--   패턴(raw 텍스트를 곧바로 ::numeric, 출처 게이트 없음)의 뷰를 저장소 전체 참조 조사
--   중에 발견해 같은 방식으로 고칩니다. raw.inventory."현재고"도 43행 전부 출처 없는
--   더미이므로(20260911000500 주석) 이 마이그레이션 적용 즉시 모든 품목의 current_stock이
--   null이 되는 것이 맞습니다 — 지어낸 재고 수량이 analytics.v_stockout_risk(재고 소진
--   위험)에 실제처럼 보이지 않게 합니다. 이 뷰는 열 이름·순서를 바꾸지 않으므로(item_id,
--   current_stock 그대로) analytics.v_stockout_risk를 넓히지 않고도 크래시만 없앨 수
--   있습니다 — 그 뷰는 이미 coalesce(current_stock, 0)으로 0 대체를 하고 있고(기존 동작,
--   이 마이그레이션이 만들지 않았습니다), 그 동작 자체는 건드리지 않습니다.

create or replace view core.v_stock_on_hand as
select
  upper(regexp_replace(i."품목코드", '[\s\-_]', '', 'g')) as item_id,
  case when bool_or(i.batch_id is null)
         or bool_or(
              i."현재고" is not null and btrim(i."현재고") <> ''
              and core.parse_lenient_numeric(i."현재고") is null
            )
       then null
       else sum(core.parse_lenient_numeric(i."현재고")) filter (where i.batch_id is not null)
  end as current_stock
from raw.inventory i
group by upper(regexp_replace(i."품목코드", '[\s\-_]', '', 'g'));

comment on view core.v_stock_on_hand is
  '보정(2026-09-12) — 4~5회차 수업에서 직접 만든 레거시 뷰(원본:
  supabase/realdata/03b-missing-objects.sql). raw.inventory."현재고"를 곧바로 ::numeric '
  '캐스트해 콤마 값 한 줄로 analytics.v_stockout_risk 전체가 막힐 수 있었다(같은 사고
  클래스, core.v_open_po_qty와 동일한 원인). core.parse_lenient_numeric + 출처 게이트로 '
  '고쳤다 — 파싱 불가·출처 없음 중 하나라도 있으면 그 품목은 null(0으로 만들지 않는다). '
  '지금 raw.inventory 43행 전부 출처가 없어 이 뷰는 당분간 전부 null을 낸다';

grant select on core.v_stock_on_hand to authenticated;
revoke all on core.v_stock_on_hand from anon, public;


-- ══ 6. 수동 적용 후 확인 쿼리 ═══════════════════════════════════════
--
-- ★ 아래 (a)는 select *(컬럼 프루닝을 이기는 형태)로 확인한다 — count(*)·필터된 count·
--   품목별 열 하나만 읽는 쿼리는 옛 정의에서도 플래너가 open_po_qty 계산 자체를 가지치기해
--   성공할 수 있다(docs/stage1-판정기록.md Task 16 판정 — "테스트는 컬럼 프루닝을 이기는
--   형태로 쓴다"). select *(또는 plpgsql `for r in select * from ... loop`)만 옛 정의에서
--   실제로 22P02를 낸다.

-- (a) 콤마 값이 있어도 조회 자체가 실패하지 않는지.
-- select * from core.v_open_po_qty where item_id = 'ITEM007';
-- 기대: 예외 없이 1행, open_po_qty is null.

-- (b) 실제로 null인 이유가 출처 게이트인지 — raw.purchase_order 92행 전부 batch_id가 null이기
-- 때문이다(콤마 여부와 무관하게 이미 이 사유다. 콤마만 없었어도 결과는 같다).
-- select count(*) as unverified_source_rows from raw.purchase_order where batch_id is null;
-- 기대(배포 DB): 92

-- (c) 화면이 실제로 읽는 뷰도 마찬가지인지 — STOCK_VIEW_ALL 권한 계정으로 실행. 이 뷰는 이번
-- 마이그레이션에서 다시 정의하지 않았지만, core.v_open_po_qty를 참조하므로 자동으로 고쳐진다.
-- select item_id, open_po_qty from analytics.v_available_stock where item_id = 'ITEM007';
-- 기대: 예외 없이 조회되고, open_po_qty is null.

-- (d) 화면 배너가 읽을 상태 뷰 확인 — STOCK_VIEW_ALL 권한 계정으로 실행.
-- select * from analytics.v_open_po_data_status;
-- 기대(배포 DB): has_unverified_source = true(92행 전부 출처 없음), has_unparseable은
--       raw.purchase_order·raw.goods_receipt에 출처 있는 파싱 불가 행이 없으면 false.

-- (e) 파서 자체 동작 확인.
-- select core.parse_lenient_numeric('1,000');   -- 기대: 1000
-- select core.parse_lenient_numeric('  500 ');  -- 기대: 500
-- select core.parse_lenient_numeric('');        -- 기대: null
-- select core.parse_lenient_numeric(null);      -- 기대: null
-- select core.parse_lenient_numeric('많음');     -- 기대: null (예외 없음)
-- select core.require_lenient_numeric('1,000', '현재고');  -- 기대: 1000
-- select core.require_lenient_numeric('많음', '현재고');    -- 기대: 예외(22P02, 명확한 한국어 메시지)

-- (f) analytics.v_available_stock을 이 마이그레이션이 다시 정의하지 않았는지(열 추가 금지 —
-- docs/stage1-판정기록.md Task 16 판정) 확인.
-- select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'analytics' and c.relname = 'v_available_stock';
-- \d analytics.v_available_stock
-- 기대: 기존 12개 열 그대로(추가된 열 없음)

-- (g) raw 텍스트 → numeric 캐스트 전수 참조 확인(정규식이 아니라 실제 grep 결과 — 저장소
-- 전체 supabase/migrations · supabase/realdata에서 Korean 텍스트 컬럼을 ::numeric으로
-- 캐스트하는 지점은 정확히 다섯 곳이었고 전부 이 마이그레이션이 다룬다:
--   core.v_open_po_qty(발주수량·입고수량, 2절) · core.apply_stock_balance_from_batch(현재고, 3-1) ·
--   core.apply_month_end_inventory_snapshot_from_batch(현재고, 3-2) ·
--   core.apply_stock_receipts_from_batch(입고수량, 3-3) · core.v_stock_on_hand(현재고, 4-2).
-- 단가를 캐스트하는 곳은 0건이었다.

-- (h) raw.inventory."현재고"에 실제 파싱 불가 행이 있는지(제 환경에서는 확인 불가 — 요청).
-- select "품목코드", "현재고" from raw.inventory
--  where "현재고" is not null and btrim("현재고") !~ '^-?[0-9]+(\.[0-9]+)?$';
