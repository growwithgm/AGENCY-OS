import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/auth';
import { PasswordResetForm } from './PasswordResetForm';

export const dynamic = 'force-dynamic';

/** Where the recovery link lands: one field, then back to your side. */
export default async function PasswordResetPage() {
  const session = await currentSession();
  if (!session) redirect('/login');

  return (
    <main className="screen" style={{ maxWidth: 400, paddingTop: 80 }}>
      <div className="eyebrow">Agency OS</div>
      <h1 className="page-title" style={{ marginTop: 8 }}>Choose a new password</h1>
      <p className="muted" style={{ marginTop: 8, marginBottom: 24 }}>
        For <strong>{session.email}</strong>.
      </p>
      <PasswordResetForm />
    </main>
  );
}
