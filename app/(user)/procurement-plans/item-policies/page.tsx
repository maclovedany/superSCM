// 품목 정책 화면 — Task 9a
//
// ★ 승인·반려 액션은 여기 두지 않는다. 공통 승인함(/approvals)이 core.decide_approval(ITEM_POLICY)을
//   그대로 처리한다 — 이 화면은 변경안 제출과 현재 운영값 · 이력 조회만 담당한다.

import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import DataTable, { type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import Badge from '@/components/ui/badge';
import ItemPolicyChangeForm from '@/components/procurement/item-policy-form';
import ItemPolicyRevisionTable from '@/components/procurement/item-policy-revision-table';
import { getPermissions, requireAnyPermission } from '@/lib/auth';
import { WORK_ROUTE_PERMISSIONS } from '@/lib/permission';
import { getItemPolicies, getItemPolicyRevisions } from '@/lib/item-policy/repository';
import type { ItemPolicy } from '@/lib/item-policy/model';

export const dynamic = 'force-dynamic';

function formatQty(value: number | null): string | null {
  return value === null ? null : value.toLocaleString('ko-KR');
}

const policyColumns: Column<ItemPolicy>[] = [
  { key: 'itemId', label: '품목' },
  {
    key: 'targetDosDays', label: '목표 DoS(운영값)', align: 'right',
    render: (row) => row.targetDosDays === null ? <EmptyValue reasonCode="TARGET_DOS_UNSET" /> : <>{row.targetDosDays}<span className="muted"> 일</span></>,
  },
  {
    key: 'targetDosApproved', label: '목표 DoS 승인', align: 'center',
    render: (row) => row.targetDosApproved ? <Badge status="SAFE">승인됨</Badge> : <Badge status="CRITICAL">미승인</Badge>,
  },
  {
    key: 'allocationMode', label: '배정 방식', align: 'center',
    render: (row) => row.allocationMode === 'MANUAL' ? <Badge status="WARNING">수동</Badge> : <Badge status="SAFE">자동</Badge>,
  },
  { key: 'targetStockQty', label: '목표 재고', align: 'right', render: (row) => formatQty(row.targetStockQty) ?? <EmptyValue reasonCode="TARGET_STOCK_UNSET" /> },
  { key: 'unitPrice', label: '단가', align: 'right', render: (row) => formatQty(row.unitPrice) ?? <EmptyValue reasonCode="UNIT_PRICE_UNSET" /> },
  {
    key: 'effectiveMoq', label: 'MOQ(계산 적용)', align: 'right',
    render: (row) => row.moq === null
      ? <span title="미설정이라 1로 적용합니다">1 <span className="muted">(기본)</span></span>
      : formatQty(row.moq),
  },
  { key: 'packSize', label: '포장단위', align: 'right', render: (row) => formatQty(row.packSize) ?? <span className="muted">— (저장만)</span> },
  { key: 'minOrderAmount', label: '최소주문금액', align: 'right', render: (row) => formatQty(row.minOrderAmount) ?? <span className="muted">— (저장만)</span> },
];

export default async function ItemPoliciesPage() {
  const current = await requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/procurement-plans/item-policies']);
  const permissions = await getPermissions();

  const [{ rows: policies, error: policyError }, { rows: revisions, error: revisionError }] = await Promise.all([
    getItemPolicies(),
    getItemPolicyRevisions(),
  ]);

  return (
    <section className="analysis-page">
      <PageHeader
        eyebrow="WORK"
        title="품목 정책"
        description="목표 DoS · 배정 방식 · 목표재고 · 단가 · MOQ 변경안을 제출하고, SCM팀장 승인 전까지는 기존 운영값을 그대로 씁니다."
      />
      <div className="analysis-content">
        {permissions.has('ITEM_POLICY_EDIT') ? (
          <Panel title="품목 정책 변경 요청" description="제출과 동시에 SCM팀장에게 승인을 요청합니다. 승인 또는 반려는 승인함(/approvals)에서 처리합니다.">
            <ItemPolicyChangeForm />
          </Panel>
        ) : null}

        <Panel title="현재 운영값" description="목표 DoS가 승인 이력 없이 비어 있으면 발주 확정을 차단합니다.">
          {policyError ? (
            <>
              <p className="text-danger">조회에 실패했습니다.</p>
              <p className="muted">{policyError}</p>
            </>
          ) : (
            <DataTable columns={policyColumns} rows={policies} rowKey={(row) => row.itemId} empty="품목 정책이 없습니다." />
          )}
        </Panel>

        <Panel title="변경 요청 이력" description="대기 · 승인 · 반려 · 취소 전체 이력입니다. 반려·취소되면 기존 운영값이 유지된 채로 사유만 남습니다. 대기 중인 자신의 변경안은 취소할 수 있습니다.">
          {revisionError ? (
            <>
              <p className="text-danger">조회에 실패했습니다.</p>
              <p className="muted">{revisionError}</p>
            </>
          ) : (
            <ItemPolicyRevisionTable rows={revisions} currentUserId={current.profile.userId} />
          )}
        </Panel>
      </div>
    </section>
  );
}
