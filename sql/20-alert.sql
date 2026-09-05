-- ★ 영업 가림막 — analytics.v_alert · v_alert_history · v_alert_resolved 의 최종 정의는 sql/29-sales-column-guard.sql 에 있습니다 (renew.prd 4.4 · 4.5).
-- ──────────────────────────────────────────────────────────────
-- STEP 14 · Alert Center + 백그라운드 스캔
--
-- renew.prd 24장
--   24.1  탐지 항목 12종
--   24.2  "severity · item_id · type · reason · impact
--          recommended_action · detected_at · acknowledged_by"
--   24.3  "단가, 결품 영향도, 남은 시간을 반영해 정렬한다."
--   24.4  "스케줄러가 주기적으로 전체 SKU를 스캔한다."
--
-- 여기서 만드는 것
--   core       alert                  알림 한 건 (미해결 · 해결 이력 모두)
--   core       alert_type_label()     유형 코드 → 한국어 라벨 (12종)
--   core       alert_priority()       정렬 점수 (renew.prd 24.3)
--   core       scan_alerts()  ★       12 룰을 훑어 fingerprint 기준으로 upsert
--   core       acknowledge_alert()    담당자 확인 (로그인 사용자 누구나)
--   analytics  v_alert                미해결 알림 + 품목명 · 공급처명 · 라벨 · 경과 시간
--   analytics  v_alert_history        해결된 것 포함 최근 500
--   analytics  v_alert_resolved       해결된 것만 최근 500 (화면 이력 패널)
--   analytics  v_alert_kpi            n_open · n_critical · n_warning · n_info ·
--                                     n_unacknowledged · last_scan_at
--
-- ★ sql/18-forecast-override.sql 까지 먼저 실행하세요.
--   analytics.v_stockout_risk · v_inventory_projection (sql/15),
--   core.v_item_price · analytics.v_demand_window (sql/16),
--   core.v_usage_monthly (sql/17), analytics.v_override_excess (sql/18) 을 읽습니다.
--
-- ★ 임계값은 전부 core.policy_config 에서 읽습니다 (AGENTS.md · renew.prd 32장).
--   이 파일이 심는 키는 §2 에 있고, 없을 때만 심습니다(on conflict do nothing).
--   예외는 §3 의 정렬 가중치 세 개뿐입니다 — 그건 정책값이 아니라 점수 눈금입니다.
--
-- ★★ 한 번만 해 둘 설정 — Cron 비밀값
--
--   Route Handler(/api/cron/scan-alerts)는 로그인 세션이 없어 core.is_admin() 이
--   false 입니다. 그래서 core.scan_alerts(p_secret) 는 두 문 중 하나를 통과시킵니다.
--     ① core.is_admin()                                   ← 관리자의 [지금 스캔]
--     ② p_secret = current_setting('app.cron_secret', true) ← 스케줄러
--
--   ②를 쓰려면 DB 에 값을 한 번 심어야 합니다. SQL Editor 에서 한 줄입니다.
--
--       alter database postgres set app.cron_secret = '충분히-긴-무작위-문자열';
--
--   같은 값을 Vercel 환경변수 CRON_SECRET 에 넣습니다. 두 값이 달라지면 스캔은
--   조용히 실패하지 않고 '알림 스캔 권한이 없습니다' 로 멈춥니다.
--
--   ★ 설정하지 않으면 ②는 통과하지 않습니다. 다만 그것이 "비교가 참이 될 수 없어서"
--     저절로 되는 것은 아닙니다. current_setting 이 null 이면 비교 결과도 null 이고,
--     null 은 거짓이 아니라서 `not (... or null)` 이 null 이 되어 if 가 분기를
--     타지 않습니다 — 그렇게 두면 오히려 문이 열립니다. §4 ①이 세 값 논리를
--     조건식에서 걷어내고 단계마다 boolean 으로 좁히는 이유가 이것입니다.
--     그 구조 덕에 기본값이 "닫힘" 입니다.
--
--   ★ 이 값을 심은 뒤 새 세션부터 반영됩니다. SQL Editor 에서 바로 확인하려면
--       select current_setting('app.cron_secret', true);
--     를 새 탭에서 실행하세요.
--
-- ★★ scan_alerts 만 anon 에게 execute 를 엽니다.
--   Route Handler 는 로그인하지 않은 anon 세션으로 rpc 를 부르기 때문입니다.
--   따라서 이 함수의 유일한 문은 함수 안의 p_secret 검사입니다.
--   acknowledge_alert 는 anon 에서 revoke 합니다.
--
-- ★★ 다시 실행할 때 (재실행 규칙) — 반드시 읽으세요
--
--   이 파일의 `drop view` 는 전부 **cascade** 입니다. cascade 가 없으면 뒤 번호
--   파일이 이 파일의 뷰 위에 뷰를 만들어 둔 순간부터
--   "cannot drop … because other objects depend on it" 으로 재실행 자체가
--   막혔습니다. 그래서 cascade 를 붙였습니다.
--
--   대신 값을 치릅니다. cascade 는 **뒤 파일이 만든 뷰까지 말없이 함께 지웁니다.**
--   analytics.v_alert_kpi 를 지우면 sql/21 의 v_dashboard_kpi 가 같이
--   사라집니다.
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
-- renew.prd 24.2 의 필드 그대로입니다. 여기에 스캔이 필요로 하는 세 가지를 더합니다.
--   last_seen_at  이번 스캔에도 여전히 잡혔는가
--   resolved_at   더 이상 잡히지 않아 닫힌 시각
--   fingerprint   같은 알림을 매 스캔마다 새로 만들지 않기 위한 키

create table if not exists core.alert (
  alert_id           bigserial primary key,
  type               text not null,
  severity           text not null check (severity in ('CRITICAL', 'WARNING', 'INFO')),
  item_id            text,
  supplier_id        text,
  -- 한국어 한 줄. 무엇을 보고 잡았는지 (숫자 포함)
  reason             text,
  -- 그래서 무슨 일이 생기는지
  impact             text,
  -- 무엇을 하면 되는지
  recommended_action text,
  -- 룰이 본 숫자들. 화면이 아니라 재현과 감사를 위한 것입니다
  metrics            jsonb,
  -- renew.prd 24.3 의 정렬 점수. 정책값이 아니라 눈금이라 뷰가 아니라 여기 저장합니다
  priority_score     numeric,
  detected_at        timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  resolved_at        timestamptz,
  acknowledged_by    uuid references auth.users(id) on delete set null,
  acknowledged_email text,
  acknowledged_at    timestamptz,
  -- type || ':' || coalesce(item_id, supplier_id, 'GLOBAL')
  fingerprint        text not null
);

-- ★ 미해결 알림은 fingerprint 당 하나뿐입니다.
--   해결된(resolved_at 이 찬) 행은 제외하므로, 같은 위험이 다시 생기면
--   새 알림으로 다시 열립니다. 이력이 덮이지 않습니다.
create unique index if not exists alert_open_fingerprint_idx
  on core.alert(fingerprint) where resolved_at is null;

create index if not exists alert_open_priority_idx
  on core.alert(priority_score desc) where resolved_at is null;

create index if not exists alert_detected_idx on core.alert(detected_at desc);
create index if not exists alert_item_idx     on core.alert(item_id);

comment on table core.alert is
  'renew.prd 24장 — 탐지된 알림. fingerprint 로 같은 알림을 매 스캔마다 새로 만들지 않습니다';

comment on column core.alert.fingerprint is
  'type || '':'' || coalesce(item_id, supplier_id, ''GLOBAL''). 미해결 부분 유니크 인덱스의 키입니다';

comment on column core.alert.resolved_at is
  '이번 스캔에서 더 이상 잡히지 않아 닫힌 시각. null 이면 미해결입니다';

-- ══ 2. 임계값 시드 ═════════════════════════════════════════════
--
-- 룰이 쓰는 임계값은 전부 여기서 옵니다. 값을 바꾸면 코드 수정 없이 다음 스캔부터
-- 반영됩니다 (renew.prd 11.4 · 32장). 이미 있는 키는 건드리지 않습니다.
--
-- EXCESS_STOCK_MONTHS 는 sql/06-core-extend.sql 이 이미 심었습니다 (과잉재고 기준 6개월).
-- 여기서 다시 심지 않습니다.
--
-- ★ ALERT_FORECAST_OUTLIER_MULTIPLE — 결정.
--   지시서 본문은 Forecast Outlier 를 "학습 구간 최대의 3배 초과" 라고만 적고
--   정책 키를 지정하지 않았습니다. 3 을 SQL 에 박으면 AGENTS.md 13("정책값을 코드에
--   하드코딩하지 않는다")에 어긋나므로, 같은 규칙을 따라 키로 뺐습니다.
--   기본값은 지시서의 3 그대로입니다.

insert into core.policy_config (key, value_num, unit, description) values
  ('ALERT_ACCURACY_WAPE_MAX',          0.30, '비율', 'Champion WAPE 가 이 값을 넘으면 예측 정확도 하락 알림'),
  ('ALERT_DEMAND_SPIKE_SIGMA',         2,    '계수', '실적이 AI 예측에서 이 배수 × σ 를 벗어나면 수요 급변 알림'),
  ('ALERT_LEADTIME_DETERIORATION_DAYS', 7,   '일',   '최근 90일 평균 리드타임이 적용값보다 이만큼 길면 악화 알림'),
  ('ALERT_OVERRIDE_REPEAT_COUNT',      3,    '회',   '최근 90일 보정이 이 횟수 이상이면 반복 보정 알림'),
  ('ALERT_INQUIRY_SPIKE_RATIO',        2,    '배',   '최근 7일 문의가 이전 4주 주평균의 이 배수를 넘으면 문의 급증 알림'),
  ('ALERT_SOFT_ALLOC_EXPIRY_DAYS',     2,    '일',   '가예약 만료가 이 일수 안으로 들어오면 만료 임박 알림'),
  ('ALERT_PO_DELAY_DAYS',              0,    '일',   '진행 중 선적이 예정일에서 이 일수를 넘겨 지나면 지연 알림'),
  ('ALERT_FORECAST_OUTLIER_MULTIPLE',  3,    '배',   '예측이 학습 구간 최대의 이 배수를 넘으면 예측 이상 알림')
on conflict (key) do nothing;

-- ══ 3. 표시 · 정렬 함수 ════════════════════════════════════════

-- 유형 코드 → 한국어 라벨 (renew.prd 24.1 의 12종).
--
-- lib/alerts.ts 의 ALERT_TYPE_LABEL 과 같은 문구여야 합니다. 두 곳이 어긋나면
-- 화면과 API 가 같은 알림을 다르게 부릅니다.
--
-- ★ STEP 20 이 13번째 유형 BULK_DATA_CHANGE 를 더합니다. when 한 줄만 넣으면 됩니다.
-- ★ 모르는 코드는 지어내지 않고 원문을 그대로 돌려줍니다. 라벨을 못 따라온 코드가
--   영문으로 보이는 편이 조용히 빈칸이 되는 것보다 낫습니다.
create or replace function core.alert_type_label(p_type text)
returns text
language sql
immutable
as $$
  select case p_type
           when 'STOCKOUT_RISK'          then '결품 위험'
           when 'ORDER_TOO_LATE'         then '발주 시점 초과'
           when 'EXCESS_INVENTORY'       then '과잉 재고'
           when 'DEMAND_SPIKE'           then '수요 급변'
           when 'FORECAST_OUTLIER'       then '예측 이상'
           when 'OPEN_PO_DELAY'          then '발주 지연'
           when 'LEADTIME_DETERIORATION' then '리드타임 악화'
           when 'FORECAST_ACCURACY_DROP' then '예측 정확도 하락'
           when 'EXCESSIVE_OVERRIDE'     then '반복 보정'
           when 'DELIVERY_PROMISE_RISK'  then '납기 약속 위험'
           when 'SOFT_ALLOC_EXPIRING'    then '가예약 만료 임박'
           when 'INQUIRY_SPIKE'          then '문의 급증'
           else p_type
         end;
$$;

-- 정렬 점수 — renew.prd 24.3 "단가, 결품 영향도, 남은 시간을 반영해 정렬한다."
--
-- ★★ 아래 숫자들은 정렬 가중치 — 정책값 아님.
--    core.policy_config 에 두지 않는 이유는, 이 값을 바꿔도 무엇을 알릴지가
--    달라지지 않기 때문입니다. 목록의 순서만 달라집니다. 판정을 바꾸는 값(임계값)과
--    보여주는 순서를 정하는 값(눈금)을 같은 곳에 두면, 정책 화면에서 눈금을 만졌다가
--    판정이 바뀐 줄 알게 됩니다.
--
--    ① severity 가중   CRITICAL 100 · WARNING 50 · INFO 10
--       위험 하나가 주의 두 건보다 항상 위에 옵니다.
--    ② 금액 가중       ln(1 + 단가 × 일평균수요) × 5
--       로그를 쓰는 이유는, 단가가 1,000배 비싼 품목이 목록을 통째로 덮지 않게
--       하기 위해서입니다. 금액은 순서를 거드는 값이지 정하는 값이 아닙니다.
--    ③ 남은 시간 가중  greatest(0, 60 − 소진까지 일수)
--       60일 밖이면 0, 오늘 소진이면 60, 이미 소진(음수)이면 60 을 넘습니다.
--       소진일을 모르면(null) 0 입니다 — 급하지 않다고 보는 것이 아니라
--       이 항목으로는 순서를 못 매긴다는 뜻입니다.
create or replace function core.alert_priority(
  p_severity       text,
  p_value_amount   numeric,
  p_stockout_days  numeric
)
returns numeric
language sql
immutable
as $$
  select (case p_severity
            when 'CRITICAL' then 100
            when 'WARNING'  then 50
            else                 10
          end)::numeric
       + ln(1 + greatest(coalesce(p_value_amount, 0), 0)) * 5
       + (case when p_stockout_days is null then 0
               else greatest(0, 60 - p_stockout_days)
          end);
$$;

revoke all on function core.alert_type_label(text) from public, anon;
revoke all on function core.alert_priority(text, numeric, numeric) from public, anon;
grant execute on function core.alert_type_label(text) to authenticated;
grant execute on function core.alert_priority(text, numeric, numeric) to authenticated;

-- ══ 4. 스캔 함수 ★ ═════════════════════════════════════════════
--
-- renew.prd 24.4 — "스케줄러가 주기적으로 전체 SKU를 스캔한다."
--
-- 구조
--   ① 권한 검사 (관리자 또는 app.cron_secret)
--   ② 후보 임시 테이블에 룰 12종의 결과를 모은다
--   ③ fingerprint 로 중복을 접고 정렬 점수를 매긴다
--   ④ fingerprint 기준 upsert — 있으면 갱신, 없으면 insert
--   ⑤ 이번에 안 잡힌 미해결 알림은 닫는다
--
-- ★ error.md #11 — RETURNS TABLE 의 컬럼(n_new · n_updated · n_resolved · message)은
--   함수 안에서 변수가 됩니다. 그래서 지역 변수는 전부 v_ 로 시작하고, 본문의 테이블
--   참조에는 항상 별칭을 붙입니다.

create or replace function core.scan_alerts(p_secret text default null)
returns table (n_new int, n_updated int, n_resolved int, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_now        timestamptz := now();
  v_total      int := 0;
  v_new        int := 0;
  v_updated    int := 0;
  v_resolved   int := 0;
  v_ratio      numeric;
  v_date_col   text;
  v_inquiry    text := '';
  v_spike_note text := '';
  v_spike_cmp  int  := 0;
  v_cron       text;
  v_allowed    boolean := false;
begin
  -- ── ① 권한 ────────────────────────────────────────────────
  --
  -- 이 함수는 anon 에게도 execute 가 열려 있습니다(Route Handler 가 로그인 세션 없이
  -- 부릅니다). 그래서 이 검사 하나가 유일한 문입니다.
  --
  -- ★★ 여기서 null 을 조건식에 흘려보내면 문이 열립니다 — 실제로 한 번 그랬습니다.
  --
  --   app.cron_secret 을 심지 않은 DB 에서 current_setting(..., true) 는 null 입니다.
  --   `p_secret = null` 은 false 가 아니라 **null** 이고,
  --   `false or null` 은 null, `not null` 도 null 이며,
  --   `if null then raise` 는 **분기를 타지 않습니다.**
  --   즉 비밀값을 심지 않은 상태에서 아무 문자열이나 p_secret 으로 넘기면
  --   로그인 없이 스캔이 돌았습니다. "비교가 참이 될 수 없다" 는 맞지만,
  --   거짓도 아니라는 것이 핵심입니다.
  --
  --   그래서 세 값 논리를 조건식에 두지 않고, 단계마다 확실한 boolean 으로 좁힙니다.
  --   v_allowed 는 false 로 시작해 명시적으로만 true 가 됩니다 — 기본값이 "닫힘" 입니다.
  --
  --   ★ core.is_admin() 은 지금 exists(...) 라 null 이 될 수 없습니다(sql/03-auth.sql).
  --     그래도 coalesce 로 감쌉니다. 저 함수가 언젠가 null 을 돌려주게 바뀌면
  --     `not null` → null → if 가 분기를 안 타서 **똑같은 구멍이 다시 열립니다.**
  --     여기서 한 번 겪은 실수라, 다른 파일의 구현에 기대지 않습니다.
  v_allowed := coalesce(core.is_admin(), false);

  if not v_allowed then
    v_cron := current_setting('app.cron_secret', true);
    -- 심지 않았거나(null) 빈 값이면 스케줄러 경로는 통째로 없는 것으로 봅니다.
    if v_cron is not null and btrim(v_cron) <> '' and p_secret is not null then
      -- 양변 모두 null 이 아니므로 이 비교는 반드시 true 이거나 false 입니다.
      v_allowed := coalesce(p_secret = v_cron, false);
    end if;
  end if;

  if not v_allowed then
    raise exception '알림 스캔 권한이 없습니다';
  end if;

  -- ── ② 후보 모으기 ─────────────────────────────────────────
  drop table if exists pg_temp._alert_cand;
  drop table if exists pg_temp._alert_scan;

  create temp table _alert_cand (
    type               text,
    severity           text,
    item_id            text,
    supplier_id        text,
    reason             text,
    impact             text,
    recommended_action text,
    metrics            jsonb
  ) on commit drop;

  insert into pg_temp._alert_cand
    (type, severity, item_id, supplier_id, reason, impact, recommended_action, metrics)
  with pol as (
    -- ★ 이 행들을 core.policy_config 에서 지우지 마세요.
    --   값이 없으면 그 룰의 비교식이 null 이 되어 그 유형만 통째로 잡히지 않습니다.
    --   0 으로 채우지 않는 이유가 그것입니다 — 0 으로 채우면 임계값이 0 인 것처럼
    --   모든 품목이 걸리거나(또는 아무도 안 걸리거나) 하여 "정책값이 빠졌다" 를
    --   알아챌 수 없습니다. 이 파일 §2 가 없는 키만 심습니다.
    select max(pc.value_num) filter (where pc.key = 'ALERT_ACCURACY_WAPE_MAX')           as accuracy_wape_max,
           max(pc.value_num) filter (where pc.key = 'ALERT_DEMAND_SPIKE_SIGMA')          as demand_spike_sigma,
           max(pc.value_num) filter (where pc.key = 'ALERT_LEADTIME_DETERIORATION_DAYS') as leadtime_deterioration_days,
           max(pc.value_num) filter (where pc.key = 'ALERT_OVERRIDE_REPEAT_COUNT')       as override_repeat_count,
           max(pc.value_num) filter (where pc.key = 'ALERT_SOFT_ALLOC_EXPIRY_DAYS')      as soft_alloc_expiry_days,
           max(pc.value_num) filter (where pc.key = 'ALERT_PO_DELAY_DAYS')               as po_delay_days,
           max(pc.value_num) filter (where pc.key = 'ALERT_FORECAST_OUTLIER_MULTIPLE')   as forecast_outlier_multiple,
           max(pc.value_num) filter (where pc.key = 'EXCESS_STOCK_MONTHS')               as excess_stock_months
      from core.policy_config pc
  ),

  -- ── 룰 1. STOCKOUT_RISK ───────────────────────────────────
  -- renew.prd 24.1 "Stockout Risk — 결품 예상일이 리드타임 이내"
  -- analytics.v_stockout_risk 가 이미 그 판정을 냈습니다(risk_status = 'WARNING').
  -- 여기서 다시 계산하지 않습니다. 두 곳에서 재면 화면과 알림이 어긋납니다.
  r_stockout as (
    select 'STOCKOUT_RISK'::text  as type,
           'WARNING'::text        as severity,
           s.item_id,
           s.supplier_id,
           ('결품 예상일 ' || coalesce(to_char(s.stockout_date, 'YYYY-MM-DD'), '—')
             || ' · 소진까지 ' || core.fmt_qty(s.stockout_days) || '일'
             || ' · 계획 리드타임 ' || core.fmt_qty(s.planned_lead_time) || '일')::text as reason,
           ('이번 검토 주기 안에 발주하지 않으면 도착 전에 재고가 바닥납니다')::text     as impact,
           ('발주 추천 화면에서 발주하세요 · 필요량 ' || core.fmt_qty(s.required_qty))::text as recommended_action,
           jsonb_build_object(
             'risk_status',       s.risk_status,
             'stockout_date',     s.stockout_date,
             'stockout_days',     s.stockout_days,
             'planned_lead_time', s.planned_lead_time,
             'required_qty',      s.required_qty,
             'available_qty',     s.available_qty
           ) as metrics
      from analytics.v_stockout_risk s
     where s.risk_status = 'WARNING'
  ),

  -- ── 룰 2. ORDER_TOO_LATE ──────────────────────────────────
  -- renew.prd 24.1 "Order Too Late — 지금 발주해도 결품 후 도착"
  -- v_stockout_risk 의 CRITICAL 이 바로 그 상태입니다
  -- (소진까지 남은 일수 < 계획 리드타임).
  r_too_late as (
    select 'ORDER_TOO_LATE'::text as type,
           'CRITICAL'::text       as severity,
           s.item_id,
           s.supplier_id,
           ('결품 예상일 ' || coalesce(to_char(s.stockout_date, 'YYYY-MM-DD'), '—')
             || ' · 소진까지 ' || core.fmt_qty(s.stockout_days) || '일'
             || ' · 계획 리드타임 ' || core.fmt_qty(s.planned_lead_time) || '일 — 지금 발주해도 도착이 늦습니다')::text,
           ('결품이 이미 예정된 상태입니다. 평시 발주로는 막을 수 없습니다')::text,
           ('특급 운송 · 대체품 · 고객 납기 조정을 함께 검토하세요')::text,
           jsonb_build_object(
             'risk_status',       s.risk_status,
             'stockout_date',     s.stockout_date,
             'stockout_days',     s.stockout_days,
             'planned_lead_time', s.planned_lead_time,
             'required_qty',      s.required_qty,
             'available_qty',     s.available_qty
           )
      from analytics.v_stockout_risk s
     where s.risk_status = 'CRITICAL'
  ),

  -- ── 룰 3. EXCESS_INVENTORY ────────────────────────────────
  -- renew.prd 24.1 "Excess Inventory — 예상 소진 기간이 기준 초과"
  -- 기준은 core.policy_config.EXCESS_STOCK_MONTHS (sql/06 시드, 기본 6개월).
  --
  -- ★★ 판정 근거를 두 갈래로 나눕니다. months_of_supply 하나로는 못 재기 때문입니다.
  --
  --   analytics.v_stockout_risk.months_of_supply 는
  --     coalesce(first_negative_index - 1, n_periods)
  --   입니다(sql/15). 전개 내내 재고가 남는 품목은 **전개 길이로 포화**됩니다.
  --   기본 horizon 이 12개월이고 기준이 6개월이므로, 그대로 견주면
  --   결품이 안 나는 품목이 전부 과잉 재고로 잡힙니다. 건강한 품목이
  --   목록을 덮으면 정작 진짜 과잉 재고를 못 봅니다.
  --
  --   ① 전개 안에서 결품이 나는 품목 (first_negative_period is not null)
  --      months_of_supply 가 실제 소진 개월 수입니다. 기존 판정 그대로.
  --   ② 전개 내내 여유인 품목 (first_negative_period is null)
  --      포화값으로는 판정하지 않고 잉여 재고를 직접 견줍니다.
  --        available_qty > 기준개월 × 일평균수요 × 30
  --      일평균수요를 모르면(null · 0) **알리지 않습니다.** 분모를 모르는 채
  --      "몇 개월치" 를 말할 수 없기 때문입니다 (AGENTS.md 규칙 5).
  --      그 품목은 v_stockout_risk.reason 이 이미 사유를 들고 있습니다.
  --
  --   metrics.basis 에 어느 갈래로 판정했는지 남깁니다. 같은 유형인데 근거가
  --   다르면, 나중에 값을 되짚을 때 그것부터 알아야 합니다.
  r_excess as (
    select 'EXCESS_INVENTORY'::text as type,
           'INFO'::text             as severity,
           s.item_id,
           s.supplier_id,
           (case when s.first_negative_period is not null
                 then '예상 소진 기간 ' || core.fmt_qty(s.months_of_supply) || '개월'
                        || ' · 기준 ' || core.fmt_qty(p.excess_stock_months) || '개월'
                 else '가용재고 ' || core.fmt_qty(s.available_qty)
                        || ' · 기준 ' || core.fmt_qty(p.excess_stock_months) || '개월치 '
                        || core.fmt_qty(p.excess_stock_months * s.daily_usage_avg * 30)
                        || ' · 전개 기간(' || core.fmt_qty(s.months_of_supply)
                        || '개월) 안에 결품 없음'
            end)::text,
           ('재고가 오래 묶입니다. 보관비와 진부화 위험이 함께 커집니다')::text,
           ('추가 발주를 미루고 소진 계획을 세우세요')::text,
           jsonb_build_object(
             'basis',            case when s.first_negative_period is not null
                                      then 'MONTHS_OF_SUPPLY' else 'SURPLUS_QTY' end,
             'months_of_supply', s.months_of_supply,
             'threshold_months', p.excess_stock_months,
             'threshold_qty',    p.excess_stock_months * s.daily_usage_avg * 30,
             'daily_usage_avg',  s.daily_usage_avg,
             'current_stock',    s.current_stock,
             'available_qty',    s.available_qty
           )
      from analytics.v_stockout_risk s
      cross join pol p
     where p.excess_stock_months is not null
       -- 판정하지 못한 품목(reason 이 있는 품목)은 months_of_supply 가 null 입니다.
       and s.months_of_supply is not null
       and (
             -- ① 전개 안에서 소진되는 품목
             (s.first_negative_period is not null
              and s.months_of_supply > p.excess_stock_months)
             -- ② 전개 내내 여유인 품목 — 잉여 수량으로 직접 판정
             or (s.first_negative_period is null
                 and s.daily_usage_avg is not null
                 and s.daily_usage_avg > 0
                 and s.available_qty is not null
                 and s.available_qty > p.excess_stock_months * s.daily_usage_avg * 30)
           )
  ),

  -- ── 룰 4. DEMAND_SPIKE ────────────────────────────────────
  -- renew.prd 24.1 "Demand Spike — 실적이 예측 구간을 벗어남"
  --
  -- 최근 확정 실적 달(core.v_usage_monthly 의 최신 달)을 그 달의 Consensus 와 견줍니다.
  --   ① 실적 > P90                                     (예측 구간 밖)
  --   ② |실적 − AI 예측| > ALERT_DEMAND_SPIKE_SIGMA × σ  (양쪽 다 봅니다)
  --
  -- ★ 결정 — 달이 끝난 달만 봅니다.
  --   v_usage_monthly 의 최신 달은 진행 중인 달일 수 있습니다. 그 달을 그대로 견주면
  --   아직 다 팔리지 않은 수량이 "급감" 으로 잡혀 매달 초 거짓 알림이 쏟아집니다.
  --   그래서 달력상 끝난 달 중 가장 최근 달을 씁니다.
  m_latest as (
    select max(u.period) as period
      from core.v_usage_monthly u
     where (u.period + interval '1 month')::date <= current_date
  ),
  r_spike as (
    select 'DEMAND_SPIKE'::text as type,
           'WARNING'::text      as severity,
           u.item_id,
           im.supplier_id,
           (to_char(u.period, 'YYYY-MM') || ' 실적 ' || core.fmt_qty(u.quantity)
             || ' · AI 예측 ' || core.fmt_qty(c.ai_qty)
             || ' · P90 ' || core.fmt_qty(c.p90)
             || ' · σ ' || core.fmt_qty(c.sigma))::text,
           ('실적이 예측 구간을 벗어났습니다. 다음 기간 예측도 함께 빗나가 있을 수 있습니다')::text,
           ('수요 급변 원인을 확인하고 필요하면 Consensus 를 보정하세요')::text,
           jsonb_build_object(
             'period',       u.period,
             'actual_qty',   u.quantity,
             'ai_qty',       c.ai_qty,
             'consensus_qty', c.consensus_qty,
             'p90',          c.p90,
             'sigma',        c.sigma,
             'spike_sigma',  p.demand_spike_sigma
           )
      from core.v_usage_monthly u
      join m_latest ml on ml.period = u.period
      join core.v_consensus_forecast c
        on c.item_id = u.item_id and c.period = u.period
      cross join pol p
      left join core.v_item_master im on im.item_id = u.item_id
     where (c.p90 is not null and u.quantity > c.p90)
        or (c.sigma is not null
            and c.ai_qty is not null
            and p.demand_spike_sigma is not null
            and abs(u.quantity - c.ai_qty) > p.demand_spike_sigma * c.sigma)
  ),

  -- ── 룰 5. FORECAST_OUTLIER ────────────────────────────────
  -- renew.prd 24.1 "Forecast Outlier — 예측값 자체가 이상"
  --   학습 구간 최대의 ALERT_FORECAST_OUTLIER_MULTIPLE 배 초과, 또는 음수.
  --
  -- 학습 구간 최대는 core.v_train_demand 에서 옵니다. 이 뷰는 학습 격리 지점이지만
  -- 여기서는 "학습에 쓴 값의 범위" 를 비교 기준으로만 읽습니다. 예측을 만들지 않으므로
  -- Data Leakage 가 아닙니다 (renew.prd 12.1 의 방향은 실적→학습입니다).
  train_max as (
    select t.item_id, max(t.quantity) as max_qty
      from core.v_train_demand t
     group by t.item_id
  ),
  outlier as (
    select distinct on (f.item_id)
           f.item_id,
           f.period,
           f.predicted_qty,
           tm.max_qty,
           (f.predicted_qty < 0) as is_negative
      from core.v_ai_forecast f
      -- ★ left join 입니다. 음수 예측은 학습 구간 최대가 없어도 이상입니다.
      --   inner join 이면 core.v_train_demand 에 행이 없는 품목(신규 품목 · 학습
      --   구간 밖에서 시작한 품목)의 음수 예측을 통째로 놓칩니다. 배수 검사 쪽은
      --   아래 where 가 tm.max_qty is not null 로 이미 스스로를 지킵니다.
      left join train_max tm on tm.item_id = f.item_id
      cross join pol p
     where f.predicted_qty is not null
       and (f.predicted_qty < 0
            or (p.forecast_outlier_multiple is not null
                and tm.max_qty is not null
                and f.predicted_qty > tm.max_qty * p.forecast_outlier_multiple))
     -- 한 품목에 여러 기간이 걸리면 가장 심한 기간 하나만 알립니다.
     -- fingerprint 가 품목 단위라 어차피 한 건으로 접힙니다.
     order by f.item_id, abs(f.predicted_qty) desc, f.period
  ),
  r_outlier as (
    select 'FORECAST_OUTLIER'::text as type,
           'WARNING'::text          as severity,
           o.item_id,
           im.supplier_id,
           (to_char(o.period, 'YYYY-MM') || ' 예측 ' || core.fmt_qty(o.predicted_qty)
             || case when o.is_negative
                     then ' · 음수 예측'
                     else ' · 학습 구간 최대 ' || core.fmt_qty(o.max_qty)
                          || ' 의 ' || core.fmt_qty(p.forecast_outlier_multiple) || '배 초과'
                end)::text,
           ('예측값 자체가 이상해 안전재고와 발주 추천이 함께 틀어집니다')::text,
           ('모델 평가에서 Champion 을 확인하고 필요하면 예측을 다시 실행하세요')::text,
           jsonb_build_object(
             'period',        o.period,
             'predicted_qty', o.predicted_qty,
             'train_max_qty', o.max_qty,
             'multiple',      p.forecast_outlier_multiple,
             'is_negative',   o.is_negative
           )
      from outlier o
      cross join pol p
      left join core.v_item_master im on im.item_id = o.item_id
  ),

  -- ── 룰 6. OPEN_PO_DELAY ───────────────────────────────────
  -- renew.prd 24.1 "Open PO Delay — 진행 중 발주가 예정일 경과"
  --   core.v_fact_shipment 의 IN_TRANSIT 이고
  --   due_date + ALERT_PO_DELAY_DAYS < current_date.
  --
  -- 한 품목에 지연 선적이 여럿이면 한 건으로 묶습니다 (fingerprint 가 품목 단위).
  po_delay as (
    select s.item_id,
           max(s.supplier_id)                          as supplier_id,
           count(*)::int                               as n_shipments,
           min(s.due_date)                             as earliest_due_date,
           max((current_date - s.due_date))::int       as max_delay_days,
           sum(s.qty)                                  as delayed_qty
      from core.v_fact_shipment s
      cross join pol p
     where s.status = 'IN_TRANSIT'
       and s.due_date is not null
       and p.po_delay_days is not null
       and (s.due_date + p.po_delay_days::int) < current_date
     group by s.item_id
  ),
  r_po_delay as (
    select 'OPEN_PO_DELAY'::text as type,
           'WARNING'::text       as severity,
           d.item_id,
           d.supplier_id,
           ('진행 중 선적 ' || d.n_shipments || '건 · 최장 ' || d.max_delay_days || '일 경과'
             || ' · 최초 예정일 ' || coalesce(to_char(d.earliest_due_date, 'YYYY-MM-DD'), '—'))::text,
           ('입고예정이 늦어져 재고 전개가 실제보다 낙관적입니다')::text,
           ('공급처에 도착 예정일을 확인하고 입고 예정을 갱신하세요')::text,
           jsonb_build_object(
             'n_shipments',       d.n_shipments,
             'max_delay_days',    d.max_delay_days,
             'earliest_due_date', d.earliest_due_date,
             'delayed_qty',       d.delayed_qty,
             'po_delay_days',     p.po_delay_days
           )
      from po_delay d
      cross join pol p
  ),

  -- ── 룰 7. LEADTIME_DETERIORATION ──────────────────────────
  -- renew.prd 24.1 "Lead Time Deterioration — 최근 리드타임이 계획값 대비 악화"
  --   최근 90일 완료 선적의 평균 lt_total − effective_lead_time
  --     > ALERT_LEADTIME_DETERIORATION_DAYS
  --
  -- ★ 공급처 단위 알림입니다. item_id 는 null 이고 fingerprint 는 supplier_id 를 씁니다.
  -- ★ core.v_shipment_valid 를 읽습니다 — COMPLETED · quality OK · lt_total > 0
  --   (덤프의 정의). 진행 중이거나 날짜가 깨진 선적은 평균을 왜곡합니다.
  lt_recent as (
    select v.supplier_id,
           count(*)::int                        as n_samples,
           round(avg(v.lt_total)::numeric, 1)   as avg_lt_recent
      from core.v_shipment_valid v
     where v.qc_release_date is not null
       and v.qc_release_date >= current_date - 90
     group by v.supplier_id
  ),
  r_leadtime as (
    select 'LEADTIME_DETERIORATION'::text as type,
           'WARNING'::text                as severity,
           null::text                     as item_id,
           lr.supplier_id,
           ('최근 90일 평균 리드타임 ' || core.fmt_qty(lr.avg_lt_recent) || '일'
             || ' · 적용 리드타임 ' || core.fmt_qty(le.effective_lead_time) || '일'
             || ' · 차이 ' || core.fmt_qty(lr.avg_lt_recent - le.effective_lead_time) || '일'
             || ' · 표본 ' || lr.n_samples || '건')::text,
           ('이 공급처 품목 전체의 결품 판정이 실제보다 낙관적입니다')::text,
           ('리드타임 정책 화면에서 계획값을 다시 확정하세요')::text,
           jsonb_build_object(
             'avg_lt_recent_90d',   lr.avg_lt_recent,
             'effective_lead_time', le.effective_lead_time,
             'gap_days',            lr.avg_lt_recent - le.effective_lead_time,
             'n_samples',           lr.n_samples,
             'threshold_days',      p.leadtime_deterioration_days
           )
      from lt_recent lr
      join core.v_leadtime_effective le on le.supplier_id = lr.supplier_id
      cross join pol p
     where le.effective_lead_time is not null
       and p.leadtime_deterioration_days is not null
       and (lr.avg_lt_recent - le.effective_lead_time) > p.leadtime_deterioration_days
  ),

  -- ── 룰 8. FORECAST_ACCURACY_DROP ──────────────────────────
  -- renew.prd 24.1 "Forecast Accuracy Drop — 품목 오차율이 임계 초과"
  --   core.champion_model.wape > ALERT_ACCURACY_WAPE_MAX
  r_accuracy as (
    select 'FORECAST_ACCURACY_DROP'::text as type,
           'INFO'::text                   as severity,
           cm.item_id,
           im.supplier_id,
           ('Champion WAPE ' || round(cm.wape::numeric, 3)
             || ' · 기준 ' || round(p.accuracy_wape_max::numeric, 3)
             || ' · 모델 ' || coalesce(cm.champion_model_id, '—'))::text,
           ('예측 오차가 커 안전재고가 실제 변동을 덮지 못할 수 있습니다')::text,
           ('모델 평가에서 다시 채점하고 Champion 을 다시 뽑으세요')::text,
           jsonb_build_object(
             'wape',              cm.wape,
             'threshold_wape',    p.accuracy_wape_max,
             'champion_model_id', cm.champion_model_id,
             'selection_method',  cm.selection_method,
             'selected_at',       cm.selected_at
           )
      from core.champion_model cm
      cross join pol p
      left join core.v_item_master im on im.item_id = cm.item_id
     where cm.wape is not null
       and p.accuracy_wape_max is not null
       and cm.wape > p.accuracy_wape_max
  ),

  -- ── 룰 9. EXCESSIVE_OVERRIDE ──────────────────────────────
  -- renew.prd 24.1 "Excessive Override — 특정 품목 보정이 반복, 모델 개선 신호"
  --   analytics.v_override_excess.n_recent_90d >= ALERT_OVERRIDE_REPEAT_COUNT
  --
  -- ★ v_override_excess 는 보정이 한 번이라도 있었던 품목만 냅니다(STEP 12 보고서 §9-6).
  --   보정이 없는 품목은 애초에 이 룰에 걸릴 수 없으므로 0 으로 채울 필요가 없습니다.
  r_override as (
    select 'EXCESSIVE_OVERRIDE'::text as type,
           'INFO'::text               as severity,
           oe.item_id,
           im.supplier_id,
           ('최근 90일 보정 ' || oe.n_recent_90d || '회 · 기준 '
             || core.fmt_qty(p.override_repeat_count) || '회'
             || ' · 마지막 보정 '
             || coalesce(to_char(oe.last_override_at, 'YYYY-MM-DD'), '—'))::text,
           ('사람이 반복해 고치는 품목입니다. 모델이 이 품목의 수요를 설명하지 못하고 있습니다')::text,
           ('보정 사유를 모아 모델 개선 신호로 쓰세요 · Forecast Value Add 화면')::text,
           jsonb_build_object(
             'n_recent_90d',     oe.n_recent_90d,
             'n_active',         oe.n_active,
             'threshold_count',  p.override_repeat_count,
             'last_override_at', oe.last_override_at
           )
      from analytics.v_override_excess oe
      cross join pol p
      left join core.v_item_master im on im.item_id = oe.item_id
     where p.override_repeat_count is not null
       and oe.n_recent_90d >= p.override_repeat_count
  ),

  -- ── 룰 10. DELIVERY_PROMISE_RISK ──────────────────────────
  -- renew.prd 24.1 "납기 약속 위험 — 확정 수주 납기 전 재고 확보 불가"
  --   raw.sales_order 의 CONFIRMED 납기 이전에 전개 기말 재고가 음수인 품목.
  --
  -- ★ 품목코드는 core 뷰와 같은 규칙으로 정규화합니다 (sql/15 의 so CTE 와 동일).
  --   그러지 않으면 'IT-001' 과 'IT001' 이 다른 품목이 됩니다.
  so_confirmed as (
    select upper(regexp_replace(coalesce(o.item_id, ''), '[\s\-_]', '', 'g')) as item_id,
           min(o.due_date)  as earliest_due_date,
           count(*)::int    as n_orders,
           sum(o.qty)       as committed_qty
      from raw.sales_order o
     where o.status = 'CONFIRMED'
       and o.due_date is not null
       and o.due_date >= current_date
     group by 1
  ),
  promise as (
    select sc.item_id,
           sc.earliest_due_date,
           sc.n_orders,
           sc.committed_qty,
           min(pj.period)          as first_negative_period,
           min(pj.closing_qty)     as worst_closing_qty
      from so_confirmed sc
      join analytics.v_inventory_projection pj
        on pj.item_id = sc.item_id
       and pj.period <= date_trunc('month', sc.earliest_due_date)::date
       and pj.closing_qty < 0
     group by sc.item_id, sc.earliest_due_date, sc.n_orders, sc.committed_qty
  ),
  r_promise as (
    select 'DELIVERY_PROMISE_RISK'::text as type,
           'CRITICAL'::text              as severity,
           pm.item_id,
           im.supplier_id,
           ('확정 수주 납기 ' || to_char(pm.earliest_due_date, 'YYYY-MM-DD')
             || ' 이전 ' || to_char(pm.first_negative_period, 'YYYY-MM')
             || ' 전개 재고가 음수 · 확정 수주 ' || pm.n_orders || '건 '
             || core.fmt_qty(pm.committed_qty))::text,
           ('고객에게 약속한 납기를 지킬 수 없습니다')::text,
           ('특급 발주 · 대체품 · 납기 재협의를 함께 검토하세요')::text,
           jsonb_build_object(
             'earliest_due_date',     pm.earliest_due_date,
             'first_negative_period', pm.first_negative_period,
             'worst_closing_qty',     pm.worst_closing_qty,
             'n_orders',              pm.n_orders,
             'committed_qty',         pm.committed_qty
           )
      from promise pm
      left join core.v_item_master im on im.item_id = pm.item_id
  ),

  -- ── 룰 11. SOFT_ALLOC_EXPIRING ────────────────────────────
  -- renew.prd 24.1 "가예약 만료 임박 — 영업 확인 필요"
  --   core.soft_allocation 의 RESERVED 이고
  --   valid_until − current_date <= ALERT_SOFT_ALLOC_EXPIRY_DAYS
  --
  -- ★ 이미 만료된 가예약(음수)도 조건에 들어옵니다. 지시서의 식 그대로입니다.
  --   만료된 예약은 전개에서 이미 빠져 있으므로(sql/15 의 alloc CTE), 영업이 아직
  --   정리하지 않았다는 사실 자체가 알릴 값입니다.
  alloc as (
    select a.item_id,
           count(*)::int      as n_allocations,
           sum(a.qty)         as reserved_qty,
           min(a.valid_until) as earliest_valid_until
      from core.soft_allocation a
      cross join pol p
     where a.status = 'RESERVED'
       and p.soft_alloc_expiry_days is not null
       and (a.valid_until - current_date) <= p.soft_alloc_expiry_days
     group by a.item_id
  ),
  r_alloc as (
    select 'SOFT_ALLOC_EXPIRING'::text as type,
           'INFO'::text                as severity,
           al.item_id,
           im.supplier_id,
           ('가예약 ' || al.n_allocations || '건 · 수량 ' || core.fmt_qty(al.reserved_qty)
             || ' · 가장 이른 만료 ' || to_char(al.earliest_valid_until, 'YYYY-MM-DD')
             || case when al.earliest_valid_until < current_date then ' (이미 만료)' else '' end)::text,
           ('만료되면 예약 재고가 풀려 재고 전개와 발주 추천이 함께 달라집니다')::text,
           ('영업에 확정 여부를 확인하고 예약을 연장하거나 해제하세요')::text,
           jsonb_build_object(
             'n_allocations',        al.n_allocations,
             'reserved_qty',         al.reserved_qty,
             'earliest_valid_until', al.earliest_valid_until,
             'expiry_days',          p.soft_alloc_expiry_days
           )
      from alloc al
      cross join pol p
      left join core.v_item_master im on im.item_id = al.item_id
  )

  -- ── 후보 합치기 ───────────────────────────────────────────
  -- 룰 12 INQUIRY_SPIKE 는 core.sales_inquiry 가 아직 없어(STEP 17) 아래에서
  -- 동적 SQL 로 따로 넣습니다. 여기 union 에 두면 테이블이 없는 지금 이 함수 자체가
  -- 계획 단계에서 죽습니다.
  select * from r_stockout
  union all select * from r_too_late
  union all select * from r_excess
  union all select * from r_spike
  union all select * from r_outlier
  union all select * from r_po_delay
  union all select * from r_leadtime
  union all select * from r_accuracy
  union all select * from r_override
  union all select * from r_promise
  union all select * from r_alloc;

  -- ── 룰 12. INQUIRY_SPIKE ──────────────────────────────────
  -- renew.prd 24.1 "문의 급증 — 특정 품목 문의가 평소 대비 증가"
  --   최근 7일 문의 수 > 이전 4주 주평균 × ALERT_INQUIRY_SPIKE_RATIO
  --
  -- ★ core.sales_inquiry 는 STEP 17 이 만듭니다. 지금은 없습니다.
  --   to_regclass 로 존재를 확인하고, 없으면 이 룰만 건너뜁니다. 스캔 전체는 돕니다.
  -- ★ 컬럼 이름도 함께 확인합니다. 테이블은 생겼는데 컬럼 이름이 다르면 동적 SQL 이
  --   실행 시점에 터져 스캔 전체가 멈추기 때문입니다. 못 찾으면 조용히 건너뛰지 않고
  --   반환 message 에 그 사실을 적습니다.
  if to_regclass('core.sales_inquiry') is null then
    v_inquiry := ' · 문의 급증 건너뜀(core.sales_inquiry 없음 · STEP 17)';
  else
    select c.column_name into v_date_col
      from information_schema.columns c
     where c.table_schema = 'core'
       and c.table_name = 'sales_inquiry'
       and c.column_name in ('inquiry_date', 'inquired_at', 'asked_at', 'created_at')
     order by array_position(
                array['inquiry_date', 'inquired_at', 'asked_at', 'created_at'],
                c.column_name::text)
     limit 1;

    if v_date_col is null
       or not exists (select 1
                        from information_schema.columns c
                       where c.table_schema = 'core'
                         and c.table_name = 'sales_inquiry'
                         and c.column_name = 'item_id') then
      v_inquiry := ' · 문의 급증 건너뜀(core.sales_inquiry 에서 item_id/문의일 컬럼을 찾지 못했습니다)';
    else
      select max(pc.value_num) filter (where pc.key = 'ALERT_INQUIRY_SPIKE_RATIO')
        into v_ratio
        from core.policy_config pc;

      if v_ratio is null then
        v_inquiry := ' · 문의 급증 건너뜀(ALERT_INQUIRY_SPIKE_RATIO 없음)';
      else
        execute format($q$
          insert into pg_temp._alert_cand
            (type, severity, item_id, supplier_id, reason, impact, recommended_action, metrics)
          select 'INQUIRY_SPIKE',
                 'INFO',
                 q.item_id,
                 im.supplier_id,
                 '최근 7일 문의 ' || q.n_recent || '건 · 이전 4주 주평균 '
                   || core.fmt_qty(q.avg_week) || '건 · 기준 ' || core.fmt_qty(%2$L::numeric) || '배',
                 '문의가 늘면 수주로 이어질 수 있습니다. 지금 예측은 그 수요를 담고 있지 않습니다',
                 '영업과 수요 계획을 확인하고 필요하면 Consensus 를 보정하세요',
                 jsonb_build_object(
                   'n_recent_7d',  q.n_recent,
                   'avg_week_4w',  q.avg_week,
                   'ratio',        %2$L::numeric
                 )
            from (
              select si.item_id,
                     count(*) filter (where si.%1$I >= current_date - 7)::int as n_recent,
                     (count(*) filter (where si.%1$I >= current_date - 35
                                         and si.%1$I <  current_date - 7))::numeric / 4 as avg_week
                from core.sales_inquiry si
               where si.%1$I >= current_date - 35
               group by si.item_id
            ) q
            left join core.v_item_master im on im.item_id = q.item_id
           where q.avg_week > 0
             and q.n_recent > q.avg_week * %2$L::numeric
        $q$, v_date_col, v_ratio);
      end if;
    end if;
  end if;

  -- ── 룰 4 가 실제로 견줄 수 있었는가 ───────────────────────
  --
  -- ★ DEMAND_SPIKE 는 "최근 확정 실적 달" 과 "그 달의 Consensus" 를 견줍니다.
  --   그런데 예측 기간은 train_end 이후부터 시작합니다. Champion 을 최근 실적까지
  --   학습시켜 두면 두 집합이 한 달도 겹치지 않아, 이 룰은 오류 없이 **영구히
  --   아무것도 내지 않습니다.** 조용한 no-op 은 "위험이 없다" 와 구별되지 않습니다.
  --
  --   그래서 겹치는 기간이 하나도 없으면 반환 message 에 그 사실을 적습니다.
  --   INQUIRY_SPIKE 를 건너뛸 때와 같은 방식입니다 — 침묵을 드러냅니다.
  select count(*)::int
    into v_spike_cmp
    from core.v_usage_monthly u
    join core.v_consensus_forecast c
      on c.item_id = u.item_id
     and c.period  = u.period
   where u.period = (select max(u2.period)
                       from core.v_usage_monthly u2
                      where (u2.period + interval '1 month')::date <= current_date);

  if coalesce(v_spike_cmp, 0) = 0 then
    v_spike_note := ' · 수요 급변 비교 불가(최근 확정 실적 달과 겹치는 예측 기간이 없습니다)';
  end if;

  -- ── ③ fingerprint · 정렬 점수 ─────────────────────────────
  --
  -- ★ 정렬 점수의 재료 두 가지는 여기서 한 번에 붙입니다.
  --   금액       core.v_item_price × core.v_usage_effective (단가 × 일평균수요)
  --   남은 시간  analytics.v_stockout_risk.stockout_days
  --   룰마다 따로 조인하면 같은 계산이 열한 번 흩어집니다.
  --
  -- ★ distinct on — 같은 fingerprint 가 후보에 둘 이상 있으면(예: 한 품목이
  --   여러 공급처의 지연 선적을 갖는 경우) 점수가 높은 쪽 하나만 남깁니다.
  --   그러지 않으면 아래 upsert 가 "ON CONFLICT DO UPDATE command cannot affect
  --   row a second time" 로 멈춥니다.
  create temp table _alert_scan on commit drop as
  with ranked as (
    select c.type,
           c.severity,
           c.item_id,
           c.supplier_id,
           c.reason,
           c.impact,
           c.recommended_action,
           c.metrics,
           (c.type || ':' || coalesce(c.item_id, c.supplier_id, 'GLOBAL')) as fingerprint,
           core.alert_priority(c.severity,
                               ip.unit_price * ue.daily_usage_avg,
                               sr.stockout_days) as priority_score
      from pg_temp._alert_cand c
      left join core.v_item_price         ip on ip.item_id = c.item_id
      left join core.v_usage_effective    ue on ue.item_id = c.item_id
      left join analytics.v_stockout_risk sr on sr.item_id = c.item_id
  )
  select distinct on (r.fingerprint) r.*
    from ranked r
   order by r.fingerprint, r.priority_score desc;

  select count(*)::int into v_total from pg_temp._alert_scan;

  -- ── ④ upsert ──────────────────────────────────────────────
  --
  -- 갱신 건수를 upsert 전에 셉니다. xmax 같은 내부 값을 읽지 않으려는 것입니다.
  select count(*)::int into v_updated
    from pg_temp._alert_scan s
    join core.alert a
      on a.fingerprint = s.fingerprint
     and a.resolved_at is null;

  v_new := v_total - v_updated;

  insert into core.alert as a
    (type, severity, item_id, supplier_id, reason, impact, recommended_action,
     metrics, priority_score, fingerprint, detected_at, last_seen_at)
  select s.type, s.severity, s.item_id, s.supplier_id, s.reason, s.impact,
         s.recommended_action, s.metrics, s.priority_score, s.fingerprint,
         v_now, v_now
    from pg_temp._alert_scan s
  on conflict (fingerprint) where resolved_at is null
  do update set
    severity           = excluded.severity,
    item_id            = excluded.item_id,
    supplier_id        = excluded.supplier_id,
    reason             = excluded.reason,
    impact             = excluded.impact,
    recommended_action = excluded.recommended_action,
    metrics            = excluded.metrics,
    priority_score     = excluded.priority_score,
    last_seen_at       = v_now;
  -- ★ detected_at 과 acknowledged_* 는 건드리지 않습니다.
  --   detected_at 을 갱신하면 "언제부터 이 위험이 있었나" 를 잃습니다.
  --   acknowledged_* 를 지우면 담당자가 확인한 알림이 스캔마다 되살아납니다.

  -- ── ⑤ 이번에 안 잡힌 알림 닫기 ────────────────────────────
  --
  -- ★★ 유형별로 나눠 닫습니다. 그냥 "이번 스캔에 없으면 닫기" 로 두면,
  --   룰 하나가 조용히 0행을 내는 순간(의존하는 뷰가 깨졌거나 · 정책 키가 지워졌거나 ·
  --   예측 실행이 없어졌거나) 그 유형의 알림 이력이 **통째로** 닫힙니다.
  --   화면에서는 "위험이 사라졌다" 와 구별되지 않습니다.
  --
  --   그래서 이번 스캔이 후보를 **한 건이라도 낸 유형**만 닫습니다.
  --   한 건도 못 낸 유형은 그대로 열어 둡니다.
  --
  --   ★ 뒤집으면 이런 값을 치릅니다 — 어떤 유형의 위험이 정말로 전부 해소되면
  --     (마지막 한 건까지 사라지면) 그 유형의 알림은 자동으로 닫히지 않고 남습니다.
  --     담당자가 [확인] 으로 처리하거나, 관리자가 직접 닫아야 합니다.
  --
  --         update core.alert set resolved_at = now()
  --          where resolved_at is null and type = 'STOCKOUT_RISK';
  --
  --     "안 닫혀서 남아 있는 알림" 은 눈에 보이지만 "조용히 사라진 이력" 은
  --     보이지 않습니다. 그래서 이쪽으로 기울였습니다.
  update core.alert as a
     set resolved_at = v_now
   where a.resolved_at is null
     and exists (select 1
                   from pg_temp._alert_scan t
                  where t.type = a.type)
     and not exists (select 1
                       from pg_temp._alert_scan s
                      where s.fingerprint = a.fingerprint);
  get diagnostics v_resolved = row_count;

  return query
    select v_new,
           v_updated,
           v_resolved,
           ('알림 스캔 완료 · 후보 ' || v_total || ' · 신규 ' || v_new
             || ' · 갱신 ' || v_updated || ' · 해결 ' || v_resolved
             || v_inquiry || v_spike_note)::text;
end;
$$;

-- ★ anon 에게도 엽니다 — Route Handler 가 로그인 세션 없이 부릅니다.
--   함수 안의 p_secret 검사가 유일한 문이라는 점을 다시 적어 둡니다.
revoke all on function core.scan_alerts(text) from public;
grant execute on function core.scan_alerts(text) to authenticated, anon;

comment on function core.scan_alerts(text) is
  'renew.prd 24.4 — 12 룰 전체 스캔. 관리자이거나 p_secret 이 app.cron_secret 과 같아야 합니다';

-- ══ 5. 확인 함수 ═══════════════════════════════════════════════
--
-- renew.prd 24.2 의 acknowledged_by. 담당자(USER)도 확인할 수 있어야 하므로
-- security definer 로 두고 로그인 여부만 봅니다 (renew.prd 4.3 의 Override 와 같은 취지).

create or replace function core.acknowledge_alert(p_alert_id bigint)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = core, public
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_exists boolean;
begin
  if v_uid is null then
    return query select false, '로그인이 필요합니다'::text;
    return;
  end if;

  select true into v_exists from core.alert a where a.alert_id = p_alert_id;
  if v_exists is not true then
    return query select false, '해당 알림을 찾을 수 없습니다'::text;
    return;
  end if;

  select au.email into v_email from core.app_user au where au.user_id = v_uid;

  update core.alert as a
     set acknowledged_by    = v_uid,
         acknowledged_email = v_email,
         acknowledged_at    = now()
   where a.alert_id = p_alert_id
     and a.acknowledged_at is null;

  -- 이미 확인한 알림을 다시 눌러도 오류가 아닙니다. 확인자를 덮어쓰지 않을 뿐입니다.
  if not found then
    return query select true, '이미 확인한 알림입니다'::text;
    return;
  end if;

  return query select true, '확인 처리했습니다'::text;
end;
$$;

revoke all on function core.acknowledge_alert(bigint) from public, anon;
grant execute on function core.acknowledge_alert(bigint) to authenticated;

-- ══ 6. analytics 뷰 ════════════════════════════════════════════
--
-- 의존 역순으로 먼저 지웁니다 (공통규칙 15 — 컬럼을 빼거나 순서를 바꾸면
-- create or replace 가 거부합니다).

drop view if exists analytics.v_alert_kpi cascade;
drop view if exists analytics.v_alert_resolved cascade;
drop view if exists analytics.v_alert_history cascade;
drop view if exists analytics.v_alert cascade;

-- 미해결 알림만. 화면과 STEP 15 대시보드 · 16 getAlerts 툴 · 19 /api/v1/alerts 가 읽습니다.
create view analytics.v_alert as
select a.alert_id,
       a.type,
       core.alert_type_label(a.type)             as type_label,
       a.severity,
       a.item_id,
       im.item_name,
       a.supplier_id,
       sm.supplier_name                            as supplier_name,
       a.reason,
       a.impact,
       a.recommended_action,
       a.metrics,
       a.priority_score,
       a.detected_at,
       a.last_seen_at,
       (a.acknowledged_at is not null)           as is_acknowledged,
       a.acknowledged_email,
       a.acknowledged_at,
       -- 처음 잡힌 뒤 몇 시간이 지났는가. 화면이 "3시간 전" 을 그리는 재료입니다.
       round((extract(epoch from (now() - a.detected_at)) / 3600)::numeric, 1) as age_hours,
       a.fingerprint
  from core.alert a
  left join core.v_item_master im on im.item_id = a.item_id
  left join core.v_supplier_master sm on sm.supplier_id = a.supplier_id
 where a.resolved_at is null;

comment on view analytics.v_alert is
  'renew.prd 24장 — 미해결 알림. priority_score 내림차순으로 읽습니다';

-- 해결된 것 포함 최근 500. "그때 무엇을 알렸나" 를 되짚는 용도입니다.
create view analytics.v_alert_history as
select a.alert_id,
       a.type,
       core.alert_type_label(a.type)   as type_label,
       a.severity,
       a.item_id,
       im.item_name,
       a.supplier_id,
       sm.supplier_name                  as supplier_name,
       a.reason,
       a.impact,
       a.recommended_action,
       a.metrics,
       a.priority_score,
       a.detected_at,
       a.last_seen_at,
       a.resolved_at,
       (a.resolved_at is not null)     as is_resolved,
       (a.acknowledged_at is not null) as is_acknowledged,
       a.acknowledged_email,
       a.acknowledged_at,
       a.fingerprint
  from core.alert a
  left join core.v_item_master im on im.item_id = a.item_id
  left join core.v_supplier_master sm on sm.supplier_id = a.supplier_id
 order by coalesce(a.resolved_at, a.last_seen_at) desc, a.alert_id desc
 limit 500;

comment on view analytics.v_alert_history is
  'renew.prd 24장 — 해결된 알림까지 최근 500건';

-- ★ 해결된 알림만. /alerts 화면 하단의 이력 패널이 읽습니다.
--
--   왜 v_alert_history 에 필터를 걸어 쓰지 않는가 —
--   v_alert_history 는 뷰 **안에서** limit 500 을 겁니다. 미해결 알림은 모두 같은
--   스캔 시각(last_seen_at)을 갖고 있어 정렬에서 앞자리를 차지합니다. 그래서
--   미해결이 500건을 넘으면, 밖에서 `resolved_at is not null` 로 걸러 봐야
--   이미 잘려 나간 뒤라 **해결된 알림이 한 건도 안 남습니다.** 이력 패널이
--   "해결된 알림이 없습니다" 로 조용히 비어 버립니다.
--
--   자르기 전에 거르면 그 일이 생기지 않습니다.
create view analytics.v_alert_resolved as
select a.alert_id,
       a.type,
       core.alert_type_label(a.type)   as type_label,
       a.severity,
       a.item_id,
       im.item_name,
       a.supplier_id,
       sm.supplier_name                  as supplier_name,
       a.reason,
       a.impact,
       a.recommended_action,
       a.metrics,
       a.priority_score,
       a.detected_at,
       a.last_seen_at,
       a.resolved_at,
       true                            as is_resolved,
       (a.acknowledged_at is not null) as is_acknowledged,
       a.acknowledged_email,
       a.acknowledged_at,
       a.fingerprint
  from core.alert a
  left join core.v_item_master im on im.item_id = a.item_id
  left join core.v_supplier_master sm on sm.supplier_id = a.supplier_id
 where a.resolved_at is not null
 order by a.resolved_at desc, a.alert_id desc
 limit 500;

comment on view analytics.v_alert_resolved is
  'renew.prd 24장 — 해결된 알림만 최근 500건. 자르기 전에 걸러 이력 패널이 비지 않게 합니다';

-- KPI 한 줄. 행이 하나도 없어도 항상 1행입니다 (count 는 0, max 는 null).
create view analytics.v_alert_kpi as
select count(*) filter (where a.resolved_at is null)                                as n_open,
       count(*) filter (where a.resolved_at is null and a.severity = 'CRITICAL')    as n_critical,
       count(*) filter (where a.resolved_at is null and a.severity = 'WARNING')     as n_warning,
       count(*) filter (where a.resolved_at is null and a.severity = 'INFO')        as n_info,
       count(*) filter (where a.resolved_at is null and a.acknowledged_at is null)  as n_unacknowledged,
       -- 마지막 스캔 시각. 해결된 알림도 그 스캔에서 마지막으로 보인 시각을 갖고 있으므로
       -- 전체 행의 max 를 씁니다. 미해결만 보면 알림이 0건인 날 "스캔한 적 없음" 이 됩니다.
       max(a.last_seen_at)                                                          as last_scan_at
  from core.alert a;

comment on view analytics.v_alert_kpi is
  'renew.prd 24장 — 알림 요약. last_scan_at 은 core.alert 전체의 max(last_seen_at) 입니다';

-- ══ 7. 권한 ════════════════════════════════════════════════════
--
-- 공통 패턴 (sql/13 §8) 그대로입니다.
-- 쓰기는 관리자만 직접 할 수 있고, 담당자의 확인은 security definer 함수를 지납니다.

grant select, insert, update, delete on core.alert to authenticated;
revoke all on core.alert from anon;
grant usage, select on sequence core.alert_alert_id_seq to authenticated;

alter table core.alert enable row level security;

drop policy if exists alert_read on core.alert;
create policy alert_read on core.alert
  for select to authenticated using (true);

drop policy if exists alert_write_admin on core.alert;
create policy alert_write_admin on core.alert
  for all to authenticated
  using (core.is_admin()) with check (core.is_admin());

grant select on analytics.v_alert          to authenticated;
grant select on analytics.v_alert_history  to authenticated;
grant select on analytics.v_alert_resolved to authenticated;
grant select on analytics.v_alert_kpi      to authenticated;

-- ══ 8. 확인 ════════════════════════════════════════════════════

-- 비밀값이 심어져 있는지 (null 이면 스케줄러가 통과하지 못합니다)
select current_setting('app.cron_secret', true) is not null as cron_secret_set;

-- 임계값 8개가 들어갔는지
select key, value_num, unit, description
  from core.policy_config
 where key like 'ALERT\_%' or key = 'EXCESS_STOCK_MONTHS'
 order by key;

-- ★ 스캔은 이 파일에서 실행하지 않습니다 — 아래 주석을 반드시 읽으세요.
--
--   core.scan_alerts() 는 core.is_admin() 으로 막혀 있습니다. Supabase SQL Editor
--   에는 JWT 가 없어 auth.uid() 가 null 이고, sql/03-auth.sql 의 is_admin() 정의로는
--   false 입니다. 즉 이 파일 안에서 scan_alerts() 를 부르면
--   '알림 스캔 권한이 없습니다' 로 터집니다.
--
--   SQL Editor 는 붙여넣은 스크립트 전체를 하나의 암묵적 트랜잭션으로 실행하므로,
--   그 오류 하나에 **이 파일 전체가 롤백**됩니다. 알림 테이블도 뷰도 규칙도
--   아무것도 설치되지 않은 채 조용히 끝납니다 (error.md #22).
--
--   그래서 이 파일은 DDL 만 합니다. 스캔은 파일을 적용한 뒤 따로 실행하세요.
--
--     방법 1 (권장)  /alerts 화면의 관리자 [지금 스캔] 버튼
--     방법 2         sql/25-python-models.sql 을 적용한 뒤, SQL Editor 에서
--                    아래 한 줄만 따로 실행 (sql/25 가 is_admin() 을 확장해
--                    JWT 없는 postgres 접속도 관리자로 인정합니다)
--
--       select * from core.scan_alerts();

-- 요약 (스캔 전에는 0 건입니다)
select * from analytics.v_alert_kpi;

-- 우선순위 순 미해결 알림
select alert_id, type, type_label, severity, item_id, supplier_id,
       round(priority_score, 1) as priority_score, reason
  from analytics.v_alert
 order by priority_score desc nulls last
 limit 30;

-- 유형별 건수 (12종 중 무엇이 잡혔는지)
select type, core.alert_type_label(type) as type_label, count(*) as n
  from core.alert
 where resolved_at is null
 group by 1, 2
 order by n desc;

-- 같은 알림이 스캔마다 늘어나지 않는지 — 두 번 연속 실행하면
-- 두 번째는 n_new = 0 이고 n_updated 가 첫 번째의 n_new 와 같아야 합니다.
--   select * from core.scan_alerts();
--   select * from core.scan_alerts();

-- 미해결 fingerprint 가 유일한지 (0행이어야 정상입니다)
select fingerprint, count(*) as n
  from core.alert
 where resolved_at is null
 group by fingerprint
having count(*) > 1;

-- ★★ 권한 게이트가 정말로 닫혀 있는지 (수정 라운드 1 · Critical)
--
--   app.cron_secret 을 심지 않은 상태에서 아무 문자열이나 넘겨 보세요.
--   반드시 '알림 스캔 권한이 없습니다' 로 **터져야** 합니다.
--   결과가 나오면 게이트가 열린 것입니다.
--
--     select * from core.scan_alerts('아무거나');        -- 관리자 아닌 세션에서
--
--   관리자 세션에서는 is_admin() 으로 통과하므로 이 시험이 되지 않습니다.
--   PostgREST 로 확인하는 편이 확실합니다 (publishable key 만, 로그인 쿠키 없이).
--
--     curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/scan_alerts" \
--       -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
--       -d '{"p_secret":"아무거나"}'
--     → {"code":"P0001","message":"알림 스캔 권한이 없습니다"} 여야 정상입니다.

-- 해결된 알림 이력 (화면 하단 패널이 읽는 뷰)
select alert_id, type, type_label, severity, item_id, detected_at, resolved_at
  from analytics.v_alert_resolved
 limit 20;

-- EXCESS_INVENTORY 가 어느 갈래로 판정했는지 (수정 라운드 1 · Important)
--   SURPLUS_QTY  전개 내내 여유 → 잉여 수량으로 판정
--   MONTHS_OF_SUPPLY  전개 안에서 소진 → 소진 개월 수로 판정
-- 건강한 품목이 통째로 잡히고 있지 않은지 여기서 봅니다.
select a.metrics ->> 'basis' as basis, count(*) as n
  from core.alert a
 where a.type = 'EXCESS_INVENTORY'
   and a.resolved_at is null
 group by 1;
