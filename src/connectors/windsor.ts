// Windsor.ai → Google Ads + GA4 (already connected upstream, spec §11).
// Windsor account mapping per client via WINDSOR_ACCOUNTS
// (JSON: { "<brand_slug>": { "google": "<acct>", "ga4": "<property>" } }).

import { env } from '@/lib/env';
import type { SnapshotRow } from './index';

type WindsorMap = Record<string, { google?: string; ga4?: string }>;

function accountsFor(slug: string): { google?: string; ga4?: string } {
  try {
    const map = JSON.parse(process.env.WINDSOR_ACCOUNTS ?? '{}') as WindsorMap;
    return map[slug] ?? {};
  } catch {
    return {};
  }
}

async function windsorFetch(connector: string, fields: string, day: string, account: string) {
  const url = new URL(`https://connectors.windsor.ai/${connector}`);
  url.searchParams.set('api_key', env.WINDSOR_API_KEY!);
  url.searchParams.set('date_from', day);
  url.searchParams.set('date_to', day);
  url.searchParams.set('fields', fields);
  url.searchParams.set('select_accounts', account);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`windsor ${connector} ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data?.[0] ?? null;
}

export async function syncWindsor(clientId: string, slug: string, date: Date): Promise<SnapshotRow[]> {
  if (!env.WINDSOR_API_KEY) return [];
  const accounts = accountsFor(slug);
  const day = new Date(date.getTime() - 86400000).toISOString().slice(0, 10);
  const rows: SnapshotRow[] = [];

  if (accounts.google) {
    const g = await windsorFetch('google_ads', 'spend,conversions,cpc,search_impression_share', day, accounts.google);
    if (g) {
      rows.push({
        client_id: clientId, source: 'google', metric_date: day,
        payload: {
          spend: Number(g.spend ?? 0),
          conversions: Number(g.conversions ?? 0),
          cpc: Number(g.cpc ?? 0),
          impression_share: Number(g.search_impression_share ?? 0),
        },
      });
    }
  }

  if (accounts.ga4) {
    const a = await windsorFetch('googleanalytics4', 'sessions,conversion_rate,total_revenue', day, accounts.ga4);
    if (a) {
      rows.push({
        client_id: clientId, source: 'ga4', metric_date: day,
        payload: {
          sessions: Number(a.sessions ?? 0),
          conversion_rate: Number(a.conversion_rate ?? 0),
          revenue: Number(a.total_revenue ?? 0),
        },
      });
    }
  }

  return rows;
}
