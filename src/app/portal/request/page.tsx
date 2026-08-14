import Link from 'next/link';
import { requireClient } from '@/lib/auth';
import { COPY } from '@/portal/copy';
import { RequestFlow } from './RequestFlow';

export const dynamic = 'force-dynamic';

export default async function PortalRequestPage() {
  await requireClient();

  return (
    <main className="portal">
      <div className="row row--between" style={{ marginBottom: 22 }}>
        <Link href="/portal" className="btn btn--sm btn--quiet">{COPY.request.close}</Link>
      </div>
      <RequestFlow />
    </main>
  );
}
