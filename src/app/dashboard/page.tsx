import { redirect } from 'next/navigation';

/** Notifications deep-link to /dashboard; the dashboard itself lives at /. */
export default function DashboardRedirect() {
  redirect('/');
}
