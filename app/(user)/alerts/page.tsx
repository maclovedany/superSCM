// 알림 센터 — renew.prd 24장
//
// 탐지 룰 12종(24.1)과 시스템 알림 1종(8.6 대량 적재)이 만든 알림을 우선순위(24.3)로 정렬해 보여주고,
// 담당자가 확인(24.2)합니다. 스캔은 스케줄러가 6시간마다 돕니다(24.4).
//
// 계산은 전부 core.scan_alerts() 가 끝냈습니다. 이 화면은 조회와 표시만 합니다.

import Link from 'next/link';
import { Bell, BellRing, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import KpiCard from '@/components/ui/kpi-card';
import Panel from '@/components/ui/panel';
import AlertRow from '@/components/ui/alert-row';
import Badge from '@/components/ui/badge';
import DataTable, { type Column } from '@/components/ui/data-table';
import FilterNotice from '@/components/ui/filter-notice';
import InsightBanner from '@/components/ui/insight-banner';
import { ErrorState, EmptyState } from '@/components/ui/state';
import { getSessionUser } from '@/lib/auth';
import { applyFilter, labelOf, readFilter, type FilterSpec, type SearchParams } from '@/lib/filter';
import {
  getAlertHistory,
  getAlertKpi,
  getAlerts,
  alertAgeText,
  ALERT_TYPE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  type AlertHistoryItem,
  type AlertItem,
} from '@/lib/alerts';
import ScanForm from './scan-form';
import ChartFrame from '@/components/chart/_base/chart-frame';
import AlertsTypeMix from '@/components/chart/alerts-type-mix';
import AlertsDaily from '@/components/chart/alerts-daily';
import { getAlertDaily, getAlertTypeMix } from '@/lib/charts';
import { pivotAlertTypeMix } from '@/lib/chart-model';

/** 유형 막대 → 이 화면의 카드 필터. FilterSpec 에 있는 유형 키는 excess 하나입니다 */
const ALERT_TYPE_HREFS: Record<string, string> = { EXCESS_INVENTORY: '?filter=excess' };
import AcknowledgeForm from './acknowledge-form';

export const dynamic = 'force-dynamic';

/**
 * KPI 카드 필터 — design.md §6.4.
 *
 * 심각도 세 개와 확인 여부 하나가 같은 `filter` 파라미터의 서로 다른 key 입니다.
 * 파라미터를 나누면 "위험이면서 미확인" 같은 조합을 만들 수 있게 되는데,
 * 카드 하나에 목록 하나라는 규칙이 흐려집니다.
 */
const FILTERS: FilterSpec<AlertItem>[] = [
  { key: 'all', label: '전체 미해결', match: null },
  { key: 'critical', label: '위험', match: (row) => row.severity === 'CRITICAL' },
  { key: 'warning', label: '주의', match: (row) => row.severity === 'WARNING' },
  { key: 'info', label: '정보', match: (row) => row.severity === 'INFO' },
  // ★ 유형 하나만 보는 필터입니다 (심각도가 아닙니다).
  //   대시보드의 "과잉 재고" 카드가 이 키로 들어옵니다 — 카드는 EXCESS_INVENTORY 만 세는데
  //   ?filter=info 로 보내면 다른 룰 4종이 낸 INFO 까지 목록에 섞여 카드 숫자와 어긋납니다.
  //   라벨은 core.alert_type_label() 과 한 곳에서 옵니다.
  {
    key: 'excess',
    label: ALERT_TYPE_LABEL.EXCESS_INVENTORY,
    match: (row) => row.type === 'EXCESS_INVENTORY',
  },
  { key: 'unacked', label: '미확인', match: (row) => !row.isAcknowledged },
];

function dateText(value: string | null): string {
  if (value === null) return '—';
  return new Date(value).toLocaleString('ko-KR');
}

const historyColumns: Column<AlertHistoryItem>[] = [
  {
    key: 'type',
    label: '유형',
    render: (row) => (
      <Badge tone={SEVERITY_TONE[row.severity]}>{row.typeLabel}</Badge>
    ),
  },
  {
    key: 'target',
    label: '대상',
    variant: 'code',
    render: (row) => {
      const target = row.itemId ?? row.supplierId;
      if (target === null || target === undefined) return <span className="text-3">전체</span>;
      return <span>{target}</span>;
    },
  },
  {
    key: 'name',
    label: '이름',
    render: (row) => {
      const name = row.itemName ?? row.supplierName;
      if (name === null || name === undefined) return <span className="text-3">—</span>;
      return <span>{name}</span>;
    },
  },
  {
    key: 'reason',
    label: '사유',
    render: (row) => <span className="t-sm text-2">{row.reason ?? '—'}</span>,
  },
  {
    key: 'acknowledged',
    label: '확인',
    render: (row) =>
      row.isAcknowledged ? (
        <span className="t-sm text-2">{row.acknowledgedEmail ?? '확인함'}</span>
      ) : (
        <span className="t-sm text-3">미확인</span>
      ),
  },
  {
    key: 'detectedAt',
    label: '탐지',
    align: 'right',
    render: (row) => <span className="t-sm text-3">{dateText(row.detectedAt)}</span>,
  },
  {
    key: 'resolvedAt',
    label: '해결',
    align: 'right',
    render: (row) => <span className="t-sm text-3">{dateText(row.resolvedAt)}</span>,
  },
];

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const activeFilter = readFilter(await searchParams);
  const [{ rows, error }, { data: kpi }, { rows: history }, user, typeMix, daily] = await Promise.all([
    getAlerts(),
    getAlertKpi(),
    getAlertHistory(50),
    getSessionUser(),
    getAlertTypeMix(),
    getAlertDaily(),
  ]);

  const isAdmin = user?.role === 'ADMIN';

  const header = (
    <PageHeader
      title="알림 센터"
      subtitle="탐지 룰 12종이 전체 SKU 를 훑어 위험을 먼저 알립니다. 단가와 결품 영향도, 남은 시간을 반영해 급한 것부터 정렬합니다. 대량 적재 알림 1종은 스캔이 아니라 적재가 확정될 때 붙습니다."
      meta={
        <>
          <MetaChip>PRD 24</MetaChip>
          <MetaChip>STEP 14</MetaChip>
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

  const visible = applyFilter(rows, FILTERS, activeFilter);
  const filterLabel = labelOf(FILTERS, activeFilter);

  return (
    <>
      {header}

      <div className="grid grid-kpi">
        <KpiCard
          label="미해결"
          value={kpi?.open ?? rows.length}
          unit="건"
          icon={Bell}
          foot={kpi?.lastScanAt ? `마지막 스캔 ${dateText(kpi.lastScanAt)}` : '아직 스캔 전'}
          filter={{ key: 'all', active: activeFilter === 'all' }}
        />
        <KpiCard
          label="위험"
          value={kpi?.critical ?? 0}
          unit="건"
          icon={CircleAlert}
          tone="crit"
          foot="지금 조치하지 않으면 결품·납기 사고"
          filter={{ key: 'critical', active: activeFilter === 'critical' }}
        />
        <KpiCard
          label="주의"
          value={kpi?.warning ?? 0}
          unit="건"
          icon={TriangleAlert}
          tone="warn"
          foot="이번 검토 주기 안에 결정이 필요합니다"
          filter={{ key: 'warning', active: activeFilter === 'warning' }}
        />
        <KpiCard
          label="정보"
          value={kpi?.info ?? 0}
          unit="건"
          icon={Info}
          foot="당장은 아니지만 알고 있어야 하는 것"
          filter={{ key: 'info', active: activeFilter === 'info' }}
        />
        <KpiCard
          label="미확인"
          value={kpi?.unacknowledged ?? 0}
          unit="건"
          icon={BellRing}
          foot="아직 아무도 확인하지 않았습니다"
          filter={{ key: 'unacked', active: activeFilter === 'unacked' }}
        />
      </div>

      <InsightBanner eyebrow="ALERT">
        같은 위험은 스캔마다 새로 쌓이지 않습니다. <b>유형 + 대상</b>을 지문으로 삼아 이미 열린 알림이면
        수치만 갱신하고, 이번 스캔에 잡히지 않으면 자동으로 닫힙니다. <b>확인</b>을 눌러도 알림은 사라지지
        않습니다 — 누가 언제 봤는지가 남을 뿐입니다. 위험이 실제로 없어져야 목록에서 빠집니다.
      </InsightBanner>

      {isAdmin && (
        <Panel title="지금 스캔">
          <ScanForm lastScanAt={kpi?.lastScanAt ?? null} />
        </Panel>
      )}

      {filterLabel && <FilterNotice label={filterLabel} shown={visible.length} total={rows.length} />}

      {/* ── 차트 띠 — spec §4.3 ── */}
      <div className="grid-charts">
        <ChartFrame
          title="유형별 현황"
          desc="열린 알림을 유형과 심각도로 · 범례를 눌러 심각도를 끄고 켭니다"
          error={typeMix.error}
          empty={typeMix.rows.length === 0 ? '열린 알림이 없습니다' : null}
        >
          <AlertsTypeMix stacks={pivotAlertTypeMix(typeMix.rows)} hrefs={ALERT_TYPE_HREFS} />
        </ChartFrame>
        <ChartFrame
          title="최근 30일 발생 · 해결"
          desc="하루에 새로 잡힌 알림과 닫힌 알림"
          error={daily.error}
          empty={daily.rows.length === 0 ? '기록이 없습니다' : null}
        >
          <AlertsDaily points={daily.rows} />
        </ChartFrame>
      </div>

      <Panel
        title="미해결 알림"
        actions={<span className="t-label">우선순위 높은 순 · 단가 · 결품 영향도 · 남은 시간</span>}
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            title="열린 알림이 없습니다"
            desc={
              isAdmin
                ? '위에서 지금 스캔을 누르면 전체 SKU 를 훑습니다. 스케줄러는 6시간마다 돕니다.'
                : '스케줄러가 6시간마다 전체 SKU 를 훑습니다. 위험이 생기면 여기에 나타납니다.'
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={`${filterLabel ?? ''} 에 해당하는 알림이 없습니다`}
            desc="위 카드를 다시 눌러 전체 목록으로 돌아갈 수 있습니다."
          />
        ) : (
          <div className="alert-list">
            {visible.map((row) => (
              <AlertRow
                key={row.alertId}
                tone={SEVERITY_TONE[row.severity]}
                type={row.typeLabel}
                time={alertAgeText(row.ageHours) ?? undefined}
                meta={
                  <>
                    <Badge tone={SEVERITY_TONE[row.severity]}>{SEVERITY_LABEL[row.severity]}</Badge>
                    {row.itemId && (
                      <span className="t-code">
                        {row.itemId}
                        {row.itemName ? ` · ${row.itemName}` : ''}
                      </span>
                    )}
                    {!row.itemId && row.supplierId && (
                      <span className="t-code">
                        {row.supplierId}
                        {row.supplierName ? ` · ${row.supplierName}` : ''}
                      </span>
                    )}
                    {row.isAcknowledged && <Badge tone="plain">확인함</Badge>}
                  </>
                }
                body={
                  <>
                    <div>{row.reason ?? '사유가 기록되지 않았습니다'}</div>
                    {row.impact && <div className="alert-row-note">{row.impact}</div>}
                    {row.recommendedAction && (
                      <div className="alert-row-note">권고 · {row.recommendedAction}</div>
                    )}
                  </>
                }
                actions={
                  <>
                    {row.isAcknowledged ? (
                      <span className="t-sm text-3">
                        {row.acknowledgedEmail ?? '확인자 미상'} · {dateText(row.acknowledgedAt)} 확인
                      </span>
                    ) : (
                      <AcknowledgeForm alertId={row.alertId} />
                    )}
                    {row.itemId && (
                      <Link
                        href={`/purchase-recommendation/${encodeURIComponent(row.itemId)}`}
                        className="btn ghost"
                      >
                        상세
                      </Link>
                    )}
                  </>
                }
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="해결된 알림"
        actions={<span className="t-label">최근 50건 · 스캔에서 더 이상 잡히지 않아 닫힌 것</span>}
        flush
      >
        {history.length === 0 ? (
          <EmptyState
            title="닫힌 알림이 없습니다"
            desc="위험이 사라지면 다음 스캔에서 자동으로 닫히고 여기에 남습니다."
          />
        ) : (
          <DataTable
            columns={historyColumns}
            rows={history}
            rowKey={(row) => String(row.alertId)}
            caption="analytics.v_alert_history — 해결된 알림 이력"
          />
        )}
      </Panel>
    </>
  );
}
