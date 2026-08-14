#!/usr/bin/env node
/**
 * Register (or repair) the five Agency OS cron jobs on cron-job.org.
 *
 * Idempotent: existing jobs are matched by URL and updated in place, so
 * running it twice never creates duplicates. The secret travels as the
 * x-cron-secret header, never in the URL — schedulers log URLs.
 *
 * Needs three environment variables:
 *   CRONJOB_API_KEY  cron-job.org → Settings → API
 *   APP_URL          the deployed app, e.g. https://your-app.vercel.app
 *   CRON_SECRET      the same value the app was deployed with
 * Optional:
 *   APP_TIMEZONE     defaults to Asia/Karachi — must match the app's
 *
 * Usage:  node scripts/setup-cronjobs.mjs
 */

const API = 'https://api.cron-job.org';

const key = process.env.CRONJOB_API_KEY;
const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '');
const secret = process.env.CRON_SECRET;
const timezone = process.env.APP_TIMEZONE?.trim() || 'Asia/Karachi';

if (!key || !appUrl || !secret) {
  console.error('Set CRONJOB_API_KEY, APP_URL and CRON_SECRET first.');
  console.error('Example: CRONJOB_API_KEY=... APP_URL=https://... CRON_SECRET=... node scripts/setup-cronjobs.mjs');
  process.exit(1);
}

// Every schedule is in the operator's timezone. -1 means "every".
const EVERY = [-1];
const JOBS = [
  {
    title: 'Agency OS — nightly (recurrence, replan, signals)',
    path: '/api/cron/nightly',
    schedule: { hours: [2], minutes: [0], wdays: EVERY },
  },
  {
    title: 'Agency OS — morning attention push',
    path: '/api/cron/morning',
    schedule: { hours: [8], minutes: [30], wdays: EVERY },
  },
  {
    title: 'Agency OS — delivery windows flush',
    path: '/api/cron/windows',
    schedule: { hours: [9, 13, 18], minutes: [0], wdays: EVERY },
  },
  {
    title: 'Agency OS — weekly update drafts (Thursday)',
    path: '/api/cron/weekly-updates',
    schedule: { hours: [11], minutes: [0], wdays: [4] },
  },
  {
    title: 'Agency OS — client digest (Friday)',
    path: '/api/cron/digest',
    schedule: { hours: [16], minutes: [0], wdays: [5] },
  },
];

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function jobBody(def) {
  return {
    job: {
      title: def.title,
      url: `${appUrl}${def.path}`,
      enabled: true,
      saveResponses: true,
      requestMethod: 0, // GET
      extendedData: { headers: { 'x-cron-secret': secret } },
      schedule: {
        timezone,
        expiresAt: 0,
        hours: def.schedule.hours,
        minutes: def.schedule.minutes,
        mdays: EVERY,
        months: EVERY,
        wdays: def.schedule.wdays,
      },
    },
  };
}

// First prove the secret works against the app itself, so a typo fails
// here rather than as silent 401s at two in the morning.
const ping = await fetch(`${appUrl}/api/cron/ping`, { headers: { 'x-cron-secret': secret } });
if (!ping.ok) {
  console.error(`The app rejected the secret: ${appUrl}/api/cron/ping → ${ping.status}.`);
  console.error('Check CRON_SECRET matches the deployed environment variable.');
  process.exit(1);
}
console.log(`Secret verified against ${appUrl}/api/cron/ping.`);

const existing = (await api('GET', '/jobs')).jobs ?? [];

for (const def of JOBS) {
  const url = `${appUrl}${def.path}`;
  const match = existing.find((j) => j.url === url);
  if (match) {
    await api('PATCH', `/jobs/${match.jobId}`, jobBody(def));
    console.log(`updated  ${def.path}  (job ${match.jobId})`);
  } else {
    const created = await api('PUT', '/jobs', jobBody(def));
    console.log(`created  ${def.path}  (job ${created.jobId})`);
  }
}

console.log(`\nAll five jobs are in place, schedules in ${timezone}.`);
console.log('cron-job.org keeps each run\'s response — check there if a job ever fails.');
