// OpenAPI 3.1 문서 — renew.prd 9.2 "OpenAPI / Swagger 문서를 제공한다"
//
// ★ 이 파일이 경로 표의 **한 곳**입니다.
//   Route Handler 가 여기서 dataType 과 scope 를 가져다 씁니다. 그래서 문서와 구현이
//   갈라질 수 없습니다 — 문서에만 있는 경로나, 문서에 없는 권한이 생기지 않습니다.
//
// 순수 데이터입니다. Supabase 를 부르지 않으므로 node --test 가 그대로 실행합니다.

import { API_SCOPES, type ApiScope } from './scopes.ts';
import type { DataType } from '../import/types.ts';

export const API_BASE = '/api/v1';

/** POST — renew.prd 9.1 */
export type InboundRoute = {
  /** /api/v1 뒤의 경로 */
  path: string;
  dataType: DataType;
  scope: ApiScope;
  summary: string;
  /** 본문 크기 상한(바이트). bulk 만 큽니다 */
  maxBodyBytes: number;
};

const MB = 1024 * 1024;
const NORMAL_BODY = 4 * MB;
const BULK_BODY = 25 * MB;

export const INBOUND_ROUTES: InboundRoute[] = [
  { path: '/items',                dataType: 'ITEM_MASTER',     scope: 'inventory:write',      summary: '품목 마스터 입력',        maxBodyBytes: NORMAL_BODY },
  { path: '/suppliers',            dataType: 'SUPPLIER_MASTER', scope: 'inventory:write',      summary: '공급처 마스터 입력',      maxBodyBytes: NORMAL_BODY },
  { path: '/demand-history',       dataType: 'DEMAND',          scope: 'demand:write',         summary: '수요 · 사용 실적 입력',   maxBodyBytes: NORMAL_BODY },
  { path: '/inventory',            dataType: 'INVENTORY',       scope: 'inventory:write',      summary: '재고 입력',               maxBodyBytes: NORMAL_BODY },
  { path: '/purchase-orders',      dataType: 'PURCHASE_ORDER',  scope: 'purchase_order:write', summary: '발주 입력',               maxBodyBytes: NORMAL_BODY },
  { path: '/receipts',             dataType: 'RECEIPT',         scope: 'purchase_order:write', summary: '입고 입력',               maxBodyBytes: NORMAL_BODY },
  // open-po 는 "아직 입고되지 않은 발주" 입니다. 발주일 · 납기일 · 공급처를 담아야 하는데
  // RECEIPT(raw.goods_receipt)에는 그 컬럼이 없어 값이 버려집니다. 그래서 PURCHASE_ORDER 로 둡니다.
  // 미입고 여부는 status 컬럼으로 구분합니다 (지시서의 대안 갈래).
  { path: '/open-po',              dataType: 'PURCHASE_ORDER',  scope: 'purchase_order:write', summary: '미입고 발주 입력',        maxBodyBytes: NORMAL_BODY },
  { path: '/events',               dataType: 'EVENT',           scope: 'demand:write',         summary: '비즈니스 이벤트 입력',    maxBodyBytes: NORMAL_BODY },
  { path: '/sales-order',          dataType: 'SALES_ORDER',     scope: 'demand:write',         summary: '확정 수주 입력',          maxBodyBytes: NORMAL_BODY },
  { path: '/bulk/demand-history',  dataType: 'DEMAND',          scope: 'demand:write',         summary: '수요 실적 대량 입력',     maxBodyBytes: BULK_BODY },
  { path: '/bulk/inventory',       dataType: 'INVENTORY',       scope: 'inventory:write',      summary: '재고 대량 입력',          maxBodyBytes: BULK_BODY },
];

/** GET — renew.prd 9.2 */
export type OutboundRoute = {
  path: string;
  scope: ApiScope;
  summary: string;
  /** 경로 변수 이름. 쿼리만 쓰는 경로는 null */
  pathParam: string | null;
  /** limit · offset 을 받는가 */
  paged: boolean;
};

export const OUTBOUND_ROUTES: OutboundRoute[] = [
  { path: '/forecast/{itemId}',              scope: 'forecast:read',       summary: '품목별 예측',           pathParam: 'itemId',     paged: true },
  { path: '/inventory-projection/{itemId}',  scope: 'recommendation:read', summary: '품목별 재고 전개',      pathParam: 'itemId',     paged: true },
  { path: '/stockout-risk/{itemId}',         scope: 'recommendation:read', summary: '품목별 결품 위험',      pathParam: 'itemId',     paged: false },
  { path: '/order-recommendation/{itemId}',  scope: 'recommendation:read', summary: '품목별 발주 추천',      pathParam: 'itemId',     paged: false },
  { path: '/leadtime/{supplierId}',          scope: 'forecast:read',       summary: '공급처별 리드타임',     pathParam: 'supplierId', paged: false },
  { path: '/atp',                            scope: 'recommendation:read', summary: '납기 가능 수량(ATP)',   pathParam: null,         paged: false },
  { path: '/alerts',                         scope: 'alert:read',          summary: '미해결 알림',           pathParam: null,         paged: true },
];

export function inboundRoute(path: string): InboundRoute | null {
  return INBOUND_ROUTES.find((route) => route.path === path) ?? null;
}

// ── OpenAPI 3.1 문서 ──────────────────────────────────────────

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', examples: ['UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED'] },
        message: { type: 'string' },
      },
    },
  },
} as const;

const INBOUND_REQUEST_SCHEMA = {
  type: 'object',
  required: ['data'],
  properties: {
    mode: {
      type: 'string',
      enum: ['append', 'replace', 'upsert'],
      default: 'append',
      description: 'append 기존 유지 + 추가 · replace 대상 기간 삭제 후 적재 · upsert 키가 같으면 교체',
    },
    strict: {
      type: 'boolean',
      default: false,
      description: 'true 면 오류가 하나라도 있을 때 한 행도 적재하지 않습니다',
    },
    period_from: {
      type: 'string',
      format: 'date',
      description:
        "mode: 'replace' 에서만 씁니다. 이 날짜부터 period_to 까지의 기존 데이터를 지우고 다시 넣습니다. 지운 원본은 되돌릴 수 없습니다",
    },
    period_to: {
      type: 'string',
      format: 'date',
      description: "mode: 'replace' 에서만 씁니다. 기간의 끝(포함)",
    },
    data: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: '컬럼 이름은 논리 필드명 또는 그 별칭을 씁니다 (파일 업로드와 같은 자동 매핑)',
    },
  },
} as const;

const INBOUND_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['batch_id', 'received', 'accepted', 'rejected', 'errors'],
  properties: {
    batch_id: { type: ['string', 'null'] },
    received: { type: 'integer' },
    accepted: { type: 'integer' },
    rejected: { type: 'integer' },
    errors_total: {
      type: 'integer',
      description: '오류가 1,000건을 넘어 errors 를 잘랐을 때의 전체 수. 전부 보려면 batch_id 로 적재 이력을 보세요',
    },
    errors: {
      type: 'array',
      maxItems: 1000,
      items: {
        type: 'object',
        properties: {
          index: { type: ['integer', 'null'], description: 'data 배열의 위치(0부터). 요청 단위 오류는 null' },
          field: { type: ['string', 'null'] },
          message: { type: 'string' },
          code: { type: 'string' },
          severity: { type: 'string', enum: ['ERROR', 'WARNING'] },
        },
      },
    },
  },
} as const;

const COMMON_RESPONSES = {
  '400': { description: '요청 본문이 올바르지 않습니다', content: { 'application/json': { schema: ERROR_SCHEMA } } },
  '401': { description: '인증되지 않았습니다', content: { 'application/json': { schema: ERROR_SCHEMA } } },
  '403': { description: 'scope 가 없습니다', content: { 'application/json': { schema: ERROR_SCHEMA } } },
  '429': { description: '분당 호출 한도를 넘었습니다', content: { 'application/json': { schema: ERROR_SCHEMA } } },
} as const;

const PAGING_PARAMS = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', default: 100, minimum: 1, maximum: 1000 },
    description: '한 번에 받을 행 수. 기본 100 · 최대 1000',
  },
  {
    name: 'offset',
    in: 'query',
    required: false,
    schema: { type: 'integer', default: 0, minimum: 0 },
  },
];

function inboundPathItem(route: InboundRoute) {
  return {
    post: {
      summary: route.summary,
      description:
        `${route.dataType} 로 적재합니다. 파일 업로드와 같은 검증을 지납니다 (renew.prd 8.3). ` +
        `본문 상한 ${Math.round(route.maxBodyBytes / MB)}MB.`,
      tags: ['Inbound'],
      security: [{ bearerAuth: [route.scope] }],
      parameters: [
        {
          name: 'Idempotency-Key',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: '같은 값으로 다시 보내면 지난 응답을 그대로 돌려주고 적재하지 않습니다',
        },
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: INBOUND_REQUEST_SCHEMA } },
      },
      responses: {
        '200': {
          description: '적재했습니다 (부분 성공 포함)',
          content: { 'application/json': { schema: INBOUND_RESPONSE_SCHEMA } },
        },
        '422': {
          description: 'strict 또는 요청 단위 오류로 전량 거부했습니다',
          content: { 'application/json': { schema: INBOUND_RESPONSE_SCHEMA } },
        },
        ...COMMON_RESPONSES,
      },
    },
  };
}

function outboundPathItem(route: OutboundRoute) {
  const parameters: unknown[] = [];

  if (route.pathParam) {
    parameters.push({
      name: route.pathParam,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  }

  if (route.path === '/atp') {
    parameters.push(
      { name: 'item_id', in: 'query', required: true, schema: { type: 'string' } },
      {
        name: 'qty',
        in: 'query',
        required: false,
        schema: { type: 'number', exclusiveMinimum: 0 },
        description: '주면 수주 가능 판정을 함께 돌려줍니다. date 도 함께 필요합니다',
      },
      {
        name: 'date',
        in: 'query',
        required: false,
        schema: { type: 'string', format: 'date' },
        description: '희망 납기일 (YYYY-MM-DD)',
      },
    );
  }

  if (route.paged) parameters.push(...PAGING_PARAMS);

  const responses: Record<string, unknown> = {
    '200': { description: '조회했습니다', content: { 'application/json': { schema: { type: 'object' } } } },
    '404': { description: '해당 데이터가 없습니다', content: { 'application/json': { schema: ERROR_SCHEMA } } },
    ...COMMON_RESPONSES,
    '503': {
      description: '서버 자격증명이 설정되지 않아 조회할 수 없습니다 (관리자 설정 문제)',
      content: { 'application/json': { schema: ERROR_SCHEMA } },
    },
  };

  if (route.path === '/atp') {
    responses['501'] = {
      description: 'ATP 조회를 쓸 수 없습니다 (STEP 17 의 sql/23 미적용)',
      content: { 'application/json': { schema: ERROR_SCHEMA } },
    };
  }

  return {
    get: {
      summary: route.summary,
      tags: ['Outbound'],
      security: [{ bearerAuth: [route.scope] }],
      parameters,
      responses,
    },
  };
}

/** OpenAPI 3.1 문서. /api/v1/openapi.json 이 이 값을 그대로 돌려줍니다 */
export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  for (const route of INBOUND_ROUTES) {
    paths[`${API_BASE}${route.path}`] = inboundPathItem(route);
  }
  for (const route of OUTBOUND_ROUTES) {
    paths[`${API_BASE}${route.path}`] = outboundPathItem(route);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'SuperSCM External API',
      version: '1.0.0',
      description:
        'renew.prd 9장. 외부 시스템(ERP 등)이 데이터를 넣고(Inbound) 결과를 가져갑니다(Outbound). ' +
        'API 입력도 파일 업로드와 같은 검증을 지납니다.',
    },
    servers: [{ url: '/', description: '같은 호스트' }],
    tags: [
      { name: 'Inbound', description: 'renew.prd 9.1 — 데이터 입력' },
      { name: 'Outbound', description: 'renew.prd 9.2 — 결과 조회' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Authorization: Bearer <API 키>. 키는 관리자 화면에서 발급하며 원문은 발급 시 한 번만 보입니다.',
        },
      },
      schemas: {
        Error: ERROR_SCHEMA,
        InboundRequest: INBOUND_REQUEST_SCHEMA,
        InboundResponse: INBOUND_RESPONSE_SCHEMA,
      },
    },
    security: [{ bearerAuth: [] }],
    'x-scopes': API_SCOPES,
    'x-rate-limit': '키마다 분당 60회. 초과하면 429 입니다 (서버 인스턴스별 계수).',
    paths,
  };
}
