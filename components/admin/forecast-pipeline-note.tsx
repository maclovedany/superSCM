// STEP 6·7 실행 이력 안내 — Task 15 fix round 2
//
// ★ 이 네 화면(forecast-runs · backtest-runs · champion-models · forecast-models)은 원래
//   NoRealDataNotice("아직 산출할 수 없습니다")만 보여줬다. 그건 core.forecast_run 등이 비어 있던
//   6회차 이관 시점(commit b2ee554)엔 맞는 말이었다. 지금은 실습 데이터가 진짜 적재 경로(STEP 6
//   core.run_baseline_forecast · STEP 7 core.run_backtest)를 통과해 실제 행을 만들었으므로, "없다"고
//   계속 말하면 화면이 거짓말을 하게 된다.
// ★ 그렇다고 "다 있다"고 말해도 안 된다 — 6회차 실데이터 전용 Forecast 엔진(계절성·리드타임까지
//   반영하는 모델)은 여전히 없다. 지금 보이는 건 STEP 6 SQL Baseline(이동평균 계열)과 그 채점
//   결과뿐이다. 그래서 NoRealDataNotice를 지우지 않고, 사실이 바뀐 만큼만 문구를 바꾼다.

export default function ForecastPipelineNote() {
  return (
    <div className="card notice-card">
      <p className="notice-eyebrow">STEP 6 · 7 파이프라인</p>
      <h3>6회차 실데이터 전용 Forecast 엔진은 아직 없습니다</h3>
      <p className="muted">
        아래 목록은 STEP 6 SQL Baseline Forecast(이동평균 · 가중이동평균 · 전년동월 · 계절성 나이브)와
        STEP 7 Backtest·Champion 파이프라인이 실제로 남긴 실행 이력입니다. 계절성·리드타임까지 반영하는
        실데이터 전용 엔진은 아직 만들지 않았습니다 — 지금 보이는 모델의 정확도가 최종 목표는 아닙니다.
      </p>
    </div>
  );
}
