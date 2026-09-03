// 알림 행 — design.md §6.9
//
// 좌측 3px 상태 바가 상태 스파인입니다 (design.md §9 ①).

import type { ReactNode } from 'react';
import type { Tone } from '@/lib/status';

export default function AlertRow({
  tone,
  type,
  body,
  time,
  meta,
  actions,
}: {
  tone: Tone;
  /** mono 대문자 유형 — CRITICAL STOCKOUT 등 */
  type: string;
  body: ReactNode;
  time?: string;
  /** 유형 옆에 붙는 보조 표시 — 배지 · 품목코드 등 */
  meta?: ReactNode;
  /**
   * 행 우측 아래 컨트롤 — [확인] 폼 · [상세] 링크.
   *
   * 주지 않으면 예전과 똑같이 그려집니다. 기존 사용처는 고치지 않아도 됩니다.
   */
  actions?: ReactNode;
}) {
  return (
    <article className={`alert-row ${tone}`}>
      <header className="alert-row-head">
        <span className="alert-row-type">{type}</span>
        {meta}
        {time && <time className="alert-row-time">{time}</time>}
      </header>
      <div className="alert-row-body">{body}</div>
      {actions && <div className="alert-row-actions">{actions}</div>}
    </article>
  );
}
