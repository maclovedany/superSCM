// 실데이터에 없는 항목을 알리는 화면 조각 — 6회차
//
// ★ 화면을 지우지 않고 남겨 둡니다. "왜 이 화면이 비었는가" 를 사람이 알아야 하고,
//   데이터가 들어오면 그대로 되살아나야 하기 때문입니다.
// ★ 없는 값을 0 이나 더미 숫자로 채우지 않습니다. 그 순간 우리가 환각을 만든 것입니다.

export default function NoRealDataNotice({
  what,
  missing,
  unlocks,
}: {
  /** 이 화면이 보여주려던 것 */
  what: string;
  /** 실데이터에서 빠진 입력 */
  missing: string[];
  /** 그 입력이 들어오면 만들 수 있는 것 */
  unlocks: string[];
}) {
  return (
    <div className="card notice-card">
      <p className="notice-eyebrow">실데이터에 없는 항목</p>
      <h3>{what}은(는) 아직 산출할 수 없습니다</h3>
      <p className="muted">
        받은 실데이터에 아래 입력이 없습니다. 데이터가 잘못된 것이 아니라 아직 받지 않은 것입니다.
        추정해서 채우면 그 순간 근거 없는 숫자가 됩니다.
      </p>

      <div className="notice-grid">
        <div>
          <p className="notice-label">없는 입력</p>
          <ul className="notice-list">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="notice-label">들어오면 만들 수 있는 것</p>
          <ul className="notice-list">
            {unlocks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="notice-foot">
        그동안 <strong>수요 패턴</strong> · <strong>OL 예측 정확도</strong> · <strong>AI 비서</strong> 는
        실데이터로 정상 동작합니다.
      </p>
    </div>
  );
}
