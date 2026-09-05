import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dataWaitSentence,
  missingKinds,
  normalizeDataAvailability,
  normalizeItemHit,
  normalizeQuery,
} from './items-model.ts';

test('normalizeItemHit — 실제 컬럼명, is_machine · matched_alias', () => {
  const hit = normalizeItemHit({ item_id: '602K02693', item_name: 'Fuser', item_type: 'PART', family: 'MDL001', is_machine: false, matched_alias: '602K02690' });
  assert.deepEqual(hit, { itemId: '602K02693', itemName: 'Fuser', itemType: 'PART', family: 'MDL001', isMachine: false, matchedAlias: '602K02690' });
});

test('normalizeQuery — core.norm_code 와 같은 규칙', () => {
  assert.equal(normalizeQuery(' 602k-026_93 '), '602K02693');
});

test('missingKinds · dataWaitSentence — 0행인 종류만, 파일 이름 포함', () => {
  const rows = [
    { kind: 'DEMAND', n_rows: 100, needed_files: null, note: null },
    { kind: 'INVENTORY', n_rows: 0, needed_files: 'INVENTORY (월말 재고 스냅샷)', note: null },
    { kind: 'LEADTIME', n_rows: 0, needed_files: 'SUPPLIER_MASTER · PURCHASE_ORDER · RECEIPT', note: null },
  ].map(normalizeDataAvailability);
  const missing = missingKinds(rows, ['INVENTORY', 'LEADTIME', 'DEMAND']);
  assert.deepEqual(missing.map((m) => m.kind), ['INVENTORY', 'LEADTIME']);
  const sentence = dataWaitSentence(missing);
  assert.ok(sentence && sentence.includes('재고 스냅샷') && sentence.includes('INVENTORY (월말 재고 스냅샷)'));
  assert.equal(dataWaitSentence([]), null);
});
