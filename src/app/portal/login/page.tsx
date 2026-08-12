import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/auth';
import { LoginForm } from '@/app/login/LoginForm';

export const dynamic = 'force-dynamic';

/**
 * Portal sign-in. Email only, no passwords, no account creation.
 * An unknown address gets the same "check your email" screen as a known
 * one — whether an address is registered is not ours to disclose.
 */
export default async function PortalLoginPage() {
  const session = await currentSession();
  if (session?.role === 'client') redirect('/portal');
  if (session?.role === 'operator') redirect('/');

  return (
    <main className="portal" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Your agency</div>
      <h1 style={{ marginBottom: 16 }}>Your work with the agency</h1>
      <p style={{ marginBottom: 24 }}>
        Enter your email and we&rsquo;ll send you a link. No password to remember.
      </p>

      <LoginForm audience="client" serif />
    </main>
  );
}
