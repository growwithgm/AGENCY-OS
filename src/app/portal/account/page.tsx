import { requireClient } from '@/lib/auth';
import { ChangePasswordForm } from './ChangePasswordForm';

export const dynamic = 'force-dynamic';

/** Change password. Nothing else lives here. */
export default async function PortalAccountPage() {
  const { session } = await requireClient();

  return (
    <main className="portal" style={{ maxWidth: 480 }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Your account</div>
      <h1 style={{ marginBottom: 6 }}>Change your password</h1>
      <p style={{ marginBottom: 24 }}>Signed in as {session.email}.</p>
      <ChangePasswordForm />
      <p className="small dim" style={{ marginTop: 28 }}>
        <a href="/portal">Back to your work</a>
      </p>
    </main>
  );
}
