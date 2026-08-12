import { resolvePortalToken } from '@/lib/portalAuth';
import { db } from '@/lib/db';
import { RequestForm } from './RequestForm';

export const dynamic = 'force-dynamic';

export default async function RequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await resolvePortalToken(token);

  if (!session) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
        <h1 style={{ fontSize: 20 }}>Enlace no válido</h1>
        <p>Este enlace ha caducado o ha sido revocado.</p>
      </main>
    );
  }

  const { data: client } = await db()
    .from('clients').select('name, locale').eq('id', session.clientId).single();
  const locale = client?.locale ?? 'es';
  const en = locale.startsWith('en');

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>{en ? 'Request work' : 'Solicitar trabajo'}</h1>
      <p style={{ color: '#9aa3b2' }}>{client?.name}</p>
      <RequestForm token={token} locale={locale} />
    </main>
  );
}
