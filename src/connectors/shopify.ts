// Shopify Admin GraphQL → orders, AOV, revenue (spec §11). Read-only.
// Shop domain per client via SHOPIFY_SHOPS (JSON: { "<brand_slug>": {"domain": "...", "token": "env:VAR"} })
// or the single-store SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_TOKEN pair.

import { env } from '@/lib/env';
import type { SnapshotRow } from './index';

function shopFor(slug: string): { domain: string; token: string } | null {
  try {
    const map = JSON.parse(process.env.SHOPIFY_SHOPS ?? '{}');
    const entry = map[slug];
    if (entry) {
      const token = entry.token?.startsWith('env:') ? process.env[entry.token.slice(4)] : entry.token;
      if (entry.domain && token) return { domain: entry.domain, token };
    }
  } catch { /* fall through to single-store config */ }
  if (env.SHOPIFY_SHOP_DOMAIN && env.SHOPIFY_ADMIN_TOKEN) {
    return { domain: env.SHOPIFY_SHOP_DOMAIN, token: env.SHOPIFY_ADMIN_TOKEN };
  }
  return null;
}

const ORDERS_QUERY = `
  query DailyOrders($query: String!) {
    orders(first: 250, query: $query) {
      edges { node { currentTotalPriceSet { shopMoney { amount } } } }
    }
  }
`;

export async function syncShopify(clientId: string, slug: string, date: Date): Promise<SnapshotRow[]> {
  const shop = shopFor(slug);
  if (!shop) return [];

  const day = new Date(date.getTime() - 86400000).toISOString().slice(0, 10);
  const res = await fetch(`https://${shop.domain}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': shop.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: ORDERS_QUERY,
      variables: { query: `created_at:>=${day} created_at:<${day}T23:59:59Z` },
    }),
  });
  if (!res.ok) throw new Error(`shopify ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`shopify graphql: ${JSON.stringify(json.errors)}`);

  const amounts: number[] = (json.data?.orders?.edges ?? []).map(
    (e: { node: { currentTotalPriceSet: { shopMoney: { amount: string } } } }) =>
      Number(e.node.currentTotalPriceSet.shopMoney.amount),
  );
  const revenue = amounts.reduce((a, b) => a + b, 0);

  return [{
    client_id: clientId,
    source: 'shopify',
    metric_date: day,
    payload: {
      orders: amounts.length,
      revenue: Math.round(revenue * 100) / 100,
      aov: amounts.length ? Math.round((revenue / amounts.length) * 100) / 100 : 0,
    },
  }];
}
