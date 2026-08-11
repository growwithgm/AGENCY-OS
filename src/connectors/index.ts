// Connectors (spec §11). Every connector writes the same shape:
// a metrics_snapshots row, unique on (client_id, source, metric_date) —
// upserts keep sync idempotent. Failures are never silent: they land in
// connection_health and get surfaced to the operator.

import { db } from '@/lib/db';
import { syncMeta } from './meta';
import { syncWindsor } from './windsor';
import { syncShopify } from './shopify';

export type SnapshotRow = {
  client_id: string;
  source: 'meta' | 'google' | 'ga4' | 'shopify';
  metric_date: string;               // YYYY-MM-DD
  payload: Record<string, number>;
};

export async function writeSnapshots(rows: SnapshotRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await db()
    .from('metrics_snapshots')
    .upsert(rows, { onConflict: 'client_id,source,metric_date' });
  if (error) throw new Error(`snapshot upsert failed: ${error.message}`);
}

async function recordHealth(source: string, clientId: string | null, ok: boolean, error?: string) {
  await db().from('connection_health').insert({ source, client_id: clientId, ok, error: error ?? null });
}

export type SyncFailure = { source: string; clientId: string | null; error: string };

/** Run every connector for every active client; collect failures for the operator. */
export async function syncAllConnectors(date = new Date()): Promise<SyncFailure[]> {
  const { data: clients } = await db().from('clients').select('id, brand_slug').eq('status', 'active');
  const failures: SyncFailure[] = [];

  const connectors: { source: string; run: (clientId: string, slug: string, d: Date) => Promise<SnapshotRow[]> }[] = [
    { source: 'meta', run: syncMeta },
    { source: 'windsor', run: syncWindsor },
    { source: 'shopify', run: syncShopify },
  ];

  for (const client of clients ?? []) {
    for (const c of connectors) {
      try {
        const rows = await c.run(client.id, client.brand_slug, date);
        await writeSnapshots(rows);
        await recordHealth(c.source, client.id, true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await recordHealth(c.source, client.id, false, msg);
        failures.push({ source: c.source, clientId: client.id, error: msg });
      }
    }
  }
  return failures;
}
