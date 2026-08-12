#!/usr/bin/env node
// Creates every Agency OS cron job on cron-job.org via their API.
//
//   CRONJOB_API_KEY=xxx APP_BASE_URL=https://... CRON_SECRET=yyy \
//     node scripts/setup-cronjobs.mjs [--dry-run]
//
// API key: cron-job.org → Settings → API.
// Re-running does NOT delete anything — remove old jobs first or you'll
// end up with duplicates.

const API = 'https://api.cron-job.org';
const TIMEZONE = 'Asia/Karachi';

const dryRun = process.argv.includes('--dry-run');
const apiKey = process.env.CRONJOB_API_KEY;
const baseUrl = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
const cronSecret = process.env.CRON_SECRET;

if (!baseUrl || !cronSecret || (!apiKey && !dryRun)) {
  console.error('Chahiye: APP_BASE_URL, CRON_SECRET' + (dryRun ? '' : ', CRONJOB_API_KEY'));
  process.exit(1);
}

// -1 in a field means "every". Times are local to TIMEZONE.
const ALL = [-1];

const JOBS = [
  { title: 'Agency OS — nightly rebuild',  path: '/api/cron/nightly',       hours: [2],  minutes: [0],  wdays: ALL },
  { title: 'Agency OS — morning briefing', path: '/api/cron/morning',       hours: [8],  minutes: [30], wdays: ALL },
  { title: 'Agency OS — overload alert',   path: '/api/cron/overload',      hours: [8],  minutes: [35], wdays: ALL },
  { title: 'Agency OS — evening check',    path: '/api/cron/evening',       hours: [18], minutes: [0],  wdays: ALL },
  { title: 'Agency OS — stale tasks',      path: '/api/cron/stale',         hours: [9],  minutes: [0],  wdays: [1] },
  { title: 'Agency OS — weekly drafts',    path: '/api/cron/weekly',        hours: [17], minutes: [0],  wdays: [5] },
  { title: 'Agency OS — report drafts',    path: '/api/cron/report-drafts', hours: [17], minutes: [5],  wdays: [5] },
  { title: 'Agency OS — monthly drafts',   path: '/api/cron/monthly',       hours: [9],  minutes: [0],  wdays: ALL, mdays: [1] },
];

function payload(job) {
  return {
    job: {
      url: `${baseUrl}${job.path}`,
      enabled: true,
      title: job.title,
      saveResponses: true,
      requestMethod: 0, // GET
      schedule: {
        timezone: TIMEZONE,
        expiresAt: 0,
        hours: job.hours,
        minutes: job.minutes,
        mdays: job.mdays ?? ALL,
        months: ALL,
        wdays: job.wdays,
      },
      extendedData: {
        // secret travels in a header, never in the URL — cron-job.org
        // keeps URLs in its logs
        headers: { 'x-cron-secret': cronSecret },
      },
    },
  };
}

async function create(job) {
  const res = await fetch(`${API}/jobs`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload(job)),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { jobId } = await res.json();
  return jobId;
}

for (const job of JOBS) {
  if (dryRun) {
    const p = payload(job);
    const s = p.job.schedule;
    console.log(`${job.title}\n  ${p.job.url}\n  ${s.hours}:${String(s.minutes).padStart(2, '0')} ${TIMEZONE}`
      + `  wdays=${s.wdays} mdays=${s.mdays}\n  headers: x-cron-secret: ${'*'.repeat(8)}\n`);
    continue;
  }
  try {
    const id = await create(job);
    console.log(`✅ ${job.title} — job ${id}`);
  } catch (e) {
    console.error(`❌ ${job.title} — ${e.message}`);
  }
}

if (dryRun) console.log('Dry run — koi request nahi gayi.');
