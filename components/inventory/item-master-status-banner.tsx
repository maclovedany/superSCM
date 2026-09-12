// 품목 마스터 출처 안내 배너 — 2026-09-12(Task 17)
//
// ★ core.v_item_master가 출처 없는(batch_id is null) raw.item_master 행을 걸러낸다(같은 날
//   core.v_open_po_qty · core.v_inbound_qty가 이미 쓴 출처 게이트와 같은 원칙). 그 결과 재고
//   화면 목록에 보이는 품목 수가 raw.item_master 전체보다 적을 수 있다 — 화면이 조용히 덜
//   보여주면 안 되므로(이 저장소의 구속 원칙), stock-reference-status-banner.tsx와 같은 패턴
//   (별도 상태 조회 + 배너 컴포넌트)으로 한 번만 안내한다. 대상이 다르므로(참고 열 값이 아니라
//   품목 존재 자체) 별도 컴포넌트로 둔다 — 그 배너에 합치지 않는다.
// ★ 새 CSS를 만들지 않고 기존 .alert-row.alert-warning을 그대로 쓴다.

import { AlertTriangle } from 'lucide-react';
import { ITEM_MASTER_STATUS_BANNER_TITLE, itemMasterStatusBannerMessage, type ItemMasterSourceStatus } from '@/lib/inventory/model';

export default function ItemMasterStatusBanner({ status }: { status: ItemMasterSourceStatus }) {
  if (status.itemMasterReasonCode === null) return null;
  return (
    <div className="alert-row alert-warning">
      <AlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>{ITEM_MASTER_STATUS_BANNER_TITLE}</strong>
        <p>{itemMasterStatusBannerMessage(status)}</p>
      </div>
    </div>
  );
}
