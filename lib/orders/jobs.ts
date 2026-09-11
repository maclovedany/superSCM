// Task 6 · core.expire_temporary_allocations RPC 결과를 앱에서 쓰기 좋은 모양으로 옮긴다.
// 계산은 하지 않는다 — DB 함수가 만료 판정·해제·알림까지 전부 끝낸 뒤 결과 행만 돌려준다.
export { isAuthorizedCronRequest } from '../notifications/cron.ts';

export type ExpiryJobOutcome = 'EXPIRED' | 'RELEASED' | 'FAILED';

export type ExpiryJobRow = {
  orderId: string;
  orderNo: string;
  outcome: ExpiryJobOutcome;
  releasedQty: number;
  errorMessage: string | null;
};

const EXPIRY_JOB_OUTCOMES: readonly ExpiryJobOutcome[] = ['EXPIRED', 'RELEASED', 'FAILED'];

function asOutcome(value: unknown): ExpiryJobOutcome {
  return typeof value === 'string' && (EXPIRY_JOB_OUTCOMES as readonly string[]).includes(value)
    ? (value as ExpiryJobOutcome)
    : 'FAILED';
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// core.expire_temporary_allocations가 돌려주는 한 행(주문 1건 처리 결과)을 정규화한다.
export function normalizeExpiryJobRow(raw: Record<string, unknown>): ExpiryJobRow {
  return {
    orderId: String(raw.order_id ?? ''),
    orderNo: String(raw.order_no ?? ''),
    outcome: asOutcome(raw.outcome),
    releasedQty: asNumber(raw.released_qty),
    errorMessage: raw.error_message == null ? null : String(raw.error_message),
  };
}

export type ExpiryJobSummary = {
  processed: number;
  expired: number;
  released: number;
  failed: number;
  failedOrders: { orderId: string; orderNo: string; errorMessage: string }[];
};

// 실패 건(outcome=FAILED)이 있어도 나머지 주문의 성공 처리는 그대로 보고한다 — 한 주문의
// 실패가 다른 주문의 결과를 가리지 않는다(컨트롤러 판정 3).
export function summarizeExpiryJobRows(rows: ExpiryJobRow[]): ExpiryJobSummary {
  const summary: ExpiryJobSummary = { processed: rows.length, expired: 0, released: 0, failed: 0, failedOrders: [] };
  for (const row of rows) {
    if (row.outcome === 'EXPIRED') summary.expired += 1;
    else if (row.outcome === 'RELEASED') summary.released += 1;
    else {
      summary.failed += 1;
      summary.failedOrders.push({
        orderId: row.orderId,
        orderNo: row.orderNo,
        errorMessage: row.errorMessage ?? '알 수 없는 오류',
      });
    }
  }
  return summary;
}
