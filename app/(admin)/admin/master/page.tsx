// Phase 1 · 마스터 화면 — refactor.md Phase 1
//
// ★ 이 화면의 목적 절반은 "아직 못 받은 값이 몇 건인지" 를 보이는 것입니다.
//   빈 칸을 0 으로 채워 그럴듯하게 보이면 데이터가 없다는 사실이 묻힙니다.

import PageHeader from '@/components/shell/page-header';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import KpiCard from '@/components/ui/kpi-card';
import Badge from '@/components/ui/badge';
import { departureLabel, type ItemPolicy, type Supplier, type SupplierDeparture, type SupplyEntity } from '@/lib/master-model';
import { getItemPolicies, getMasterReadiness, getSupplierDepartures, getSuppliers, getSupplyEntities } from '@/lib/master';

export const dynamic = 'force-dynamic';

function period(from: string | null, to: string | null) {
  if (!from && !to) return <span className="muted">제한 없음</span>;
  return <span className="muted">{from ?? '—'} ~ {to ?? '—'}</span>;
}

const entityColumns: Column<SupplyEntity>[] = [
  { key: 'entityId', label: '법인', render: (row) => <><b>{row.entityName}</b><br /><span className="muted">{row.entityId} · {row.countryCode}</span></> },
  {
    key: 'prepDays', label: '출항 준비기간', align: 'right',
    render: (row) => row.reasonCode === 'PREP_DAYS_UNSET'
      ? <EmptyValue reasonCode="PREP_DAYS_UNSET" />
      : <>{row.prepDays}<span className="muted"> 일</span></>,
  },
  { key: 'activeSupplierCount', label: '활성 공급처', align: 'right', render: (row) => row.activeSupplierCount.toLocaleString('ko-KR') },
  { key: 'validFrom', label: '적용 기간', render: (row) => period(row.validFrom, row.validTo) },
  { key: 'active', label: '상태', align: 'center', render: (row) => row.active ? <Badge status="SAFE">활성</Badge> : <span className="muted">비활성</span> },
];

const supplierColumns: Column<Supplier>[] = [
  { key: 'supplierId', label: '공급처', render: (row) => <><b>{row.supplierName}</b><br /><span className="muted">{row.supplierId}</span></> },
  { key: 'entityName', label: '소속 법인', render: (row) => row.entityName ?? <EmptyValue reasonCode="ENTITY_UNSET" /> },
  {
    key: 'leadTimeDays', label: '리드타임', align: 'right',
    render: (row) => row.leadTimeDays === null
      ? <EmptyValue reasonCode="LEADTIME_UNSET" />
      : <>{row.leadTimeDays}<span className="muted"> 일</span></>,
  },
  { key: 'departureRuleCount', label: '출항일 규칙', align: 'right', render: (row) => row.departureRuleCount === 0 ? <EmptyValue reasonCode="NO_DEPARTURE_RULE" /> : `${row.departureRuleCount}건` },
  { key: 'validFrom', label: '적용 기간', render: (row) => period(row.validFrom, row.validTo) },
  { key: 'active', label: '상태', align: 'center', render: (row) => row.active ? <Badge status="SAFE">활성</Badge> : <span className="muted">비활성</span> },
];

const departureColumns: Column<SupplierDeparture>[] = [
  { key: 'supplierName', label: '공급처', render: (row) => <><b>{row.supplierName}</b><br /><span className="muted">{row.supplierId}</span></> },
  { key: 'weekday', label: '출항 규칙', render: (row) => departureLabel(row) },
  { key: 'validFrom', label: '적용 기간', render: (row) => period(row.validFrom, row.validTo) },
  { key: 'note', label: '비고', render: (row) => row.note ?? <span className="muted">—</span> },
];

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
  const [entities, suppliers, departures, policies, readiness] = await Promise.all([
    getSupplyEntities(), getSuppliers(), getSupplierDepartures(), getItemPolicies(), getMasterReadiness(),
  ]);
  const failure = entities.error ?? suppliers.error ?? departures.error ?? policies.error ?? readiness.error;

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
          <KpiCard label="영업일 달력" value={r?.calendarDays ?? 0} foot={r && r.calendarDays === 0 ? '공휴일 자료 없음 — 주말만 판정' : '공휴일 반영 중'} status={r && r.calendarDays === 0 ? 'CALCULATION_UNAVAILABLE' : 'SAFE'} />
          <KpiCard label="발주 확정 차단" value={r?.targetDosUnset ?? 0} foot={`목표 DoS 미설정 (전체 ${r?.itemPolicies ?? 0})`} status={r && r.targetDosUnset > 0 ? 'CRITICAL' : 'SAFE'} />
        </div>

        <div className="section card">
          <div className="card-title"><div><h3>해외법인</h3><span>발주일 = 공급처 출항일 − 출항 준비기간</span></div></div>
          <DataTable columns={entityColumns} rows={entities.rows} rowKey={(row) => row.entityId} empty="법인이 없습니다." />
        </div>

        <div className="section card">
          <div className="card-title"><div><h3>공급처</h3><span>리드타임은 예측 조정 범위의 시작 월을 정합니다</span></div></div>
          <DataTable columns={supplierColumns} rows={suppliers.rows} rowKey={(row) => row.supplierId} empty="공급처가 없습니다. 현업 자료를 받아 등록하세요." />
        </div>

        <div className="section card">
          <div className="card-title"><div><h3>출항일 규칙</h3><span>출항일을 주차별로 묶어 발주합니다</span></div></div>
          <DataTable columns={departureColumns} rows={departures.rows} rowKey={(row) => String(row.departureId)} empty="출항일 규칙이 없습니다." />
        </div>

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
      </div>
    </section>
  );
}
