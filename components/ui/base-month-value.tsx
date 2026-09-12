// 운영 기준월 표시 — Topbar · Sidebar · 대시보드 KPI 카드가 공유한다 (Task 12 fix round 1)
//
// ★ lib/kpi/model.ts의 resolveBaseMonthDisplay가 판정한 세 상태를 그대로 구분해서 보여준다.
//   1) formatted가 있다 — 정상 기준월.
//   2) reasonCode = PLANNING_CYCLE_LOOKUP_FAILED — 조회 자체가 실패한 시스템 오류다. 다른
//      계산 불가(EmptyValue)와 같은 회색 처리로 두면 "취합 주기가 없나 보다"로 오해하기 쉬워
//      경고색(text-danger)과 "조회 실패" 문구로 눈에 띄게 구분한다.
//   3) 그 밖의 사유(PLANNING_CYCLE_NOT_OPEN 등) — 정상적인 업무 상태이므로 기존 EmptyValue로 표시한다.

import EmptyValue from './empty-value';
import { BASE_MONTH_LOOKUP_FAILED } from '@/lib/kpi/model';

export default function BaseMonthValue({
  formatted,
  reasonCode,
  suffix = '',
}: {
  formatted: string | null;
  reasonCode: string | null;
  suffix?: string;
}) {
  if (formatted !== null) return <>{formatted}{suffix}</>;
  if (reasonCode === BASE_MONTH_LOOKUP_FAILED) {
    return <span className="text-danger" title={reasonCode}>조회 실패</span>;
  }
  return <EmptyValue reasonCode={reasonCode ?? 'PLANNING_CYCLE_NOT_OPEN'} />;
}
