// 툴 레지스트리 — renew.prd 26.2 ★
//
// LLM 이 부를 수 있는 함수 목록입니다. 규칙은 하나뿐입니다.
//
//   ★ 툴은 화면이 쓰는 것과 똑같은 lib 함수를 부릅니다. Supabase 를 직접 부르지 않습니다.
//     renew.prd 32 — "화면과 AI Agent 가 동일한 함수를 호출한다. 두 경로에서 다른 숫자가
//     나오면 시스템 신뢰가 무너진다." 그래서 이 파일에는 쿼리가 한 줄도 없습니다.
//
// 왜 동적 import(`await import('../scm.ts')`) 인가
//   lib/agent/tools.test.ts 는 node --test 로 이 파일을 그대로 실행합니다. 파일 맨 위에서
//   lib/scm.ts 를 정적으로 부르면 서버 전용 Supabase 클라이언트가 딸려 들어와 테스트가
//   모듈 로딩 단계에서 죽습니다(error.md #17 과 같은 확장자 문제까지 함께). run() 안에서만
//   부르면 목록·스키마·역할은 네트워크도 DB 도 없이 검사할 수 있고, 레지스트리는 한 파일로
//   남습니다. 상대 경로에 .ts 를 붙이는 것도 같은 이유입니다.
//
// STEP 17 · 18 확장점
//   registerTool(tool) 로 한 줄 더하면 끝입니다. 이 파일을 고칠 필요가 없습니다.
//     STEP 17  영업 툴 6종 (checkOrderFeasibility · getATP · …)
//     STEP 18  simulateScenario 를 켜고 run 을 채웠습니다 (lib/what-if.ts 의 runWhatIf)

// ── 타입 ──────────────────────────────────────────────────────

/** renew.prd 4.1 의 Role. 초기 두 가지입니다 */
export type ToolRole = 'ADMIN' | 'USER';

/**
 * 툴 묶음 — renew.prd 4.5 (정보 접근 범위).
 *
 * Role 이 ADMIN · USER 둘뿐이라 "영업이 부를 수 있는 툴" 을 role 로 나눌 수 없습니다.
 * 대신 툴에 묶음을 달아 두고, 오케스트레이터가 부서로 묶음을 고릅니다.
 *
 *   SCM     기존 10종. 발주 추천 · 정확도 · 리드타임 통계처럼 영업이 보지 않는 것을 담습니다
 *   SALES   STEP 17 의 영업 툴 6종. ATP · 납기 · 대체품 · 가예약만 다룹니다
 *
 * 묶음을 적지 않은 툴은 SCM 입니다.
 */
export type ToolGroup = 'SCM' | 'SALES';

/** 툴 파라미터 스키마 (JSON Schema 의 object 한 겹) */
export type JsonSchemaObject = {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
};

/**
 * 툴 한 번의 결과.
 *
 * ok 는 "답할 거리를 찾았는가" 입니다. 조회가 실패했을 때도, 조회는 됐지만 행이 없을 때도
 * false 이고 reason 에 사유가 붙습니다. 모델은 그때 추측하지 않고 cannot_answer 로 갑니다.
 *
 * ★ numbers 는 이 툴이 돌려준 모든 수치의 평평한 사전입니다.
 *   Guardrail 은 여기 있는 값만 답변에 허용합니다 (renew.prd 26.3).
 *   값이 없으면 0 이 아니라 null 입니다 (AGENTS.md 규칙 5).
 */
export type ToolResult = {
  ok: boolean;
  data: unknown;
  numbers: Record<string, number | null>;
  dataAsOf: string | null;
  /**
   * 이 툴이 돌려준 날짜 전부 (`YYYY-MM-DD`) — STEP 17.
   *
   * numbers 가 수치에 대해 하는 일을 날짜에 대해 합니다. Guardrail 은 여기 있는
   * 날짜만 답변에 허용합니다 (lib/agent/guardrail.ts 의 ★ 날짜 절).
   *
   * ★ 이 필드를 **적지 않으면 그 툴이 쓰인 답변은 날짜 검사를 받지 않습니다.**
   *   STEP 16 의 SCM 툴 10종은 아직 적지 않았고, 그래서 그 경로의 동작은 그대로입니다.
   *   SCM 툴에 날짜를 채우면 그때부터 자동으로 검사가 켜집니다 (orchestrator 참조).
   *   날짜를 하나도 내지 않는 툴이라면 빈 배열 `[]` 을 적으세요 — "없다" 와
   *   "적지 않았다" 는 다릅니다.
   */
  dates?: string[];
  reason?: string;
};

/** 툴이 누구를 대신해 도는가. STEP 17 의 정보 접근 범위(renew.prd 4.5)가 이 값을 씁니다 */
export type ToolContext = {
  role: ToolRole;
  userId: string;
  email: string;
  /** core.app_user.department. 영업 판정에 씁니다 (renew.prd 4.5) */
  department?: string | null;
  /**
   * 사용자가 던진 질문 원문.
   *
   * 영업 툴이 core.sales_inquiry 에 문의를 남길 때 씁니다 (renew.prd 27.7).
   * SCM 툴은 쓰지 않습니다.
   */
  question?: string | null;
};

export type AgentTool = {
  name: string;
  /** 한국어 설명. 모델이 이 문장만 보고 툴을 고릅니다 */
  description: string;
  parameters: JsonSchemaObject;
  roles: ToolRole[];
  /** 적지 않으면 'SCM' 입니다 (renew.prd 4.5) */
  group?: ToolGroup;
  /** false 면 모델에게 보이지 않습니다 (STEP 18 의 simulateScenario) */
  enabled: boolean;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

// ── 결과를 만드는 작은 도구들 ─────────────────────────────────

/** 조회는 됐지만 답할 거리가 없을 때. 숫자를 지어내지 않습니다 (AGENTS.md 규칙 5) */
function fail(reason: string): ToolResult {
  return { ok: false, data: null, numbers: {}, dataAsOf: null, reason };
}

function ok(
  data: unknown,
  numbers: Record<string, number | null>,
  dataAsOf: string | null,
): ToolResult {
  return { ok: true, data, numbers, dataAsOf };
}

/**
 * numbers 사전에 한 묶음을 얹습니다.
 *
 * Guardrail 은 이 사전에 있는 값만 답변에 허용합니다. 그래서 "화면에 보일 법한 수치" 가
 * 아니라 "툴이 돌려준 모든 수치" 를 넣습니다. 빠뜨린 값은 답변에서 쓸 수 없습니다.
 */
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

/** 여러 행의 기준시각 중 하나. 전부 없으면 null 입니다 */
function firstAsOf(values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value) return value;
  }
  return null;
}

const ITEM_ID: JsonSchemaObject['properties'] = {
  itemId: { type: 'string', description: '품목코드 (예: ITEM012)' },
};

// ── 툴 10종 — renew.prd 26.2 (SCM 담당자용) ───────────────────

const getDemandForecast: AgentTool = {
  name: 'getDemandForecast',
  description:
    '한 품목의 기간별 수요 예측을 돌려줍니다. AI 예측(ai_qty) · 사람 보정(override_qty) · ' +
    '적용 수요(consensus_qty) 와 P80 · P90 을 함께 냅니다. period 를 주면 그 기간만 봅니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: {
      ...ITEM_ID,
      period: { type: 'string', description: "기간 앞자리. 'YYYY-MM' 또는 'YYYY' (선택)" },
    },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');
    const period = argText(args, 'period');

    const [{ getLatestSuccessfulRun, getForecastDetail }, { getConsensus }] = await Promise.all([
      import('../forecast.ts'),
      import('../override.ts'),
    ]);

    const consensus = await getConsensus(itemId);
    if (consensus.error) return fail(`예측 조회에 실패했습니다: ${consensus.error}`);

    const rows = period
      ? consensus.rows.filter((row) => row.period.startsWith(period))
      : consensus.rows;
    if (rows.length === 0) return fail('NO_FORECAST — 이 품목의 예측이 없습니다.');

    const run = await getLatestSuccessfulRun();
    const detail = run ? await getForecastDetail(run.runId, itemId) : { rows: [], error: null };

    const numbers: Record<string, number | null> = { periods: rows.length };
    for (const row of rows) {
      put(numbers, row.period, {
        ai_qty: row.aiQty,
        override_qty: row.overrideQty,
        consensus_qty: row.consensusQty,
        p80: row.p80,
        p90: row.p90,
      });
    }
    for (const point of detail.rows) {
      put(numbers, `${point.period}.${point.modelId}`, {
        predicted_qty: point.predictedQty,
        p50: point.p50,
        p80: point.p80,
        p90: point.p90,
      });
    }

    return ok(
      {
        itemId,
        runId: run?.runId ?? null,
        forecastSource: run?.status ?? null,
        periods: rows,
        byModel: detail.rows,
      },
      numbers,
      run?.dataSnapshotAt ?? null,
    );
  },
};

const getForecastAccuracy: AgentTool = {
  name: 'getForecastAccuracy',
  description:
    '한 품목의 예측 정확도를 돌려줍니다. 모델별 WAPE · MAPE · Bias · RMSE 와 Champion 모델, ' +
    '기준선 대비 개선률을 냅니다. 지표는 비율입니다 (0.124 = 12.4%).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: { ...ITEM_ID },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');

    const { getItemPerformance, getChampions } = await import('../backtest.ts');
    const [performance, champions] = await Promise.all([getItemPerformance(itemId), getChampions()]);

    if (performance.error) return fail(`정확도 조회에 실패했습니다: ${performance.error}`);
    const champion = champions.rows.find((row) => row.itemId === itemId) ?? null;
    if (performance.rows.length === 0 && champion === null) {
      return fail('INSUFFICIENT_SAMPLE — 이 품목은 아직 채점되지 않았습니다.');
    }

    const numbers: Record<string, number | null> = { models: performance.rows.length };
    for (const row of performance.rows) {
      put(numbers, row.modelId, {
        wape: row.wape,
        mape: row.mape,
        bias: row.bias,
        rmse: row.rmse,
        mae: row.mae,
        baseline_improvement: row.baselineImprovement,
        metric_value: row.metricValue,
        rank: row.rank,
        periods: row.periods,
        actual_sum: row.actualSum,
      });
    }
    if (champion) {
      put(numbers, 'champion', {
        wape: champion.wape,
        bias: champion.bias,
        rmse: champion.rmse,
        baseline_improvement: champion.baselineImprovement,
        metric_value: champion.metricValue,
        candidates: champion.candidateCount,
      });
    }

    return ok({ itemId, champion, models: performance.rows }, numbers, champion?.selectedAt ?? null);
  },
};

const getInventoryProjection: AgentTool = {
  name: 'getInventoryProjection',
  description:
    '한 품목의 기간별 재고 전개를 돌려줍니다. 기초재고 · 입고예정 · 예측수요 · 확정수주 · ' +
    '가예약 · 기말재고를 기간 순서로 냅니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: { ...ITEM_ID },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');

    const { getInventoryProjection: query } = await import('../inventory.ts');
    const { rows, error } = await query(itemId);
    if (error) return fail(`재고 전개 조회에 실패했습니다: ${error}`);
    if (rows.length === 0) return fail('NO_INVENTORY_DATA — 이 품목의 재고 전개가 없습니다.');

    const numbers: Record<string, number | null> = { periods: rows.length };
    for (const row of rows) {
      put(numbers, row.period, {
        opening_qty: row.openingQty,
        receipt_qty: row.receiptQty,
        forecast_qty: row.forecastQty,
        committed_so_qty: row.committedSoQty,
        soft_allocation_qty: row.softAllocationQty,
        demand_qty: row.demandQty,
        closing_qty: row.closingQty,
        cumulative_demand_qty: row.cumulativeDemandQty,
      });
    }

    return ok(
      { itemId, itemName: rows[0].itemName, periods: rows },
      numbers,
      firstAsOf(rows.map((row) => row.dataSnapshotAt)),
    );
  },
};

const getStockoutRisk: AgentTool = {
  name: 'getStockoutRisk',
  description:
    '결품 위험을 돌려줍니다. itemId 를 주면 그 품목 하나, 주지 않으면 위험(CRITICAL)과 ' +
    '주의(WARNING) 품목을 결품이 이른 순으로 최대 20건 냅니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: { ...ITEM_ID },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const itemId = argText(args, 'itemId');

    // 건수는 세지 않고 KPI 뷰가 센 값을 씁니다. 화면의 KPI 카드와 같은 숫자여야 합니다
    // (renew.prd 32 · AGENTS.md 규칙 2).
    const { getStockoutRisks, getStockoutKpi } = await import('../scm.ts');
    const [{ rows, error }, kpi] = await Promise.all([getStockoutRisks(), getStockoutKpi()]);
    if (error) return fail(`결품 위험 조회에 실패했습니다: ${error}`);

    const picked = itemId
      ? rows.filter((row) => row.itemId === itemId)
      : rows.filter((row) => row.riskStatus === 'CRITICAL' || row.riskStatus === 'WARNING').slice(0, 20);

    const summary: Record<string, number | null> = {
      count: picked.length,
      items: kpi.data?.itemCount ?? null,
      critical: kpi.data?.criticalCount ?? null,
      warning: kpi.data?.warningCount ?? null,
      safe: kpi.data?.safeCount ?? null,
      unknown: kpi.data?.unknownCount ?? null,
      within_30_days: kpi.data?.within30DaysCount ?? null,
      within_60_days: kpi.data?.within60DaysCount ?? null,
      average_stockout_days: kpi.data?.averageStockoutDays ?? null,
    };

    if (picked.length === 0) {
      return itemId
        ? fail(`${itemId} 의 결품 위험 판정이 없습니다.`)
        : ok({ items: [], summary: kpi.data }, summary, null);
    }

    const numbers: Record<string, number | null> = { ...summary };
    for (const row of picked) {
      put(numbers, row.itemId, {
        current_stock: row.currentStock,
        inbound_qty: row.inboundQty,
        available_qty: row.availableQty,
        daily_usage_avg: row.dailyUsageAvg,
        planned_lead_time: row.plannedLeadTime,
        stockout_days: row.stockoutDays,
        days_of_supply: row.daysOfSupply,
        months_of_supply: row.monthsOfSupply,
        leadtime_demand_qty: row.leadtimeDemandQty,
        required_qty: row.requiredQty,
      });
    }

    return ok(
      { items: picked, summary: kpi.data },
      numbers,
      firstAsOf(picked.map((row) => row.dataSnapshotAt)),
    );
  },
};

const getLeadtimeStats: AgentTool = {
  name: 'getLeadtimeStats',
  description:
    '공급처별 리드타임 통계를 돌려줍니다. 표본 수 · P50 · P80 · P90 · 표준편차와 확정값, ' +
    '적용 중인 리드타임(effective_lead_time)과 그 출처를 냅니다. ' +
    'supplierId 를 주지 않으면 공급처 코드 순으로 최대 20곳만 돌려줍니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      supplierId: { type: 'string', description: '공급처코드 (선택). 없으면 전체' },
    },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const supplierId = argText(args, 'supplierId');

    const { getLeadtimePolicies } = await import('../inventory.ts');
    const { rows, error } = await getLeadtimePolicies();
    if (error) return fail(`리드타임 조회에 실패했습니다: ${error}`);

    // 공급처를 지정하지 않으면 상위 20곳까지만 봅니다 (getStockoutRisk · getAlerts 와 같은 상한).
    // 공급처 200곳 × 8필드를 한꺼번에 허용 목록에 넣으면 프롬프트가 부풀 뿐 아니라,
    // Guardrail 이 사실상 아무것도 막지 못하게 됩니다 — 어떤 숫자를 대도 그 1,600개 중 하나에 걸립니다.
    const picked = supplierId
      ? rows.filter((row) => row.supplierId === supplierId)
      : rows.slice(0, 20);
    if (picked.length === 0) return fail('NO_LEADTIME — 해당 공급처의 리드타임 통계가 없습니다.');

    const numbers: Record<string, number | null> = { count: picked.length, total: rows.length };
    for (const row of picked) {
      put(numbers, row.supplierId, {
        n_samples: row.sampleCount,
        p50_days: row.p50Days,
        p80_days: row.p80Days,
        p90_days: row.p90Days,
        std_days: row.stdDays,
        std_lead_time: row.stdLeadTime,
        planned_lead_time: row.plannedLeadTime,
        effective_lead_time: row.effectiveLeadTime,
      });
    }

    return ok(
      { suppliers: picked, total: rows.length },
      numbers,
      firstAsOf(picked.map((row) => row.lastChangedAt ?? row.confirmedAt)),
    );
  },
};

const getSafetyStock: AgentTool = {
  name: 'getSafetyStock',
  description:
    '한 품목의 안전재고와 그 근거를 돌려줍니다. 서비스 수준 · Z값 · 리드타임 · 일평균 수요 · ' +
    'σ_d · σ_DLT · 안전재고를 냅니다. 재료가 없으면 reason 에 사유 코드가 붙습니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: { ...ITEM_ID },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');

    // 목록 함수(getSafetyStocks)와 같은 뷰의 같은 행입니다. 한 품목만 물어보므로
    // 한 줄짜리 함수를 씁니다 — 500행을 받아 걸러도 값은 같습니다.
    const { getSafetyStock: query } = await import('../recommendation.ts');
    const { data, error } = await query(itemId);
    if (error) return fail(`안전재고 조회에 실패했습니다: ${error}`);
    if (!data) return fail(`${itemId} 의 안전재고 근거가 없습니다.`);

    const numbers: Record<string, number | null> = {};
    put(numbers, '', {
      service_level: data.serviceLevel,
      z_value: data.zValue,
      lead_time_days: data.leadTimeDays,
      lead_time_sd: data.leadTimeSd,
      daily_demand: data.dailyDemand,
      sigma_d_monthly: data.sigmaDMonthly,
      sigma_d: data.sigmaD,
      sigma_dlt: data.sigmaDlt,
      safety_stock: data.safetyStock,
    });

    return ok(data, numbers, null);
  },
};

const calcOrderQuantity: AgentTool = {
  name: 'calcOrderQuantity',
  description:
    '한 품목의 발주 추천을 돌려줍니다. 적용수요 · 현재고 · 입고예정 · 안전재고 · 필요량 · ' +
    'MOQ · 포장단위 · 최종 추천수량 · 발주 권고일 · 판정을 냅니다. 수량은 뷰가 이미 계산한 값입니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: { ...ITEM_ID },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');

    const { getSkuDetail } = await import('../recommendation.ts');
    const { data, error } = await getSkuDetail(itemId);
    if (error) return fail(`발주 추천 조회에 실패했습니다: ${error}`);
    if (!data) return fail(`${itemId} 는 품목 마스터에 없습니다.`);

    const numbers: Record<string, number | null> = {};
    put(numbers, '', {
      current_inventory: data.currentInventory,
      incoming_qty: data.incomingQty,
      consensus_forecast: data.consensusForecast,
      lead_time: data.leadTime,
      safety_stock: data.safetyStock,
      service_level: data.serviceLevel,
      z_value: data.zValue,
      sigma_dlt: data.sigmaDlt,
      stockout_days: data.stockoutDays,
      raw_recommended_qty: data.rawRecommendedQty,
      moq: data.moq,
      pack_size: data.packSize,
      final_recommended_qty: data.finalRecommendedQty,
      unit_price: data.unitPrice,
      recommended_amount: data.recommendedAmount,
      champion_wape: data.championWape,
      champion_bias: data.championBias,
      n_overrides: data.overrideCount,
      last_approved_qty: data.lastApprovedQty,
    });

    return ok(data, numbers, data.dataSnapshotAt);
  },
};

const getOpenPO: AgentTool = {
  name: 'getOpenPO',
  description:
    '입고 예정(Open PO)을 돌려줍니다. itemId 를 주면 그 품목의 입고예정 수량 · ETA 와 ' +
    '기간별 입고 계획을, 주지 않으면 입고예정이 있는 품목을 최대 20건 냅니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: { ...ITEM_ID },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const itemId = argText(args, 'itemId');

    if (!itemId) {
      const { getPurchaseRecommendations } = await import('../recommendation.ts');
      const { rows, error } = await getPurchaseRecommendations();
      if (error) return fail(`입고 예정 조회에 실패했습니다: ${error}`);

      const picked = rows
        .filter((row) => row.incomingQty !== null && row.incomingQty > 0)
        .slice(0, 20);
      if (picked.length === 0) return fail('입고 예정이 있는 품목이 없습니다.');

      const numbers: Record<string, number | null> = { count: picked.length };
      for (const row of picked) {
        put(numbers, row.itemId, {
          incoming_qty: row.incomingQty,
          current_inventory: row.currentInventory,
          available_qty: row.availableQty,
        });
      }
      return ok(
        {
          items: picked.map((row) => ({
            itemId: row.itemId,
            itemName: row.itemName,
            supplierId: row.supplierId,
            incomingQty: row.incomingQty,
            incomingEta: row.incomingEta,
            availableQty: row.availableQty,
          })),
        },
        numbers,
        firstAsOf(picked.map((row) => row.dataSnapshotAt)),
      );
    }

    // 한 품목이면 요약(입고예정 · ETA)과 기간별 입고 계획을 함께 봅니다.
    // 두 값 모두 재고 전개가 쓰는 receipt 와 같은 자리에서 옵니다 (renew.prd 19장).
    const [{ getSkuDetail }, { getInventoryProjection: projection }] = await Promise.all([
      import('../recommendation.ts'),
      import('../inventory.ts'),
    ]);
    const [detail, plan] = await Promise.all([getSkuDetail(itemId), projection(itemId)]);
    if (detail.error) return fail(`입고 예정 조회에 실패했습니다: ${detail.error}`);
    if (!detail.data) return fail(`${itemId} 는 품목 마스터에 없습니다.`);

    const receipts = plan.rows.filter((row) => row.receiptQty !== null && row.receiptQty !== 0);
    const numbers: Record<string, number | null> = {};
    put(numbers, '', {
      incoming_qty: detail.data.incomingQty,
      current_inventory: detail.data.currentInventory,
      receipt_periods: receipts.length,
    });
    for (const row of receipts) put(numbers, row.period, { receipt_qty: row.receiptQty });

    return ok(
      {
        itemId,
        itemName: detail.data.itemName,
        supplierId: detail.data.supplierId,
        incomingQty: detail.data.incomingQty,
        incomingEta: detail.data.incomingEta,
        receipts: receipts.map((row) => ({ period: row.period, receiptQty: row.receiptQty })),
      },
      numbers,
      detail.data.dataSnapshotAt,
    );
  },
};

const getAlerts: AgentTool = {
  name: 'getAlerts',
  description:
    '미해결 알림을 우선순위 순으로 돌려줍니다. severity · type · itemId 로 좁힐 수 있습니다. ' +
    '각 알림에는 사유 · 영향 · 권고 행동이 붙어 있습니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: [],
    properties: {
      severity: {
        type: 'string',
        enum: ['CRITICAL', 'WARNING', 'INFO'],
        description: '심각도 (선택)',
      },
      type: {
        type: 'string',
        description: '탐지 유형 코드 (선택). 예: STOCKOUT_RISK · ORDER_TOO_LATE · EXCESS_INVENTORY',
      },
      ...ITEM_ID,
    },
  },
  roles: ['ADMIN', 'USER'],
  enabled: true,
  async run(args) {
    const severity = argText(args, 'severity');
    const type = argText(args, 'type');
    const itemId = argText(args, 'itemId');

    // 건수는 화면 KPI 카드와 같은 뷰에서 가져옵니다 (analytics.v_alert_kpi).
    const { getAlerts: query, getAlertKpi } = await import('../alerts.ts');
    const [{ rows, error }, kpi] = await Promise.all([query(200), getAlertKpi()]);
    if (error) return fail(`알림 조회에 실패했습니다: ${error}`);

    const picked = rows
      .filter((row) => (severity ? row.severity === severity : true))
      .filter((row) => (type ? row.type === type : true))
      .filter((row) => (itemId ? row.itemId === itemId : true))
      .slice(0, 20);

    const numbers: Record<string, number | null> = {
      count: picked.length,
      open: kpi.data?.open ?? null,
      critical: kpi.data?.critical ?? null,
      warning: kpi.data?.warning ?? null,
      info: kpi.data?.info ?? null,
      unacknowledged: kpi.data?.unacknowledged ?? null,
    };
    for (const row of picked) {
      put(numbers, String(row.alertId), {
        priority_score: row.priorityScore,
        age_hours: row.ageHours,
      });
    }

    return ok(
      {
        alerts: picked.map((row) => ({
          alertId: row.alertId,
          type: row.type,
          typeLabel: row.typeLabel,
          severity: row.severity,
          itemId: row.itemId,
          itemName: row.itemName,
          supplierId: row.supplierId,
          reason: row.reason,
          impact: row.impact,
          recommendedAction: row.recommendedAction,
          detectedAt: row.detectedAt,
          isAcknowledged: row.isAcknowledged,
        })),
        summary: kpi.data,
      },
      numbers,
      firstAsOf(picked.map((row) => row.lastSeenAt ?? row.detectedAt)),
    );
  },
};

/**
 * 시나리오 시뮬레이션 — STEP 18 (renew.prd 25장).
 *
 * ★ 여기서 계산하지 않습니다. 화면(app/(user)/what-if)이 쓰는 것과 **똑같은**
 *   lib/what-if.ts 의 runWhatIf 를 부릅니다 (renew.prd 32 — 두 경로가 같은 숫자를 내야 합니다).
 *   그 함수는 core.simulate_scenario · core.simulate_scenario_summary 를 부르고,
 *   두 함수 모두 `stable` 이라 실제 데이터를 바꾸지 못합니다 (renew.prd 25.2).
 *
 * ★ 영업 묶음에 넣지 않았습니다(group 미지정 = SCM). 리드타임 통계와 발주 수량이
 *   결과에 들어가기 때문입니다 (renew.prd 4.5). DB 함수도 core.is_sales() 를 막습니다.
 */
const simulateScenario: AgentTool = {
  name: 'simulateScenario',
  description:
    '가정을 바꿔 재고 전개 · 결품 예상일 · 안전재고 · 발주 수량을 다시 계산해 ' +
    '기준(Base)과 나란히 돌려줍니다. 실제 데이터는 바뀌지 않습니다. ' +
    '파라미터는 준 것만 적용되고, 주지 않은 것은 기준과 같습니다.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['itemId'],
    properties: {
      ...ITEM_ID,
      // ★ 키 이름은 sql/24-what-if.sql 의 p_params · lib/what-if-model.ts 와 같습니다.
      //   화면 · AI · URL · DB 가 같은 이름을 써야 두 경로의 숫자가 갈리지 않습니다
      //   (renew.prd 32).
      demand_pct: { type: 'number', description: '수요 증감 %. +20 / -20' },
      lead_time_days: { type: 'number', description: '리드타임 절대값 (일)' },
      lead_time_pct: { type: 'number', description: '리드타임 증감 %. 두 배면 100' },
      open_po_delay_days: { type: 'number', description: '입고예정 지연 (일)' },
      service_level: { type: 'number', description: '서비스 수준 비율. 95% 면 0.95' },
      supplier_unavailable: { type: 'boolean', description: '공급처를 쓸 수 없으면 true' },
      extra_order_qty: { type: 'number', description: '추가 계약 수량' },
      extra_order_period: { type: 'string', description: "추가 계약 기간 'YYYY-MM'" },
      promotion_pct: { type: 'number', description: '프로모션 증감 %' },
      promotion_period: { type: 'string', description: "프로모션 기간 'YYYY-MM'" },
    },
  },
  roles: ['ADMIN', 'USER'],
  // STEP 18 에서 켰습니다. 화면과 같은 lib 함수(runWhatIf)를 부릅니다.
  enabled: true,
  async run(args) {
    const itemId = argText(args, 'itemId');
    if (!itemId) return fail('품목코드가 필요합니다.');

    // ★ 순수 모듈(what-if-model)을 먼저 부릅니다. 조회 모듈(what-if)은 Supabase 클라이언트를
    //   달고 오므로, 가정이 비었을 때까지 그것을 부르면 node --test 가 모듈 해석에서
    //   죽습니다 (error.md #17). 인자 검사가 끝난 뒤에만 조회 모듈을 부릅니다.
    const { parseParams } = await import('../what-if-model.ts');

    // itemId 는 파라미터가 아닙니다. 넘기면 parseParams 가 모르는 키로 보고 무시 목록에 담습니다.
    const { itemId: _omit, ...rest } = args as Record<string, unknown>;
    void _omit;
    const { params, ignored } = parseParams(rest);

    if (Object.keys(params).length === 0) {
      return fail('바꿀 가정이 없습니다. 수요 · 리드타임 · 입고 지연 같은 파라미터를 하나 이상 주세요.');
    }

    const { runWhatIf } = await import('../what-if.ts');
    const { series, summary, error } = await runWhatIf(itemId, params);
    if (error) return fail(`시뮬레이션에 실패했습니다: ${error}`);
    if (!summary || !summary.found) return fail(`품목 ${itemId} 을(를) 찾을 수 없습니다.`);

    // Guardrail 은 여기 있는 값만 답변에 허용합니다 (renew.prd 26.3).
    // 그래서 "화면에 보일 법한 값" 이 아니라 두 쪽의 모든 수치를 넣습니다.
    const numbers: Record<string, number | null> = { periods: series.length };
    for (const side of [
      { name: 'base', value: summary.base },
      { name: 'scenario', value: summary.scenario },
    ]) {
      put(numbers, side.name, {
        stockout_days: side.value.stockoutDays,
        safety_stock: side.value.safetyStock,
        order_qty: side.value.orderQty,
        raw_order_qty: side.value.rawOrderQty,
        lead_time_days: side.value.leadTimeDays,
        service_level: side.value.serviceLevel,
        z_value: side.value.zValue,
        window_demand_qty: side.value.windowDemandQty,
        daily_demand: side.value.dailyDemand,
        sigma_dlt: side.value.sigmaDlt,
        current_stock: side.value.currentStock,
        incoming_qty: side.value.incomingQty,
        moq: side.value.moq,
        pack_size: side.value.packSize,
      });
    }
    put(numbers, 'delta', {
      stockout_days:
        summary.base.stockoutDays === null || summary.scenario.stockoutDays === null
          ? null
          : summary.scenario.stockoutDays - summary.base.stockoutDays,
      safety_stock:
        summary.base.safetyStock === null || summary.scenario.safetyStock === null
          ? null
          : summary.scenario.safetyStock - summary.base.safetyStock,
      order_qty:
        summary.base.orderQty === null || summary.scenario.orderQty === null
          ? null
          : summary.scenario.orderQty - summary.base.orderQty,
    });
    for (const point of series) {
      put(numbers, point.period.slice(0, 7), {
        base_closing: point.baseClosing,
        scenario_closing: point.scenarioClosing,
        base_demand: point.baseDemand,
        scenario_demand: point.scenarioDemand,
        base_receipt: point.baseReceipt,
        scenario_receipt: point.scenarioReceipt,
      });
    }

    // 날짜도 검사 대상입니다 (lib/agent/guardrail.ts 의 날짜 절).
    //
    // ★ 전개 기간(series[].period)까지 넣습니다. 여기를 비워 두면 안 됩니다 —
    //   dates 가 비어 있지 않은 순간 Guardrail 은 답변의 **모든** 날짜를 이 목록과
    //   대조하므로, 모델이 전개 한 줄을 "2026-11-01 에 마이너스가 됩니다" 처럼
    //   인용하면 없는 날짜로 몰려 답변이 통째로 다시 만들어집니다.
    //   기간은 우리가 준 값이지 지어낸 값이 아닙니다.
    const dates = [
      summary.base.stockoutDate,
      summary.base.requiredOrderDate,
      summary.scenario.stockoutDate,
      summary.scenario.requiredOrderDate,
      ...series.map((point) => point.period),
    ].filter((value): value is string => typeof value === 'string' && value !== '');

    return {
      ok: true,
      data: {
        itemId: summary.itemId,
        itemName: summary.itemName,
        paramsApplied: summary.paramsApplied,
        ignoredParams: [...ignored, ...summary.ignored],
        base: summary.base,
        scenario: summary.scenario,
        series,
        note: '시뮬레이션 결과입니다. 실제 데이터는 바뀌지 않았습니다.',
      },
      numbers,
      dataAsOf: summary.dataSnapshotAt,
      dates,
    };
  },
};

// ── 레지스트리 ────────────────────────────────────────────────

const registry: AgentTool[] = [
  getDemandForecast,
  getForecastAccuracy,
  getInventoryProjection,
  getStockoutRisk,
  getLeadtimeStats,
  getSafetyStock,
  calcOrderQuantity,
  getOpenPO,
  getAlerts,
  simulateScenario,
];

/**
 * 등록된 툴 전부 (숨긴 것 포함).
 *
 * 배열 복사본을 돌려줍니다. 부르는 쪽이 밀어 넣어도 레지스트리가 바뀌지 않게 하려는 것입니다.
 */
export function allTools(): AgentTool[] {
  return [...registry];
}

/**
 * 툴을 더합니다 — STEP 17 · 18 확장점.
 *
 * 같은 이름이 이미 있으면 거절합니다. 조용히 덮어쓰면 어느 쪽이 실행되는지 알 수 없습니다.
 * 일부러 갈아 끼울 때는 replaceTool 을 쓰세요.
 */
export function registerTool(tool: AgentTool): void {
  if (registry.some((item) => item.name === tool.name)) {
    throw new Error(`이미 등록된 툴입니다: ${tool.name}`);
  }
  registry.push(tool);
}

/** 같은 이름의 툴을 갈아 끼웁니다 (STEP 18 의 simulateScenario) */
export function replaceTool(tool: AgentTool): void {
  const index = registry.findIndex((item) => item.name === tool.name);
  if (index === -1) throw new Error(`등록되지 않은 툴입니다: ${tool.name}`);
  registry[index] = tool;
}

export function findTool(name: string): AgentTool | null {
  return registry.find((item) => item.name === name) ?? null;
}

/** 이 툴이 속한 묶음. 적지 않았으면 SCM 입니다 */
export function groupOf(tool: AgentTool): ToolGroup {
  return tool.group ?? 'SCM';
}

/**
 * 이 역할이 부를 수 있는 툴 — renew.prd 26.2 "Role 에 따라 호출 가능한 Tool 집합이 달라진다".
 *
 * 오케스트레이터(서버)가 이 함수로 거릅니다. 화면에서 거르지 않습니다 —
 * 액션은 URL 만 알면 부를 수 있기 때문입니다 (AGENTS.md 규칙 8).
 *
 * group 을 주지 않으면 SCM 묶음입니다. 영업 사용자에게는 오케스트레이터가
 * 'SALES' 를 넘겨 6종만 노출합니다 (renew.prd 4.5).
 */
export function toolsFor(role: ToolRole, group: ToolGroup = 'SCM'): AgentTool[] {
  return registry.filter(
    (tool) => tool.enabled && tool.roles.includes(role) && groupOf(tool) === group,
  );
}

/** OpenAI 호환 `tools` 배열로 바꿉니다 */
export function toOpenAiTools(tools: AgentTool[]): {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchemaObject };
}[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}
