import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import ProcurementApp from '@/components/procurement-app';

// Task 13 — 레거시 격리: 이 화면은 참고용 프로토타입으로만 남긴다. 실제 업무는
// /procurement-plans(발주계획) · /allocations(배정) · /demand-submissions(수요 제출)에서
// 처리하며, 이 화면의 조작은 브라우저 로컬 상태일 뿐 DB에 저장·승인되지 않는다.
export default function LegacyWorkflowPage() {
  return (
    <>
      <div className="alert-row alert-warning" style={{ margin: '16px' }}>
        <AlertTriangle size={16} />
        <div>
          <strong>참고용 화면입니다 — 저장·승인되지 않습니다</strong>
          <p>
            아래 화면은 이전 단계의 브라우저 프로토타입입니다. 실제 발주계획 업무는{' '}
            <Link href="/procurement-plans">발주계획</Link> 메뉴를 이용하세요.
          </p>
        </div>
      </div>
      <ProcurementApp />
    </>
  );
}

