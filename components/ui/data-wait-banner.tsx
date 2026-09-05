// 데이터 대기 배너 — 실데이터 전환 Plan 3 (spec §7)
//
// 재고 · 리드타임 · 단가가 아직 없어 숫자를 낼 수 없는 화면 상단에 붙입니다.
// 판정은 analytics.v_data_availability 한 줄이 하고, 이 컴포넌트는 그것을 문장으로 옮깁니다.
// 데이터가 들어와 n_rows 가 0 을 벗어나면 저절로 사라집니다. 서버 컴포넌트입니다.

import { getDataAvailability } from '@/lib/items';
import { dataWaitSentence, missingKinds, type DataKind } from '@/lib/items-model';

export default async function DataWaitBanner({ kinds }: { kinds: DataKind[] }) {
  const { rows } = await getDataAvailability();
  // 조회에 실패하면 아무것도 그리지 않습니다. 모르는 것을 경고로 올리지 않습니다.
  const sentence = dataWaitSentence(missingKinds(rows, kinds));
  if (sentence === null) return null;
  return (
    <div className="stale-banner" role="status">
      <span>
        <b>데이터 대기</b> — {sentence}
      </span>
    </div>
  );
}
