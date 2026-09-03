// OpenAPI 문서 — renew.prd 9.2
//
// 경로 18개(Inbound 11 · Outbound 7)가 모두 있고, 모두 security 가 붙어 있는지 봅니다.
// 인증이 빠진 경로가 문서에 남으면, 그 경로가 실제로도 열려 있다고 믿게 됩니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_SCOPES } from './scopes.ts';
import {
  API_BASE,
  INBOUND_ROUTES,
  OUTBOUND_ROUTES,
  inboundRoute,
  openApiDocument,
} from './openapi.ts';

/** renew.prd 9.1 · 9.2 가 적어 둔 경로 그대로 */
const EXPECTED = [
  '/api/v1/items',
  '/api/v1/suppliers',
  '/api/v1/demand-history',
  '/api/v1/inventory',
  '/api/v1/purchase-orders',
  '/api/v1/receipts',
  '/api/v1/open-po',
  '/api/v1/events',
  '/api/v1/sales-order',
  '/api/v1/bulk/demand-history',
  '/api/v1/bulk/inventory',
  '/api/v1/forecast/{itemId}',
  '/api/v1/inventory-projection/{itemId}',
  '/api/v1/stockout-risk/{itemId}',
  '/api/v1/order-recommendation/{itemId}',
  '/api/v1/leadtime/{supplierId}',
  '/api/v1/atp',
  '/api/v1/alerts',
];

test('경로가 18개이며 renew.prd 9 의 목록과 같다', () => {
  const doc = openApiDocument();
  const paths = doc.paths as Record<string, unknown>;
  const keys = Object.keys(paths);

  assert.equal(keys.length, 18);
  assert.deepEqual(keys.slice().sort(), EXPECTED.slice().sort());
});

test('모든 경로에 security 가 있고, 그 scope 는 renew.prd 9.3 의 6종 안에 있다', () => {
  const doc = openApiDocument();
  const paths = doc.paths as Record<string, Record<string, { security?: { bearerAuth?: string[] }[] }>>;

  for (const path of Object.keys(paths)) {
    const item = paths[path];
    const method = Object.keys(item)[0];
    const operation = item[method];

    assert.ok(operation.security, `${path} 에 security 가 없습니다`);
    assert.equal(operation.security.length, 1, `${path} 의 security 는 하나여야 합니다`);

    const scopes = operation.security[0].bearerAuth;
    assert.ok(Array.isArray(scopes), `${path} 에 bearerAuth 가 없습니다`);
    assert.equal(scopes.length, 1, `${path} 는 scope 하나를 요구해야 합니다`);
    assert.ok(
      (API_SCOPES as readonly string[]).includes(scopes[0]),
      `${path} 의 scope '${scopes[0]}' 가 renew.prd 9.3 목록에 없습니다`,
    );
  }
});

test('Inbound 11개 · Outbound 7개', () => {
  assert.equal(INBOUND_ROUTES.length, 11);
  assert.equal(OUTBOUND_ROUTES.length, 7);
});

test('Inbound 의 scope 는 데이터 종류와 맞는다 (core.api_scope_for_data_type 과 같은 표)', () => {
  const expected: Record<string, string> = {
    DEMAND: 'demand:write',
    EVENT: 'demand:write',
    SALES_ORDER: 'demand:write',
    INVENTORY: 'inventory:write',
    ITEM_MASTER: 'inventory:write',
    SUPPLIER_MASTER: 'inventory:write',
    PURCHASE_ORDER: 'purchase_order:write',
    RECEIPT: 'purchase_order:write',
  };

  for (const route of INBOUND_ROUTES) {
    assert.equal(route.scope, expected[route.dataType], `${route.path} 의 scope`);
  }
});

test('bulk 경로만 본문 상한이 크다', () => {
  for (const route of INBOUND_ROUTES) {
    const isBulk = route.path.startsWith('/bulk/');
    assert.equal(route.maxBodyBytes, isBulk ? 25 * 1024 * 1024 : 4 * 1024 * 1024, route.path);
  }
});

test('inboundRoute — 표에 있는 경로만 찾아진다', () => {
  assert.equal(inboundRoute('/demand-history')?.dataType, 'DEMAND');
  assert.equal(inboundRoute('/bulk/inventory')?.dataType, 'INVENTORY');
  assert.equal(inboundRoute('/nope'), null);
  assert.equal(inboundRoute('/api/v1/items'), null, '접두어를 포함한 경로로는 찾지 않는다');
});

test('문서 머리 — OpenAPI 3.1 · bearerAuth · scope 목록', () => {
  const doc = openApiDocument();
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(API_BASE, '/api/v1');

  const components = doc.components as { securitySchemes: Record<string, { type: string; scheme: string }> };
  assert.equal(components.securitySchemes.bearerAuth.type, 'http');
  assert.equal(components.securitySchemes.bearerAuth.scheme, 'bearer');

  assert.deepEqual(doc['x-scopes'], API_SCOPES);
});

test('atp 만 501 을 문서화한다 (STEP 17 미배포)', () => {
  const doc = openApiDocument();
  const paths = doc.paths as Record<string, Record<string, { responses: Record<string, unknown> }>>;

  assert.ok(paths['/api/v1/atp'].get.responses['501']);
  assert.equal(paths['/api/v1/alerts'].get.responses['501'], undefined);
});
