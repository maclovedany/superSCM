// 참고 열(Open PO · 이동 중) 상태 안내 배너 — 2026-09-12 보정
//
// ★ analytics.v_available_stock에 사유 열을 더하지 않는다(docs/stage1-판정기록.md Task 16
//   판정 — 열을 넓히면 "전체를 파일명 순서로 다시 적용"하는 표준 복구 절차가 cannot drop
//   columns from view로 멈춘다). 대신 이 저장소가 이미 practice-banner에 쓰는 패턴(별도 상태
//   조회 + 배너 컴포넌트)으로 화면 수준에서 한 번만 안내한다. Open PO · 이동 중 두 참고 열을
//   함께 다룬다 — 같은 화면의 인접한 열이 같은 사고 클래스(출처 없는 더미 숫자 노출)를
//   가졌기 때문이다.
// ★ 새 CSS를 만들지 않고 기존 .alert-row.alert-warning을 그대로 쓴다(practice-banner와 같은 모양).

import { AlertTriangle } from 'lucide-react';
import {
  STOCK_REFERENCE_STATUS_BANNER_TITLE,
  stockReferenceStatusBannerMessage,
  type StockReferenceSourceStatus,
} from '@/lib/inventory/model';

export default function StockReferenceStatusBanner({ status }: { status: StockReferenceSourceStatus }) {
  if (status.openPoReasonCode === null && status.inTransitReasonCode === null) return null;
  return (
    <div className="alert-row alert-warning">
      <AlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>{STOCK_REFERENCE_STATUS_BANNER_TITLE}</strong>
        <p>{stockReferenceStatusBannerMessage(status)}</p>
      </div>
    </div>
  );
}
