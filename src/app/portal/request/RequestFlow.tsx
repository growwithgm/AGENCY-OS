'use client';

import { useActionState } from 'react';
import { submitRequestAction, type RequestState } from './actions';
import { COPY } from '@/portal/copy';
import { SERVICE_AREAS } from '@/portal/requestPolicy';

/**
 * The whole request on one page: title, what they need, how urgent it is
 * for them, the date they are hoping for (a calendar field), the service
 * area and a reference link. One submit.
 *
 * The boundaries hold even though the form grew: urgency is what THEY
 * said, never a priority (INV-1); "needed by" is what they asked for,
 * never a promise back (INV-6); and nothing here ever says "scheduled".
 */
export function RequestFlow() {
  const copy = COPY.request;
  const [state, action, pending] = useActionState<RequestState, FormData>(
    submitRequestAction,
    {},
  );

  if (state.done) {
    return (
      <section>
        <h2 style={{ marginBottom: 12 }}>{copy.received}</h2>
        <p>{copy.receivedBody}</p>
      </section>
    );
  }

  return (
    <form action={action}>
      <div className="cp-field">
        <label htmlFor="req-title">{copy.titleLabel}</label>
        <input
          id="req-title"
          name="title"
          className="input"
          maxLength={80}
          placeholder={copy.titlePlaceholder}
        />
      </div>

      <div className="cp-field">
        <label htmlFor="req-detail">{copy.prompt}</label>
        <textarea
          id="req-detail"
          name="detail"
          required
          rows={4}
          className="input"
          placeholder={copy.detailPlaceholder}
        />
        <div className="cp-helper">{copy.detailHelper}</div>
      </div>

      <div className="cp-row2">
        <div className="cp-field">
          <label htmlFor="req-urgency">{copy.urgencyLabel}</label>
          <select id="req-urgency" name="urgency" className="input" defaultValue="normal">
            <option value="normal">{copy.urgencyNormal}</option>
            <option value="high">{copy.urgencyHigh}</option>
            <option value="urgent">{copy.urgencyUrgent}</option>
          </select>
        </div>
        <div className="cp-field">
          <label htmlFor="req-date">{copy.neededByLabel}</label>
          <input id="req-date" name="needed_by" type="date" className="input" />
          <div className="cp-helper">{copy.neededByHelper}</div>
        </div>
      </div>

      <div className="cp-field">
        <label htmlFor="req-service">{copy.serviceLabel}</label>
        <select id="req-service" name="service_area" className="input" defaultValue="">
          <option value="">{copy.servicePlaceholder}</option>
          {SERVICE_AREAS.map((area) => (
            <option key={area} value={area}>{area}</option>
          ))}
        </select>
      </div>

      <div className="cp-field">
        <label htmlFor="req-reference">{copy.referenceLabel}</label>
        <input
          id="req-reference"
          name="reference"
          className="input"
          maxLength={500}
          placeholder={copy.referencePlaceholder}
        />
      </div>

      {state.error && <p className="small risk-text" style={{ marginBottom: 10 }}>{state.error}</p>}

      <button type="submit" className="cp-submit" disabled={pending}>
        {pending ? copy.sending : copy.submit}
      </button>

      <p className="cp-helper" style={{ marginTop: 12 }}>{copy.notCommitment}</p>
    </form>
  );
}
