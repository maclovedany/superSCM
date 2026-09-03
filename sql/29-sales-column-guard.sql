-- ──────────────────────────────────────────────────────────────
-- STEP 17 후속 · 영업 정보 접근 범위를 Database 층에서 닫습니다
--
-- renew.prd 4.4
--   "Role 은 화면 표시만 제어하지 않는다. Backend API 와 Database(RLS) 양쪽에 적용한다."
-- renew.prd 4.5
--   조달 단가 · 발주 금액 · 공급처 상세 · 리드타임 통계 · 예측 정확도 — 영업 ✕
--
-- 세 겹 중 둘은 이미 닫혀 있었습니다.
--   ① AI Agent 경로 — lib/agent/redact.ts 가 툴 결과에서 키를 지웁니다
--   ② 화면 경로     — 서버 컴포넌트가 컬럼을 빼거나 403 을 냅니다
--   ③ ★ DB 경로     — 여기. 지금까지 열려 있었습니다.
--
-- ③이 왜 필요한가. ①②는 앱을 지나야 걸립니다. 영업 사용자의 토큰은 그 자체로
-- authenticated 이고, 아래 뷰들은 전부 authenticated 에게 select 가 열려 있어
-- PostgREST 로 뷰를 직접 부르면 앱을 건너뛰고 단가·분위수·WAPE 가 그대로 나옵니다.
-- 브라우저 devtools 하나면 되는 일이라 "메뉴에서 감췄다" 는 방어가 아닙니다.
--
-- ★ 방법은 sql/23-atp-sales.sql 이 analytics.v_atp.lead_time_confidence 에 쓴 것과
--   같습니다 — 컬럼을 **빼지 않고** 값만 null 로 냅니다.
--     case when core.is_sales() then null else <컬럼> end
--   컬럼을 빼면 STEP 19 의 /api/v1/* 응답 모양과 기존 화면이 함께 깨집니다.
--
-- 여기서 하는 것
--   §1  core.is_sales()          ADMIN 예외를 더해 앱(isSalesActor)과 규칙을 맞춥니다
--   §2  core.__sales_guard()     뷰 하나를 가리는 일회용 도구 (파일 끝에서 지웁니다)
--   §3  리드타임 통계            core.v_leadtime_stat · v_leadtime_effective ·
--                                analytics.v_safety_stock · v_leadtime_gap ·
--                                v_leadtime_plan_history
--                                (analytics.v_stockout_risk 는 일부러 두었습니다 — §3-4)
--   §4  단가 · 발주 금액         core.v_item_price · core.v_purchase_order ·
--                                analytics.v_purchase_recommendation_kpi
--   §5  공급처 상세              analytics.v_alert · v_alert_history · v_alert_resolved ·
--                                v_dashboard_open_po_risk
--   §6  예측 정확도              analytics.v_model_performance · v_champion_model ·
--                                v_backtest_kpi · v_dashboard_kpi ·
--                                v_forecast_value_add_* · v_consensus_forecast ·
--                                v_forecast_result · v_forecast_summary
--   §7  도구 정리 + 읽기 전용 확인
--
-- 먼저 실행할 파일
--   sql/13 · 15 · 16 · 17 · 18 · 19 · 20 · 21 · 23 · 27  (가리려는 뷰를 만드는 파일 전부)
--   즉 이 파일은 **27 다음, 28 앞** 입니다. sql/README.md §1 의 표를 보세요.
--
-- 다시 실행해도 안전합니다. 아래 §2 의 도구가 멱등입니다.
--
-- ★ error.md #22 — 파일 끝 확인 블록에는 읽기 전용 select 만 둡니다.
-- ──────────────────────────────────────────────────────────────


-- ══ 1. core.is_sales() — ADMIN 예외 ════════════════════════════
--
-- sql/23-atp-sales.sql §1 이 만든 함수를 여기서 한 줄 넓힙니다.
--
-- 그 파일의 주석은 이렇게 적어 두었습니다 —
--   "같은 규칙이 앱에도 있습니다 — lib/auth.ts 의 isSalesUser(user). 두 곳을 함께
--    고치세요. 한쪽만 바꾸면 화면과 DB 의 판정이 갈립니다."
--
-- 그런데 실제로 갈라져 있었습니다. 앱의 판정(lib/agent/redact.ts 의 isSalesActor)은
-- **역할을 먼저 봅니다** — role 이 ADMIN 이면 부서가 '영업1팀' 이어도 영업이 아닙니다.
-- renew.prd 4.2 가 ADMIN 을 "모든 USER 기능" 으로 정의하기 때문입니다.
-- 반면 sql/23 의 core.is_sales() 는 department 만 봅니다.
--
-- 지금까지는 그 차이가 v_atp 의 컬럼 하나에만 걸려 눈에 띄지 않았습니다. 이 파일이
-- 같은 판정을 뷰 스무 개로 넓히므로, 고치지 않으면 **영업 부서에 속한 관리자가**
-- 발주 추천 · 단가 · 정확도를 통째로 잃습니다. 그것은 4.2 위반입니다.
--
-- ★ 앱을 고치는 대신 DB 를 앱에 맞춥니다. 앱 쪽 판정이 PRD 4.2 를 따르는 쪽입니다.

create or replace function core.is_sales()
returns boolean
language sql
stable
security definer
set search_path = core, public
as $$
  -- ★ btrim 은 앱(lib/agent/redact.ts 의 isSalesDepartment)이 trim() 후에 견주기
  --   때문입니다. 한쪽만 다듬으면 department 가 ' 영업2팀' 인 사람이 화면에서는 영업이고
  --   DB 에서는 아닌, 규칙이 두 벌인 상태가 됩니다.
  -- ★ role <> 'ADMIN' 은 lib/agent/redact.ts 의 isSalesActor 와 같은 줄입니다.
  select coalesce(
    (select coalesce(u.role, 'USER') <> 'ADMIN'
        and btrim(u.department) <> ''
        and (btrim(u.department) like '영업%' or upper(btrim(u.department)) like '%SALES%')
       from core.app_user u
      where u.user_id = auth.uid()
        and u.active
        and u.department is not null),
    false);
$$;

comment on function core.is_sales() is
  'renew.prd 4.5 — 영업 사용자 판정. department 가 ''영업'' 으로 시작하거나 SALES 를 포함하고, '
  'role 이 ADMIN 이 아닐 때 true. 같은 규칙이 lib/agent/redact.ts 의 isSalesActor 에 있습니다';

revoke all on function core.is_sales() from public, anon;
grant execute on function core.is_sales() to authenticated;


-- ══ 2. 가리는 도구 ═════════════════════════════════════════════
--
-- 뷰 하나를 받아 이렇게 바꿉니다.
--
--   ① 지금 정의를 그대로 복사해 <뷰>_src 를 만듭니다 (가리지 않은 원본)
--   ② <뷰>_src 의 권한을 전부 거둡니다 — 이것을 직접 읽을 수 있으면 가린 의미가 없습니다
--   ③ 뷰 자신을 <뷰>_src 위의 얇은 select 로 바꿉니다. 가릴 컬럼만 case 로 감쌉니다
--
-- ★ 왜 정의를 손으로 옮겨 적지 않는가.
--   analytics.v_stockout_risk 는 200줄, v_safety_stock 은 100줄입니다. 손으로 옮기면
--   sql/15 · sql/16 과 여기에 정의가 두 벌 생기고, 한쪽만 고치는 날 화면이 조용히
--   어긋납니다 — sql/README.md §2 가 막으려는 바로 그 상태입니다. pg_get_viewdef 로
--   복사하면 옮겨 적는 일이 없으므로 두 벌이 될 수 없습니다.
--
-- ★ <뷰>_src 는 뷰 소유자(postgres)로 읽힙니다. 뷰는 언제나 소유자 권한으로 밑을
--   읽으므로(sql/23 §9 주석과 같은 성질), authenticated 에게서 권한을 거둬도
--   가린 뷰는 그대로 돕니다.
--
-- ★ 멱등. 두 번째 실행에서는 뷰가 이미 <뷰>_src 를 읽고 있으므로 ①을 건너뜁니다.
--   앞 번호 파일을 다시 실행해 원래 정의가 돌아왔다면 ①을 다시 합니다.
--
-- ★ p_rewrite_from / p_rewrite_to — 복사한 정의 안의 참조를 갈아끼웁니다.
--   analytics.v_safety_stock 한 곳에만 씁니다 (§3-3 주석).
--
-- ★ security definer 가 아닙니다. 부르는 사람의 권한으로 DDL 을 합니다.
--   그리고 파일 끝(§7)에서 지웁니다 — 남겨 두면 sql/28 의 무차별
--   `grant execute on all functions in schema core to authenticated` 가 이 함수까지
--   authenticated 에게 열어 줍니다.

create or replace function core.__sales_guard(
  p_schema       text,
  p_view         text,
  p_cols         text[],
  p_rewrite_from text default null,
  p_rewrite_to   text default null
)
returns void
language plpgsql
as $$
declare
  v_src  text := p_view || '_src';
  v_def  text;
  v_sel  text;
  v_miss text;
  v_dep  text;
begin
  -- 오타로 조용히 가리지 않는 컬럼이 생기지 않게, 먼저 이름을 확인합니다.
  select string_agg(c, ', ') into v_miss
    from unnest(p_cols) c
   where not exists (
     select 1 from information_schema.columns ic
      where ic.table_schema = p_schema and ic.table_name = p_view
        and ic.column_name = c);

  if v_miss is not null then
    raise exception '%.% 에 없는 컬럼을 가리려 했습니다: %', p_schema, p_view, v_miss;
  end if;

  v_def := pg_get_viewdef(format('%I.%I', p_schema, p_view)::regclass, true);

  -- 이미 가려져 있으면 원본은 그대로 둡니다. 아니면 지금 정의를 원본으로 뜹니다.
  if position(v_src in v_def) = 0 then
    if p_rewrite_from is not null then
      v_def := replace(v_def, p_rewrite_from, p_rewrite_to);
      if position(p_rewrite_to in v_def) = 0 then
        raise exception '%.% 의 정의에서 % 를 찾지 못했습니다', p_schema, p_view, p_rewrite_from;
      end if;
    end if;

    -- cascade — 앞 번호 파일을 다시 실행해 원본이 낡았을 때를 위한 것입니다.
    -- 이 분기에서는 **가리는 뷰 자신**이 아직 원본을 읽지 않으므로 그쪽으로는 딸려
    -- 지워지는 것이 없습니다.
    --
    -- ★ 다만 _src 를 직접 읽는 뷰를 이 파일이 손으로 둘 만듭니다 —
    --   core.v_leadtime_effective 와 analytics.v_safety_stock_src 가 둘 다
    --   core.v_leadtime_stat_src 를 읽습니다 (§3-2 · §3-3). 그 상태에서 §3-1 의 이
    --   분기가 다시 걸리면 cascade 가 그 둘과 그 아래를 **말없이** 지웁니다.
    --   앞 파일 중 core.v_leadtime_stat 을 다시 만드는 것이 없으므로 정상 순서에서는
    --   걸리지 않지만, 걸렸을 때 조용하지는 않게 먼저 이름을 찍습니다.
    for v_dep in
      select distinct dn.nspname || '.' || dc.relname
        from pg_depend d
        join pg_rewrite r  on r.oid = d.objid
        join pg_class   dc on dc.oid = r.ev_class
        join pg_namespace dn on dn.oid = dc.relnamespace
       where d.refobjid = to_regclass(format('%I.%I', p_schema, v_src))
         and d.classid  = 'pg_rewrite'::regclass
         and dc.relname <> v_src
    loop
      raise notice '%.% 를 다시 뜨면서 % 가 함께 지워집니다 — sql/29 를 끝까지 실행하세요',
                   p_schema, v_src, v_dep;
    end loop;

    execute format('drop view if exists %I.%I cascade', p_schema, v_src);
    execute format('create view %I.%I as %s', p_schema, v_src, v_def);
  end if;

  -- ★★ 이 revoke 는 if 밖입니다. 안에 두었다가 구멍을 냈습니다.
  --
  --   sql/01-grants.sql 19·20 행이 **blanket** 으로 줍니다 —
  --     grant select on all tables in schema core      to anon, authenticated;
  --     grant select on all tables in schema analytics to anon, authenticated;
  --   그리고 24행부터의 default privileges 가 새로 만든 뷰에도 자동으로 붙입니다.
  --   즉 01 을 다시 실행할 때마다 이미 있는 _src 까지 전부 다시 열립니다.
  --
  --   revoke 를 위 if 안에만 두면, **원본을 다시 뜨지 않는 실행**(= 이미 가려져 있어
  --   ①을 건너뛰는 실행)에서는 revoke 도 함께 건너뜁니다. 그러면 01 이 열어 둔 채로
  --   남습니다. 임시 클러스터에서 전체를 두 번 돌리고 실제로 확인했습니다 —
  --   core.v_leadtime_stat_src 와 analytics.v_leadtime_gap_src 두 개가
  --   authenticated 에게 열려 있었습니다. 앞 번호 파일이 다시 만들지 않는 뷰라
  --   ①을 건너뛴 것들입니다. 그 둘에 4.5 가 ✕ 로 둔 리드타임 통계가 통째로 들어
  --   있으므로, 가림막이 있으나 마나였습니다.
  --
  --   그래서 실행할 때마다 무조건 다시 거둡니다. revoke 는 멱등합니다.
  execute format('revoke all on %I.%I from public, anon, authenticated', p_schema, v_src);

  -- 컬럼 이름 · 순서 · 타입을 그대로 둡니다. case 의 타입은 else 쪽이 정하므로
  -- create or replace view 가 요구하는 "같은 모양" 을 만족합니다.
  select string_agg(
           case when ic.column_name = any(p_cols)
                then format('case when core.is_sales() then null else s.%I end as %I',
                            ic.column_name, ic.column_name)
                else format('s.%I', ic.column_name) end,
           E',\n       ' order by ic.ordinal_position)
    into v_sel
    from information_schema.columns ic
   where ic.table_schema = p_schema and ic.table_name = p_view;

  execute format('create or replace view %I.%I as%sselect %s%s  from %I.%I s',
                 p_schema, p_view, E'\n', v_sel, E'\n', p_schema, v_src);
end;
$$;


-- ══ 3. 리드타임 통계 ═══════════════════════════════════════════
--
-- renew.prd 4.5 "리드타임 통계 — 영업 ✕".
--
-- ★ 무엇을 가리고 무엇을 남기는가.
--   가립니다 — 분포의 모양: 표본 수 · P50/P80/P90 · 표준편차 · 평균 · 최댓값 ·
--              구간 평균 · 신뢰도 등급 · 마스터 대비 격차
--   남깁니다 — 적용 중인 리드타임(effective_lead_time · planned_lead_time)
--
--   sql/23 §9 가 이미 그렇게 갈라 두었습니다 — "lead_time 하나만 남깁니다. '언제 받을
--   수 있나' 를 답하려면 필요하고, 그것은 4.5 의 '예상 입고일 ○' 에 해당합니다."
--   analytics.v_atp · v_sales_supply_status 가 영업에게 그 값을 냅니다. 여기서
--   effective_lead_time 을 함께 가리면 영업 화면의 ATP 와 예상 입고일이 통째로 사라집니다.

-- ── 3-1. core.v_leadtime_stat ─────────────────────────────────
--
-- 가장 날것입니다. 이 뷰 하나로 4.5 의 "리드타임 통계" 전부를 읽을 수 있었습니다.
-- 앱은 이 뷰를 읽지 않습니다 (lib/agent/redact.ts 의 주석 한 줄뿐).
-- 밑의 계산은 §3-2 · §3-3 이 원본(core.v_leadtime_stat_src)으로 옮겨 갑니다.
select core.__sales_guard('core', 'v_leadtime_stat', array[
  'supplier_name', 'country', 'n_samples',
  'avg_order_to_ship', 'avg_ship_to_receive', 'mean_days',
  'p50_days', 'p80_days', 'p90_days', 'std_days', 'max_days', 'confidence'
]);

comment on view core.v_leadtime_stat is
  'renew.prd 4.5 — 공급처별 리드타임 실적 통계. 영업에게는 전부 null 입니다. '
  '가리지 않은 원본은 core.v_leadtime_stat_src (권한 없음) 이고 최종 정의는 sql/29 에 있습니다';

-- ── 3-2. core.v_leadtime_effective ────────────────────────────
--
-- ★★ 여기가 이 파일에서 가장 조심한 곳입니다.
--
--   effective_lead_time = coalesce(planned_lead_time, p80_days) 입니다.
--   §3-1 이 p80_days 를 가린 뒤에도 이 뷰가 **가려진** v_leadtime_stat 을 읽으면,
--   확정 리드타임이 없는 공급처의 effective_lead_time 이 영업에게만 null 이 됩니다.
--   그러면 영업 화면에서 ATP · 예상 입고일 · 결품 판정이 함께 사라집니다.
--   가리는 일이 계산을 바꾸면 안 됩니다. 그래서 원본(_src)에서 읽습니다.
--
-- ★ 이 뷰는 sql/ 이 아니라 운영 DB 덤프에 정의가 있었습니다 (프로젝트 파일이 만들지
--   않습니다). 그래서 §2 의 도구를 쓰지 않고 여기서 직접 씁니다. 아래 본문은 덤프의
--   정의 그대로이고, 달라진 것은 읽는 곳(_src)과 case 네 개뿐입니다.
--
-- ★ source 는 남깁니다 ('확정값' | '실적 P80'). 값이 아니라 출처 이름이고,
--   그 값 자체(effective_lead_time)는 위 주석대로 영업에게 허용된 값입니다.

create or replace view core.v_leadtime_effective as
select st.supplier_id,
       case when core.is_sales() then null else st.supplier_name end as supplier_name,
       case when core.is_sales() then null else st.country       end as country,
       case when core.is_sales() then null else st.n_samples     end as n_samples,
       case when core.is_sales() then null else st.p80_days      end as p80_days,
       p.planned_lead_time,
       coalesce(p.planned_lead_time, st.p80_days) as effective_lead_time,
       case
         when p.planned_lead_time is not null then '확정값'::text
         else '실적 P80'::text
       end as source
  from core.v_leadtime_stat_src st
  left join core.leadtime_plan p on p.supplier_id = st.supplier_id;

comment on view core.v_leadtime_effective is
  '적용 중인 리드타임. effective_lead_time 은 영업에게도 그대로 냅니다 (renew.prd 4.5 "예상 입고일 ○"). '
  '표본 수 · P80 · 공급처명 · 국가는 영업에게 null 입니다. 최종 정의는 sql/29 에 있습니다';

-- ── 3-3. analytics.v_safety_stock ─────────────────────────────
--
-- ★★ §3-2 와 같은 이유이고, 이쪽이 더 위험했습니다.
--
--   σ_DLT = √( L × σ_d² + d² × σ_L² ) 에서 σ_L 은 core.v_leadtime_stat.std_days 이고,
--   sql/16 은 그 값을 **coalesce(lead_time_sd, 0)** 으로 씁니다. 가려서 null 이 되면
--   0 으로 조용히 바뀌어 안전재고가 영업에게만 **작아집니다.** 그 안전재고는
--   analytics.v_atp 의 protected_safety_stock 으로 들어가므로, 결과는
--   **영업 화면의 ATP 가 실제보다 커지는 것** 입니다. 가림막이 과잉 판매를 만듭니다.
--
--   그래서 복사한 정의 안의 core.v_leadtime_stat 참조를 원본으로 갈아끼웁니다.
--   sigma 계열과 lead_time_sd 는 출력에서만 가립니다 — safety_stock 은 뷰 안에서
--   sigma_dlt_calc(별칭)로 계산하므로 영향을 받지 않습니다.
--
-- ★ sigma_source ('BACKTEST' | 'IN_SAMPLE') 도 가립니다. lib/agent/redact.ts 의
--   CONTAINS 에 'sigma' 가 있어 앱은 이미 이 키를 지웁니다. 두 층의 규칙을 맞춥니다.
select core.__sales_guard('analytics', 'v_safety_stock', array[
  'lead_time_sd', 'lead_time_confidence',
  'sigma_d_monthly', 'sigma_d', 'sigma_source', 'sigma_dlt'
], 'core.v_leadtime_stat ', 'core.v_leadtime_stat_src ');

comment on view analytics.v_safety_stock is
  'renew.prd 21.1 — σ_DLT 와 안전재고. σ 계열과 리드타임 표준편차는 영업에게 null 이고, '
  'safety_stock 자체는 두 역할이 같은 값입니다. 최종 정의는 sql/29 에 있습니다';

-- ── 3-4. 나머지 리드타임 뷰 ───────────────────────────────────
--
-- ★ analytics.v_leadtime_policy 는 여기에 없습니다. 그 뷰의 통계 컬럼은 전부
--   core.v_leadtime_stat · v_leadtime_effective · v_leadtime_gap 에서 오므로
--   위 세 개를 가린 것만으로 함께 null 이 됩니다. 뷰를 하나 덜 건드립니다.
--   (std_lead_time 은 v_leadtime_gap 에서 오고, 그것은 바로 아래에서 가립니다.)

-- 마스터 표준 리드타임(std_lead_time)과 격차(gap_days)도 리드타임 통계입니다.
-- gap_days = p80_days − std_lead_time 이라 p80 을 가린 것만으로 이미 null 이 됩니다.
select core.__sales_guard('analytics', 'v_leadtime_gap', array[
  'supplier_name', 'country', 'std_lead_time'
]);

select core.__sales_guard('analytics', 'v_leadtime_plan_history', array['supplier_name']);

-- ── analytics.v_stockout_risk 는 가리지 않습니다 (★ 한 번 가렸다가 되돌렸습니다) ──
--
-- 이 뷰의 planned_lead_time 은 core.v_leadtime_effective 의 effective_lead_time
-- 그대로입니다. §3-2 가 그 값을 **영업에게 남기기로** 이미 정했습니다
-- (renew.prd 4.5 "예상 입고일 ○"). 여기서만 가리면 같은 숫자가 한쪽에서는 보이고
-- 한쪽에서는 안 보이는, 규칙이 두 벌인 상태가 됩니다. 막지도 못합니다 —
-- core.v_leadtime_effective 를 한 번 더 부르면 그대로 나옵니다.
--
-- ★ 그리고 가리면 계산이 바뀝니다. 임시 클러스터에서 두 사용자로 실제로 확인한 값입니다.
--
--   analytics.v_purchase_recommendation 이 이 컬럼을 lead_time 으로 받아
--   required_order_date · is_urgent · explanation 을 만듭니다. 가렸을 때 영업에게는 —
--     · explanation  "리드타임 —일 + 검토 30일 동안 수요 2,096 · …"
--       → 권한 때문에 가린 것을 **리드타임을 모른다** 고 말합니다. 사실이 아닙니다.
--     · analytics.v_purchase_recommendation_kpi.n_urgent  영업 0 · 그 밖 5
--     · analytics.v_dashboard_kpi.n_urgent_orders         영업 0 · 그 밖 5
--       → is_urgent 가 null 이 되자 count(*) filter (where is_urgent) 가 **0** 을 셉니다.
--         null 이 아니라 확신에 찬 0 이고, 그 카드는 영업에게도 열려 있는 대시보드에
--         섭니다. "긴급 발주 0건" 은 가린 값이 아니라 **틀린 값**입니다.
--
--   가릴 값과 없는 값은 다릅니다 (design.md §8.2). 그리고 §3-2 · §3-3 · §5 에서
--   세 번 되풀이한 규칙이 여기에도 적용됩니다 — **가림막이 계산을 바꾸지 않습니다.**


-- ══ 4. 조달 단가 · 발주 금액 ═══════════════════════════════════
--
-- ★ core.v_item_price 를 가리면 그 위가 전부 따라옵니다 —
--   analytics.v_purchase_recommendation.unit_price · recommended_amount ·
--   v_purchase_recommendation_with_approval · v_sku_detail ·
--   v_dashboard_purchase_priority. 뷰를 하나만 고쳐 여섯 곳이 닫힙니다.
--   recommended_amount 는 final_recommended_qty × unit_price 라 null 이 곱해져 null 입니다.
select core.__sales_guard('core', 'v_item_price', array['unit_price']);

comment on view core.v_item_price is
  'raw.item_master 의 표준단가. 숫자로 바꿀 수 없으면 null 입니다 (0 으로 채우지 않습니다). '
  '영업에게는 언제나 null 입니다 — renew.prd 4.5. 최종 정의는 sql/29 에 있습니다';

-- 발주 단가. sql/17 이 만드는 뷰이고 위 §4 와 같은 항목입니다.
select core.__sales_guard('core', 'v_purchase_order', array['unit_price']);

-- ★ n_missing_price 를 함께 가리는 이유.
--   total_recommended_amount 는 `filter (where unit_price is not null)` 이라 영업에게
--   자동으로 null 이 됩니다. 그런데 n_missing_price 는 반대로 **품목 전부를 셉니다** —
--   영업 화면에 "단가 없음 20건" 이라는 확신에 찬 숫자가 서게 됩니다. 사실이 아닙니다.
--   가릴 값과 없는 값은 다릅니다 (design.md §8.2).
select core.__sales_guard('analytics', 'v_purchase_recommendation_kpi', array[
  'total_recommended_amount', 'n_missing_price'
]);


-- ══ 5. 공급처 상세 ═════════════════════════════════════════════
--
-- ★ supplier_id 는 가리지 않습니다.
--   그것은 뷰끼리 잇는 열쇠입니다. analytics.v_purchase_recommendation 이
--   `le.supplier_id = r.supplier_id` 로 잇고, 그 값이 null 이 되면 공급처명 ·
--   리드타임 · 발주 권고일이 **조인 자체가 끊겨** 함께 사라집니다. 가림막이
--   계산을 바꾸는 일을 하지 않습니다 (§3-2 · §3-3 과 같은 판단).
--   4.5 가 ✕ 로 둔 것은 "공급처 상세" 이고, 상세는 이름 · 국가입니다.
--   앱(lib/agent/redact.ts)은 supplier_id 까지 지웁니다 — 그 차이는 보고서에 적었습니다.
--
-- 아래 세 알림 뷰는 /alerts 화면이 읽습니다. 그 화면은 영업에게도 열려 있습니다
-- (lib/menu.ts 의 SALES_HIDDEN 에 없습니다).
select core.__sales_guard('analytics', 'v_alert',          array['supplier_name']);
select core.__sales_guard('analytics', 'v_alert_history',  array['supplier_name']);
select core.__sales_guard('analytics', 'v_alert_resolved', array['supplier_name']);

-- 대시보드의 지연 발주 패널. 이 화면도 영업에게 열려 있습니다.
select core.__sales_guard('analytics', 'v_dashboard_open_po_risk', array['supplier_name']);


-- ══ 6. 예측 정확도 지표 ════════════════════════════════════════
--
-- renew.prd 4.5 "예측 정확도 지표 — 영업 ✕".
-- lib/agent/redact.ts 의 CONTAINS 목록과 같은 이름들입니다 —
-- wape · mape · rmse · bias · mae · baseline_improvement · metric_value · sigma.

select core.__sales_guard('analytics', 'v_model_performance', array[
  'wape', 'mape', 'bias', 'rmse', 'mae', 'baseline_improvement', 'metric_value'
]);

-- ★ analytics.v_champion_model 을 가리면 두 곳이 따라옵니다 —
--   v_sku_detail.champion_wape · champion_bias 와 v_dashboard_accuracy_ranking.
--   후자는 정의 안에 `where wape is not null` 이 있어 영업에게는 **0행**이 됩니다.
--   순위표가 비는 것이 맞습니다. 순위만 남기면 누가 못 맞히는지가 그대로 읽힙니다.
--
-- ★ analytics.v_safety_stock 은 영향받지 않습니다. 그 뷰는 이 뷰가 아니라
--   core.champion_model **테이블**의 rmse 를 직접 읽습니다.
select core.__sales_guard('analytics', 'v_champion_model', array[
  'metric_value', 'wape', 'mape', 'bias', 'rmse', 'mae', 'baseline_improvement'
]);

select core.__sales_guard('analytics', 'v_backtest_kpi', array['avg_wape', 'avg_abs_bias']);

-- 대시보드 KPI 카드. 정확도 넷은 core.champion_model 테이블에서 바로 오므로
-- 위 뷰들을 가린 것으로는 닫히지 않습니다. 금액 둘은 §4 에서 이미 null 입니다.
select core.__sales_guard('analytics', 'v_dashboard_kpi', array[
  'forecast_accuracy', 'avg_wape', 'forecast_bias', 'n_bias_items',
  'total_recommended_amount', 'n_missing_price'
]);

-- Forecast Value Add (sql/18). improvement_pct 는 두 WAPE 의 차이라 함께 가립니다.
select core.__sales_guard('analytics', 'v_forecast_value_add_by_reason', array[
  'ai_wape', 'consensus_wape', 'improvement_pct'
]);
select core.__sales_guard('analytics', 'v_forecast_value_add_summary', array[
  'ai_wape', 'consensus_wape', 'improvement_pct'
]);

-- 예측 잔차 σ. renew.prd 21.1 이 "예측 정확도가 안전재고 두께를 결정한다" 고 쓴
-- 그 값이고, lib/agent/redact.ts 도 'sigma' 를 지웁니다.
--
-- ★ core.v_ai_forecast · core.v_consensus_forecast 의 sigma 는 **가리지 않습니다.**
--   analytics.v_safety_stock 이 백테스트가 없을 때 그 값으로 σ_d 를 만듭니다.
--   가리면 §3-3 과 똑같이 영업의 안전재고가 무너지고 ATP 가 커집니다.
--   화면에 나가는 세 뷰에서만 가립니다.
select core.__sales_guard('analytics', 'v_consensus_forecast', array['sigma']);
select core.__sales_guard('analytics', 'v_forecast_result',    array['sigma']);
select core.__sales_guard('analytics', 'v_forecast_summary',   array['sigma']);


-- ══ 7. 도구 정리 + 확인 ════════════════════════════════════════
--
-- ★ 도구를 남기지 않습니다. sql/28-anon-lockdown.sql 이
--   `grant execute on all functions in schema core to authenticated` 를 하므로,
--   남겨 두면 로그인한 누구나 이 DDL 함수를 부를 수 있게 됩니다.
drop function if exists core.__sales_guard(text, text, text[], text, text);

-- 읽기 전용 확인 (error.md #22 — 여기서 쓰기 함수를 부르지 않습니다).
--
-- ① 원본(_src)이 authenticated 에게 닫혀 있는가.
--
--   verdict 가 한 줄이라도 '★ 열려 있습니다' 면 그 뷰의 가림막은 없는 것과 같습니다.
--   sql/01-grants.sql 을 다시 실행한 뒤 이 파일을 실행하지 않으면 그렇게 됩니다.
--   고치는 법은 이 파일을 한 번 더 실행하는 것뿐입니다 (§2 의 revoke 가 다시 거둡니다).
select n.nspname || '.' || c.relname                          as src_view,
       case when has_table_privilege('authenticated', c.oid, 'select')
                 or has_table_privilege('anon', c.oid, 'select')
            then '★ 열려 있습니다 — sql/29 를 다시 실행하세요'
            else 'ok — 닫혀 있습니다' end                      as verdict,
       has_table_privilege('authenticated', c.oid, 'select')  as authenticated_can_read,
       has_table_privilege('anon',          c.oid, 'select')  as anon_can_read
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v'
   and n.nspname in ('core', 'analytics')
   and c.relname like '%\_src'
 order by 2 desc, 1;

-- ② 가려진 컬럼이 실제로 case 로 감싸였는가 — 뷰마다 한 줄씩 셉니다.
select n.nspname || '.' || c.relname                                     as view_name,
       (length(pg_get_viewdef(c.oid, true))
        - length(replace(pg_get_viewdef(c.oid, true), 'is_sales()', '')))
         / length('is_sales()')                                          as n_guarded_columns
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'v'
   and n.nspname in ('core', 'analytics')
   and pg_get_viewdef(c.oid, true) like '%is_sales()%'
 order by 1;
