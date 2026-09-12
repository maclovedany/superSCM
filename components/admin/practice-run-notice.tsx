// 실습 실행 안내 — Task 15 fix round 1 (C2-3)
//
// ★ /admin/forecast-runs · backtest-runs · champion-models 세 화면은 아직 실행 이력을 조회하지 않고
//   NoRealDataNotice("아직 산출할 수 없습니다")만 보여준다. 실습 데이터를 넣으면 실제로는 실행
//   이력이 **생기므로**, 그 상태에서 "없다"고만 말하면 화면이 사실과 다른 말을 하게 된다.
//   숫자를 새로 보여주는 것이 아니라, 있는 것을 없다고 말하지 않기 위한 안내다.

export default function PracticeRunNotice({ count, what }: { count: number; what: string }) {
  if (count <= 0) return null;
  return (
    <div className="alert-row alert-warning">
      <span className="insight-mark">!</span>
      <div>
        <strong>실습용 {what} {count}건이 있습니다</strong>
        <p>
          아래 안내는 <b>실데이터</b> 기준입니다. 실습용 데이터 묶음이 만든 {what}은 별도로 존재하며,
          이 화면은 아직 그 이력을 표로 보여주지 않습니다. 목록은 관리자 화면의{' '}
          <b>실습용 데이터</b>(/admin/practice-data)에서 확인하세요. 실습 실행으로 나온 수치는 실제 실적이 아닙니다.
        </p>
      </div>
    </div>
  );
}
