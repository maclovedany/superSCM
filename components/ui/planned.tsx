// 아직 만들지 않은 화면.
//
// 빈 페이지를 두지 않고 "언제 · 무엇이 들어오는지" 를 밝힙니다.
// 화면이 완성되면 이 파일을 쓰지 않게 되고, lib/menu.ts 의 ready 를 true 로 바꿉니다.

import Link from 'next/link';
import PageHeader, { MetaChip } from '@/components/shell/page-header';
import Panel from './panel';

export default function Planned({
  title,
  subtitle,
  step,
  prd,
  contents,
}: {
  title: string;
  subtitle: string;
  /** step.md 의 단계 번호 */
  step: string;
  /** renew.prd 의 장 번호 */
  prd: string;
  /** 이 화면에 들어올 것 */
  contents: string[];
}) {
  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        meta={
          <>
            <MetaChip>{step}</MetaChip>
            <MetaChip>PRD {prd}</MetaChip>
          </>
        }
      />

      <Panel title="아직 만들지 않았습니다">
        <p className="t-sm text-2" style={{ marginBottom: 'var(--s-4)' }}>
          이 화면은 <b className="text-1">{step}</b> 에서 만듭니다. 들어올 내용은 다음과 같습니다.
        </p>
        <ul className="t-sm text-2" style={{ margin: 0, paddingLeft: '1.1em' }}>
          {contents.map((line) => (
            <li key={line} style={{ marginBottom: 'var(--s-1)' }}>
              {line}
            </li>
          ))}
        </ul>
        <p className="t-sm text-3" style={{ marginTop: 'var(--s-4)' }}>
          지금 동작하는 화면은{' '}
          <Link href="/analysis/stockout" style={{ color: 'var(--info-fg)' }}>
            재고 소진 위험
          </Link>{' '}
          과{' '}
          <Link href="/analysis/leadtime" style={{ color: 'var(--info-fg)' }}>
            리드타임 격차
          </Link>{' '}
          두 개입니다.
        </p>
      </Panel>
    </>
  );
}
