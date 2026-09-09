import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/20260828000200_step3_data_isolation.sql');

function migration() {
  return readFileSync(migrationPath, 'utf8');
}

test('STEP3 migration adds common raw ingestion tracking without rebuilding existing raw tables', () => {
  const sql = migration();
  for (const tableName of ['shipment_log', 'usage_history', 'inventory', 'item_master', 'supplier_master', 'purchase_order', 'goods_receipt', 'forecast']) {
    assert.match(sql, new RegExp(`alter table raw\\.${tableName} add column if not exists batch_id`, 'i'));
  }
  assert.match(sql, /create table if not exists raw\.business_event/i);
  assert.match(sql, /create table if not exists raw\.sales_order/i);
  assert.match(sql, /create table if not exists raw\.item_substitute/i);
});

test('STEP3 migration creates fail-closed train and test demand boundaries', () => {
  const sql = migration();
  assert.match(sql, /create table if not exists core\.forecast_setting/i);
  assert.match(sql, /create or replace view core\.v_train_demand/i);
  assert.match(sql, /create or replace view core\.v_test_actual/i);
  assert.match(sql, /create or replace view analytics\.v_data_coverage/i);
  assert.match(sql, /train_start is not null/i);
  assert.match(sql, /test_end is not null/i);
  assert.match(sql, /p_train_end < p_test_start/i);
  assert.match(sql, /data_isolation_ok/i);
  assert.match(sql, /BLOCKED_INVALID_SETTING/i);
  assert.match(sql, /WINDOW_OUTSIDE_DATA/i);
});

test('STEP3 migration centralizes policies and limits mutations to administrators', () => {
  const sql = migration();
  for (const tableName of ['policy_config', 'outlier_rule', 'item_policy', 'forecast_setting']) {
    assert.match(sql, new RegExp(`create table if not exists core\\.${tableName}`, 'i'));
    assert.match(sql, new RegExp(`alter table core\\.${tableName} enable row level security`, 'i'));
  }
  assert.match(sql, /table_name \|\| '_admin_mutation'/i);
  assert.match(sql, /for all to authenticated using \(core\.is_admin\(\)\) with check \(core\.is_admin\(\)\)/i);
  assert.match(sql, /create or replace view analytics\.v_data_coverage/i);
  assert.match(sql, /revoke all on schema raw from anon/i);
});
