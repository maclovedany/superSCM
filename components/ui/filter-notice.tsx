// 필터가 걸려 있음을 알리고 푸는 줄 — design.md §6.4
//
// 카드를 눌러 목록이 좁혀졌을 때, 지금 무엇만 보고 있는지 분명히 합니다.
// 이게 없으면 "왜 20개가 아니라 3개만 보이지?" 를 겪습니다.

import Link from 'next/link';
import { X } from 'lucide-react';

export default function FilterNotice({
  label,
  shown,
  total,
}: {
  label: string;
  shown: number;
  total: number;
}) {
  return (
    <div className="filter-notice">
      <span>
        <b>{label}</b> 만 보는 중 · {shown.toLocaleString()} / {total.toLocaleString()}건
      </span>
      <Link href="?" className="btn ghost" scroll={false}>
        <X size={13} aria-hidden />
        전체 보기
      </Link>
    </div>
  );
}
