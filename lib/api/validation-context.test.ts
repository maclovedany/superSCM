// 검증 재료의 순수 부분 — 어떤 데이터 종류가 마스터 목록을 실제로 참조하는가.
//
// ★ 왜 이 테스트가 있는가 (재리뷰 A)
//   빈 컨텍스트로는 검증하지 않고 503 을 돌려줍니다. 그런데 그 판정을 데이터 종류와
//   무관하게 걸면, **빈 데이터베이스에서 품목 마스터를 넣어야 품목 마스터를 넣을 수 있는**
//   상태가 됩니다. ITEM_MASTER · SUPPLIER_MASTER 는 자기 id 필드의 references 가
//   undefined 라 그 집합을 애초에 보지 않기 때문입니다.
//
//   파일 업로드에는 그런 차단이 없으므로, 종류를 안 가리면 규칙이 두 벌이 됩니다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA_TYPES, TABLE_SPECS } from '../import/schema.ts';
import { validate } from '../import/validate.ts';
import { referencedMasters } from './inbound-model.ts';

test('마스터를 참조하는 종류와 아닌 종류를 가른다', () => {
  // 자기 자신이 마스터인 두 종류는 **품목** 목록을 보지 않습니다.
  // (ITEM_MASTER 에는 supplier_id 필드가 있어 공급처는 참조합니다 — 그건 경고 전용입니다)
  assert.equal(referencedMasters('ITEM_MASTER').item, false);
  assert.equal(referencedMasters('SUPPLIER_MASTER').item, false);
  assert.equal(referencedMasters('SUPPLIER_MASTER').supplier, false);

  // 실적·거래 데이터는 품목 마스터를 봅니다
  assert.equal(referencedMasters('DEMAND').item, true);
  assert.equal(referencedMasters('INVENTORY').item, true);
  assert.equal(referencedMasters('SALES_ORDER').item, true);

  // 발주는 공급처도 봅니다
  assert.equal(referencedMasters('PURCHASE_ORDER').item, true);
  assert.equal(referencedMasters('PURCHASE_ORDER').supplier, true);
});

test('판정이 TABLE_SPECS 와 어긋나지 않는다 — 스키마가 기준입니다', () => {
  for (const dataType of DATA_TYPES) {
    const fields = TABLE_SPECS[dataType].fields;
    const result = referencedMasters(dataType);

    assert.equal(
      result.item,
      fields.some((field) => field.references === 'ITEM'),
      `${dataType} 의 품목 참조 판정`,
    );
    assert.equal(
      result.supplier,
      fields.some((field) => field.references === 'SUPPLIER'),
      `${dataType} 의 공급처 참조 판정`,
    );
  }
});

test('빈 DB 에서 마스터를 넣을 수 있어야 한다', () => {
  // 이 두 종류가 품목 목록을 요구하면 새 연동이 첫 요청부터 503 을 받습니다.
  for (const dataType of ['ITEM_MASTER', 'SUPPLIER_MASTER'] as const) {
    assert.equal(
      referencedMasters(dataType).item,
      false,
      `${dataType} 가 품목 마스터를 요구하면 빈 DB 에서 API 로 빠져나올 수 없습니다`,
    );
  }
});

test('validate.ts 가 실제로 그 조건으로 검사한다는 전제 확인', () => {
  // referencedMasters 는 "validate 가 이 집합을 볼 것인가" 를 대신 답합니다.
  // 그 전제가 깨지면(참조 필드가 없는데 검사한다면) 이 함수의 의미가 사라집니다.
  const itemFields = TABLE_SPECS.DEMAND.fields.filter((f) => f.references === 'ITEM');
  assert.equal(itemFields.length, 1, 'DEMAND 에 품목 참조 필드가 하나 있어야 합니다');
  assert.equal(itemFields[0].target, 'item_id');
});

test('★ 품목만 막고 공급처는 막지 않는 근거 — 두 검사의 severity 가 다르다', () => {
  // 품목 없음은 행을 거절합니다(ERROR). 그래서 집합이 비면 검사가 꺼진 것과 구분할 수 없습니다.
  const unknownItem = validate(
    'DEMAND',
    [{ item_id: 'NOPE', use_date: '2025-01-01', qty: 1 }],
    { item_id: 'item_id', use_date: 'use_date', qty: 'qty' },
    {
      knownItemIds: new Set(['ITEM001']),
      knownSupplierIds: new Set(['SUP01']),
      targetColumns: new Set(['item_id', 'use_date', 'qty']),
    },
  );
  assert.equal(unknownItem.rowValid[0], false, '모르는 품목은 행을 거절해야 합니다');
  assert.equal(unknownItem.issues.find((i) => i.code === 'UNKNOWN_ITEM')?.severity, 'ERROR');

  // 공급처 없음은 경고일 뿐이라 적재 여부를 바꾸지 않습니다.
  // 그래서 공급처 집합이 비어도 "조용히 규칙이 달라지는" 일이 없고, 막을 이유도 없습니다.
  const unknownSupplier = validate(
    'PURCHASE_ORDER',
    [{ po_no: 'PO1', item_id: 'ITEM001', supplier_id: 'NOPE', order_date: '2025-01-01', qty: 1 }],
    {
      po_no: 'po_no',
      item_id: 'item_id',
      supplier_id: 'supplier_id',
      order_date: 'order_date',
      qty: 'qty',
    },
    {
      knownItemIds: new Set(['ITEM001']),
      knownSupplierIds: new Set(['SUP01']),
      targetColumns: new Set(['po_no', 'item_id', 'supplier_id', 'order_date', 'qty']),
    },
  );
  assert.equal(unknownSupplier.rowValid[0], true, '모르는 공급처는 행을 거절하지 않습니다');
  assert.equal(
    unknownSupplier.issues.find((i) => i.code === 'UNKNOWN_SUPPLIER')?.severity,
    'WARNING',
  );
});
