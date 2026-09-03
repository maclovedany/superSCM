// Inbound 응답 조립 — renew.prd 9.1
//
// DB 를 부르는 부분은 lib/api/inbound.ts 에 있습니다. 여기는 순수 함수뿐이라
// node --test 가 그대로 실행합니다 (error.md #17 — 상대 import 에 .ts 를 붙입니다).
//
// ★ 검증 규칙을 여기서 다시 만들지 않습니다. lib/import/validate.ts 가 유일한 검증 경로입니다.
//   이 파일이 하는 일은 그 결과를 renew.prd 9.1 의 응답 모양으로 옮기는 것뿐입니다.

import { TABLE_SPECS, autoMap } from '../import/schema.ts';
import type { DataType, ImportMode, SourceRow, ValidationIssue, ValidationResult } from '../import/types.ts';

/** renew.prd 9.1 의 요청 본문 */
export type InboundRequest = {
  mode: ImportMode;
  strict: boolean;
  data: SourceRow[];
  /**
   * mode: 'replace' 가 지울 기간 — renew.prd 8.4.
   *
   * 기간 기준 컬럼은 데이터 종류가 정합니다(호출자가 고르지 못합니다). 창만 받습니다.
   * replace 가 아니면 둘 다 null 입니다.
   */
  periodFrom: string | null;
  periodTo: string | null;
};

/** renew.prd 9.1 의 오류 한 건 */
export type InboundError = {
  /** data 배열의 위치(0부터). 파일 단위 오류는 null 입니다 */
  index: number | null;
  field: string | null;
  message: string;
  code: string;
  severity: 'ERROR' | 'WARNING';
};

/** renew.prd 9.1 의 응답 본문 */
export type InboundResponse = {
  batch_id: string | null;
  received: number;
  accepted: number;
  rejected: number;
  errors: InboundError[];
  /** errors 를 잘랐을 때의 전체 오류 수. 자르지 않았으면 없습니다 */
  errors_total?: number;
};

const MODES: ImportMode[] = ['append', 'replace', 'upsert'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 요청 본문을 읽습니다. 관대하게 받지 않습니다 —
 * 모르는 mode 를 append 로 바꿔 주면 호출자가 실수를 알아채지 못합니다.
 */
export function parseInboundBody(
  body: unknown,
): { ok: true; request: InboundRequest } | { ok: false; message: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: '요청 본문은 { mode, strict, data } 형태의 객체여야 합니다.' };
  }

  const raw = body as Record<string, unknown>;

  if (!Array.isArray(raw.data)) {
    return { ok: false, message: 'data 는 배열이어야 합니다.' };
  }

  for (const row of raw.data) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, message: 'data 의 각 항목은 객체여야 합니다.' };
    }
  }

  const mode = raw.mode === undefined ? 'append' : raw.mode;
  if (typeof mode !== 'string' || MODES.indexOf(mode as ImportMode) < 0) {
    return { ok: false, message: `mode 는 ${MODES.join(' · ')} 중 하나여야 합니다.` };
  }

  if (raw.strict !== undefined && typeof raw.strict !== 'boolean') {
    return { ok: false, message: 'strict 는 true 또는 false 여야 합니다.' };
  }

  // ── replace — 지울 기간을 반드시 받습니다 (renew.prd 8.4) ──
  //
  // 지운 원본은 되돌릴 수 없습니다. `core.rollback_batch` 가 replace 배치의
  // 되돌리기를 거절하는 것과 같은 이유입니다. 파일 업로드는 화면에서 기간을 보여주고
  // 사람이 누르지만, API 에는 그 단계가 없으므로 **호출자가 창을 명시**하게 합니다.
  let periodFrom: string | null = null;
  let periodTo: string | null = null;

  if (mode === 'replace') {
    const from = raw.period_from;
    const to = raw.period_to;

    if (typeof from !== 'string' || !ISO_DATE.test(from) || typeof to !== 'string' || !ISO_DATE.test(to)) {
      return {
        ok: false,
        message:
          "mode: 'replace' 에는 period_from 과 period_to 가 필요합니다 (YYYY-MM-DD). 그 기간의 기존 데이터를 지우고 다시 넣으며, 지운 원본은 되돌릴 수 없습니다.",
      };
    }
    if (from > to) {
      return { ok: false, message: 'period_from 이 period_to 보다 늦습니다.' };
    }

    periodFrom = from;
    periodTo = to;
  } else if (raw.period_from !== undefined || raw.period_to !== undefined) {
    // 조용히 무시하면 "기간을 줬는데 왜 다 지워지지 않지" 가 됩니다.
    return { ok: false, message: "period_from · period_to 는 mode: 'replace' 에서만 씁니다." };
  }

  return {
    ok: true,
    request: {
      mode: mode as ImportMode,
      strict: raw.strict === true,
      data: raw.data as SourceRow[],
      periodFrom,
      periodTo,
    },
  };
}

/**
 * 들어온 행들에 나타난 컬럼 이름을 처음 나온 순서로 모읍니다.
 *
 * API 본문은 이미 논리 필드명을 쓰지만, renew.prd 9.1 의 예시처럼
 * `date` · `quantity` 같은 별칭도 옵니다. 그래서 파일 업로드와 같은 자동 매핑을 태웁니다.
 */
export function collectColumns(rows: SourceRow[]): string[] {
  const seen: string[] = [];
  const known = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        known.add(key);
        seen.push(key);
      }
    }
  }
  return seen;
}

/**
 * 원본 컬럼 → 대상 컬럼. 파일 업로드가 쓰는 autoMap 을 그대로 씁니다.
 * 규칙이 두 벌이 되지 않게 하기 위해서입니다 (renew.prd 9.1).
 *
 * ★ 관리자가 저장해 둔 매핑 규칙(renew.prd 8.2)까지 얹은 것은
 *   `lib/api/validation-context.ts` 의 `buildMappingWithSaved` 입니다.
 *   운영 경로는 그쪽을 씁니다. 이 함수는 그 바탕이자 테스트용입니다.
 */
export function buildMapping(dataType: DataType, rows: SourceRow[]): Record<string, string> {
  return autoMap(TABLE_SPECS[dataType], collectColumns(rows));
}

/**
 * 이 데이터 종류가 마스터 목록을 실제로 참조하는가.
 *
 * `lib/import/validate.ts` 는 `field.references === 'ITEM'` 인 필드가 있을 때만
 * `knownItemIds` 를 봅니다. 그 판정을 여기서 되풀이하지 않고 **같은 표(TABLE_SPECS)**
 * 에 물어봅니다 — 스키마가 바뀌면 이 함수도 따라옵니다.
 */
export function referencedMasters(dataType: DataType): { item: boolean; supplier: boolean } {
  const fields = TABLE_SPECS[dataType].fields;
  return {
    item: fields.some((field) => field.references === 'ITEM'),
    supplier: fields.some((field) => field.references === 'SUPPLIER'),
  };
}

/** 파일(요청) 단위 오류. 이게 있으면 어떤 행도 적재할 수 없습니다 */
export function hasRequestLevelError(result: ValidationResult): boolean {
  return result.issues.some((issue) => issue.rowNumber === 0 && issue.severity === 'ERROR');
}

/**
 * 적재를 막아야 하는가 — renew.prd 9.1 "strict: true 면 전부 거부한다".
 *
 *   · 요청 단위 오류(필수 컬럼 누락 등)가 있으면 strict 와 무관하게 전량 거부입니다.
 *     그 상태로는 "성공한 행" 이 실은 필수 값을 빠뜨린 행이기 때문입니다.
 *   · strict 이면 행 오류가 하나라도 있을 때 전량 거부입니다.
 *   · 그 밖에는 부분 성공입니다.
 */
export function isBlocked(result: ValidationResult, strict: boolean): boolean {
  if (hasRequestLevelError(result)) return true;
  if (strict && result.errorRows > 0) return true;
  return false;
}

/** 적재를 시도할 행 표시. 전량 거부면 한 행도 넣지 않습니다 */
export function stageableRows(result: ValidationResult, strict: boolean): boolean[] {
  return isBlocked(result, strict) ? result.rowValid.map(() => false) : result.rowValid.slice();
}

/**
 * 한 응답에 담을 오류의 상한.
 *
 * 25MB 대량 요청이 전부 틀리면 오류가 수만 건 나옵니다. 그것을 그대로 실어 보내면
 * 응답이 요청보다 커집니다. 잘라도 잃는 것이 없습니다 — 모든 오류는
 * `core.validation_error` 에 남고 관리자 화면(적재 오류)에서 배치 번호로 전부 볼 수 있습니다.
 */
export const MAX_RESPONSE_ERRORS = 1000;

/**
 * 검증 오류 → renew.prd 9.1 의 errors 배열.
 *
 * 심각도 ERROR 를 먼저 담습니다. 잘릴 때 경고가 오류를 밀어내지 않게 하기 위해서입니다.
 */
export function toInboundErrors(issues: ValidationIssue[]): InboundError[] {
  const ordered =
    issues.length <= MAX_RESPONSE_ERRORS
      ? issues
      : issues
          .filter((issue) => issue.severity === 'ERROR')
          .concat(issues.filter((issue) => issue.severity === 'WARNING'))
          .slice(0, MAX_RESPONSE_ERRORS);

  return ordered.map((issue) => ({
    index: issue.rowNumber > 0 ? issue.rowNumber - 1 : null,
    field: issue.column,
    message: issue.message,
    code: issue.code,
    severity: issue.severity,
  }));
}

/**
 * 응답 한 벌.
 *
 * accepted 는 **실제로 적재된 행 수**를 받습니다. 검증이 통과했다고 적재된 것은 아니므로
 * 여기서 successRows 를 그대로 쓰지 않습니다.
 */
export function buildInboundResponse(params: {
  batchId: string | null;
  received: number;
  accepted: number;
  issues: ValidationIssue[];
}): InboundResponse {
  const accepted = Math.max(0, Math.min(params.accepted, params.received));
  const errors = toInboundErrors(params.issues);

  const body: InboundResponse = {
    batch_id: params.batchId,
    received: params.received,
    accepted,
    rejected: params.received - accepted,
    errors,
  };

  // 잘렸을 때만 전체 수를 함께 알려줍니다. 배치 번호로 전부 조회할 수 있습니다.
  if (errors.length < params.issues.length) body.errors_total = params.issues.length;

  return body;
}
