-- ──────────────────────────────────────────────────────────────
-- STEP 3 · 데이터 모델 확장 (1/2)
--
-- renew.prd 6장 · 7장 — RAW 확장과 CORE 정책 계층
--
-- 여기서 만드는 것
--   raw   business_event · sales_order · item_substitute
--   raw   모든 테이블에 적재 추적 컬럼 (batch_id · source_type · loaded_at)
--   core  policy_config · item_policy · outlier_rule · outlier_exclusion
--   core  soft_allocation · forecast_setting
--
-- 03-auth.sql · 04-rls.sql 을 먼저 실행하세요. core.is_admin() 이 필요합니다.
-- ──────────────────────────────────────────────────────────────

-- ══ 1. RAW 신규 테이블 ═════════════════════════════════════════

-- renew.prd 7.7 — 프로모션 · 계약 · 신제품을 데이터로 관리합니다.
create table if not exists raw.business_event (
  event_id        text primary key,
  item_id         text,
  period_start    date,
  period_end      date,
  event_type      text,          -- PROMOTION · NEW_CONTRACT · NEW_PRODUCT · DISCONTINUED
  expected_impact numeric,       -- 예상 증감률 또는 수량
  note            text
);

-- renew.prd 22.1 — 확정 수주는 예측보다 우선합니다.
create table if not exists raw.sales_order (
  so_no      text primary key,
  item_id    text,
  customer   text,
  order_date date,
  due_date   date,
  qty        numeric,
  status     text               -- CONFIRMED · TENTATIVE · CANCELLED
);

-- renew.prd 26.2 getAlternativeItems
create table if not exists raw.item_substitute (
  item_id            text,
  substitute_item_id text,
  priority           int default 1,
  note               text,
  primary key (item_id, substitute_item_id)
);

comment on table raw.business_event   is 'renew.prd 7.7 — 수요에 영향을 주는 사건';
comment on table raw.sales_order      is 'renew.prd 7.8 — 확정 수주';
comment on table raw.item_substitute  is 'renew.prd 7.8 — 대체품 마스터';

-- ══ 2. 적재 추적 컬럼 ══════════════════════════════════════════
--
-- renew.prd 6.1 — 원본은 수정하지 않되, 언제 · 어디서 왔는지는 기록합니다.
-- batch_id 로 업로드 단위를 되돌릴 수 있어야 합니다 (STEP 4).

do $$
declare
  t text;
  targets text[] := array[
    'shipment_log', 'usage_history', 'inventory', 'item_master',
    'supplier_master', 'purchase_order', 'goods_receipt',
    'business_event', 'sales_order', 'item_substitute'
  ];
begin
  foreach t in array targets loop
    if to_regclass('raw.' || t) is null then
      raise notice '건너뜀 — raw.% 가 없습니다', t;
      continue;
    end if;
    execute format('alter table raw.%I add column if not exists batch_id text', t);
    execute format('alter table raw.%I add column if not exists source_type text', t);
    execute format('alter table raw.%I add column if not exists loaded_at timestamptz default now()', t);
    execute format('alter table raw.%I add column if not exists source_record_id text', t);
    execute format('create index if not exists %I on raw.%I(batch_id)', t || '_batch_idx', t);
  end loop;
end $$;

-- 기존 행은 최초 덤프에서 온 것으로 표시합니다.
do $$
declare t text;
begin
  foreach t in array array['shipment_log','usage_history','inventory','item_master',
                           'supplier_master','purchase_order','goods_receipt'] loop
    if to_regclass('raw.' || t) is not null then
      execute format(
        'update raw.%I set source_type = ''INITIAL_DUMP'', batch_id = ''b_initial''
          where source_type is null', t);
    end if;
  end loop;
end $$;

-- ══ 3. CORE — 정책 ═════════════════════════════════════════════
--
-- renew.prd 32장 — 정책값을 코드에 하드코딩하지 않습니다.
-- 이 표의 값을 바꾸면 화면 코드를 고치지 않아도 계산이 달라져야 합니다.

create table if not exists core.policy_config (
  key         text primary key,
  value_num   numeric,
  value_text  text,
  unit        text,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

insert into core.policy_config (key, value_num, unit, description) values
  ('SERVICE_LEVEL_DEFAULT',   0.95, '비율', '기본 서비스 수준. 등급별 값은 core.service_level 이 우선합니다'),
  ('Z_VALUE_DEFAULT',         1.65, '계수', '서비스 수준 95% 의 Z 값'),
  ('REVIEW_PERIOD_DAYS',      30,   '일',   '발주 검토 주기. 리드타임에 더해 커버할 기간'),
  ('DELIVERY_BUFFER_DAYS',    5,    '일',   '고객 납기 안내 시 얹는 여유일. P80 은 5회 중 1회 지연됩니다'),
  ('SAFETY_BUFFER_DAYS',      3,    '일',   '발주 권고일 계산에 쓰는 여유일'),
  ('SOFT_ALLOCATION_DAYS',    7,    '일',   '가예약 기본 유효기간'),
  ('LEADTIME_MIN_SAMPLES',    30,   '건',   '이 미만이면 리드타임 신뢰도를 LOW 로 표시합니다'),
  ('EXCESS_STOCK_MONTHS',     6,    '개월', '예상 소진 기간이 이 값을 넘으면 과잉재고로 봅니다')
on conflict (key) do nothing;

-- renew.prd 7.5 · 22.1 — MOQ 와 발주단위
create table if not exists core.item_policy (
  item_id       text primary key,
  moq           numeric,          -- null = 최소 주문 수량 제약 없음
  pack_size     numeric,          -- null = 올림 단위 없음
  item_grade    text,             -- A · B · C
  service_level numeric,          -- null 이면 policy_config 기본값
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);

comment on column core.item_policy.moq is
  'null 은 "제약 없음" 입니다. 0 이나 1 로 채워 넣지 마세요 (AGENTS.md 규칙 5)';

-- 품목 목록을 먼저 깔아 둡니다. 값은 마스터에서 오거나 관리자가 입력합니다.
insert into core.item_policy (item_id)
select item_id from core.v_item_master
on conflict (item_id) do nothing;

-- raw.item_master 에 MOQ · pack_size 컬럼이 있으면 옮겨옵니다.
-- 컬럼명이 프로젝트마다 달라 후보를 훑습니다 (AGENTS.md 의 정규화 방식과 같은 이유).
do $$
declare
  moq_col  text;
  pack_col text;
begin
  select column_name into moq_col
    from information_schema.columns
   where table_schema = 'raw' and table_name = 'item_master'
     and column_name in ('moq', 'MOQ', 'min_order_qty', '최소발주수량')
   limit 1;

  select column_name into pack_col
    from information_schema.columns
   where table_schema = 'raw' and table_name = 'item_master'
     and column_name in ('pack_size', 'packsize', 'order_unit', '발주단위')
   limit 1;

  if moq_col is not null then
    execute format(
      'update core.item_policy p set moq = m.%I::numeric
         from raw.item_master m where m.item_id = p.item_id and p.moq is null', moq_col);
    raise notice 'MOQ 를 raw.item_master.% 에서 가져왔습니다', moq_col;
  else
    raise notice 'raw.item_master 에 MOQ 컬럼이 없습니다. 관리자가 입력해야 합니다';
  end if;

  if pack_col is not null then
    execute format(
      'update core.item_policy p set pack_size = m.%I::numeric
         from raw.item_master m where m.item_id = p.item_id and p.pack_size is null', pack_col);
    raise notice 'pack_size 를 raw.item_master.% 에서 가져왔습니다', pack_col;
  else
    raise notice 'raw.item_master 에 pack_size 컬럼이 없습니다. 관리자가 입력해야 합니다';
  end if;
end $$;

-- renew.prd 12.3 — 이상치 제외 규칙. 코드에 하드코딩하지 않습니다.
create table if not exists core.outlier_rule (
  rule_id    bigserial primary key,
  rule_type  text not null,   -- RETURN · PROJECT · DUPLICATE · RANGE
  scope      text not null default 'GLOBAL',  -- GLOBAL · ITEM
  item_id    text,
  threshold  numeric,
  active     boolean not null default true,
  note       text,
  created_at timestamptz not null default now()
);

insert into core.outlier_rule (rule_type, threshold, note)
select * from (values
  ('RETURN',  0,  '음수 출고(반품)는 학습에서 제외합니다'),
  ('PROJECT', 5,  '평소 평균의 5배를 넘는 대량 출고는 프로젝트성으로 보고 검토 대상에 올립니다')
) v(a, b, c)
where not exists (select 1 from core.outlier_rule);

-- 규칙 판정을 거쳐 "제외하기로 확정된" 행입니다. 학습 뷰가 이 표를 봅니다.
create table if not exists core.outlier_exclusion (
  item_id     text not null,
  use_date    date not null,
  reason_code text not null,   -- RETURN · PROJECT · DUPLICATE · MANUAL
  note        text,
  excluded_at timestamptz not null default now(),
  excluded_by uuid references auth.users(id) on delete set null,
  primary key (item_id, use_date, reason_code)
);

-- renew.prd 27.6 — 가예약. ATP 에서 차감되어 이중 약속을 막습니다.
create table if not exists core.soft_allocation (
  allocation_id bigserial primary key,
  item_id       text not null,
  qty           numeric not null check (qty > 0),
  status        text not null default 'RESERVED'
                  check (status in ('RESERVED', 'CONFIRMED', 'RELEASED')),
  requested_by  uuid references auth.users(id) on delete set null,
  customer      text,
  valid_until   date not null,
  created_at    timestamptz not null default now(),
  released_at   timestamptz
);

create index if not exists soft_allocation_active_idx
  on core.soft_allocation(item_id) where status = 'RESERVED';

-- ══ 4. 예측 설정 — 학습/검증 경계 ══════════════════════════════
--
-- renew.prd 12.1 — 2025 는 Training 에 쓰지 않습니다.
-- 그 경계를 여기 한 곳에 두고, 학습 뷰가 이 값만 봅니다.
-- STEP 6 에서 모델 관련 컬럼이 더 붙습니다.

create table if not exists core.forecast_setting (
  id                  int primary key default 1 check (id = 1),
  granularity         text not null default 'MONTH' check (granularity in ('MONTH', 'WEEK')),
  train_start         date not null,
  train_end           date not null,
  test_start          date not null,
  test_end            date not null,
  forecast_horizon    int  not null default 12,
  champion_metric     text not null default 'WAPE',
  prediction_interval text not null default 'P50,P80,P90',
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null,
  check (train_end < test_start)
);

comment on table core.forecast_setting is
  'renew.prd 12.1 — 학습/검증 경계. core.v_train_demand 가 이 값만 보고 2025 를 격리합니다';

-- 초기값은 실제 데이터 범위에서 계산합니다.
-- 검증 구간을 마지막 6개월로 두고 그 앞 전부를 학습에 씁니다.
--
-- ⚠ renew.prd 12.1 은 TRAIN 2023.01~2024.12 · TEST 2025 를 전제합니다.
--   3년치 실데이터를 적재한 뒤에는 아래 한 줄로 바꾸세요.
--
--     update core.forecast_setting
--        set train_start='2023-01-01', train_end='2024-12-31',
--            test_start ='2025-01-01', test_end ='2025-12-31'
--      where id = 1;
-- ★ 실데이터 전환 뒤에는 raw.usage_history 가 없습니다 (sql/34 가 지웁니다). 그때는 sql/34 가
--   core.v_demand_monthly 범위로 경계를 잡으므로 여기서는 표가 있을 때만 초기값을 넣습니다.
--   ★ 아래 가드는 반드시 having 이어야 합니다 (where 가 아닙니다).
--     group by 없는 집계 질의는 입력이 0행이어도 결과가 1행(전부 null)입니다.
--     where 에 두면 이미 행이 있을 때 입력이 모두 걸러져 (1, null, null, null, null)
--     한 행이 들어가고 not-null 제약에 걸립니다. having 은 집계 뒤에 걸리므로
--     0행이 되어 아무것도 넣지 않습니다 (error.md #22 주변, 재실행 안전).
do $$
begin
  if to_regclass('raw.usage_history') is null then
    raise notice 'sql/06: raw.usage_history 가 없습니다 — forecast_setting 초기값은 sql/34 가 잡습니다';
    return;
  end if;
  execute $q$
    insert into core.forecast_setting (id, train_start, train_end, test_start, test_end)
    select 1,
           min(use_date),
           (date_trunc('month', max(use_date)) - interval '6 months')::date - 1,
           (date_trunc('month', max(use_date)) - interval '6 months')::date,
           max(use_date)
      from raw.usage_history
    having count(*) > 0
       and not exists (select 1 from core.forecast_setting)
  $q$;
end $$;

-- ══ 5. 권한과 RLS ══════════════════════════════════════════════
--
-- 읽기는 로그인한 사용자, 쓰기는 관리자입니다 (renew.prd 4.2).

do $$
declare t text;
begin
  foreach t in array array['policy_config','item_policy','outlier_rule',
                           'outlier_exclusion','soft_allocation','forecast_setting'] loop
    execute format('grant select, insert, update, delete on core.%I to authenticated', t);
    execute format('revoke all on core.%I from anon', t);
    execute format('alter table core.%I enable row level security', t);

    execute format('drop policy if exists %I on core.%I', t || '_read', t);
    execute format('create policy %I on core.%I for select to authenticated using (true)',
                   t || '_read', t);

    execute format('drop policy if exists %I on core.%I', t || '_write_admin', t);
    execute format('create policy %I on core.%I for all to authenticated
                      using (core.is_admin()) with check (core.is_admin())',
                   t || '_write_admin', t);
  end loop;
end $$;

-- 시퀀스도 열어 줍니다.
grant usage, select on sequence core.outlier_rule_rule_id_seq        to authenticated;
grant usage, select on sequence core.soft_allocation_allocation_id_seq to authenticated;

-- 가예약은 영업 담당자(USER)도 만들 수 있어야 합니다 (renew.prd 27.6).
-- 위 반복문이 건 admin 전용 정책을 여기서 덮어씁니다.
drop policy if exists soft_allocation_write_admin on core.soft_allocation;

drop policy if exists soft_allocation_insert_self on core.soft_allocation;
create policy soft_allocation_insert_self on core.soft_allocation
  for insert to authenticated
  with check (requested_by = auth.uid());

drop policy if exists soft_allocation_update_own on core.soft_allocation;
create policy soft_allocation_update_own on core.soft_allocation
  for update to authenticated
  using (requested_by = auth.uid() or core.is_admin())
  with check (requested_by = auth.uid() or core.is_admin());

-- ══ 6. 확인 ════════════════════════════════════════════════════

select 'policy_config'      as t, count(*) from core.policy_config
union all select 'item_policy',        count(*) from core.item_policy
union all select 'outlier_rule',       count(*) from core.outlier_rule
union all select 'forecast_setting',   count(*) from core.forecast_setting;

-- MOQ · pack_size 가 얼마나 채워졌는지
select count(*)                              as 품목수,
       count(moq)                            as moq_있음,
       count(pack_size)                      as pack_size_있음
  from core.item_policy;

-- 확정된 학습/검증 경계
select granularity, train_start, train_end, test_start, test_end, forecast_horizon
  from core.forecast_setting;
