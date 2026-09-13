// 빈자리의 설명 — 차트가 **그리지 않은** 구간을 말로 적는다.
//
// ★ 이것이 없으면 끊어 그리기가 절반만 정직하다. 선이 끊긴 것은 보이지만 "왜" 는 안 보이고,
//   보는 사람은 빈 구간을 자기 마음대로 메워 읽는다.
// ★ 영문 사유 코드를 그대로 쓰지 않는다 — lib/charts/reason-labels.ts 가 한국어로 바꾼 뒤에만
//   여기 온다.

export type ChartReason = { code: string; label: string; months: string[] };

/** 달 목록을 짧게 — 많으면 처음과 끝만 적고 개수를 붙인다. */
function describeMonths(months: readonly string[]): string {
  if (months.length === 0) return '';
  if (months.length <= 3) return months.join(' · ');
  return `${months[0]} ~ ${months[months.length - 1]} (${months.length}개월)`;
}

export default function ChartReasons({ reasons, title }: { reasons: readonly ChartReason[]; title?: string }) {
  const shown = reasons.filter((reason) => reason.months.length > 0);
  if (shown.length === 0) return null;

  return (
    <ul className="chart-reasons">
      {shown.map((reason) => (
        <li className="chart-reason" key={reason.code}>
          {title ? <strong>{title}</strong> : null}
          <span>{reason.label}</span>
          <span className="chart-reason-months">{describeMonths(reason.months)}</span>
        </li>
      ))}
    </ul>
  );
}
