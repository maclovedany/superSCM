// 화면 전환 중 뼈대 — design.md §8 의 "산출 불가(—)" 와 같은 태도로, 값을 지어내지 않고
// 자리만 보여 줍니다. app/(user)/loading.tsx · app/(admin)/loading.tsx 가 그립니다.
//
// 이 파일이 있어야 Next 가 화면 전환을 스트리밍합니다. 없으면 서버가 데이터를 전부 모을 때까지
// 이전 화면이 그대로 남아 "느리다" 로 느껴집니다. 링크는 이 뼈대를 미리 받아 두므로 클릭 즉시 바뀝니다.

export default function PageSkeleton() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-live="polite" aria-label="불러오는 중">
      <div className="skeleton-header">
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-subtitle" />
      </div>
      <div className="grid-kpi">
        {[0, 1, 2, 3].map((i) => (
          <div className="panel skeleton-card" key={i}>
            <span className="skeleton skeleton-label" />
            <span className="skeleton skeleton-value" />
          </div>
        ))}
      </div>
      <div className="grid-2">
        <div className="panel skeleton-block" />
        <div className="panel skeleton-block" />
      </div>
      <div className="panel skeleton-table">
        {[0, 1, 2, 3, 4].map((i) => (
          <span className="skeleton skeleton-row" key={i} />
        ))}
      </div>
    </div>
  );
}
