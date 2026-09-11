import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { normalizeExpiryJobRow, summarizeExpiryJobRows } from './jobs.ts';

test('normalizeExpiryJobRow는 DB 행을 카멜케이스로 정규화한다', () => {
  const row = normalizeExpiryJobRow({
    order_id: 'order-1',
    order_no: 'SO-1',
    outcome: 'EXPIRED',
    released_qty: 12,
    error_message: null,
  });
  assert.deepEqual(row, {
    orderId: 'order-1',
    orderNo: 'SO-1',
    outcome: 'EXPIRED',
    releasedQty: 12,
    errorMessage: null,
  });
});

test('normalizeExpiryJobRow는 예상치 못한 outcome을 FAILED로 취급한다', () => {
  const row = normalizeExpiryJobRow({ order_id: 'o', order_no: 'SO', outcome: null, released_qty: null, error_message: null });
  assert.equal(row.outcome, 'FAILED');
  assert.equal(row.releasedQty, 0);
});

test('summarizeExpiryJobRows는 결과 건수를 outcome별로 센다', () => {
  const summary = summarizeExpiryJobRows([
    { orderId: '1', orderNo: 'SO-1', outcome: 'EXPIRED', releasedQty: 10, errorMessage: null },
    { orderId: '2', orderNo: 'SO-2', outcome: 'RELEASED', releasedQty: 5, errorMessage: null },
    { orderId: '3', orderNo: 'SO-3', outcome: 'RELEASED', releasedQty: 3, errorMessage: null },
    { orderId: '4', orderNo: 'SO-4', outcome: 'FAILED', releasedQty: 0, errorMessage: '55000: 잠금 대기 시간 초과' },
  ]);
  assert.deepEqual(summary, {
    processed: 4,
    expired: 1,
    released: 2,
    failed: 1,
    failedOrders: [{ orderId: '4', orderNo: 'SO-4', errorMessage: '55000: 잠금 대기 시간 초과' }],
  });
});

test('summarizeExpiryJobRows는 빈 배열이면 0건으로 요약한다', () => {
  const summary = summarizeExpiryJobRows([]);
  assert.deepEqual(summary, { processed: 0, expired: 0, released: 0, failed: 0, failedOrders: [] });
});

test('Cron 라우트는 CRON_SECRET을 검증하고 core.expire_temporary_allocations만 호출한다', () => {
  const route = readFileSync(new URL('../../app/api/cron/allocations/route.ts', import.meta.url), 'utf8');
  assert.match(route, /isAuthorizedCronRequest/);
  assert.match(route, /expire_temporary_allocations/);
  assert.match(route, /createSupabaseAdminClient/);
  assert.match(route, /status:\s*401/);
  assert.match(route, /summary\.failed\s*>\s*0/);
  assert.match(route, /status:\s*500/);
});
