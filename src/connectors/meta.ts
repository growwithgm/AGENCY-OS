// Meta Marketing API → spend, ROAS, CPC, CTR, purchases (spec §11).
// Ad account ids are configured per client via META_AD_ACCOUNTS
// (JSON: { "<brand_slug>": "act_123..." }).

import { env } from '@/lib/env';
import type { SnapshotRow } from './index';

function accountFor(slug: string): string | null {
  try {
    const map = JSON.parse(process.env.META_AD_ACCOUNTS ?? '{}');
    return map[slug] ?? null;
  } catch {
    return null;
  }
}

export async function syncMeta(clientId: string, slug: string, date: Date): Promise<SnapshotRow[]> {
  if (!env.META_ACCESS_TOKEN) return [];
  const account = accountFor(slug);
  if (!account) return [];

  const day = new Date(date.getTime() - 86400000).toISOString().slice(0, 10); // yesterday
  const url = new URL(`https://graph.facebook.com/v21.0/${account}/insights`);
  url.searchParams.set('fields', 'spend,ctr,cpc,purchase_roas,actions');
  url.searchParams.set('time_range', JSON.stringify({ since: day, until: day }));
  url.searchParams.set('access_token', env.META_ACCESS_TOKEN);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`meta insights ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const row = json.data?.[0];
  if (!row) return [];

  const purchases = (row.actions ?? []).find(
    (a: { action_type: string; value: string }) => a.action_type === 'purchase',
  );
  const roas = row.purchase_roas?.[0]?.value;

  return [{
    client_id: clientId,
    source: 'meta',
    metric_date: day,
    payload: {
      spend: Number(row.spend ?? 0),
      ctr: Number(row.ctr ?? 0),
      cpc: Number(row.cpc ?? 0),
      roas: Number(roas ?? 0),
      purchases: Number(purchases?.value ?? 0),
    },
  }];
}
