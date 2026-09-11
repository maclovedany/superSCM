-- Task 4 · 정상 창고재고와 가용재고 기준 확정
--
-- 목적: Open PO와 이동 중 수량을 제외하고, 중복 배정을 방지할 수 있는 단일 가용재고
-- 기준을 만든다. 실제 Supabase 적용은 사용자가 SQL Editor에서 수동으로 수행한다.
--
-- ★ raw.inventory 는 5회차 실습 더미 43행이 그대로 남아 있는 테이블이다. 이 마이그레이션이
--   추가하는 inventory_status · snapshot_at · warehouse_code 는 모두 nullable이며, 기존
--   43행은 이 값이 전부 null이다. 이 마이그레이션은 그 행을 NORMAL로 추정하지 않는다 —
--   분류할 수 없으면 core.stock_balance에 아예 올리지 않고, analytics.v_available_stock은
--   그 품목을 null + INVENTORY_SCOPE_UNCLASSIFIED로 보여준다.
-- ★ 다시 실행해도 안전하다 (if not exists · create or replace · drop/재생성 정책).


-- ══ 1. raw 적재 필드 보강 ═══════════════════════════════════════

alter table raw.inventory add column if not exists inventory_status text;
alter table raw.inventory add column if not exists snapshot_at timestamptz;
alter table raw.inventory add column if not exists warehouse_code text;

comment on column raw.inventory.inventory_status is
  '원본 재고상태 텍스트. core.inventory_scope_rule로 NORMAL 등 여섯 범위에 매핑한다';
comment on column raw.inventory.snapshot_at is
  '이 재고 수량을 확인한 시각. 없으면 정상 창고재고 분류에 포함하지 않는다';
comment on column raw.inventory.warehouse_code is
  '정규화된 창고 코드. null이면 창고 범위를 알 수 없어 분류에서 제외한다';

-- raw.goods_receipt 증가 원장 연결에 필요한 완료 상태 — "입고일" 컬럼은 이미 있다.
-- "완료일과 완료 상태가 모두 확인된 건" = 입고일이 채워져 있고 receipt_status가 COMPLETED인 건.
alter table raw.goods_receipt add column if not exists receipt_status text;

comment on column raw.goods_receipt.receipt_status is
  '입고 완료 상태. "입고일" + receipt_status=COMPLETED 두 조건을 모두 만족해야 참고 열에 반영한다';


-- ══ 2. 분류 규칙 ═════════════════════════════════════════════════
--
-- core.supplier_alias와 같은 alias → 정규코드 매핑 표다. 실데이터의 실제 표기가
-- 확인되면 이 표에 행을 더하기만 하면 된다 (기존 앱 코드는 바뀌지 않는다).

create table if not exists core.inventory_scope_rule (
  raw_status  text primary key,
  scope_code  text not null check (scope_code in (
    'NORMAL', 'INSPECTION', 'DEFECT', 'SERVICE_CENTER', 'PARTNER', 'IN_TRANSIT'
  )),
  description text not null,
  created_at  timestamptz not null default now()
);

insert into core.inventory_scope_rule (raw_status, scope_code, description) values
  ('정상',           'NORMAL',         '정상 창고재고'),
  ('NORMAL',         'NORMAL',         '정상 창고재고'),
  ('검사대기',        'INSPECTION',     '검사 대기재고'),
  ('검사 대기',       'INSPECTION',     '검사 대기재고'),
  ('INSPECTION',     'INSPECTION',     '검사 대기재고'),
  ('불량',           'DEFECT',         '불량·폐기 예정재고'),
  ('폐기예정',        'DEFECT',         '불량·폐기 예정재고'),
  ('DEFECT',         'DEFECT',         '불량·폐기 예정재고'),
  ('서비스센터',       'SERVICE_CENTER', '서비스센터 보유재고'),
  ('SERVICE_CENTER', 'SERVICE_CENTER', '서비스센터 보유재고'),
  ('파트너',          'PARTNER',        '파트너 보유재고'),
  ('PARTNER',        'PARTNER',        '파트너 보유재고'),
  ('이동중',          'IN_TRANSIT',     '이동 중 재고'),
  ('이동 중',         'IN_TRANSIT',     '이동 중 재고'),
  ('IN_TRANSIT',     'IN_TRANSIT',     '이동 중 재고')
on conflict (raw_status) do nothing;

comment on table core.inventory_scope_rule is
  'stage1 §6 — 원본 재고상태 표기를 여섯 범위로 매핑. 매핑에 없는 표기는 분류 불가로 제외한다';

create table if not exists core.item_visibility_rule (
  raw_item_type    text primary key,
  visibility_scope text not null check (visibility_scope in (
    'PAPER_CARD_READER', 'CONSUMABLE', 'GENERAL'
  )),
  description      text not null,
  created_at       timestamptz not null default now()
);

insert into core.item_visibility_rule (raw_item_type, visibility_scope, description) values
  ('용지',          'PAPER_CARD_READER', '용지'),
  ('PAPER',         'PAPER_CARD_READER', '용지'),
  ('카드리더기',      'PAPER_CARD_READER', '카드리더기'),
  ('CARD_READER',   'PAPER_CARD_READER', '카드리더기'),
  ('소모품',         'CONSUMABLE',        '소모품'),
  ('CONSUMABLE',    'CONSUMABLE',        '소모품')
on conflict (raw_item_type) do nothing;

comment on table core.item_visibility_rule is
  'stage1 §2 — 품목구분을 조회 범위로 매핑. 매핑에 없는 품목구분은 GENERAL로 취급한다(제외하지 않는다)';


-- ══ 3. 확정 정상 창고재고 ═════════════════════════════════════════

create table if not exists core.stock_balance (
  item_id         text primary key,
  normal_qty      numeric not null default 0 check (normal_qty >= 0),
  snapshot_at     timestamptz not null,
  source_batch_id uuid references core.upload_batch(batch_id) on delete set null,
  updated_at      timestamptz not null default now()
);

comment on table core.stock_balance is
  '품목별 확정 정상 창고재고. Task 5의 배정 함수가 FOR UPDATE로 잠그는 행이다. '
  '분류 가능한 raw.inventory 행이 하나도 없는 품목은 이 표에 올리지 않는다 '
  '(0이 아니라 "아직 모른다"를 뜻하기 때문이다)';

create or replace function core.refresh_stock_balance(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = core, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_batch core.upload_batch%rowtype;
  v_count integer;
begin
  if v_actor is null or not core.is_active_user(v_actor) then
    raise exception '로그인한 활성 사용자만 재고 배치를 반영할 수 있습니다.' using errcode = '42501';
  end if;

  -- 정상 창고재고 반영은 STOCK_VIEW_ALL 권한을 가진 SCM 담당자(SCM_PLANNER · SCM_LEAD)만
  -- 할 수 있다. 전용 권한 코드를 새로 만들지 않고 기존 재고 전체 조회 권한을 재사용한다.
  if not (core.has_permission('STOCK_VIEW_ALL', v_actor) or core.is_admin(v_actor)) then
    raise exception '정상 창고재고 반영 권한이 없습니다.' using errcode = '42501';
  end if;

  select * into v_batch from core.upload_batch where batch_id = p_batch_id;
  if not found then
    raise exception '재고 배치를 찾을 수 없습니다: %', p_batch_id using errcode = 'P0002';
  end if;
  if v_batch.import_type <> 'inventory' then
    raise exception 'inventory 배치만 정상 창고재고에 반영할 수 있습니다.' using errcode = '22023';
  end if;
  if v_batch.status not in ('VALIDATED', 'IMPORTED') then
    raise exception '검증 완료된 배치만 반영할 수 있습니다. 현재 상태: %', v_batch.status using errcode = '22023';
  end if;

  with classified as (
    -- 상태나 창고 범위를 분류할 수 없는 행은 여기서 완전히 제외한다 — 0으로도, NORMAL로도
    -- 세지 않는다. warehouse_code가 없거나(창고 범위 미상) inventory_status가 매핑되지
    -- 않으면(재고상태 미상) 그 행은 정상 창고재고 계산에 아예 참여하지 않는다.
    select
      upper(regexp_replace(i."품목코드", '[\s\-_]', '', 'g')) as item_id,
      nullif(i."현재고", '')::numeric as qty,
      i.snapshot_at,
      r.scope_code
    from raw.inventory i
    join core.inventory_scope_rule r on r.raw_status = i.inventory_status
    where i.batch_id = p_batch_id
      and i.warehouse_code is not null
      and nullif(i."현재고", '') is not null
      and i.snapshot_at is not null
  ),
  aggregated as (
    select
      item_id,
      coalesce(sum(qty) filter (where scope_code = 'NORMAL'), 0) as normal_qty,
      max(snapshot_at) as snapshot_at
    from classified
    group by item_id
  )
  insert into core.stock_balance (item_id, normal_qty, snapshot_at, source_batch_id, updated_at)
  select item_id, normal_qty, snapshot_at, p_batch_id, now()
    from aggregated
  on conflict (item_id) do update
    set normal_qty      = excluded.normal_qty,
        snapshot_at     = excluded.snapshot_at,
        source_batch_id = excluded.source_batch_id,
        updated_at      = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function core.refresh_stock_balance(uuid) is
  '검증 완료된(VALIDATED 이상) inventory 배치만 core.stock_balance에 반영한다. '
  '분류 불가 행은 반영에서 제외되어 해당 품목은 이전 확정값을 그대로 유지한다';


-- ══ 3-1. Open PO 참고 열 ═══════════════════════════════════════════
--
-- ★ core.v_inbound_qty · core.v_stock_on_hand와 같은 자리의 뷰다. authenticated는 raw
--   테이블에 직접 GRANT가 없으므로(SCHEMA.md), security_invoker 분석 뷰가 raw를 직접
--   참조하면 permission denied가 난다. raw 집계는 항상 이런 소유자 권한 core 뷰를 한 번
--   거친 뒤 analytics 뷰가 그 결과만 읽는다.
-- ★ "창고 입고 완료" = 입고일이 있고 receipt_status가 COMPLETED인 건만 발주잔량 계산에
--   넣는다(stage1 §6). 발주 자체가 없는 품목은 미상이 아니라 0건이 사실이므로 0을 쓴다.

create or replace view core.v_open_po_qty as
with ordered as (
  select
    upper(regexp_replace(p."품목코드", '[\s\-_]', '', 'g')) as item_id,
    sum(nullif(p."발주수량", '')::numeric) as ordered_qty
  from raw.purchase_order p
  group by upper(regexp_replace(p."품목코드", '[\s\-_]', '', 'g'))
),
received as (
  select
    upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g')) as item_id,
    sum(nullif(g."입고수량", '')::numeric) as received_qty
  from raw.goods_receipt g
  where nullif(g."입고일", '') is not null
    and g.receipt_status = 'COMPLETED'
  group by upper(regexp_replace(g."품목코드", '[\s\-_]', '', 'g'))
)
select
  o.item_id,
  greatest(0, o.ordered_qty - coalesce(r.received_qty, 0)) as open_po_qty
from ordered o
left join received r on r.item_id = o.item_id;

comment on view core.v_open_po_qty is
  '품목별 Open PO 참고 수량 = 발주수량 합 - 입고완료(입고일 존재 + receipt_status=COMPLETED) 합. '
  '음수는 0으로 clamp한다. 가용재고 계산에는 더하지 않는 참고 열이다';

grant select on core.v_open_po_qty to authenticated;
revoke all on core.v_open_po_qty from anon, public;


-- ══ 4. 가용재고 뷰 ════════════════════════════════════════════════
--
-- available_qty = normal_warehouse_qty - temporary_allocated_qty - firm_allocated_qty
--               - approval_hold_qty
--
-- ★ temporary_allocated_qty · firm_allocated_qty · approval_hold_qty는 지금 0으로 고정한다.
--   core.stock_allocation(Task 5)이 아직 없기 때문이다 — 지금은 배정 이력이 0건이라는
--   것이 사실 그대로이므로 0은 추정이 아니다. Task 5는 이 뷰를 create or replace로
--   확장하되, 기존 열 순서는 그대로 두고 끝에 덧붙인다(error.md #16).
-- ★ open_po_qty · in_transit_qty는 참고 열이며 available_qty 계산에 더하지 않는다.

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
  0::numeric as temporary_allocated_qty,
  0::numeric as firm_allocated_qty,
  0::numeric as approval_hold_qty,
  case when sb.normal_qty is null then null
       else sb.normal_qty - 0::numeric - 0::numeric - 0::numeric
  end as available_qty,
  po.open_po_qty,
  ib.inbound_qty as in_transit_qty,
  case when sb.item_id is null then 'INVENTORY_SCOPE_UNCLASSIFIED' end as reason_code
from core.v_item_master im
left join core.item_visibility_rule ivr on ivr.raw_item_type = im.item_type
left join core.stock_balance sb on sb.item_id = im.item_id
left join core.v_inbound_qty ib on ib.item_id = im.item_id
left join core.v_open_po_qty po on po.item_id = im.item_id
where
  -- 마케팅은 용지·카드리더기, 서비스는 소모품, 영업(ATP_VIEW)과 SCM(STOCK_VIEW_ALL)은 전체.
  core.has_permission('STOCK_VIEW_ALL')
  or core.has_permission('ATP_VIEW')
  or (core.has_permission('STOCK_VIEW_PAPER') and coalesce(ivr.visibility_scope, 'GENERAL') = 'PAPER_CARD_READER')
  or (core.has_permission('STOCK_VIEW_SUPPLY') and coalesce(ivr.visibility_scope, 'GENERAL') = 'CONSUMABLE');

comment on view analytics.v_available_stock is
  'Task 4 — 부서 권한과 품목 범위로 제한한 정상 창고재고·가용재고. security_invoker로 '
  '호출자 RLS를 그대로 적용한다. 분류 불가 품목은 null + INVENTORY_SCOPE_UNCLASSIFIED';


-- ══ 5. RLS와 권한 ════════════════════════════════════════════════

alter table core.inventory_scope_rule enable row level security;
alter table core.item_visibility_rule enable row level security;
alter table core.stock_balance        enable row level security;

drop policy if exists inventory_scope_rule_read on core.inventory_scope_rule;
drop policy if exists inventory_scope_rule_write on core.inventory_scope_rule;
create policy inventory_scope_rule_read on core.inventory_scope_rule
  for select to authenticated using (true);
create policy inventory_scope_rule_write on core.inventory_scope_rule
  for all to authenticated using (core.is_admin()) with check (core.is_admin());

drop policy if exists item_visibility_rule_read on core.item_visibility_rule;
drop policy if exists item_visibility_rule_write on core.item_visibility_rule;
create policy item_visibility_rule_read on core.item_visibility_rule
  for select to authenticated using (true);
create policy item_visibility_rule_write on core.item_visibility_rule
  for all to authenticated using (core.is_admin()) with check (core.is_admin());

drop policy if exists stock_balance_read on core.stock_balance;
create policy stock_balance_read on core.stock_balance
  for select to authenticated
  using (
    core.has_permission('STOCK_VIEW_ALL')
    or core.has_permission('ATP_VIEW')
    or core.has_permission('STOCK_VIEW_PAPER')
    or core.has_permission('STOCK_VIEW_SUPPLY')
    or core.is_admin()
  );

revoke all on core.inventory_scope_rule, core.item_visibility_rule, core.stock_balance from anon, public;
revoke insert, update, delete on core.stock_balance from authenticated;
grant select on core.stock_balance to authenticated;
grant select, insert, update, delete on core.inventory_scope_rule, core.item_visibility_rule to authenticated;
grant select on analytics.v_available_stock to authenticated;
revoke all on analytics.v_available_stock from anon, public;

revoke all on function core.refresh_stock_balance(uuid) from public, anon;
grant execute on function core.refresh_stock_balance(uuid) to authenticated;


-- ══ 6. 수동 적용 후 확인 쿼리 ═══════════════════════════════════

-- (a) 검사대기 10 · 정상 20 · 이동 중 30 → 정상 창고재고 20
-- insert into raw.inventory ("품목코드","현재고",inventory_status,warehouse_code,snapshot_at,batch_id,source_type)
-- values
--   ('ITEM901','10','검사대기','MAIN',now(),'<검증용 batch_id>','FILE_UPLOAD'),
--   ('ITEM901','20','정상','MAIN',now(),'<검증용 batch_id>','FILE_UPLOAD'),
--   ('ITEM901','30','이동중','MAIN',now(),'<검증용 batch_id>','FILE_UPLOAD');
-- select core.refresh_stock_balance('<검증용 batch_id>');
-- select item_id, normal_qty from core.stock_balance where item_id = 'ITEM901';
-- 기대: normal_qty = 20

-- (b) 상태 미입력 재고는 0이 아니라 사유 코드로 제외되는지 확인
select item_id, normal_warehouse_qty, available_qty, reason_code
from analytics.v_available_stock
where reason_code = 'INVENTORY_SCOPE_UNCLASSIFIED'
order by item_id;
-- 기대: 기존 43행처럼 상태값이 없는 품목은 normal_warehouse_qty · available_qty가 null이고
--       reason_code가 INVENTORY_SCOPE_UNCLASSIFIED. 0행으로 나오면 안 된다.

-- (c) 뷰의 security_invoker 설정 확인
select c.relname, c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'analytics' and c.relname = 'v_available_stock';
-- 기대: reloptions에 security_invoker=true

-- (d) 익명 사용자는 조회·갱신할 수 없는지 확인 (SQL Editor에서 anon 역할로 실행)
-- set role anon;
-- select * from analytics.v_available_stock;        -- 기대: 0행 또는 42501
-- select * from core.stock_balance;                  -- 기대: 42501 또는 0행
-- select core.refresh_stock_balance(gen_random_uuid()); -- 기대: 42501 (function 실행 권한 없음)
-- reset role;
