import { requireClient } from '@/lib/auth';
import { t, type Locale } from '@/portal/copy';
import { RequestFlow } from './RequestFlow';

export const dynamic = 'force-dynamic';

export default async function PortalRequestPage() {
  const { supabase } = await requireClient();

  // The client's own language — the whole portal speaks it, and so must
  // this flow (the report caught it answering in English under a Spanish
  // portal).
  const { data } = await supabase.from('client_profile').select('locale').maybeSingle();
  const locale = ((data?.locale as Locale) ?? 'en');
  const say = t(locale).request;

  return (
    <main className="portal">
      <div className="row row--between" style={{ marginBottom: 22 }}>
        <a href="/portal" className="btn btn--sm btn--quiet">{say.close}</a>
      </div>
      <RequestFlow copy={say} />
    </main>
  );
}
