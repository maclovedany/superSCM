// 성능 비교표 CSV 내보내기 — renew.prd 16.3

import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getItemPerformance } from '@/lib/backtest';

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function asPercent(value: number | null) {
  return value === null ? '' : `${(value * 100).toFixed(2)}%`;
}

export async function GET(request: Request) {
  await requireUser();

  const itemId = new URL(request.url).searchParams.get('item');
  if (!itemId) return NextResponse.json({ error: '품목을 지정해주세요.' }, { status: 400 });

  const { rows, error } = await getItemPerformance(itemId);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const header = ['순위', '모델', 'WAPE', 'MAPE', 'Bias', 'RMSE', 'MAE', '기준선 대비', '채점 기간', '사유'];
  const lines = [header.map(cell).join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.rank ?? '',
        row.modelName ?? row.modelId,
        asPercent(row.wape),
        asPercent(row.mape),
        asPercent(row.bias),
        row.rmse ?? '',
        row.mae ?? '',
        asPercent(row.baselineImprovement),
        row.periods,
        row.reason ?? '',
      ]
        .map(cell)
        .join(','),
    );
  }

  // Excel 이 UTF-8 로 읽도록 BOM 을 붙입니다
  return new NextResponse(`﻿${lines.join('\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="model-performance-${itemId}.csv"`,
    },
  });
}
