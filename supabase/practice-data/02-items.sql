-- 실습 데이터 2 · 품목 마스터 — 실데이터에서 고른 진짜 품목코드 11개
--
-- ★ 품목코드를 지어내지 않습니다. raw.dim_item(실데이터 93,868행)에서 **조회해서** 씁니다.
--   지어낸 코드를 쓰면 (1) 나중에 실데이터와 조인이 깨지고, (2) 실습 행인지 실데이터 행인지
--   구분할 근거가 코드 자체에 남지 않습니다.
-- ★ raw.dim_item은 읽기만 합니다. 한 줄도 바꾸지 않습니다("품목 통합 마스터. 실데이터 원본. 수정 금지").
-- ★ 적재는 STEP 4 경로를 그대로 씁니다(core.upload_batch → import_staging → commit_import_batch).
--   그래야 batch_id가 남아 제거할 때 실습 행만 정확히 지울 수 있습니다.
--
-- ★ 품목구분(용지 · 카드리더기 · 소모품)은 실습용으로 **부여한** 값입니다. dim_item의 실제 분류가
--   stage1의 조회 범위(core.item_visibility_rule)와 매핑되지 않아, 마케팅부 · 서비스부 화면에도
--   무언가 보이도록 나눠 넣습니다. 실제 품목 속성이 아니며 등기부에 실습으로 표시됩니다.
--
-- 고르는 기준 — item_code 오름차순으로, 이미 raw.item_master에 있는 코드(5회차 더미 23행 등)와
-- 겹치지 않는 것 11개. 겹치면 core.v_item_master가 DISTINCT ON으로 하나만 남겨 실습 행이 조용히
-- 가려집니다.
--
-- 11개의 역할
--   seq 1~10  전체 흐름(사용 이력 · 정책 · 재고 · 발주계획)을 타는 품목
--   seq 11    재고 분류 불가 사유 코드를 화면에 남기기 위한 품목 — 사용 이력도 정책도 없습니다

\set ON_ERROR_STOP on

do $$
declare
  v_admin uuid;
  v_label text := 'PRACTICE-2026-09';
  v_batch uuid := gen_random_uuid();
  v_rows integer;
  v_item record;
begin
  select user_id into v_admin from core.app_user
   where email = 'insightdany@naver.com' and active and role = 'ADMIN';
  if v_admin is null then
    raise exception '실습 관리자 계정을 찾을 수 없습니다. 00-open-dataset.sql을 먼저 실행하세요.';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, false);

  if not exists (select 1 from core.practice_dataset where label = v_label and active) then
    raise exception '열려 있는 실습 묶음(%)이 없습니다.', v_label;
  end if;

  -- 이미 한 번 돌렸으면 그대로 둡니다(재실행 안전).
  if exists (select 1 from core.practice_object where object_kind = 'ITEM') then
    raise notice '실습 품목이 이미 등기되어 있습니다 — 건너뜁니다';
    return;
  end if;

  -- ── 1. 실데이터에서 품목 11개를 고른다 ───────────────────────────
  create temporary table practice_pick on commit drop as
  with candidate as (
    select d.item_code,
           upper(regexp_replace(d.item_code, '[\s\-_]', '', 'g')) as item_id,
           coalesce(nullif(btrim(d.description), ''), d.item_code) as item_name
      from raw.dim_item d
     where d.item_code is not null
       and btrim(d.item_code) <> ''
  )
  select c.item_code, c.item_id, c.item_name,
         row_number() over (order by c.item_code) as seq,
         -- ★ fix round 1 (I4) — 실습용으로 **부여한** 품목구분입니다. dim_item의 실제 분류가
         --   core.item_visibility_rule(용지 · 카드리더기 · 소모품)과 매핑되지 않아, 마케팅부 ·
         --   서비스부 화면에도 무언가 보이도록 나눠 넣습니다. 실제 품목 속성이 아니므로 아래에서
         --   등기부 note에 함께 적어 /admin/practice-data 화면에 그대로 드러나게 합니다.
         case when row_number() over (order by c.item_code) <= 2 then '용지'
              when row_number() over (order by c.item_code) <= 4 then '카드리더기'
              else '소모품' end as assigned_item_type
    from candidate c
   where not exists (
     select 1 from raw.item_master im
      where upper(regexp_replace(im."품목코드", '[\s\-_]', '', 'g')) = c.item_id
   )
     and not exists (select 1 from core.practice_object o where o.object_kind = 'ITEM' and o.object_key = c.item_id)
   order by c.item_code
   limit 11;

  select count(*) into v_rows from practice_pick;
  if v_rows < 11 then
    raise exception 'raw.dim_item에서 쓸 수 있는 품목이 %개뿐입니다(11개 필요). 실데이터가 적재되어 있는지 확인하세요.', v_rows;
  end if;

  -- ── 2. STEP 4 적재 경로로 품목 마스터에 넣는다 ───────────────────
  insert into core.upload_batch (batch_id, file_name, import_type, import_mode, total_rows, success_rows,
                                 warning_rows, error_rows, status, uploaded_by, uploaded_at)
  values (v_batch, '[실습용 ' || v_label || '] practice-item-master.csv', 'item_master', 'append',
          11, 11, 0, 0, 'VALIDATED', v_admin, now());

  insert into core.import_staging (batch_id, row_number, original_data, mapped_data, validation_status)
  select v_batch, p.seq::integer + 1,
         jsonb_build_object('item_code', p.item_code),
         jsonb_build_object(
           'item_id',   p.item_id,
           'item_name', p.item_name,
           -- 실습용으로 부여한 조회 범위 분류(위 머리말 · practice_pick 주석 참고)
           'item_type', p.assigned_item_type,
           'unit', 'EA',
           -- 품목 → 공급처 매핑. Task 10b가 core.v_item_master.supplier_id로 발주 일정을 만든다.
           'supplier_id', case (p.seq - 1) % 5
                            when 0 then 'PRC-SUP-JP' when 1 then 'PRC-SUP-CN'
                            when 2 then 'PRC-SUP-VN' when 3 then 'PRC-SUP-SG'
                            else 'PRC-SUP-NL' end,
           'source_record_id', 'PRACTICE-ITEM-' || lpad(p.seq::text, 2, '0')
         ),
         'SUCCESS'
    from practice_pick p;

  perform core.commit_import_batch(v_batch);
  perform core.register_practice_object(v_label, 'UPLOAD_BATCH', v_batch::text, '품목 마스터 적재');

  -- ── 3. 등기 — seq와 "부여한 품목구분"을 note에 남긴다 ────────────
  -- ★ note는 `seq:<번호>`로 시작합니다. 뒤 스크립트는 substring(note from 'seq:([0-9]+)')로 읽으므로
  --   뒤에 설명을 덧붙여도 안전합니다(split_part로 자르던 이전 판은 설명을 붙이면 깨졌습니다).
  -- ★ 부여한 품목구분을 여기 적어 /admin/practice-data 화면에서 "이 분류는 실습용으로 붙인 값"임이
  --   SQL 주석이 아니라 화면에 드러나게 합니다(fix round 1 · I4).
  for v_item in select item_id, seq, assigned_item_type from practice_pick order by seq loop
    perform core.register_practice_object(
      v_label, 'ITEM', v_item.item_id,
      'seq:' || v_item.seq
        || ' · 품목구분 ' || v_item.assigned_item_type || '(실습용으로 부여, dim_item의 실제 분류 아님)'
        || case when v_item.seq = 11 then ' · 재고 분류 불가 시연 전용(사용 이력 · 정책 없음)' else '' end
    );
  end loop;

  raise notice '실습 품목 11개 적재 완료(batch %) — seq 11은 재고 분류 불가 시연용', v_batch;
end $$;

-- 확인
select o.object_key as item_id, o.note, im.item_name, im.item_type, im.supplier_id
  from core.practice_object o
  join core.v_item_master im on im.item_id = o.object_key
 where o.object_kind = 'ITEM'
 order by substring(o.note from 'seq:([0-9]+)')::int;
-- 기대: 11행. supplier_id가 PRC-SUP-* 5곳에 고르게 배분되어 있어야 합니다.

select count(*) as dim_item_unchanged from raw.dim_item;
-- 기대: 93,868 (실데이터는 건드리지 않습니다)
