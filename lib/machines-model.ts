// 기종 — 순수 타입 · 정규화 (실데이터 전환 Plan 3)

import { bool, count, num, text } from './dashboard-model.ts';

export type MachineRow = { itemId: string; itemName: string | null; family: string | null; nActualMonths: number };

export function normalizeMachine(row: Record<string, unknown>): MachineRow {
  return {
    itemId: text(row.item_id) ?? '',
    itemName: text(row.item_name),
    family: text(row.family),
    nActualMonths: count(row.n_actual_months) ?? 0,
  };
}

export type MachinePlanActualRow = {
  itemId: string;
  modelBase: string | null;
  /** YYYY-MM */
  period: string;
  salesOl: number | null;
  scmOl: number | null;
  act: number | null;
};

export function normalizeMachinePlanActual(row: Record<string, unknown>): MachinePlanActualRow {
  return {
    itemId: text(row.item_id) ?? '',
    modelBase: text(row.model_base),
    period: (text(row.period) ?? '').slice(0, 7),
    salesOl: num(row.sales_ol),
    scmOl: num(row.scm_ol),
    act: num(row.act),
  };
}

export type MachineBomRow = {
  modelBase: string;
  machineId: string;
  role: string;
  itemId: string;
  itemName: string | null;
  itemType: string | null;
  qtyPerUnit: number | null;
  isCommon: boolean;
  nModels: number | null;
  machineH: number | null;
  dependentH: number | null;
  independentH: number | null;
  gapH: number | null;
  reasonCode: string | null;
};

export function normalizeMachineBom(row: Record<string, unknown>): MachineBomRow {
  return {
    modelBase: text(row.model_base) ?? '',
    machineId: text(row.machine_id) ?? '',
    role: text(row.role) ?? 'BOM',
    itemId: text(row.item_id) ?? '',
    itemName: text(row.item_name),
    itemType: text(row.item_type),
    qtyPerUnit: num(row.qty_per_unit),
    isCommon: bool(row.is_common) === true,
    nModels: count(row.n_models),
    machineH: num(row.machine_h),
    dependentH: num(row.dependent_h),
    independentH: num(row.independent_h),
    gapH: num(row.gap_h),
    reasonCode: text(row.reason_code),
  };
}

export const ROLE_LABEL: Record<string, string> = {
  CAP: 'CAP (주문 단위)',
  NEUTRAL: 'Neutral 본체',
  MUST_OPTION: '필수 옵션',
  SCC_LABEL: 'SCC · 라벨',
  BOM: 'BOM 구성',
};

export type DemandCompareRow = {
  itemId: string;
  period: string;
  actualQty: number | null;
  independentQty: number | null;
  independentModel: string | null;
  dependentQty: number | null;
  nMachines: number | null;
  isCommon: boolean | null;
};

export function normalizeDemandCompare(row: Record<string, unknown>): DemandCompareRow {
  return {
    itemId: text(row.item_id) ?? '',
    period: (text(row.period) ?? '').slice(0, 7),
    actualQty: num(row.actual_qty),
    independentQty: num(row.independent_qty),
    independentModel: text(row.independent_model),
    dependentQty: num(row.dependent_qty),
    nMachines: count(row.n_machines),
    isCommon: bool(row.is_common),
  };
}

/** 기종 화면 · 모델 비교 오버레이가 쓰는 가상 모델 ID — 사람의 예측과 종속수요 */
export const SALES_OL_MODEL = 'SALES_OL';
export const SCM_OL_MODEL = 'SCM_OL';
export const DEPENDENT_MODEL = 'DEPENDENT_BOM';
