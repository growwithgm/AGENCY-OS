import { requireClient } from '@/lib/auth';
import { RequestFlow } from './RequestFlow';

export const dynamic = 'force-dynamic';

export default async function PortalRequestPage() {
  await requireClient();

  return (
    <main className="portal">
      <div className="row row--between" style={{ marginBottom: 22 }}>
        <a href="/portal" className="btn btn--sm btn--quiet">Close</a>
      </div>
      <RequestFlow />
    </main>
  );
}
