-- 출처 게이트 · core.v_item_master가 출처 없는 5회차 더미 품목을 실데이터처럼 보여주던 것을 막습니다
--
-- ★ 증상 — 재고 화면 기준 뷰 core.v_item_master가 raw.item_master 34행을 그대로 담는데, 그중
--   23행(배포 DB 측정: 11행만 batch_id가 있고 23행은 없음)이 출처 없는 5회차 더미입니다.
--   DISTINCT ON(item_id) 중복 제거 뒤 32품목이 남고, team-lead가 배포 DB에서 직접 확인한 값:
--     - 32품목 중 11품목만 raw.dim_item(93,868행, 진짜 품목마스터)에도 있고, 정확히
--       analytics.v_practice_item에 등록된 11품목과 일치합니다(실습 배너가 이 11품목은
--       이미 표시합니다).
--     - 나머지 21품목은 raw.dim_item에도 없고 실습 등록도 안 돼 있습니다 — 아무 표식도 없이
--       진짜 품목 옆에 나란히 섞여 있었습니다.
--     - core.stock_balance는 10품목뿐이고 전부 실품목입니다 — 21개 더미 품목은
--       normal_warehouse_qty · available_qty가 이미 null, reason_code가
--       INVENTORY_SCOPE_UNCLASSIFIED로 나오고 있었습니다(숫자를 보여준 적은 없지만, 품목
--       자체가 "실재하는 미분류 품목"처럼 목록에 남아 있었습니다).
--     - core.item_id 열을 가진 core 표 19개 전수 조사: 이 21품목을 참조하는 업무 행이
--       0건입니다(주문 · 배정 · 승인 · 정책 · 계획 어디에도 없습니다) — 게이트를 걸어도
--       고아 행이 생기지 않습니다.
--
-- ★ 원인 — raw.item_master는 core.commit_import_batch를 거치는 정식 업로드 경로가 있는
--   import 대상 표입니다(core.import_target_table('item_master') → 'raw.item_master').
--   정식 경로로 들어온 행은 batch_id가 채워지고, 4~5회차 수업에서 SQL Editor로 직접 넣은
--   더미 행은 batch_id가 없습니다. core.v_item_master는 이 구분을 전혀 쓰지 않고 raw.item_master
--   전체를 DISTINCT ON으로만 추려 보여줬습니다 — core.v_open_po_qty · core.v_inbound_qty ·
--   core.v_stock_on_hand(20260912000800)가 이미 같은 종류의 결함을 "출처 게이트"로 고쳤는데,
--   품목 마스터 자체는 그 게이트가 없었습니다.
--
-- ★★ batch_id는 "가져오기 경로가 있는 표"에서만 의미가 있는 판정입니다 — raw.dim_item ·
--   raw.fact_shipment · bridge_* 같은 진짜 실데이터 표는애초에 4~5회차 강의 SQL로 적재돼
--   batch_id 열 자체가 없습니다(memory: "실데이터에 재고·리드타임이 없다" 참고 — 이 표들은
--   가져오기 경로를 거치지 않고 강의 SQL로 직접 채워졌습니다). **이 게이트를 raw.item_master
--   같은 "가져오기 경로가 있는" 표 밖으로 넓히면 안 됩니다** — 나중에 누군가 이 주석만
--   보고 "출처가 없으면 다 더미다"로 일반화해 실데이터 표에 batch_id 열을 요구하면, 그 표들이
--   전부 통째로 사라집니다.
--
-- ★ 해결 — core.v_item_master를 raw.item_master.batch_id is not null인 행만으로 다시
--   정의합니다. DISTINCT ON(item_id) 중복 제거와 pref 정렬(정규화 안 된 원본 코드보다 이미
--   정규화된 코드를 우선)은 그대로 둡니다. **열은 하나도 더하거나 빼지 않습니다**(item_id ·
--   item_name · item_type · supplier_id · unit · is_active, 순서도 동일) — docs/
--   stage1-판정기록.md Task 16 판정과 같은 이유로, 열을 넓히면 "전체를 파일명 순서로 다시
--   적용"하는 표준 복구 절차가 cannot drop columns from view로 멈춥니다.
--
-- ★ raw.item_master 행은 지우지 않습니다 — 사용자가 요청한 것은 "더미 표시 + 계속 수정
--   가능"이지 삭제가 아닙니다(memory: "실데이터에 재고·리드타임이 없다" — 더미 화면·Tool을
--   만들면 지어낸 숫자가 실데이터처럼 보인다는 같은 문제의식). 이 마이그레이션은 raw를 전혀
--   건드리지 않고 core.v_item_master의 정의만 바꿉니다 — 21개 행은 core.commit_import_batch로
--   같은 품목코드를 다시 정식 재적재하면(batch_id가 채워짐) 언제든 다시 보일 수 있습니다.
--   ★★ 리뷰 fix round 1 정정(2026-09-12) — 1차 초안은 "core.register_practice_object 실습
--   등록으로도 다시 보인다"고 적었는데 **스크래치 DB로 직접 측정해 반증됐습니다**(등록 전후
--   모두 core.v_item_master에서 0건). core.register_practice_object(20260912000400:174-220)는
--   core.practice_object에만 INSERT할 뿐 raw.item_master.batch_id를 전혀 건드리지 않습니다 —
--   유효한 복구 경로는 core.commit_import_batch 하나뿐입니다. (같은 측정으로 core.commit_import_batch
--   경로는 실제로 가시성을 되돌리는 것을 확인했습니다 — before 0 · 실습 등록 후 0 ·
--   commit_import_batch 뒤 1.)
--
-- ★ 사유는 새 열이 아니라 새 객체로 안내합니다 — core.v_open_po_qty · core.v_inbound_qty가
--   이미 쓴 패턴(20260912000800 §4-2, analytics.v_stock_reference_source_status +
--   StockReferenceStatusBanner)을 그대로 따르되, **같은 뷰에 열을 더하지 않습니다**(위 규칙이
--   core.v_item_master뿐 아니라 이미 있는 analytics 뷰 전체에 적용됩니다 — 열을 더하면 같은
--   cannot-drop-columns 위험이 v_stock_reference_source_status에도 생깁니다). 대신 **새 뷰**
--   core.v_item_master_source_status · analytics.v_item_master_source_status를 둡니다 — 대상
--   자체가 다릅니다(참고 열 두 개의 값 상태가 아니라, 화면에 보이는 "품목이 몇 개인가"라는
--   문제이므로 같은 뷰에 합치면 서로 다른 두 사유코드 체계가 한 행에 섞여 오히려 읽기
--   어려워집니다).
--
-- ★ 소비자 27개(뷰 13 + 함수 14) 점검 — core.v_item_master를 참조하는 모든 core/analytics
--   객체를 저장소 전체에서 grep으로 확인했습니다(rg -n 'v_item_master' supabase/migrations
--   supabase/realdata).
--   - analytics.v_allocation_queue · v_available_stock · v_demand_submission_line ·
--     v_forecast_result · v_inventory_performance · v_item_policy_revision ·
--     v_my_sales_order · v_order_available_stock · v_sku_demand_profile · v_stockout_risk ·
--     v_urgent_order · v_usage_profile · core.v_approved_demand_source — 전부 item_id로
--     core.v_item_master를 LEFT JOIN하거나 core.v_item_master에서 직접 SELECT합니다. LEFT
--     JOIN인 경우 21개 더미 품목이 그냥 결과에서 빠질 뿐 다른 행이 깨지지 않습니다(그 21개를
--     참조하는 업무 행이 0건이므로 LEFT JOIN 쪽에서도 잃을 게 없습니다). core.v_item_master를
--     직접 SELECT하는 뷰(v_sku_demand_profile 등)는 대상 품목 수가 32 → 11로 줄어드는 것이
--     바로 이 마이그레이션의 목적입니다(더미 품목의 가짜 수요 프로파일 · 예측을 만들지 않는다).
--   - core.build_procurement_plan · run_baseline_forecast — core.v_item_master를 순회하며
--     계획 · 예측을 만듭니다. 21개 더미 품목은 core.stock_balance에도 없어 지금까지도
--     의미 있는 값을 만들지 못했습니다(정상재고 null). 게이트 뒤에는 애초에 순회 대상에서
--     빠지므로 결과가 오히려 더 정직해집니다 — 이전에 만들어졌을 조용한 null/0 계획 행이
--     이제 생성 자체가 안 됩니다.
--   - core.insert_sales_order · create_urgent_order — `not exists (select 1 from
--     core.v_item_master ... where item_id = ...)`로 존재 검증만 합니다. 21개 더미 품목은
--     참조하는 업무 행이 0건이므로 지금 이 검증을 통과해 주문을 만든 사례가 없습니다. 게이트
--     뒤에는 이 21개 품목으로 새 주문을 시도하면 ORDER_ITEM_UNKNOWN으로 거절됩니다 — 이는
--     회귀가 아니라 "출처 없는 품목은 주문 대상이 아니다"라는 올바른 방향의 강화입니다.
--   - core.register_practice_object — core.practice_object에만 INSERT합니다(raw.item_master ·
--     core.v_item_master 둘 다 거치지 않음). 게이트 영향 없음.
--   - core.remove_practice_dataset — ★★ 리뷰 fix round 1에서 blocking으로 잡힌 지점입니다.
--     20260912000600의 legacy-retire 검사(object_kind='ITEM'일 때 "원본이 아직 있는지" 판정)가
--     원래 core.v_item_master(화면 가시성, 이 게이트가 걸린 뷰)를 썼습니다. 1차 초안은 "이
--     검사가 다루는 품목은 실습 등록된 품목뿐이고 항상 batch_id가 있어 영향이 없다"고
--     단정했는데, 이건 **측정된 우연이지 register_practice_object가 강제하는 불변식이
--     아닙니다**(바로 위에서 확인했듯 그 함수는 raw.item_master.batch_id를 전혀 건드리지
--     않습니다) — 출처 없는 품목을 ITEM으로 등록하면 게이트 뒤 core.v_item_master에서 사라져
--     이 검사가 "원본이 없어졌다"고 오판, remove_practice_dataset이 실습 표식을 조용히
--     지웁니다(리뷰어 실측: would_be_deleted = t). 20260912000600의 해당 DELETE 술어를
--     raw.item_master 직접 조회로 바꿔 고쳤습니다(등기부는 "화면에 보이는가"가 아니라
--     "원본 행이 아직 있는가"를 물어야 합니다) — 그 파일의 fix round 1 주석 참고.
--   - 결론: **BLOCKED 사유는 없지만, remove_practice_dataset 하나는 게이트가 새로 만든
--     잠재 결함이었고 이번에 고쳤습니다.** 나머지 26개 소비자는 게이트가 필요로 하는 21개
--     더미 품목에 의존하지 않습니다.
--
-- ★★ 두 계층 정본 동기화 — core.v_item_master의 정본은 supabase/realdata/03b-missing-objects.sql
--   입니다(그 파일이 만들고, 저장소 마이그레이션에는 이 파일 전까지 없었습니다). 적용 순서
--   (realdata → migrations)상 이 마이그레이션의 create or replace가 나중에 이겨 배포 DB는
--   항상 이 정의를 씁니다. 하지만 저장소만으로 새 환경을 재구성할 때 03b가 적용되는 동안
--   (이 마이그레이션 적용 전)은 03b의 정의가 그대로 유효하므로, **03b 쪽 정의도 같은 게이트를
--   가져야 합니다** — 20260912000800이 core.v_fact_shipment · core.v_inbound_qty ·
--   core.v_stock_on_hand에 적용한 것과 같은 원칙입니다. 03b도 이번에 함께 고쳤습니다(§4-1 ·
--   §4-3 머리 주석과 같은 교차 참조를 남겼습니다) — **이 뷰를 다시 고칠 때는 두 파일을 항상
--   함께 고칩니다.**
-- ★ 03b는 CASCADE 정리 블록이 의도적으로 없습니다(03b 머리말 §참고 — DROP VIEW ... CASCADE가
--   core.v_item_master 위에 쌓인 13개 뷰까지 지울 수 있어 42P16보다 훨씬 나쁩니다). 여기서도
--   같은 원칙을 따라 DROP을 추가하지 않고, 03b·이 파일 두 정의의 열 구성을 항상 맞춰서
--   create or replace가 충돌 없이 재적용되게 합니다.
--
-- 다시 실행해도 안전합니다. raw 데이터를 바꾸지 않습니다.


-- ══ 1. core.v_item_master — 출처 게이트 ═══════════════════════════════
--
-- ★ 정본은 supabase/realdata/03b-missing-objects.sql(그 파일을 고칠 때 이 정의도 함께
--   고친다). raw.item_master.batch_id가 없는(출처 없는) 행은 DISTINCT ON 이전에 걸러냅니다
--   — 20260911000500 원본과 열 이름 · 순서 · DISTINCT ON · pref 정렬 규칙은 완전히 동일하고,
--   FROM 절 서브쿼리에 WHERE batch_id is not null 한 줄만 더했습니다.
create or replace view core.v_item_master as
select distinct on (item_id) item_id,
    item_name,
    item_type,
    supplier_id,
    unit,
    is_active
   from ( select upper(regexp_replace(item_master."품목코드", '[\s\-_]', '', 'g')) as item_id,
            item_master."품목명" as item_name,
            item_master."품목구분" as item_type,
            item_master.supplier_id,
            item_master."단위" as unit,
            item_master."사용여부" as is_active,
                case
                    when (item_master."품목코드" = upper(regexp_replace(item_master."품목코드", '[\s\-_]', '', 'g'))) then 0
                    else 1
                end as pref
           from raw.item_master
          where item_master.batch_id is not null) t
  order by item_id, pref;

comment on view core.v_item_master is
  '보정(2026-09-12) — 출처 없는(batch_id is null) raw.item_master 행을 제외한다. 배포 DB 측정:
  34행 중 23행이 4~5회차 더미(batch_id null)였고, DISTINCT ON 중복 제거 뒤 32품목 중 21품목이
  raw.dim_item에도 analytics.v_practice_item에도 없는 무표식 더미였다(11품목은 실습 배너가 이미
  덮는다). 이 21개를 참조하는 core 업무 행은 0건(19개 item_id 표 전수조사) — 게이트를 걸어도
  고아 행이 생기지 않는다. 열 이름 · 순서 · DISTINCT ON(item_id) · pref 정렬은 20260911000500
  원본과 동일 — 열을 더하지 않는다(docs/stage1-판정기록.md Task 16과 같은 원칙). 사유 안내는
  analytics.v_item_master_source_status + ItemMasterStatusBanner가 화면 수준에서 한다(아래 §2).
  raw.item_master 행 자체는 지우지 않는다 — 같은 품목코드를 core.commit_import_batch로 다시
  정식 재적재하면(batch_id가 채워짐) 언제든 다시 보일 수 있다. register_practice_object 실습
  등록은 가시성을 되돌리지 않는다(실측 반증, 리뷰 fix round 1) — core.practice_object에만
  INSERT할 뿐 raw.item_master.batch_id를 건드리지 않는다';


-- ══ 2. 품목 마스터 출처 상태 안내 — 별도 객체(열이 아니라 새 뷰) ═════════════
--
-- ★ core.v_stock_reference_source_status(20260912000800)와 합치지 않고 새 뷰로 둔다 — 그 뷰는
--   Open PO · 이동 중 "참고 열 값"의 출처 상태이고, 이 뷰는 "품목이 화면에 보이는가" 자체의
--   출처 상태다. 대상(값 vs 품목 존재)과 사유코드 체계가 서로 달라 한 뷰에 합치면 오히려
--   읽기 어렵다. 같은 이유로 기존 뷰에 열을 추가하는 것도 하지 않는다(위 규칙이 이미 있는
--   analytics 뷰 전체에 적용된다 — 열을 더하면 그 뷰도 cannot-drop-columns 위험을 갖게 된다).
-- ★★ 리뷰 fix round 1(2026-09-12) — 1차 초안은 raw.item_master **행** 수를 셌는데(34행 ·
--   23행), 배너 문구가 그 숫자를 화면 **목록**(core.v_item_master, DISTINCT ON(item_id) 뒤
--   품목 단위)에서 빠진 개수처럼 말해서 단위가 어긋났다(리뷰어 지적: 23행 ≠ 21품목 — 34행이
--   32품목으로 접히듯 23행도 21품목으로 접힌다, 2행이 기존 품목코드의 중복 표기이기 때문).
--   목록의 단위(품목)에 맞춰 정규화된 품목코드 기준으로 다시 센다 — 열은 3개로 그대로
--   유지한다(이름만 …_rows → …_items로 바꿨다, 열 수 불변이라 migration_rerun 사후조건
--   영향 없음). "출처 있는 품목" = core.v_item_master에 실제로 나타나는 품목(정규화된 코드
--   기준으로 batch_id 있는 행이 하나라도 있음)과 정확히 같은 정의다.
create or replace view core.v_item_master_source_status as
with items as (
  select
    upper(regexp_replace(m."품목코드", '[\s\-_]', '', 'g')) as item_id,
    bool_or(m.batch_id is not null) as has_sourced_row
  from raw.item_master m
  group by upper(regexp_replace(m."품목코드", '[\s\-_]', '', 'g'))
)
select
  count(*) filter (where has_sourced_row) as item_master_sourced_items,
  count(*) filter (where not has_sourced_row) as item_master_unsourced_items,
  case when count(*) filter (where not has_sourced_row) > 0
       then 'ITEM_MASTER_SOURCE_UNVERIFIED'
  end as item_master_reason_code
from items;

comment on view core.v_item_master_source_status is
  '보정(2026-09-12, 리뷰 fix round 1) — core.v_item_master가 출처 없는 raw.item_master 행을
  걸러내는 지금, 화면 목록(품목 단위)에서 몇 품목이 걸러졌는지 한 줄로 요약한다. 정규화된
  품목코드(core.normalize_item_id와 같은 규칙)로 묶어 "출처 있는 행이 하나라도 있는 품목"과
  "전부 출처 없는 품목"을 센다 — core.v_item_master에 실제로 나타나는지와 정확히 같은 기준
  이다(행 수가 아니라 품목 수 — raw.item_master 행 수를 그대로 세면 DISTINCT ON 중복 제거로
  화면 목록과 단위가 어긋난다). item_master_reason_code: ITEM_MASTER_SOURCE_UNVERIFIED(출처
  없는 품목이 1개라도 있음) | null(전부 출처 있음). 소유자 권한으로 raw를 직접 읽는다 —
  analytics.v_item_master_source_status가 권한 필터를 얹어 감싼다(core.v_stock_reference_source_status
  와 같은 배선, 20260912000800 §4-2)';

grant select on core.v_item_master_source_status to authenticated;
revoke all on core.v_item_master_source_status from anon, public;

create or replace view analytics.v_item_master_source_status
with (security_invoker = true)
as
select s.*
  from core.v_item_master_source_status s
 where core.has_permission('STOCK_VIEW_ALL')
    or core.has_permission('STOCK_VIEW_PAPER')
    or core.has_permission('STOCK_VIEW_SUPPLY');

comment on view analytics.v_item_master_source_status is
  '보정(2026-09-12) — 재고 화면 배너 전용 요약. core.v_item_master_source_status를 재고 상세 권한
  (STOCK_VIEW_ALL·STOCK_VIEW_PAPER·STOCK_VIEW_SUPPLY)으로만 연다. 권한이 없으면 0행 —
  ItemMasterStatusBanner는 이 뷰가 0행이면 아무것도 표시하지 않는다. security_invoker로
  호출자 RLS를 그대로 적용한다';

grant select on analytics.v_item_master_source_status to authenticated;
revoke all on analytics.v_item_master_source_status from anon, public;


-- ══ 3. 수동 적용 후 확인 쿼리 ══════════════════════════════════════════
--
-- (a) 컬럼 프루닝을 이기는 형태(select *)로 게이트가 실제로 걸리는지 확인한다 — count(*)만
-- 세면 플래너가 서브쿼리 필터를 가지치기할 수 있다(docs/stage1-판정기록.md Task 16 판정).
-- select count(*) from (select * from core.v_item_master) t;
-- 기대(배포 DB): 11

-- (b) 21개 더미 품목이 정확히 사라졌는지(raw.dim_item · analytics.v_practice_item 둘 다 없는 품목).
-- select count(*) from core.v_item_master im
--  where not exists (select 1 from raw.dim_item d where upper(regexp_replace(d."품목코드", '[\s\-_]', '', 'g')) = im.item_id);
-- 기대: 0 (게이트 뒤에는 실습 등록 품목 = raw.dim_item 존재 품목과 완전히 겹친다)

-- (c) 상태 뷰(품목 단위 — 리뷰 fix round 1로 행 단위에서 바꿨다).
-- select * from analytics.v_item_master_source_status;
-- 기대(배포 DB): item_master_sourced_items = 11 · item_master_unsourced_items = 21 ·
--       item_master_reason_code = 'ITEM_MASTER_SOURCE_UNVERIFIED'

-- (d) stock_balance 10품목이 전부 살아남는지.
-- select count(*) from core.stock_balance sb
--  where exists (select 1 from core.v_item_master im where im.item_id = sb.item_id);
-- 기대: 10 (stock_balance 10행 전부 실품목)
