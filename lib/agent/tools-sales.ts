// 영업 툴 6종 — renew.prd 27장 ★
//
// STEP 16 의 레지스트리(lib/agent/tools.ts)에 얹습니다. 그 파일을 고칠 필요가 없도록
// registerTool 확장점을 씁니다.
//
//   checkOrderFeasibility(itemId, qty, targetDate)   수주 가능 판정 (27.5)
//   getATP(itemId, targetDate?)                      4구간 ATP (27.3)
//   getEarliestDelivery(itemId, qty)                 그 수량이 확보되는 가장 이른 날
//   getAlternativeItems(itemId)                      대체품 (27.2)
//   createSoftAllocation(itemId, qty, validDays?)    ★ 실제로 예약을 만듭니다 (27.6)
//   getSupplyStatus(itemId)                          수급 상태 (28.3)
//
// 규칙은 SCM 툴과 같습니다.
//   ★ 툴은 화면이 쓰는 것과 똑같은 lib 함수를 부릅니다. Supabase 를 직접 부르지 않습니다
//     (renew.prd 32 — 화면과 AI 가 다른 숫자를 내면 신뢰가 무너집니다).
//   ★ numbers 에 그 툴이 돌려준 수치를 빠짐없이 넣습니다. 빠뜨린 값은 Guardrail 이
//     막아 답변에 쓸 수 없습니다. 값이 없으면 0 이 아니라 null 입니다.
//   ★ lib 조회 함수는 run() 안에서 동적으로 import 합니다. 파일 맨 위에서 부르면
//     lib/agent/tools.test.ts 가 서버 전용 Supabase 클라이언트를 끌고 들어와
//     모듈 로딩 단계에서 죽습니다 (error.md #17).
//
// ★ 정보 접근 범위 (renew.prd 4.5)
//   이 여섯 툴이 읽는 뷰에는 단가 · 발주 금액 · 공급처 상세 · 리드타임 통계 ·
//   정확도 컬럼이 없습니다 (sql/23-atp-sales.sql §9). 그 위에 오케스트레이터가
//   lib/agent/redact.ts 로 모든 툴 결과를 한 번 더 훑습니다.
//
// ★ 문의 이력 (renew.prd 27.7)
//   여섯 툴 모두 끝에서 core.sales_inquiry 에 한 줄 남깁니다. 기록에 실패해도
//   답은 그대로 나갑니다 — 기록이 없는 것보다 답을 못 주는 쪽이 나쁩니다.

import { registerTool, type AgentTool, type ToolContext, type ToolResult } from './tools.ts';

// ── 작은 도구들 (tools.ts 와 같은 모양) ───────────────────────

function fail(reason: string): ToolResult {
  return { ok: false, data: null, numbers: {}, dataAsOf: null, dates: [], reason };
}

/**
 * 성공한 결과.
 *
 * ★ dates 를 반드시 넘깁니다 (빈 배열이라도). Guardrail 은 이 목록에 있는 날짜만
 *   답변에 허용합니다 — 영업 답변은 거의 전부가 날짜라, 수량만 검사하고 날짜를 두면
 *   "10월 10일까지 620개" 에서 620 은 못 지어내고 날짜는 지어낼 수 있습니다.
 */
function ok(
  data: unknown,
  numbers: Record<string, number | null>,
  dataAsOf: string | null,
  dates: (string | null | undefined)[],
): ToolResult {
  const clean: string[] = [];
  for (const value of dates) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) clean.push(value.slice(0, 10));
  }
  return { ok: true, data, numbers, dataAsOf, dates: clean };
}

function put(
  target: Record<string, number | null>,
  prefix: string,
  entries: Record<string, number | null | undefined>,
): void {
  for (const [key, value] of Object.entries(entries)) {
    target[prefix ? `${prefix}.${key}` : key] = value === undefined ? null : value;
  }
}

function argText(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function argNumber(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** YYYY-MM-DD 만 받습니다. 그 밖의 모양은 DB 로 넘기지 않습니다 */
function argDate(args: Record<string, unknown>, key: string): string | null {
  const value = argText(args, key);
  if (value === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 문의 이력 한 줄 — renew.prd 27.7.
 *
 * 실패를 삼킵니다. 이 기록은 통계용이고, 실패하면 답변까지 막을 이유가 없습니다.
 */
async function logInquiry(
  ctx: ToolContext,
  input: {
    itemId: string | null;
    requestedQty?: number | null;
    requestedDate?: string | null;
    answerStatus?: 'AVAILABLE' | 'CONDITIONALLY_AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN' | null;
    answer?: unknown;
    softAllocationId?: number | null;
  },
): Promise<void> {
  try {
    const { recordSalesInquiry } = await import('../atp.ts');
    await recordSalesInquiry({
      itemId: input.itemId,
      requestedQty: input.requestedQty ?? null,
      requestedDate: input.requestedDate ?? null,
      question: ctx.question ?? null,
      answerStatus: input.answerStatus ?? null,
      answer: input.answer ?? null,
      softAllocationId: input.softAllocationId ?? null,
    });
  } catch {
    // 기록은 실패해도 답은 나갑니다 (renew.prd 31.4 와 같은 취지).
  }
}

const ITEM_ID: AgentTool['parameters']['properties'] = {
  itemId: { type: 'string', description: '품목코드 (예: ITEM012)' },
};

// ── 툴 6종 ────────────────────────────────────────────────────

const checkOrderFeasibilityTool: AgentTool = {
  name: 'checkOrderFeasibility',
  description:
    '요청 수량을 요청 납기까지 약속할 수 있는지 판정합니다. ' +
    'status(AVAILABLE · CONDITIONALLY_AVAILABLE · UNAVAILABLE · UNKNOWN) · 가용 수량 · ' +
    '주문 후 예상 재고 · 안전재고 · 가장 이른 안전 납기일 · 적용 리드타임과 신뢰도를 냅니다. ' +
    '"500대 받을 수 있어?" · "10월 15일까지 700대 가능해?" 에 이 툴로 답합니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId', 'qty'],
    properties: {
      ...ITEM_ID,
      qty: { type: 'number', description: '요청 수량' },
      targetDate: { type: 'string', description: "요청 납기 'YYYY-MM-DD' (선택). 없으면 오늘" },
    },
  },
  roles: ['ADMIN', 'USER'],
  group: 'SALES',
  enabled: true,
  async run(args, ctx) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');
    const qty = argNumber(args, 'qty');
    if (qty === null || qty <= 0) return fail('요청 수량이 필요합니다 (0보다 커야 합니다).');
    const targetDate = argDate(args, 'targetDate') ?? today();

    const { checkOrderFeasibility } = await import('../atp.ts');
    const { data, error } = await checkOrderFeasibility(itemId, qty, targetDate);
    if (error) return fail(`수주 가능 판정에 실패했습니다: ${error}`);
    if (!data) return fail(`${itemId} 의 수주 가능 여부를 판정하지 못했습니다.`);

    const numbers: Record<string, number | null> = {};
    put(numbers, '', {
      available_qty: data.availableQty,
      requested_qty: data.requestedQty,
      projected_inventory_after_order: data.projectedInventoryAfterOrder,
      safety_stock: data.safetyStock,
      lead_time_used: data.leadTimeUsed,
      delivery_buffer_days: data.deliveryBufferDays,
      atp_now: data.atpNow,
      atp_2w: data.atp2w,
      atp_1m: data.atp1m,
      confirmed_incoming: data.confirmedIncoming,
      committed_demand: data.committedDemand,
      soft_allocation: data.softAllocation,
    });

    await logInquiry(ctx, {
      itemId,
      requestedQty: qty,
      requestedDate: targetDate,
      answerStatus: data.status,
      answer: data,
    });

    return ok(data, numbers, data.dataSnapshotAt, [
      data.earliestSafeDate,
      data.earliestNewSupplyDate,
      data.bucketUntil,
      data.targetDate,
      data.projectionHorizonEnd,
    ]);
  },
};

const getAtpTool: AgentTool = {
  name: 'getATP',
  description:
    '한 품목의 약속 가능 수량(ATP)을 네 구간으로 돌려줍니다 — 즉시(NOW) · 2주 내(2W) · ' +
    '1개월 내(1M) · 그 이후(BEYOND). 현재고 · 구간까지의 입고예정 · 확정 수주 · 가예약 · ' +
    '보호 안전재고를 함께 냅니다. BEYOND 는 수량이 아니라 신규 발주 시 확보 가능일만 냅니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: {
      ...ITEM_ID,
      targetDate: { type: 'string', description: "관심 납기 'YYYY-MM-DD' (선택)" },
    },
  },
  roles: ['ADMIN', 'USER'],
  group: 'SALES',
  enabled: true,
  async run(args, ctx) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');
    const targetDate = argDate(args, 'targetDate');

    const { getAtp } = await import('../atp.ts');
    const { rows, error } = await getAtp(itemId);
    if (error) return fail(`ATP 조회에 실패했습니다: ${error}`);
    if (rows.length === 0) return fail(`${itemId} 는 품목 마스터에 없습니다.`);

    const numbers: Record<string, number | null> = {};
    for (const row of rows) {
      put(numbers, row.bucket, {
        atp_qty: row.atpQty,
        available_now: row.availableNow,
        confirmed_incoming: row.confirmedIncoming,
        committed_demand: row.committedDemand,
        soft_allocation: row.softAllocation,
        protected_safety_stock: row.protectedSafetyStock,
      });
    }
    put(numbers, '', {
      lead_time: rows[0].leadTime,
      delivery_buffer_days: rows[0].deliveryBufferDays,
    });

    const dataAsOf = rows.find((row) => row.dataSnapshotAt)?.dataSnapshotAt ?? null;
    const beyond = rows.find((row) => row.bucket === 'BEYOND') ?? null;

    await logInquiry(ctx, {
      itemId,
      requestedDate: targetDate,
      answerStatus: rows[0].reason === null ? null : 'UNKNOWN',
    });

    return ok(
      {
        itemId,
        itemName: rows[0].itemName,
        buckets: rows,
        leadTime: rows[0].leadTime,
        leadTimeConfidence: rows[0].leadTimeConfidence,
        earliestNewSupplyDate: beyond?.earliestNewSupplyDate ?? null,
        reason: rows[0].reason,
      },
      numbers,
      dataAsOf,
      [...rows.map((row) => row.bucketUntil), beyond?.earliestNewSupplyDate ?? null],
    );
  },
};

const getEarliestDeliveryTool: AgentTool = {
  name: 'getEarliestDelivery',
  description:
    '요청 수량이 확보되는 가장 이른 날을 돌려줍니다. 지금 재고로 되면 오늘, 입고예정으로 ' +
    '충당되면 그 구간의 끝, 그것도 부족하면 신규 발주 기준일입니다. 고객 안내용 여유일이 ' +
    '이미 더해져 있습니다 — P80 리드타임은 다섯 번 중 한 번 지연되기 때문입니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId', 'qty'],
    properties: {
      ...ITEM_ID,
      qty: { type: 'number', description: '필요 수량' },
    },
  },
  roles: ['ADMIN', 'USER'],
  group: 'SALES',
  enabled: true,
  async run(args, ctx) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');
    const qty = argNumber(args, 'qty');
    if (qty === null || qty <= 0) return fail('필요 수량이 필요합니다 (0보다 커야 합니다).');

    // 오늘 기준으로 물어 즉시 구간부터 훑게 합니다. 함수가 네 구간을 모두 보고
    // 가장 이른 날을 냅니다 (sql/23 의 earliest_safe_date).
    const { checkOrderFeasibility } = await import('../atp.ts');
    const { data, error } = await checkOrderFeasibility(itemId, qty, today());
    if (error) return fail(`납기 조회에 실패했습니다: ${error}`);
    if (!data) return fail(`${itemId} 의 납기를 산출하지 못했습니다.`);

    if (data.earliestSafeDate === null) {
      await logInquiry(ctx, { itemId, requestedQty: qty, answerStatus: 'UNAVAILABLE', answer: data });
      return fail(
        data.reason
          ? `${data.reason} — 이 품목의 확보 가능일을 산출할 수 없습니다.`
          : '요청 수량을 확보할 수 있는 날을 산출하지 못했습니다 (리드타임 미확정).',
      );
    }

    const numbers: Record<string, number | null> = {};
    put(numbers, '', {
      requested_qty: qty,
      atp_now: data.atpNow,
      atp_2w: data.atp2w,
      atp_1m: data.atp1m,
      lead_time_used: data.leadTimeUsed,
      delivery_buffer_days: data.deliveryBufferDays,
    });

    await logInquiry(ctx, {
      itemId,
      requestedQty: qty,
      requestedDate: data.earliestSafeDate,
      answerStatus: data.status,
      answer: data,
    });

    return ok(
      {
        itemId,
        itemName: data.itemName,
        requestedQty: qty,
        earliestSafeDate: data.earliestSafeDate,
        earliestNewSupplyDate: data.earliestNewSupplyDate,
        leadTimeUsed: data.leadTimeUsed,
        leadTimeConfidence: data.leadTimeConfidence,
        deliveryBufferDays: data.deliveryBufferDays,
        status: data.status,
      },
      numbers,
      data.dataSnapshotAt,
      [data.earliestSafeDate, data.earliestNewSupplyDate],
    );
  },
};

const getAlternativeItemsTool: AgentTool = {
  name: 'getAlternativeItems',
  description:
    '이 품목의 대체품을 우선순위 순으로 돌려줍니다. 대체품마다 지금 약속 가능한 수량(ATP)과 ' +
    '수급 상태를 함께 냅니다. "이 모델 대체품 있어?" 에 이 툴로 답합니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: { ...ITEM_ID },
  },
  roles: ['ADMIN', 'USER'],
  group: 'SALES',
  enabled: true,
  async run(args, ctx) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');

    const { getAlternativeItems, getAtp } = await import('../atp.ts');
    const { rows, error } = await getAlternativeItems(itemId);
    if (error) return fail(`대체품 조회에 실패했습니다: ${error}`);
    if (rows.length === 0) return fail(`${itemId} 에 등록된 대체품이 없습니다.`);

    // 대체품마다 지금 팔 수 있는 수량을 붙입니다. 대체품 목록만 주면
    // "그래서 그걸로 되냐" 를 다시 물어야 합니다.
    const numbers: Record<string, number | null> = { count: rows.length };
    const enriched: unknown[] = [];
    for (const row of rows) {
      const atp = await getAtp(row.substituteItemId);
      const now = atp.rows.find((item) => item.bucket === 'NOW') ?? null;
      put(numbers, row.substituteItemId, {
        priority: row.priority,
        atp_now: now?.atpQty ?? null,
      });
      enriched.push({
        substituteItemId: row.substituteItemId,
        substituteItemName: row.substituteItemName,
        isActive: row.substituteIsActive,
        priority: row.priority,
        note: row.note,
        atpNow: now?.atpQty ?? null,
        reason: now?.reason ?? null,
      });
    }

    await logInquiry(ctx, { itemId });

    // 대체품 목록에는 날짜가 없습니다. 빈 배열을 명시합니다 — "없다" 와 "적지 않았다" 는
    // 다르고, 적지 않으면 이 툴이 쓰인 답변의 날짜 검사가 통째로 꺼집니다.
    return ok({ itemId, itemName: rows[0].itemName, alternatives: enriched }, numbers, null, []);
  },
};

const createSoftAllocationTool: AgentTool = {
  name: 'createSoftAllocation',
  description:
    '★ 실제로 재고를 잡아 둡니다 (가예약). 이 수량은 즉시 ATP 에서 빠져 다른 영업이 같은 ' +
    '재고를 약속할 수 없게 됩니다. 현재 ATP 를 넘으면 거부됩니다. 유효기간이 지나면 자동으로 ' +
    '풀립니다. 예약을 만들었으면 답변에 예약 번호와 유효기간을 반드시 알려 주세요.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId', 'qty'],
    properties: {
      ...ITEM_ID,
      qty: { type: 'number', description: '예약 수량' },
      validDays: { type: 'number', description: '유효기간(일). 없으면 정책 기본값' },
      customer: { type: 'string', description: '고객명 (선택)' },
    },
  },
  roles: ['ADMIN', 'USER'],
  group: 'SALES',
  enabled: true,
  async run(args, ctx) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');
    const qty = argNumber(args, 'qty');
    if (qty === null || qty <= 0) return fail('예약 수량이 필요합니다 (0보다 커야 합니다).');
    const validDays = argNumber(args, 'validDays');
    const customer = argText(args, 'customer');

    const { createSoftAllocation } = await import('../atp.ts');
    const result = await createSoftAllocation(itemId, qty, validDays, customer);
    if (result.error) return fail(`가예약에 실패했습니다: ${result.error}`);
    if (!result.ok) {
      await logInquiry(ctx, { itemId, requestedQty: qty, answerStatus: 'UNAVAILABLE' });
      return fail(result.message);
    }

    // ★ 예약 번호와 남은 일수를 numbers 에 넣습니다.
    //   Guardrail 은 툴이 준 수치만 답변에 허용하므로, 여기 없으면 모델이 예약 번호를
    //   문장에 쓸 수 없습니다 — "예약했습니다" 만 있고 번호가 빠진 답이 됩니다.
    const numbers: Record<string, number | null> = {};
    put(numbers, '', {
      allocation_id: result.allocationId,
      qty,
      valid_days: validDays,
    });

    await logInquiry(ctx, {
      itemId,
      requestedQty: qty,
      answerStatus: 'AVAILABLE',
      answer: { allocationId: result.allocationId, validUntil: result.validUntil },
      softAllocationId: result.allocationId,
    });

    return ok(
      {
        itemId,
        qty,
        allocationId: result.allocationId,
        validUntil: result.validUntil,
        message: result.message,
        customer,
      },
      numbers,
      null,
      // ★ 유효기간을 반드시 실어야 모델이 "…까지" 를 답변에 쓸 수 있습니다.
      [result.validUntil],
    );
  },
};

const getSupplyStatusTool: AgentTool = {
  name: 'getSupplyStatus',
  description:
    '한 품목의 수급 상태를 돌려줍니다 — 안전 · 주의 · 불가 중 하나와 구간별 ATP(즉시 · 2주 · ' +
    '1개월), 신규 발주 시 확보 가능일입니다. 상태는 앞으로의 전망이고 ATP 는 지금 약속해도 ' +
    '되는 수량이라, "불가" 인데 즉시 수량이 남아 있을 수 있습니다. 둘을 함께 설명하세요.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: { ...ITEM_ID },
  },
  roles: ['ADMIN', 'USER'],
  group: 'SALES',
  enabled: true,
  async run(args, ctx) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');

    const { getSalesSupplyStatus } = await import('../atp.ts');
    const { rows, error } = await getSalesSupplyStatus();
    if (error) return fail(`수급 상태 조회에 실패했습니다: ${error}`);

    const normalized = itemId.replace(/[\s\-_]/g, '').toUpperCase();
    const row = rows.find((item) => item.itemId === normalized) ?? null;
    if (!row) return fail(`${itemId} 의 수급 상태가 없습니다.`);

    const numbers: Record<string, number | null> = {};
    put(numbers, '', {
      atp_now: row.atpNow,
      atp_2w: row.atp2w,
      atp_1m: row.atp1m,
      lead_time: row.leadTime,
    });

    await logInquiry(ctx, { itemId, answerStatus: row.reason === null ? null : 'UNKNOWN' });

    return ok(row, numbers, row.dataSnapshotAt, [row.earliestNewSupplyDate]);
  },
};

/** renew.prd 27 의 영업 툴 6종. 등록 순서가 모델에게 보이는 순서입니다 */
export const SALES_TOOLS: AgentTool[] = [
  checkOrderFeasibilityTool,
  getAtpTool,
  getEarliestDeliveryTool,
  getAlternativeItemsTool,
  createSoftAllocationTool,
  getSupplyStatusTool,
];

/** 영업 툴 이름 6개. 화면·테스트가 목록을 대조할 때 씁니다 */
export const SALES_TOOL_NAMES: string[] = SALES_TOOLS.map((tool) => tool.name);

/**
 * 레지스트리에 얹습니다.
 *
 * 여러 번 불려도 안전합니다. registerTool 은 같은 이름이 이미 있으면 throw 하는데,
 * 모듈이 서로 다른 지정자('./tools-sales.ts' · '@/lib/agent')로 두 번 평가되면
 * 그 throw 가 앱 부팅을 막습니다. 이미 있는 것은 건너뜁니다.
 */
export function registerSalesTools(): void {
  for (const tool of SALES_TOOLS) {
    try {
      registerTool(tool);
    } catch {
      // 이미 등록되어 있습니다.
    }
  }
}

registerSalesTools();
