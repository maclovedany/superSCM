// 값이 없을 때 — 빈 축과 빈 범례 대신 문장을 보인다.
//
// ★ 빈 축은 "데이터가 없다"보다 나쁜 신호다. 눈금과 범례가 그려져 있으면 "차트는 잘 나왔는데
//   값이 0이구나"로 읽힌다. 왜 없는지까지 말해 주는 것이 정직하다.

export default function ChartEmpty({ message, reason }: { message: string; reason?: string | null }) {
  return (
    <p className="chart-empty">
      {message}
      {reason ? (
        <>
          <br />
          <span className="muted">{reason}</span>
        </>
      ) : null}
    </p>
  );
}
