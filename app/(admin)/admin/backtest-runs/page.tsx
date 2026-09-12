import PageHeader from '@/components/shell/page-header';
import NoRealDataNotice from '@/components/analysis/no-realdata-notice';
import PracticeRunNotice from '@/components/admin/practice-run-notice';
import { getPracticeBacktestRunIds } from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

// ★ Task 15 fix round 1 — forecast-runs와 같은 이유(실습 실행이 있으면 "없다"고 말하지 않는다).
export default async function Page() {
  const practiceRunIds = await getPracticeBacktestRunIds();

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Backtest Runs" description="저장된 예측을 검증 Actual과 대조하는 실행 이력입니다." />
      <div className="analysis-content">
        <PracticeRunNotice count={practiceRunIds.size} what="Backtest 실행" />
        <NoRealDataNotice
          what="Backtest Runs"
          missing={['검증 Actual (실적 대비 예측 오차 채점용)', '예측 실행 결과 (실데이터용 Forecast 엔진 미구축)']}
          unlocks={['모델별 WAPE·Bias 채점', 'Champion 모델 자동 선정', '재실행 없는 성능 비교']}
        />
      </div>
    </section>
  );
}
