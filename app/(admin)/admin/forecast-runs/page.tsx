import PageHeader from '@/components/shell/page-header';
import NoRealDataNotice from '@/components/analysis/no-realdata-notice';
import PracticeRunNotice from '@/components/admin/practice-run-notice';
import { getPracticeForecastRunIds } from '@/lib/practice/repository';

export const dynamic = 'force-dynamic';

// ★ Task 15 fix round 1 — 이 화면은 실행 이력을 조회하지 않는다(실데이터용 Baseline 미구축).
//   그런데 실습 데이터를 넣으면 core.forecast_run에 실제 실행이 생기므로, "아직 산출할 수 없습니다"만
//   보여주면 사실과 다른 말이 된다. 실습 실행이 있으면 그 사실을 먼저 알린다.
export default async function Page() {
  const practiceRunIds = await getPracticeForecastRunIds();

  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Forecast Runs" description="예측 실행 이력입니다." />
      <div className="analysis-content">
        <PracticeRunNotice count={practiceRunIds.size} what="Forecast 실행" />
        <NoRealDataNotice
          what="Forecast Runs"
          missing={['예측 실행 엔진 (실데이터용 Baseline 미구축)']}
          unlocks={['월별 예측 실행', 'P50·P80·P90 산출', '실행 이력과 stale 판정']}
        />
      </div>
    </section>
  );
}
