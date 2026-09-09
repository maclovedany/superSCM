import PageHeader from '@/components/shell/page-header';
import NoRealDataNotice from '@/components/analysis/no-realdata-notice';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Forecast Runs" description="예측 실행 이력입니다." />
      <div className="analysis-content">
        <NoRealDataNotice
          what="Forecast Runs"
          missing={['예측 실행 엔진 (실데이터용 Baseline 미구축)']}
          unlocks={['월별 예측 실행', 'P50·P80·P90 산출', '실행 이력과 stale 판정']}
        />
      </div>
    </section>
  );
}
