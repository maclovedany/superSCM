// 실습용 데이터 배너 — Task 15
//
// ★ 실습 데이터는 진짜 적재 경로(STEP 4 배치)로 들어오기 때문에 발주계획 계산까지 정상적으로
//   통과한다. 화면이 말해 주지 않으면 학생도 관리자도 그 숫자를 실적으로 읽는다 — 이 배너는
//   장식이 아니라 "검증되지 않은 숫자가 실데이터처럼 보이면 안 된다"는 원칙의 마지막 방어선이다.
// ★ 새 CSS를 만들지 않고 기존 .alert-row.alert-warning을 그대로 쓴다(레거시 /workflow 안내 배너와
//   같은 모양). 색은 전부 globals.css의 토큰에서 온다 — 컴포넌트에 hex를 쓰지 않는다.

import { FlaskConical } from 'lucide-react';
import { PRACTICE_BANNER_TITLE, practiceBannerMessage, type PracticeDataStatus } from '@/lib/practice/model';

export default function PracticeDataBanner({ status }: { status: PracticeDataStatus }) {
  return (
    <div className="alert-row alert-warning">
      <FlaskConical size={16} aria-hidden="true" />
      <div>
        <strong>{PRACTICE_BANNER_TITLE}</strong>
        <p>{practiceBannerMessage(status)}</p>
      </div>
    </div>
  );
}
