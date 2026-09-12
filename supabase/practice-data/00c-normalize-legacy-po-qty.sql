-- 실습 데이터 0c · 5회차 더미 발주수량 콤마값 정규화 (되돌릴 수 있습니다)
--
-- ★ 실행 시점 — 00-open-dataset.sql · 00b-retire-legacy-usage.sql과 달리 실습 묶음 열림
--   여부와 무관합니다. 아무 때나(권장: supabase/migrations/20260912000800 적용 직후) 실행·
--   되돌리기가 가능합니다. 순서표에 없는 이유는 이후 어떤 실습 데이터 파일도 이 값을
--   전제하지 않기 때문입니다 — 04-usage-history.sql처럼 뒤 파일이 이 결과를 필요로 하지
--   않습니다.
--
-- ══ 무엇을, 왜 ═════════════════════════════════════════════════════
--
-- 배포 DB의 raw.purchase_order에는 5회차 실습 더미 한 줄(발주번호 PO20261024, 품목코드
-- ITEM007, batch_id·source_type 모두 null)이 "발주수량"에 천단위 콤마가 섞인 텍스트
-- '1,000'을 갖고 있습니다. 이 값이 core.v_open_po_qty의 numeric 캐스트를 실패시켜,
-- analytics.v_available_stock을 부르는 /inventory 화면 전체가 22P02 오류로 막혔습니다.
--
-- supabase/migrations/20260912000800_fix_open_po_qty_cast.sql이 계산 쪽(core.v_open_po_qty ·
-- core.apply_stock_receipts_from_batch)을 콤마에 관대하게 고쳤으므로, **이 스크립트를 실행하지
-- 않아도 화면은 이미 막히지 않고, ITEM007의 open_po_qty도 이미 콤마가 자동으로 제거된 실제
-- 숫자로 계산됩니다**(null이나 사유 코드가 아닙니다 — 콤마는 "정말 파싱 불가한 값"이 아니라
-- 관대한 파서가 그 자리에서 복원하는 값이기 때문입니다). 이 스크립트는 그것과 별개로, raw에
-- 남은 잘못된 텍스트 자체를 정리해 두는 선택적 데이터 위생 조치입니다 —
-- core.parse_lenient_numeric을 거치지 않는 어떤 미래 코드(BI 쿼리 등)도 같은 함정에 걸리지
-- 않도록 합니다. 정규화 전후로 open_po_qty 계산값 자체는 바뀌지 않습니다 — raw 텍스트의
-- 모양(콤마 유무)만 정리됩니다.
--
-- ══ 안전장치 ═══════════════════════════════════════════════════════
--
-- 1. **지우지 않습니다.** 원본 행 전체를 core.purchase_order_qty_normalized에 jsonb로
--    그대로 보관합니다.
-- 2. **되돌릴 수 있습니다.** core.restore_normalized_purchase_order_qty()를 부르면 보관된
--    발주수량을 원본 텍스트로 되돌리고 보관소를 비웁니다.
-- 3. **대상이 정확히 좁습니다.** 출처 없는(batch_id is null) 행 중, 지금 그대로는 순수
--    숫자 텍스트가 아니지만(콤마 등) 관대한 파서로는 값을 복원할 수 있는 발주수량만
--    바꿉니다. 이미 깨끗한 값이나 완전히 알 수 없는 값은 건드리지 않습니다.
-- 4. 정규화·복구 모두 core.audit_log에 남습니다.
--
-- ⚠️ 그래도 **실행 전에 백업을 받으세요.** 이 스크립트는 사용자가 만들지 않은 기존 데이터를
--   고칩니다.
--
-- ══ 선행 조건 ══════════════════════════════════════════════════════
--   supabase/migrations/20260912000800_fix_open_po_qty_cast.sql 적용

\set ON_ERROR_STOP on

-- ── 1. 정규화 전 현황 — 이 값을 메모해 두세요 ──────────────────────

select "발주번호", "품목코드", "발주수량"
  from raw.purchase_order
 where batch_id is null
   and "발주수량" is not null
   and btrim("발주수량") !~ '^-?[0-9]+(\.[0-9]+)?$'
   and core.parse_lenient_numeric("발주수량") is not null;
-- 기대(배포 DB): PO20261024 · ITEM007 · '1,000' 1행

select item_id, open_po_qty, reason_code from core.v_open_po_qty where item_id = 'ITEM007';
-- 기대(정규화 전): reason_code is null · open_po_qty가 이미 숫자로 계산됨(발주 1,000을 콤마 없이
-- 더한 값 − 입고완료분) — 20260912000800이 적용돼 있으면 정규화 전에도 이렇다. 정규화는 이
-- 계산값을 바꾸지 않고 raw 텍스트 모양만 정리한다(아래 3절 참고).


-- ── 2. 정규화 ───────────────────────────────────────────────────────

do $$
declare
  v_admin uuid;
  v_result jsonb;
begin
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자(ADMIN) 계정을 찾을 수 없습니다.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  v_result := core.normalize_legacy_purchase_order_qty(p_confirm => true);
  raise notice E'정규화 결과\n%', jsonb_pretty(v_result);
end $$;


-- ── 3. 정규화 후 확인 ───────────────────────────────────────────────

select "발주번호", "품목코드", "발주수량"
  from raw.purchase_order where "발주번호" = 'PO20261024' and "품목코드" = 'ITEM007';
-- 기대: '1000' (콤마 제거, 값 자체는 그대로 1000)

select item_id, open_po_qty, reason_code from core.v_open_po_qty where item_id = 'ITEM007';
-- 기대: reason_code is null · open_po_qty가 숫자로 계산됨(발주 1000 − 입고완료분)

select * from core.purchase_order_qty_normalized order by normalize_id;
-- 기대: 1행, original_qty='1,000', normalized_qty='1000'


-- ── 4. 되돌리기 ────────────────────────────────────────────────────
--
-- do $$
-- declare
--   v_admin uuid;
-- begin
--   select user_id into v_admin from core.app_user
--    where email = 'insightdany@naver.com' and active and role = 'ADMIN';
--   perform set_config('request.jwt.claim.sub', v_admin::text, false);
--   raise notice '복구된 행: %', core.restore_normalized_purchase_order_qty();
-- end $$;
--
-- select "발주수량" from raw.purchase_order where "발주번호" = 'PO20261024' and "품목코드" = 'ITEM007';
-- -- 기대: '1,000' (원본 그대로)
-- select count(*) from core.purchase_order_qty_normalized;
-- -- 기대: 0
