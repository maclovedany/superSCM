// 발주 추천 CSV 내보내기 — renew.prd 22.3 의 출력 필드 전부
//
// 값이 없는 칸은 빈 칸으로 둡니다. 0 으로 채우면 "발주 불필요" 와 "산출 불가" 가
// 구분되지 않습니다 (AGENTS.md 규칙 5 · design.md §8.2).

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getPurchaseRecommendations } from '@/lib/recommendation';
import {
  RECOMMENDATION_CSV_HEADER,
  recommendationCsvRow,
} from '@/lib/recommendation-model';

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  await requireUser();

  // ?item=ITEM001 이면 그 품목만 내보냅니다 (SKU Detail 화면의 CSV 버튼).
  const itemId = new URL(request.url).searchParams.get('item');

  const { rows, error } = await getPurchaseRecommendations();
  if (error) return NextResponse.json({ error }, { status: 500 });

  const selected = itemId ? rows.filter((row) => row.itemId === itemId) : rows;

  const lines = [RECOMMENDATION_CSV_HEADER.map(cell).join(',')];
  for (const row of selected) {
    lines.push(recommendationCsvRow(row).map(cell).join(','));
  }

  const filename = itemId
    ? `purchase-recommendation-${itemId}.csv`
    : 'purchase-recommendations.csv';

  // Excel 이 UTF-8 로 읽도록 BOM 을 붙입니다
  return new NextResponse(`﻿${lines.join('\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
