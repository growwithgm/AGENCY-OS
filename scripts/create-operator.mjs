#!/usr/bin/env node
/**
 * One-time operator bootstrap.
 *
 * Creates (or re-keys) the operator's auth user with the service role and
 * stamps the owner claim, so the very first sign-in works without touching
 * the Supabase dashboard.
 *
 * Usage:
 *   OPERATOR_EMAIL=you@example.com OPERATOR_PASSWORD='choose-one' \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/create-operator.mjs
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.OPERATOR_EMAIL ?? '').trim().toLowerCase();
const password = process.env.OPERATOR_PASSWORD ?? '';

for (const [name, value] of [
  ['NEXT_PUBLIC_SUPABASE_URL', url],
  ['SUPABASE_SERVICE_ROLE_KEY', serviceKey],
  ['OPERATOR_EMAIL', email],
  ['OPERATOR_PASSWORD', password],
]) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}
if (password.length < 10) {
  console.error('OPERATOR_PASSWORD needs at least 10 characters.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
if (listError) {
  console.error(listError.message);
  process.exit(1);
}

const existing = list.users.find((u) => u.email?.toLowerCase() === email);
let userId;

if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    app_metadata: { role: 'owner' },
  });
  if (error) { console.error(error.message); process.exit(1); }
  userId = existing.id;
  console.log(`Updated existing operator user ${email}`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'owner' },
  });
  if (error) { console.error(error.message); process.exit(1); }
  userId = data.user.id;
  console.log(`Created operator user ${email}`);
}

const { error: mapError } = await admin.from('app_users').upsert({
  user_id: userId,
  role: 'operator',
  client_id: null,
});
if (mapError) {
  // The mapping table may not exist yet on an old database; the claim above
  // is what security reads, so this is informational.
  console.warn(`app_users row not written: ${mapError.message}`);
}

console.log('Done. Sign in at /login with that email and password.');
