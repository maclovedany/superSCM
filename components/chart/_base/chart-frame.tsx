// 차트 껍데기 — 제목 · 설명 · 상태 (spec §2 · §6)
//
// 조회 실패는 ErrorState, 행 없음은 EmptyState, 영업 가림은 문구입니다.
// 차트 하나가 실패해도 옆 차트와 표는 그려집니다 — 상태를 여기서 가둡니다.

import type { ReactNode } from 'react';
import { EmptyState, ErrorState } from '@/components/ui/state';

export default function ChartFrame({
  title,
  desc,
  error = null,
  empty = null,
  masked = false,
  actions,
  children,
}: {
  title: string;
  /** 무엇을 보는 차트인지 한 줄. 툴팁이 아니라 항상 보입니다 */
  desc?: string;
  /** 조회 오류 문구. 있으면 차트 대신 ErrorState */
  error?: string | null;
  /** 행이 없을 때 제목. 있으면 차트 대신 EmptyState */
  empty?: string | null;
  /** 영업 권한으로 값이 가려진 차트 (renew.prd 4.5) */
  masked?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel chart-card">
      <header className="panel-head">
        <div>
          <h2 className="t-h2">{title}</h2>
          {desc && <p className="chart-card-desc">{desc}</p>}
        </div>
        {actions && <div className="panel-head-actions">{actions}</div>}
      </header>
      <div className="panel-body">
        {error !== null ? (
          <ErrorState detail={error} />
        ) : masked ? (
          <div className="state">
            <p className="state-title">영업 권한에서 볼 수 없습니다</p>
            <p className="state-desc">renew.prd 4.5 — 이 값은 영업 부서에 열리지 않습니다.</p>
          </div>
        ) : empty !== null ? (
          <EmptyState title={empty} />
        ) : (
          children
        )}
      </div>
    </section>
  );
}
