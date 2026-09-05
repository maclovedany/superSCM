// 품목 검색 · 데이터 가용성 — 순수 함수 (실데이터 전환 Plan 3)
//
// 뷰 행 → 화면 모양. 계산하지 않습니다.

import { count, text } from './dashboard-model.ts';

export type ItemHit = {
  itemId: string;
  itemName: string | null;
  itemType: string | null;
  family: string | null;
  isMachine: boolean;
  /** 구코드로 찾았으면 그 코드. 대표코드로 찾았으면 null */
  matchedAlias: string | null;
};

export function normalizeItemHit(row: Record<string, unknown>): ItemHit {
  return {
    itemId: text(row.item_id) ?? '',
    itemName: text(row.item_name),
    itemType: text(row.item_type),
    family: text(row.family),
    isMachine: row.is_machine === true,
    matchedAlias: text(row.matched_alias),
  };
}

/** 검색어 정규화 — core.norm_code 와 같은 규칙(대문자 · 공백 · 하이픈 · 밑줄 제거) */
export function normalizeQuery(q: string): string {
  return q.toUpperCase().replace(/[\s\-_]/g, '');
}

// ── 데이터 가용성 (analytics.v_data_availability) ─────────────

export type DataKind = 'DEMAND' | 'ITEM' | 'INVENTORY' | 'LEADTIME' | 'PRICE';

export type DataAvailability = {
  kind: DataKind;
  nRows: number;
  neededFiles: string | null;
  note: string | null;
};

export function normalizeDataAvailability(row: Record<string, unknown>): DataAvailability {
  const kind = text(row.kind) ?? 'DEMAND';
  return {
    kind: (['DEMAND', 'ITEM', 'INVENTORY', 'LEADTIME', 'PRICE'].includes(kind) ? kind : 'DEMAND') as DataKind,
    nRows: count(row.n_rows) ?? 0,
    neededFiles: text(row.needed_files),
    note: text(row.note),
  };
}

export const DATA_KIND_LABEL: Record<DataKind, string> = {
  DEMAND: '월별 수요',
  ITEM: '품목 마스터',
  INVENTORY: '재고 스냅샷',
  LEADTIME: '공급처 · 발주 · 입고 실적',
  PRICE: '단가 · MOQ',
};

/**
 * 이 화면이 기다리는 데이터 중 아직 없는 것. 비어 있으면 배너를 띄우지 않습니다.
 * 판정은 뷰의 n_rows 하나로 합니다 — 화면마다 따로 세지 않습니다 (AGENTS.md 규칙 1).
 */
export function missingKinds(rows: DataAvailability[], kinds: DataKind[]): DataAvailability[] {
  return kinds
    .map((kind) => rows.find((row) => row.kind === kind))
    .filter((row): row is DataAvailability => row !== undefined && row.nRows === 0);
}

/** 배너 문장. 필요한 파일을 이어 적습니다 */
export function dataWaitSentence(missing: DataAvailability[]): string | null {
  if (missing.length === 0) return null;
  const labels = missing.map((m) => DATA_KIND_LABEL[m.kind]).join(' · ');
  const files = missing
    .map((m) => m.neededFiles)
    .filter((f): f is string => f !== null)
    .join(' · ');
  return `${labels}이(가) 아직 없어 이 화면의 숫자는 산출하지 않았습니다.${files ? ` 필요한 파일: ${files}.` : ''} 데이터가 들어오면 그대로 살아납니다.`;
}
