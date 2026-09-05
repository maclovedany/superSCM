// 이상치 규칙 — renew.prd 12.3
//
// "프로젝트성 대량 출고 · 반품(음수) · 중복 입력을 학습에서 제외한다.
//  규칙은 core 테이블로 관리하고 코드에 하드코딩하지 않는다."
//
// 규칙(core.outlier_rule)은 "무엇을 뺄 것인가" 를 정하고,
// 제외 목록(core.outlier_exclusion)은 "실제로 무엇을 뺐는가" 입니다.
// 학습 뷰(core.v_train_demand · core.v_production_demand)가 보는 것은 제외 목록입니다.
//
// kpi-filter: 사용 규칙 · 중지 규칙만 목록을 좁힙니다. "제외 행" 카드는 아래 두 번째
// 표(제외 목록)의 지표라 첫 표를 좁힐 수 없어 filter 를 주지 않습니다 (design.md §6.4).

import { Ban, ListFilter, Scissors, ShieldCheck } from 'lucide-react';
import { kstMinute } from '@/lib/time';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { requireAdmin } from '@/lib/auth';
import {
  getOutlierExclusions,
  getOutlierRules,
  outlierReasonLabel,
  type OutlierExclusionRow,
  type OutlierRuleRow,
} from '@/lib/admin-ops';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import RuleToggleForm from './rule-toggle-form';
import ExclusionForm from './exclusion-form';
import ExclusionRemoveForm from './exclusion-remove-form';

export const dynamic = 'force-dynamic';

/** KPI 카드 하나 = 목록 필터 하나 (design.md §6.4) */
const FILTERS: FilterSpec<OutlierRuleRow>[] = [
  { key: 'all', label: '전체 규칙', match: null },
  { key: 'active', label: '사용 중인 규칙', match: (row) => row.active === true },
  { key: 'inactive', label: '중지된 규칙', match: (row) => row.active === false },
];

function ruleColumns(canEdit: boolean): Column<OutlierRuleRow>[] {
  return [
    {
      key: 'ruleType',
      label: '규칙',
      render: (row) => (
        <>
          <span className="cell-strong">{outlierReasonLabel(row.ruleType) ?? '—'}</span>
          {row.ruleType && <div className="t-code text-3">{row.ruleType}</div>}
        </>
      ),
    },
    {
      key: 'scope',
      label: '적용 범위',
      render: (row) =>
        row.scope === 'ITEM' ? (
          <>
            품목 <span className="t-code">{row.itemId ?? '—'}</span>
            {row.itemName && <div className="t-sm text-3">{row.itemName}</div>}
          </>
        ) : (
          '전체 품목'
        ),
    },
    {
      key: 'threshold',
      label: '기준값',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.threshold === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          formatNumber(row.threshold)
        ),
    },
    {
      key: 'exclusionCount',
      label: '제외한 행',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.exclusionCount === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          formatNumber(row.exclusionCount, '건')
        ),
    },
    { key: 'note', label: '설명', render: (row) => row.note ?? <span className="text-3">—</span> },
    {
      key: 'active',
      label: '사용',
      render: (row) =>
        canEdit && row.ruleId !== null ? (
          <RuleToggleForm ruleId={row.ruleId} active={row.active === true} />
        ) : (
          <Badge tone={row.active === true ? 'safe' : 'plain'}>
            {row.active === true ? '사용' : '중지'}
          </Badge>
        ),
    },
  ];
}

function exclusionColumns(canEdit: boolean): Column<OutlierExclusionRow>[] {
  return [
    {
      key: 'itemId',
      label: '품목',
      render: (row) => (
        <>
          <span className="t-code">{row.itemId ?? '—'}</span>
          {row.itemName && <div className="t-sm text-3">{row.itemName}</div>}
        </>
      ),
    },
    { key: 'useDate', label: '날짜', align: 'right', variant: 'num', render: (row) => row.useDate ?? '—' },
    {
      key: 'excludedQty',
      label: '뺀 수량',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.excludedQty === null ? (
          // 그날 그 품목의 원본 실적이 없습니다 — 뺀 것이 없다는 뜻입니다.
          <EmptyValue align="right" reason="NO_USAGE_HISTORY" showLabel={false} />
        ) : (
          formatNumber(row.excludedQty)
        ),
    },
    {
      key: 'reason',
      label: '사유',
      render: (row) => (
        <Badge tone={row.reasonCode === 'MANUAL' ? 'info' : 'plain'}>
          {row.reasonLabel ?? outlierReasonLabel(row.reasonCode) ?? '—'}
        </Badge>
      ),
    },
    { key: 'note', label: '메모', render: (row) => row.note ?? <span className="text-3">—</span> },
    {
      key: 'excludedEmail',
      label: '뺀 사람',
      render: (row) => row.excludedEmail?.split('@')[0] ?? <span className="text-3">규칙</span>,
    },
    {
      key: 'excludedAt',
      label: '뺀 시각',
      align: 'right',
      variant: 'num',
      render: (row) => (row.excludedAt ? kstMinute(row.excludedAt) : '—'),
    },
    ...(canEdit
      ? [
          {
            key: 'undo',
            label: '',
            render: (row: OutlierExclusionRow) =>
              row.itemId && row.useDate && row.reasonCode ? (
                <ExclusionRemoveForm
                  itemId={row.itemId}
                  useDate={row.useDate}
                  reasonCode={row.reasonCode}
                />
              ) : null,
          } satisfies Column<OutlierExclusionRow>,
        ]
      : []),
  ];
}

export default async function OutlierPolicyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const admin = await requireAdmin();
  const canEdit = admin !== null;

  const activeFilter = readFilter(await searchParams);
  const [{ rows: rules, error: ruleError }, { rows: exclusions, error: exclusionError }] =
    await Promise.all([getOutlierRules(), getOutlierExclusions()]);

  const header = (
    <PageHeader
      title="이상치 규칙"
      subtitle="학습에서 뺄 데이터를 정합니다. 규칙은 표로 관리하고 코드에 적지 않습니다. 여기서 뺀 행은 다음 예측 실행부터 반영됩니다."
      meta={
        <>
          <MetaChip>PRD 12.3</MetaChip>
          <MetaChip>STEP 20</MetaChip>
        </>
      }
    />
  );

  if (ruleError) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={ruleError} />
        </Panel>
      </>
    );
  }

  const activeRules = rules.filter((row) => row.active === true).length;
  const inactiveRules = rules.filter((row) => row.active === false).length;
  const manual = exclusions.filter((row) => row.reasonCode === 'MANUAL').length;
  const visible = applyFilter(rules, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="전체 규칙"
          value={rules.length}
          unit="개"
          icon={ListFilter}
          foot="core.outlier_rule"
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="사용 중"
          value={activeRules}
          unit="개"
          icon={ShieldCheck}
          foot="학습에서 걸러냅니다"
          filter={{ key: 'active', active: activeFilter === 'active' }}
        />
        <KpiCard
          label="중지"
          value={inactiveRules}
          unit="개"
          icon={Ban}
          tone={inactiveRules > 0 ? 'warn' : 'default'}
          foot="지금은 걸러내지 않습니다"
          filter={{ key: 'inactive', active: activeFilter === 'inactive' }}
        />
        {/* kpi-filter: 없음 — 아래 두 번째 표의 지표라 규칙 목록을 좁힐 수 없습니다 */}
        <KpiCard
          label="제외한 행"
          value={exclusionError === null ? exclusions.length : null}
          unit="건"
          icon={Scissors}
          foot={`이 중 수동 제외 ${manual}건`}
        />
      </div>

      <InsightBanner eyebrow="TRAINING DATA">
        규칙을 껐다 켜는 것만으로는 이미 뺀 행이 돌아오지 않습니다. 학습 뷰가 보는 것은{' '}
        <span className="t-code">core.outlier_exclusion</span> 이기 때문입니다. 한 건을 학습에 되돌리려면
        아래 제외 목록에서 <b>되돌리기</b> 를 누르세요. 어느 쪽이든{' '}
        <b>예측을 다시 돌려야</b> 화면 숫자가 바뀝니다.
      </InsightBanner>

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rules.length} />}

      <Panel title="규칙" flush>
        {rules.length === 0 ? (
          <EmptyState
            title="규칙이 없습니다"
            desc="sql/06-core-extend.sql 을 실행하면 반품 · 프로젝트성 출고 두 규칙이 들어갑니다."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 규칙이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <DataTable
            columns={ruleColumns(canEdit)}
            rows={visible}
            rowKey={(row) => String(row.ruleId ?? row.ruleType)}
            caption="core.outlier_rule — 학습에서 뺄 데이터의 판정 규칙"
          />
        )}
      </Panel>

      {canEdit && (
        <Panel title="수동으로 한 건 빼기">
          <ExclusionForm />
        </Panel>
      )}

      <Panel
        title="제외 목록"
        actions={<span className="t-label">최근 300건</span>}
        flush
      >
        {exclusionError !== null ? (
          <ErrorState detail={exclusionError} />
        ) : exclusions.length === 0 ? (
          <EmptyState
            title="학습에서 뺀 행이 없습니다"
            desc="규칙이 잡은 행이나 위에서 직접 뺀 행이 여기에 쌓입니다."
          />
        ) : (
          <DataTable
            columns={exclusionColumns(canEdit)}
            rows={exclusions}
            rowKey={(row) => `${row.itemId}-${row.useDate}-${row.reasonCode}`}
            caption="core.outlier_exclusion — 학습 뷰가 실제로 빼는 행"
          />
        )}
      </Panel>
    </>
  );
}
