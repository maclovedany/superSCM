// 서비스 수준 — renew.prd 21.2
//
// 안전재고의 두께를 정하는 Z 가 여기서 나옵니다.
//   ① 품목이 직접 지정한 service_level   → core.z_table 최근접 Z
//   ② 품목 등급                          → core.service_level 의 오늘 이전 최신 행
//   ③ core.policy_config 의 기본값
//
// 값을 바꾸면 화면 코드를 한 줄도 고치지 않고 안전재고와 발주 추천이 즉시 달라집니다.
// 과거 행은 덮어쓰지 않고 오늘 자로 한 행을 더 쌓습니다 — 지난 판정을 재현할 수 있어야 합니다.

import { Info } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import Forbidden from '@/components/ui/forbidden';
import InsightBanner from '@/components/ui/insight-banner';
import { EmptyState, ErrorState } from '@/components/ui/state';
import { requireAdmin } from '@/lib/auth';
import { getItemPolicies, getServiceLevels } from '@/lib/recommendation';
import type { ItemPolicy, ServiceLevel } from '@/lib/recommendation-model';
import ItemPolicyRowForm from './item-policy-row-form';
import ServiceLevelRowForm from './service-level-row-form';

export const dynamic = 'force-dynamic';

const SOURCE_LABEL: Record<string, string> = {
  ITEM: '품목 지정',
  GRADE: '등급',
  DEFAULT: '기본값',
};

function pct(value: number | null): string | null {
  return value === null ? null : `${(value * 100).toFixed(1)}%`;
}

export default async function ServiceLevelPage() {
  // 레이아웃이 이미 막지만 화면에서도 검증합니다 (AGENTS.md 규칙 8).
  const admin = await requireAdmin();
  if (!admin) return <Forbidden role="USER" />;

  const [{ rows: levels, error }, { rows: policies, error: policyError }] = await Promise.all([
    getServiceLevels(),
    getItemPolicies(),
  ]);

  const header = (
    <PageHeader
      title="서비스 수준"
      subtitle="등급별 서비스 수준과 Z 값을 관리합니다. 여기서 값을 바꾸면 화면 코드를 고치지 않아도 안전재고와 발주 추천이 즉시 달라집니다. 과거 값은 지우지 않고 오늘 자로 새 행을 쌓습니다."
      meta={
        <>
          <MetaChip>PRD 21.2</MetaChip>
          <MetaChip>ROLE: ADMIN</MetaChip>
        </>
      }
    />
  );

  if (error) {
    return (
      <>
        {header}
        <Panel>
          <ErrorState detail={error} />
        </Panel>
      </>
    );
  }

  // 어느 행이 지금 적용 중인지는 뷰가 판정합니다 (analytics.v_service_level.is_effective).
  // 화면에서 오늘을 다시 계산하면 앱 서버(UTC)와 DB 의 시간대가 달라 자정 근처에서
  // 하루가 밀립니다. is_urgent 에서 피한 것과 같은 어긋남입니다.
  const appliedRows = levels
    .filter((row) => row.isEffective)
    .sort((a, b) => a.itemGrade.localeCompare(b.itemGrade));

  const levelColumns: Column<ServiceLevel>[] = [
    { key: 'itemGrade', label: '등급', variant: 'strong', render: (row) => row.itemGrade },
    {
      key: 'serviceLevel',
      label: '서비스 수준',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.serviceLevel === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          pct(row.serviceLevel)
        ),
    },
    {
      key: 'zValue',
      label: 'Z',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.zValue === null ? <EmptyValue align="right" showLabel={false} /> : row.zValue.toFixed(4),
    },
    {
      key: 'effectiveFrom',
      label: '적용 시작일',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.effectiveFrom === null ? (
          <EmptyValue align="right" showLabel={false} />
        ) : (
          row.effectiveFrom
        ),
    },
    {
      key: 'status',
      label: '상태',
      render: (row) =>
        row.isEffective ? (
          <Badge tone="safe">적용 중</Badge>
        ) : row.isScheduled ? (
          <Badge tone="info">예정</Badge>
        ) : (
          <span className="text-3">지난 값</span>
        ),
    },
  ];

  const formColumns: Column<ServiceLevel>[] = [
    { key: 'itemGrade', label: '등급', variant: 'strong', render: (row) => row.itemGrade },
    {
      key: 'current',
      label: '지금 적용 중',
      align: 'right',
      variant: 'num',
      render: (row) => (
        <span>
          {row.serviceLevel === null ? '—' : pct(row.serviceLevel)}
          {' · Z '}
          {row.zValue === null ? '—' : row.zValue.toFixed(4)}
        </span>
      ),
    },
    {
      key: 'form',
      label: '새 값 적용 (오늘 자)',
      render: (row) => <ServiceLevelRowForm row={row} />,
    },
  ];

  const policyColumns: Column<ItemPolicy>[] = [
    {
      key: 'item',
      label: '품목',
      variant: 'strong',
      render: (row) => (
        <span style={{ display: 'grid' }}>
          <span>{row.itemName ?? row.itemId}</span>
          <span className="t-code text-3">{row.itemId}</span>
        </span>
      ),
    },
    {
      key: 'itemGrade',
      label: '등급',
      render: (row) =>
        row.itemGrade === null ? <span className="text-3">없음</span> : <Badge>{row.itemGrade}</Badge>,
    },
    {
      key: 'moq',
      label: 'MOQ',
      align: 'right',
      variant: 'num',
      // null 은 "제약 없음" 입니다. 0 으로 채우지 않습니다 (sql/06 의 core.item_policy 주석).
      render: (row) =>
        row.moq === null ? <span className="text-3">제약 없음</span> : formatNumber(row.moq),
    },
    {
      key: 'packSize',
      label: '포장 단위',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.packSize === null ? (
          <span className="text-3">올림 없음</span>
        ) : (
          formatNumber(row.packSize)
        ),
    },
    {
      key: 'itemServiceLevel',
      label: '개별 SL',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.itemServiceLevel === null ? (
          <span className="text-3">등급 따름</span>
        ) : (
          pct(row.itemServiceLevel)
        ),
    },
    {
      key: 'applied',
      label: '적용 SL · Z',
      align: 'right',
      variant: 'num',
      render: (row) =>
        row.appliedZValue === null ? (
          <EmptyValue align="right" reason="INSUFFICIENT_SAMPLE" showLabel={false} />
        ) : (
          <span>
            {pct(row.appliedServiceLevel) ?? '—'} · {row.appliedZValue.toFixed(4)}{' '}
            <Badge tone={row.serviceLevelSource === 'ITEM' ? 'info' : 'plain'}>
              {SOURCE_LABEL[row.serviceLevelSource ?? 'DEFAULT'] ?? '기본값'}
            </Badge>
          </span>
        ),
    },
    {
      key: 'form',
      label: '편집',
      render: (row) => <ItemPolicyRowForm row={row} />,
    },
  ];

  return (
    <>
      {header}

      <InsightBanner eyebrow="SERVICE LEVEL">
        서비스 수준을 올리면 Z 가 커지고 안전재고가 두꺼워집니다. 결품은 줄지만 재고 비용은
        늘어납니다. 등급으로 한 번에 정하고, 특별한 품목만 개별 값으로 덮어쓰는 것이 관리하기
        쉽습니다. 품목이 직접 지정한 값이 언제나 등급보다 우선합니다.
      </InsightBanner>

      <Panel
        title="새 값 적용"
        actions={<span className="t-label">오늘 자로 한 행이 쌓입니다 · 과거 값은 지우지 않습니다</span>}
        flush
      >
        {appliedRows.length === 0 ? (
          <EmptyState
            title="등급 정의가 없습니다"
            desc="sql/16-safety-stock-recommendation.sql 을 실행하면 A · B · C 시드가 들어갑니다."
          />
        ) : (
          <DataTable
            columns={formColumns}
            rows={appliedRows}
            rowKey={(row) => row.itemGrade}
            caption="등급별로 오늘 자 서비스 수준을 적용합니다"
          />
        )}
      </Panel>

      <Panel
        title="등급별 서비스 수준"
        actions={
          <span className="t-label">
            <Info size={12} aria-hidden /> 적용 시작일 최신 순 · 최근 200건
          </span>
        }
        flush
      >
        {levels.length === 0 ? (
          <EmptyState
            title="등록된 서비스 수준이 없습니다"
            desc="sql/16-safety-stock-recommendation.sql 실행 여부를 확인해주세요."
          />
        ) : (
          <DataTable
            columns={levelColumns}
            rows={levels}
            rowKey={(row) => `${row.itemGrade}-${row.effectiveFrom ?? ''}`}
            caption="analytics.v_service_level — 등급별 서비스 수준의 적용 이력"
          />
        )}
      </Panel>

      <Panel
        title="품목 정책"
        actions={<span className="t-label">빈 칸은 "제약 없음" 으로 저장됩니다</span>}
        flush
      >
        {policyError ? (
          <ErrorState detail={policyError} />
        ) : policies.length === 0 ? (
          <EmptyState
            title="품목 정책이 없습니다"
            desc="sql/06-core-extend.sql 이 품목 행을 깔아 둡니다. 실행 여부를 확인해주세요."
          />
        ) : (
          <DataTable
            columns={policyColumns}
            rows={policies}
            rowKey={(row) => row.itemId}
            caption="analytics.v_item_policy — 품목별 MOQ · 포장 단위 · 등급과 적용 중인 Z"
          />
        )}
      </Panel>
    </>
  );
}
