// GET /api/v1/atp 의 계산 연결 — renew.prd 9.2 · 27장
//
// ATP(납기 가능 수량)와 수주 가능 판정은 STEP 17 의 `lib/atp.ts` 가 합니다.
// STEP 19 는 그 계산을 만들지 않습니다 — 만들면 두 벌이 되고, 영업 화면과 API 가
// 다른 숫자를 말하게 됩니다 (renew.prd 32).
//
// 이 파일은 쿼리 파라미터를 읽고, 조회하고, 응답 모양으로 옮기기만 합니다.
// STEP 17 의 SQL(sql/23-atp-sales.sql)이 아직 적용되지 않았으면 조회가 오류를 돌려주므로
// 501 로 바꿔 알려줍니다 — 500 으로 두면 연동 쪽이 "우리 잘못인가" 를 알 수 없습니다.
//
// ★ lib/atp.ts 의 getAtp · checkOrderFeasibility 를 부르지 않고 같은 뷰·RPC 를 직접 읽습니다.
//   그 두 함수는 세션 쿠키 클라이언트를 **내부에서** 만들기 때문에 secret 키를 넘길 수 없고,
//   lib/atp.ts 는 STEP 17 이 작업 중이라 손대지 않기로 되어 있습니다.
//
//   ★ 계산도 정규화도 베끼지 않았습니다. 숫자를 만드는 것은 sql/23 의 뷰와 함수이고,
//     컬럼 → 필드 변환은 lib/atp-model.ts 의 normalizeAtp · normalizeFeasibility 를
//     **그대로 가져다 씁니다** — 영업 화면이 쓰는 바로 그 함수입니다.
//     여기서 다른 것은 조회에 쓰는 클라이언트뿐입니다 (renew.prd 32).
//     lib/atp.ts 의 조회 조건(뷰 이름 · 정렬 · limit · item_id 정규화)과 같아야 하며,
//     `lib/api/atp-parity.test.ts` 가 두 파일을 대조합니다.

import { normalizeAtp, normalizeFeasibility } from '../atp-model';
import { apiError } from './auth-model.ts';
import { serviceClientOrFailure, type OutboundResult } from './outbound';

export type AtpQuery = { itemId: string; qty: number | null; date: string | null };

/**
 * 쿼리 파라미터 읽기.
 *
 *   item_id  필수
 *   qty      선택. 주면 수주 가능 판정을 함께 돌려줍니다 (date 도 함께 필요합니다)
 *   date     선택. YYYY-MM-DD
 *
 * 값이 없거나 형식이 다르면 400 입니다. 지어내지 않습니다.
 */
export function readAtpQuery(
  searchParams: URLSearchParams,
): { ok: true; query: AtpQuery } | { ok: false; message: string } {
  const itemId = searchParams.get('item_id');
  if (!itemId || itemId.trim() === '') {
    return { ok: false, message: 'item_id 가 필요합니다.' };
  }

  const rawQty = searchParams.get('qty');
  let qty: number | null = null;
  if (rawQty !== null && rawQty.trim() !== '') {
    const parsed = Number(rawQty);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, message: 'qty 는 0보다 큰 숫자여야 합니다.' };
    }
    qty = parsed;
  }

  const rawDate = searchParams.get('date');
  const date = rawDate !== null && rawDate.trim() !== '' ? rawDate.trim() : null;
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: 'date 는 YYYY-MM-DD 형식이어야 합니다.' };
  }

  if (qty !== null && date === null) {
    return { ok: false, message: 'qty 를 물으면 date(희망 납기일)도 함께 주세요.' };
  }

  return { ok: true, query: { itemId: itemId.trim(), qty, date } };
}

/** lib/atp.ts 의 normalizeItemId 와 같은 규칙입니다 */
function normalizeItemId(itemId: string): string {
  return itemId.replace(/[\s\-_]/g, '').toUpperCase();
}

export async function atpQuote(query: AtpQuery): Promise<OutboundResult> {
  const gate = serviceClientOrFailure();
  if (!gate.ok) return gate.result;

  const itemId = normalizeItemId(query.itemId);

  // lib/atp.ts 의 getAtp 와 같은 조회입니다 (뷰 · 정렬 · 상한).
  const { data, error } = await gate.client
    .schema('analytics')
    .from('v_atp')
    .select('*')
    .eq('item_id', itemId)
    .order('bucket_ord')
    .limit(8);

  const rows = (data ?? []).map((row) => normalizeAtp(row as Record<string, unknown>));

  if (error) {
    // ★ "아직 없다" 와 "지금 고장났다" 를 구분합니다 (재리뷰 C).
    //
    //   전부 501 로 보내면 권한 누락(sql/26 §10-2 미적용) · 일시적 실패 · 네트워크 오류가
    //   "이 기능은 없습니다" 로 읽힙니다. 연동 쪽은 재시도하지 않고 기능을 지워 버립니다.
    //   장애를 미구현으로 위장하지 않습니다 — 라운드 1 에서 고친
    //   "조회 실패가 404 로 보이던" 문제와 같은 계열입니다.
    //
    //   42P01 undefined_table = 뷰가 없다 = sql/23 미적용 → 501 이 맞습니다.
    //   그 밖(42501 permission denied 등)은 502 입니다.
    console.error('[api] v_atp 조회 실패:', error.code, error.message);

    if (error.code === '42P01') {
      return {
        status: 501,
        body: apiError(
          'NOT_IMPLEMENTED',
          'STEP 17 — ATP 조회를 아직 쓸 수 없습니다. sql/23-atp-sales.sql 적용 여부를 관리자에게 확인해주세요.',
        ),
      };
    }

    return { status: 502, body: apiError('UPSTREAM_ERROR', 'ATP 조회에 실패했습니다.') };
  }

  if (rows.length === 0) {
    return {
      status: 404,
      body: apiError('NOT_FOUND', `${query.itemId} 의 ATP 를 산출할 수 없습니다.`),
    };
  }

  // qty · date 를 함께 물었을 때만 수주 가능 판정을 답합니다 (renew.prd 27.5).
  // 읽기 전용입니다 — 여러 번 물어도 재고가 잠기지 않습니다.
  if (query.qty !== null && query.date !== null) {
    const { data: raw, error: rpcError } = await gate.client
      .schema('core')
      .rpc('check_order_feasibility', {
        p_item_id: itemId,
        p_qty: query.qty,
        p_target_date: query.date,
      });

    if (rpcError) {
      console.error('[api] check_order_feasibility 실패:', rpcError.code, rpcError.message);

      // 함수 자체가 없으면(42883 undefined_function) sql/23 미적용입니다.
      if (rpcError.code === '42883') {
        return {
          status: 501,
          body: apiError(
            'NOT_IMPLEMENTED',
            'STEP 17 — 수주 가능 판정을 아직 쓸 수 없습니다. sql/23-atp-sales.sql 적용 여부를 관리자에게 확인해주세요.',
          ),
        };
      }

      return { status: 502, body: apiError('UPSTREAM_ERROR', '수주 가능 판정에 실패했습니다.') };
    }

    // 이 함수는 jsonb 하나를 돌려줍니다 (returns table 이 아닙니다).
    const feasibility =
      raw && typeof raw === 'object'
        ? normalizeFeasibility(raw as Record<string, unknown>)
        : null;

    return {
      status: 200,
      body: { item_id: itemId, qty: query.qty, date: query.date, atp: rows, feasibility },
    };
  }

  return { status: 200, body: { item_id: itemId, atp: rows, feasibility: null } };
}
