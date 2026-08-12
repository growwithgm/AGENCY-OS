import { currentSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  link_invalid: 'That link was not valid. Request a new one.',
  link_expired: 'That link has expired. Request a new one.',
  no_access: 'That account has no access here.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  if (session?.role === 'operator') redirect('/');
  if (session?.role === 'client') redirect('/portal');

  const { error } = await searchParams;

  return (
    <main className="screen" style={{ maxWidth: 400, paddingTop: 80 }}>
      <div className="eyebrow">Ledger</div>
      <h1 className="page-title" style={{ marginTop: 8 }}>Sign in</h1>
      <p className="muted" style={{ marginTop: 8, marginBottom: 24 }}>
        Enter your email and we&rsquo;ll send you a link. No password to remember.
      </p>

      {error && ERRORS[error] && (
        <p className="small" style={{ color: 'var(--risk)', marginBottom: 16 }}>
          {ERRORS[error]}
        </p>
      )}

      <LoginForm audience="operator" />

      <p className="tiny dim" style={{ marginTop: 28 }}>
        Client of the agency? <a href="/portal/login">Use the client portal</a>.
      </p>
    </main>
  );
}
