// Phase 1 · 마스터 화면 — refactor.md Phase 1
//
// ★ 이 화면의 목적 절반은 "아직 못 받은 값이 몇 건인지" 를 보이는 것입니다.
//   빈 칸을 0 으로 채워 그럴듯하게 보이면 데이터가 없다는 사실이 묻힙니다.

import PageHeader from '@/components/shell/page-header';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import KpiCard from '@/components/ui/kpi-card';
import Badge from '@/components/ui/badge';
import SupplyEntitySection from '@/components/admin/master/supply-entity-section';
import SupplierSection from '@/components/admin/master/supplier-section';
import DepartureRuleSection from '@/components/admin/master/departure-rule-section';
import CalendarSection from '@/components/admin/master/calendar-section';
import ChangeHistoryTable from '@/components/admin/master/change-history-table';
import type { ItemPolicy } from '@/lib/master-model';
import {
  getCalendarReadiness,
  getItemPolicies,
  getMasterHistory,
  getMasterReadiness,
  getSupplierDepartures,
  getSuppliers,
  getSupplyEntities,
} from '@/lib/master';

export const dynamic = 'force-dynamic';

const policyColumns: Column<ItemPolicy>[] = [
  { key: 'itemId', label: '품목' },
  {
    key: 'targetDosDays', label: '목표 DoS', align: 'right',
    render: (row) => row.targetDosDays === null
      ? <EmptyValue reasonCode="TARGET_DOS_UNSET" />
      : <>{row.targetDosDays}<span className="muted"> 일</span></>,
  },
  {
    // Task 9a — 값이 있어도 core.item_policy_revision 승인 이력이 없으면 미승인이다(임의로 승인된
    // 것으로 보지 않는다). 변경 요청은 /procurement-plans/item-policies에서 한다(여기는 조회 전용).
    key: 'targetDosApproved', label: '목표 DoS 승인', align: 'center',
    render: (row) => row.targetDosApproved ? <Badge status="SAFE">승인됨</Badge> : <Badge status="CRITICAL">미승인</Badge>,
  },
  {
    key: 'effectiveMoq', label: '최소주문수량', align: 'right',
    render: (row) => row.moq === null
      ? <span title="미설정이라 1 로 적용합니다">1 <span className="muted">(기본)</span></span>
      : row.moq.toLocaleString('ko-KR'),
  },
  { key: 'allocationMode', label: '배정 방식', align: 'center', render: (row) => row.allocationMode === 'MANUAL' ? <Badge status="WARNING">수동</Badge> : <Badge status="SAFE">자동</Badge> },
  { key: 'targetStockQty', label: '목표 재고', align: 'right', render: (row) => row.targetStockQty === null ? <EmptyValue reasonCode="TARGET_STOCK_UNSET" /> : row.targetStockQty.toLocaleString('ko-KR') },
  { key: 'unitPrice', label: '단가', align: 'right', render: (row) => row.unitPrice === null ? <EmptyValue reasonCode="UNIT_PRICE_UNSET" /> : row.unitPrice.toLocaleString('ko-KR') },
  {
    key: 'orderBlocked', label: '발주 확정', align: 'center',
    render: (row) => row.orderBlocked ? <Badge status="CRITICAL">차단</Badge> : <Badge status="SAFE">가능</Badge>,
  },
];

export default async function MasterPage() {
  const [entities, suppliers, departures, policies, readiness, calendarReadiness, history] = await Promise.all([
    getSupplyEntities(), getSuppliers(), getSupplierDepartures(), getItemPolicies(), getMasterReadiness(),
    getCalendarReadiness(), getMasterHistory(),
  ]);
  const failure = entities.error ?? suppliers.error ?? departures.error ?? policies.error ?? readiness.error
    ?? calendarReadiness.error ?? history.error;

  if (failure) {
    return (
      <section className="analysis-page">
        <PageHeader eyebrow="ADMIN" title="마스터" description="해외법인 · 공급처 · 출항일 · 품목 정책" />
        <div className="analysis-content">
          <div className="card">
            <p className="text-danger">조회에 실패했습니다.</p>
            <p className="muted">{failure}</p>
            <p className="muted">STEP 18 마이그레이션(20260911000100_step18_master.sql)이 적용되었는지 확인하세요.</p>
          </div>
        </div>
      </section>
    );
  }

  const r = readiness.data;

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="ADMIN"
        title="마스터"
        description="이후 모든 발주 계산이 참조하는 기준 정보입니다. 비어 있는 값은 채워질 때까지 계산이 멈춥니다."
      />
      <div className="analysis-content">
        <div className="grid grid-4">
          <KpiCard label="해외법인" value={r?.entities ?? 0} foot={r && r.prepDaysUnset > 0 ? `준비기간 미입력 ${r.prepDaysUnset}곳` : '준비기간 모두 입력됨'} status={r && r.prepDaysUnset > 0 ? 'WARNING' : 'SAFE'} />
          <KpiCard label="활성 공급처" value={r?.suppliers ?? 0} foot={r && r.leadtimeUnset > 0 ? `리드타임 미입력 ${r.leadtimeUnset}곳` : '리드타임 모두 입력됨'} status={r && r.leadtimeUnset > 0 ? 'WARNING' : 'SAFE'} />
          <KpiCard label="영업일 달력" value={r?.calendarDays ?? 0} foot={r && r.calendarDays === 0 ? '공휴일 자료 없음 — 주말만 판정' : `준비된 달 ${r?.calendarMonthsReady ?? 0}개`} status={r && r.calendarDays === 0 ? 'CALCULATION_UNAVAILABLE' : 'SAFE'} />
          <KpiCard label="발주 확정 차단" value={r?.targetDosUnset ?? 0} foot={`목표 DoS 미설정 (전체 ${r?.itemPolicies ?? 0})`} status={r && r.targetDosUnset > 0 ? 'CRITICAL' : 'SAFE'} />
        </div>

        <SupplyEntitySection entities={entities.rows} />
        <SupplierSection suppliers={suppliers.rows} entities={entities.rows} />
        <DepartureRuleSection departures={departures.rows} suppliers={suppliers.rows} />
        <CalendarSection readiness={calendarReadiness.rows} />

        <div className="section card">
          <div className="card-title">
            <div>
              <h3>품목 정책</h3>
              <span>목표 DoS 가 승인 이력 없이 비어 있으면 발주 확정을 차단합니다. 최소주문수량이 없으면 1 로 봅니다.
                변경 요청은 발주계획 &gt; 품목 정책(/procurement-plans/item-policies)에서 합니다.</span>
            </div>
          </div>
          <DataTable columns={policyColumns} rows={policies.rows} rowKey={(row) => row.itemId} empty="품목 정책이 없습니다." />
        </div>

        <div className="section card">
          <div className="card-title"><div><h3>변경 이력</h3><span>법인 · 공급처 · 출항일 규칙 · 달력 변경 최근 {history.rows.length}건(before · after · 처리자 · 사유)</span></div></div>
          <ChangeHistoryTable rows={history.rows} />
        </div>
      </div>
    </section>
  );
}
