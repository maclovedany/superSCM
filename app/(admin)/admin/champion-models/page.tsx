import PageHeader from '@/components/shell/page-header';
import NoRealDataNotice from '@/components/analysis/no-realdata-notice';
import PracticeRunNotice from '@/components/admin/practice-run-notice';
import { getPracticeBacktestRunIds } from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

// ★ Task 15 fix round 1 — Champion은 Backtest 실행에 매달려 있으므로 실습 Backtest 수로 판단한다.
export default async function Page() {
  const practiceRunIds = await getPracticeBacktestRunIds();

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Champion Models" description="품목별 대표 모델을 고르고 이력을 남깁니다." />
      <div className="analysis-content">
        <PracticeRunNotice count={practiceRunIds.size} what="Champion 선정(Backtest 실행)" />
        <NoRealDataNotice
          what="Champion Models"
          missing={['검증 Actual (실적 대비 예측 오차 채점용)', '예측 실행 결과 (실데이터용 Forecast 엔진 미구축)']}
          unlocks={['품목별 Champion 선정', '모델 교체 이력 추적', '선정 근거 감사 기록']}
        />
      </div>
    </section>
  );
}
