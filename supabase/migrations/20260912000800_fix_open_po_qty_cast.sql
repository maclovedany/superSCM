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
--   안내합니다 — analytics.v_stock_reference_source_status(아래 4-2절) +
--   StockReferenceStatusBanner 컴포넌트, 이 저장소가 이미 practice-banner에 쓰는 것과
--   같은 패턴입니다.
--
-- ★ 같은 결함이 바로 옆 참고 열에도 있었습니다 — in_transit_qty(이동 중 참고,
--   core.v_inbound_qty가 채움). 캐스트 크래시는 없습니다(raw.shipment_log.qty는 이미
--   numeric 타입) — 하지만 team-lead 배포 측정: raw.shipment_log 2,864행 **전부**
--   batch_id null, IN_TRANSIT 117행·수량 합 12,137이 그대로 화면에 나갑니다. Open PO만
--   고치면 화면이 살아나는 순간 이 열이 지어낸 12,137을 그대로 노출합니다 — 그래서 같은
--   출처 게이트를 core.v_inbound_qty에도 적용합니다(4-1절). 게다가 raw.shipment_log.batch_id
--   는 채우는 적재 경로 자체가 없습니다(commit_import_batch에 shipment 분기가 없고
--   schema.ts에도 없습니다) — Open PO의 "아직 IMPORT 안 됨"과 달리 "지금 구조로는 영구히
--   채울 수 없음"이라 별도 사유코드(IN_TRANSIT_NO_IMPORT_PATH)로 구분합니다.
--
-- ★ "발주수량 · 입고수량 · 단가" 세 열을 모두 훑었습니다(저장소 전체에서 정규식이 아니라
--   실제 참조 목록으로 — 아래 6절 확인 쿼리 (g) 참고). raw.purchase_order."단가"는 지금
--   core/analytics 어떤 뷰·함수도 참조하지 않습니다 — 배포 DB 전수조사에서도 이 열의
--   파싱 불가 행은 0건입니다.
--
-- ★ 같은 패턴의 잠재 결함을 세 번째 지점에서 선제 차단합니다 — core.v_stock_on_hand
--   (4~5회차 수업에서 SQL Editor로 직접 만든 뷰, 정본은 supabase/realdata/03b-missing-objects.sql)
--   가 raw.inventory."현재고"를 같은 방식(`sum(nullif(...,'')::numeric)`, 출처 게이트 없음)
--   으로 캐스트하고, analytics.v_stockout_risk(/analysis 재고 소진 위험 화면)가 이 뷰를
--   직접 조인합니다. **team-lead가 배포 DB에서 직접 확인**: raw.inventory."현재고"에
--   파싱 불가 행은 0건(비어 있지 않은 값 54개 전부 순수 숫자)이고, core.v_stock_on_hand ·
--   analytics.v_stockout_risk 둘 다 지금 정상 조회됩니다 — **/analysis는 지금 죽어 있지
--   않습니다.** 게다가 그 화면(`app/(user)/analysis/stockout/page.tsx`)은 안내 컴포넌트만
--   렌더하고 이 뷰를 실제로 쿼리하지 않으며, 등록된 에이전트 툴 4개도 이 뷰를 읽지
--   않습니다 — 지금은 앱에서 도달 불가능합니다. 그래도 같은 무방비 캐스트 패턴이고
--   raw.inventory도 43행 전부 출처 없는 5회차 더미이므로(20260911000500 주석), **같은
--   사고가 나중에 재발하는 것을 미리 막기 위해**(살아 있는 크래시를 고치는 것이 아니라)
--   core.v_stock_on_hand만 같은 방식(관대한 파싱 + 출처 게이트)으로 함께 고칩니다.
--   analytics.v_stockout_risk 자체는 건드리지 않습니다(그 뷰를 넓히는 것은 이번 판단
--   범위 밖이고, 이미 `coalesce(current_stock, 0)`으로 0 대체를 하고 있어 — 이
--   마이그레이션이 만든 동작이 아니라 기존 동작입니다).
--
-- ★ 이미 적용된 파일(20260911000500 · 20260911000600 · 20260911000610)은 고치지 않습니다.
--   아래 정의가 core.v_open_po_qty · core.apply_stock_receipts_from_batch ·
--   core.apply_stock_balance_from_batch · core.apply_month_end_inventory_snapshot_from_batch ·
--   core.v_stock_on_hand · core.v_fact_shipment · core.v_inbound_qty의 최종본이 됩니다.
--   뒤 두 개는 정본이 supabase/realdata/03b-missing-objects.sql이고(그 파일도 같은
--   게이트를 갖도록 함께 고쳤습니다 — 4-1절 참고), 저장소 **마이그레이션**에는 이 파일이
--   처음입니다. analytics.v_available_stock은 여기서 다시 정의하지 않습니다 —
--   20260911000600의 정의가 그대로 최종본이고, core.v_open_po_qty·core.v_inbound_qty만
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

-- ★ 리뷰 라운드 3 — supabase/realdata/03b-missing-objects.sql의 core.v_stock_on_hand(§4-3
--   참고)가 이 함수를 쓰는데 03b가 이 마이그레이션보다 먼저 적용되므로, 03b 안에도 이
--   정의를 그대로 복제해 두었다. **이 함수를 고칠 때는 그 복제본도 함께 고친다.**

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
--   보여주는 사유는 4-2절의 analytics.v_stock_reference_source_status가 별도로 제공합니다.

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
  'analytics.v_stock_reference_source_status 참고 — 이 뷰 자체에는 사유 열을 두지 않는다, '
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


-- ══ 4-1. 이동 중(참고) 열도 같은 결함 — core.v_fact_shipment · core.v_inbound_qty ═══
--
-- ★ team-lead 배포 측정(2026-09-12): raw.shipment_log 2,864행 전부 batch_id가 null이다.
--   IN_TRANSIT 117행·수량 합 12,137이 core.v_inbound_qty → analytics.v_available_stock.
--   in_transit_qty로 그대로 나간다 — Open PO와 똑같이 "출처 없는 더미 숫자가 실적처럼
--   보이는" 결함이다(캐스트 크래시는 없다 — raw.shipment_log.qty가 이미 numeric 타입이라
--   22P02는 안 나지만, 지어낸 숫자가 화면에 앉는 문제는 동일하다). Open PO만 고치고 이
--   열을 그대로 두면, 화면을 살리는 순간 Open PO는 정직하게 비고 바로 옆 열은 12,137을
--   보이는 상태로 배포된다 — 둘 중 어느 쪽보다 나쁘다.
--
-- ★★ 정정(2026-09-12, team-lead) — 이 두 뷰의 정본은 배포 DB가 아니라
--   supabase/realdata/03b-missing-objects.sql이다(저장소 안에 이미 있다 — 2026-09-11
--   docs/db-저장소-대조가 진단·조치한 26건 중 24건이 그 파일로 편입됐다). 적용 순서가
--   realdata → migrations이므로 이 마이그레이션의 create or replace가 나중에 이겨 배포
--   DB는 항상 게이트 걸린 정의를 쓰지만, **03b를 단독으로 재실행하는 것이 문서화된 복구
--   절차**이므로 03b 쪽 정의도 같은 게이트를 가져야 한다(그러지 않으면 단독 재실행 때
--   게이트가 조용히 사라진다). 그래서 03b의 두 뷰 정의도 이 마이그레이션과 같은 내용으로
--   함께 고쳤다(batch_id 노출 + 출처 게이트, CREATE VIEW → CREATE OR REPLACE VIEW로
--   바꿔 재실행 안전하게 만들었다) — **이 뷰를 다시 고칠 때는 두 파일을 항상 함께 고친다.**
--   core.v_fact_shipment는 03b의 정의에 batch_id 열만 끝에 추가한다 — 열 구성 확대가
--   아니다(이 두 뷰 모두 저장소 **마이그레이션**에는 이 파일 전까지 없었으므로, 여기서는
--   "cannot drop columns" 위험이 없다 — 위험은 03b를 단독 재실행할 때뿐이고, 그건 03b
--   자체를 고쳐서 막았다).
create or replace view core.v_fact_shipment as
select
  shipment_id,
  upper(regexp_replace(coalesce(po_no, ''), '[\s\-_]', '', 'g')) as po_no,
  upper(regexp_replace(coalesce(item_id, ''), '[\s\-_]', '', 'g')) as item_id,
  supplier_id,
  country,
  case upper(btrim(transport_mode))
    when '해상' then 'SEA'
    when '항공' then 'AIR'
    else upper(btrim(transport_mode))
  end as transport_mode,
  order_date,
  due_date,
  supplier_ship_date,
  port_departure_date,
  port_arrival_date,
  customs_clear_date,
  warehouse_receipt_date,
  qc_release_date,
  qty,
  status,
  nullif(btrim(coalesce(incident_note, '')), '') as incident_note,
  (supplier_ship_date - order_date) as seg_order_to_ship,
  (qc_release_date - supplier_ship_date) as seg_ship_to_receive,
  (qc_release_date - order_date) as lt_total,
  case
    when status = 'IN_TRANSIT' then 'IN_TRANSIT'
    when order_date is null or qc_release_date is null then 'MISSING_DATE'
    when qc_release_date < warehouse_receipt_date then 'IMPOSSIBLE_ORDER'
    when warehouse_receipt_date < order_date then 'IMPOSSIBLE_ORDER'
    else 'OK'
  end as quality_flag,
  batch_id
from raw.shipment_log s;

comment on view core.v_fact_shipment is
  '보정(2026-09-12) — 정본은 supabase/realdata/03b-missing-objects.sql(그 파일을 고칠 때
  이 정의도 함께 고친다). 03b의 정의에 batch_id만 끝에 추가했다(출처 게이트용).
  docs/db-저장소-대조 §6.2가 "발주 계산에 재사용하면 안 되고 4~5회차 화면 전용으로
  남긴다"고 이미 결론냈는데 analytics.v_available_stock이 core.v_inbound_qty를 통해
  재사용 중이다 — 이 마이그레이션은 그 구조를 바꾸지 않는다(범위 밖)';

grant select on core.v_fact_shipment to authenticated;
revoke all on core.v_fact_shipment from anon, public;

-- ★ raw.shipment_log.batch_id는 열은 있지만(STEP 3) 채우는 적재 경로가 없다 —
--   core.commit_import_batch의 import_type 분기에 shipment 종류가 없고
--   lib/import/schema.ts에도 없다. 유일한 기입자는 4~5회차 강의 로더이고 그 로더는 이
--   열을 채우지 않는다(22열 표에 18개 값만 넣는다). 즉 이 게이트는 Open PO처럼 "아직
--   IMPORT 안 됨"이 아니라 "지금 구조로는 영구히 채울 수 없음"이다 — 상태 뷰(4-2절)가
--   이 둘을 다른 사유코드로 구분한다. docs/stage1-supabase-수동적용.md에 안내를 남긴다.
create or replace view core.v_inbound_qty as
select
  f.item_id,
  case when bool_or(f.batch_id is null) then null
       else sum(f.qty) filter (where f.batch_id is not null)
  end as inbound_qty,
  case when bool_or(f.batch_id is null) then null
       else count(*) filter (where f.batch_id is not null)
  end as inbound_shipments,
  case when bool_or(f.batch_id is null) then null
       else min(f.order_date + coalesce(
              (select e.effective_lead_time from core.v_leadtime_effective e where e.supplier_id = f.supplier_id),
              30
            )) filter (where f.batch_id is not null)
  end as earliest_eta
from core.v_fact_shipment f
where f.status = 'IN_TRANSIT'
group by f.item_id;

comment on view core.v_inbound_qty is
  '보정(2026-09-12) — 정본은 supabase/realdata/03b-missing-objects.sql(그 파일을 고칠 때
  이 정의도 함께 고친다). 열 이름·순서는 원래 정의와 동일(item_id, inbound_qty,
  inbound_shipments, earliest_eta) — 열을 더하지 않는다. 기여하는 core.v_fact_shipment
  행 중 batch_id가 없는 행이 하나라도 있으면 그 품목 전체를 null로 낸다(부분합 금지,
  core.v_open_po_qty와 같은 전부-또는-전무 판정, earliest_eta도 예외 없이 같은 게이트를
  받는다). raw.shipment_log에 batch_id를 채우는 적재 경로가 없어 지금은 전 품목이
  null이다 — 사유는 analytics.v_stock_reference_source_status가 알려준다';

grant select on core.v_inbound_qty to authenticated;
revoke all on core.v_inbound_qty from anon, public;


-- ══ 4-2. 참고 열 상태 안내 — 별도 객체(열이 아니라 새 뷰) ═══════════════════
--
-- ★ 화면에 사유를 알려야 하지만 기존 뷰에 열을 더하지 않기로 했으므로(머리말 참고), 이
--   저장소가 practice-data에 이미 쓰는 패턴(별도 상태 뷰 + 배너 컴포넌트)을 그대로 따라
--   **새 뷰** 하나로 Open PO · 이동 중(참고) 두 열의 상태를 함께 알린다(품목별이 아니라
--   화면 전체 기준 한 줄 요약). 새 객체이므로 나중에 열을 자유롭게 늘릴 수 있다.
-- ★ 사유코드 우선순위 — 출처 게이트가 파싱 사유보다 앞선다. 출처가 없으면 파싱 여부는
--   따지지 않는다(신뢰하지 않는 행의 파싱 가능 여부는 의미가 없다).
-- ★ authenticated는 raw 테이블에 직접 GRANT가 없으므로(SCHEMA.md), security_invoker 뷰가
--   raw를 직접 참조하면 permission denied가 난다(error.md #22). core.v_open_po_qty와 같은
--   자리에 소유자 권한 core 뷰를 먼저 두고, analytics 뷰는 그 결과만 읽는다.
-- ★★ core.import_target_table은 배포 DB에서 REVOKE ALL ... FROM PUBLIC 상태다(원래
--   호출자가 전부 SECURITY DEFINER 함수 내부뿐이라 문제가 없었다 — commit_import_batch가
--   자기 소유자 권한으로 부른다). 이 뷰는 SECURITY DEFINER가 아닌 평범한 뷰라 함수 호출의
--   EXECUTE 권한이 조회자 기준으로 검사된다 — 로컬 스크래치 DB에서 직접 겪었다
--   (`permission denied for function import_target_table`). authenticated에 명시적으로
--   내준다(순수 SQL 매핑 함수라 안전하다 — 부작용도 raw 접근도 없다).
grant execute on function core.import_target_table(text) to authenticated;

create or replace view core.v_stock_reference_source_status as
with po as (
  select
    count(*) filter (where p.batch_id is not null) as sourced_rows,
    count(*) filter (where p.batch_id is null) as unsourced_rows
  from raw.purchase_order p
),
gr as (
  select
    count(*) filter (where g.batch_id is not null) as sourced_rows,
    count(*) filter (where g.batch_id is null) as unsourced_rows
  from raw.goods_receipt g
  where nullif(g."입고일", '') is not null and g.receipt_status = 'COMPLETED'
),
unparseable as (
  -- 출처 있는(batch_id not null) 행 중 콤마를 떼도 숫자가 아닌 품목의 distinct 개수.
  select count(distinct item_id) as items from (
    select upper(regexp_replace(p."품목코드", '[\s\-_]', '', 'g')) as item_id
      from raw.purchase_order p
     where p.batch_id is not null and p."발주수량" is not null and btrim(p."발주수량") <> ''
       and core.parse_lenient_numeric(p."발주수량") is null
    union
    select upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g')) as item_id
      from raw.goods_receipt g
     where g.batch_id is not null and nullif(g."입고일", '') is not null and g.receipt_status = 'COMPLETED'
       and g."입고수량" is not null and btrim(g."입고수량") <> '' and core.parse_lenient_numeric(g."입고수량") is null
  ) x
),
ship as (
  select
    count(*) filter (where f.batch_id is not null) as sourced_rows,
    count(*) filter (where f.batch_id is null) as unsourced_rows
  from core.v_fact_shipment f
  where f.status = 'IN_TRANSIT'
),
ship_import_path as (
  -- ★★ 리뷰 라운드 3 — 구조 조건(적재 경로가 있는가)과 데이터 조건(출처 있는 행이
  --   있는가)을 각각 다른 근거로 따로 판정한다. 이전 정의는 "출처 있는 행이 0건"이라는
  --   데이터 사실만으로 "적재 경로가 없다"는 구조적 주장을 냈다 — shipment 적재 경로가
  --   생기고도 아직 업로드가 없으면 배너가 거짓으로 "경로가 없다"고 말하고, 반대로
  --   경로가 생기자마자(데이터 유무와 무관하게) 그 사유가 조용히 사라지는 문제였다.
  --   core.import_target_table이 'shipment' 종류를 아는지는 데이터와 완전히 무관한
  --   구조적 사실이다 — core.commit_import_batch가 실제로 커밋할 수 있는 import_type
  --   목록과 같은 기준(STEP 4 원본)이다.
  select core.import_target_table('shipment') is not null as has_import_path
)
select
  po.sourced_rows + gr.sourced_rows as open_po_sourced_rows,
  po.unsourced_rows + gr.unsourced_rows as open_po_unsourced_rows,
  unparseable.items as open_po_unparseable_items,
  case
    when po.unsourced_rows + gr.unsourced_rows > 0 then 'OPEN_PO_SOURCE_UNVERIFIED'
    when unparseable.items > 0 then 'OPEN_PO_QTY_UNPARSEABLE'
  end as open_po_reason_code,
  ship.sourced_rows as in_transit_sourced_rows,
  ship.unsourced_rows as in_transit_unsourced_rows,
  ship_import_path.has_import_path as in_transit_has_import_path,
  case
    when not ship_import_path.has_import_path and ship.unsourced_rows > 0 then 'IN_TRANSIT_NO_IMPORT_PATH'
    when ship_import_path.has_import_path and ship.unsourced_rows > 0 then 'IN_TRANSIT_SOURCE_UNVERIFIED'
  end as in_transit_reason_code
from po, gr, unparseable, ship, ship_import_path;

comment on view core.v_stock_reference_source_status is
  '보정(2026-09-12) — Open PO·이동 중(참고) 두 열의 출처/파싱 상태를 화면 전체 기준 한 줄로
  요약한다(품목별 아님). open_po_reason_code: OPEN_PO_SOURCE_UNVERIFIED(출처 없는 행이 기여,
  파싱 사유보다 우선) > OPEN_PO_QTY_UNPARSEABLE(출처는 있으나 파싱 불가) > null(정상).
  in_transit_reason_code는 구조 조건(in_transit_has_import_path — core.import_target_table
  이 shipment 종류를 아는가, 데이터와 무관)과 데이터 조건(in_transit_unsourced_rows —
  batch_id 없는 행이 있는가)을 각각의 근거로 따로 판정해 조합한다: 적재 경로가 없는데
  출처 없는 행이 있으면 IN_TRANSIT_NO_IMPORT_PATH(구조적으로 영구히 채울 수 없다),
  적재 경로는 있는데 출처 없는 행이 있으면 IN_TRANSIT_SOURCE_UNVERIFIED(Open PO의
  "아직 IMPORT 안 됨"과 같다), 둘 다 없으면 null(정상). 소유자 권한으로 raw를 직접
  읽는다 — analytics.v_stock_reference_source_status가 권한 필터를 얹어 감싼다';

grant select on core.v_stock_reference_source_status to authenticated;
revoke all on core.v_stock_reference_source_status from anon, public;

create or replace view analytics.v_stock_reference_source_status
with (security_invoker = true)
as
select s.*
  from core.v_stock_reference_source_status s
 where core.has_permission('STOCK_VIEW_ALL')
    or core.has_permission('STOCK_VIEW_PAPER')
    or core.has_permission('STOCK_VIEW_SUPPLY');

comment on view analytics.v_stock_reference_source_status is
  '보정(2026-09-12) — 화면 배너 전용 요약(품목별이 아님). core.v_stock_reference_source_status를
  재고 상세 권한(STOCK_VIEW_ALL·STOCK_VIEW_PAPER·STOCK_VIEW_SUPPLY)으로만 연다. 권한이 없으면
  0행 — StockReferenceStatusBanner는 이 뷰가 0행이면 아무것도 표시하지 않는다.
  security_invoker로 호출자 RLS를 그대로 적용한다';

grant select on analytics.v_stock_reference_source_status to authenticated;
revoke all on analytics.v_stock_reference_source_status from anon, public;


-- ══ 4-3. 세 번째 사고 지점 — core.v_stock_on_hand ═══════════════════
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
-- ★★ 정본은 supabase/realdata/03b-missing-objects.sql이다(core.v_fact_shipment·
--   core.v_inbound_qty와 같은 이유 — 4-1절 참고). 그 파일도 이번에 같은 게이트를 갖도록
--   함께 고쳤다(CREATE VIEW → CREATE OR REPLACE VIEW 포함). **이 뷰를 다시 고칠 때는
--   두 파일을 항상 함께 고친다.**
-- ★★★ 리뷰 라운드 3 — 03b는 이 마이그레이션보다 먼저 적용되므로(realdata → migrations
--   순서) core.parse_lenient_numeric도 §1의 정의를 03b 안에 그대로 복제해 두었다(없으면
--   03b 단독 적용 시 이 뷰 생성 자체가 "function ... does not exist"로 막힌다). 03b·
--   scratch DB에 01-schema.sql + 03b를 적용하고 다시 03b를 적용해(이중 적용) 세 뷰
--   (v_fact_shipment·v_inbound_qty·v_stock_on_hand) 모두 게이트가 남는지 확인했다 —
--   plain CREATE TABLE/CREATE VIEW 21건은 "already exists"로 실패하고(조용히 되돌아가지
--   않는다), CREATE OR REPLACE VIEW 세 곳만 오류 없이 재실행되며 게이트를 그대로 유지했다.
--   §1의 core.parse_lenient_numeric을 고칠 때는 이 복제본도 함께 고친다.

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
-- select * from analytics.v_stock_reference_source_status;
-- 기대(배포 DB): open_po_unsourced_rows > 0 · open_po_reason_code = 'OPEN_PO_SOURCE_UNVERIFIED',
--       in_transit_unsourced_rows > 0 · in_transit_has_import_path = false ·
--       in_transit_reason_code = 'IN_TRANSIT_NO_IMPORT_PATH'(core.import_target_table이
--       아직 'shipment' 종류를 모르기 때문 — 구조 조건. shipment 적재 경로가 생기면
--       in_transit_has_import_path가 true로 바뀌고, 그래도 업로드가 없으면
--       in_transit_reason_code는 IN_TRANSIT_SOURCE_UNVERIFIED로 바뀐다)
--       (측정값: raw.purchase_order 92 · raw.goods_receipt 81 · raw.shipment_log 2864 전부
--       batch_id null, IN_TRANSIT 117행 · 수량 합 12,137).

-- (d-1) 이동 중(참고) 열도 같은 이유로 null인지 확인.
-- select item_id, in_transit_qty from analytics.v_available_stock where in_transit_qty is not null;
-- 기대: 0행(적용 전에는 19품목 · 합계 12,137이 보였다).

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
-- 기대: 기존 13개 열 그대로(추가된 열 없음 — migration_rerun 스위트가 이 열 수를
--       사후 조건으로 고정 확인한다)

-- (g) raw 텍스트 → numeric 캐스트 전수 참조 확인(정규식이 아니라 실제 grep 결과 — 저장소
-- 전체 supabase/migrations · supabase/realdata에서 Korean 텍스트 컬럼을 ::numeric으로
-- 캐스트하는 지점은 정확히 다섯 곳이었고 전부 이 마이그레이션이 다룬다:
--   core.v_open_po_qty(발주수량·입고수량, 2절) · core.apply_stock_balance_from_batch(현재고, 3-1) ·
--   core.apply_month_end_inventory_snapshot_from_batch(현재고, 3-2) ·
--   core.apply_stock_receipts_from_batch(입고수량, 3-3) · core.v_stock_on_hand(현재고, 4-3).
-- 단가를 캐스트하는 곳은 0건이었다. core.v_inbound_qty(raw.shipment_log.qty)는 이미 numeric
-- 타입이라 캐스트가 없다 — 4-1절의 출처 게이트는 캐스트 문제가 아니라 지어낸 숫자 노출을
-- 막기 위한 것이다.

-- (h) raw.inventory."현재고"에 실제 파싱 불가 행이 있는지(제 환경에서는 확인 불가 — 요청).
-- select "품목코드", "현재고" from raw.inventory
--  where "현재고" is not null and btrim("현재고") !~ '^-?[0-9]+(\.[0-9]+)?$';

-- (i) raw.shipment_log 출처 분포 재확인(team-lead 측정값과 대조).
-- select count(*) as rows, count(*) filter (where batch_id is null) as no_provenance,
--        count(*) filter (where status = 'IN_TRANSIT') as in_transit,
--        sum(qty) filter (where status = 'IN_TRANSIT') as in_transit_qty
--   from raw.shipment_log;
-- 기대: 2864 / 2864 / 117 / 12137
