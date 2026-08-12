import { resolvePortalToken } from '@/lib/portalAuth';
import { db } from '@/lib/db';
import { RequestForm } from './RequestForm';

export const dynamic = 'force-dynamic';

export default async function RequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await resolvePortalToken(token);

  if (!session) {
    return (
      <main className="container container--narrow">
        <h1>Enlace no válido</h1>
        <p>Este enlace ha caducado o ha sido revocado.</p>
      </main>
    );
  }

  const { data: client } = await db()
    .from('clients').select('name, locale').eq('id', session.clientId).single();
  const locale = client?.locale ?? 'es';
  const en = locale.startsWith('en');

  return (
    <main className="container container--narrow">
      <h1>{en ? 'Request work' : 'Solicitar trabajo'}</h1>
      <p className="muted small">{client?.name}</p>
      <RequestForm token={token} locale={locale} />
      <p><a href={`/c/${token}`}>← {en ? 'Back' : 'Volver'}</a></p>
    </main>
  );
}
