'use client';

import { useState } from 'react';
import { hm } from '@/lib/format';
import { OVERRUN_REASONS } from '@/engines/estimates/referenceClass';
import { recordOverrunAction } from './actions';

/**
 * One question, once, when a job ran well over: why.
 *
 * Asked at completion because that is the only moment the answer is still
 * known. Skip is a real answer — a guessed reason is worse than none, and
 * the weekly review only aggregates what was actually said.
 */
export function OverrunAsk({ taskId, overrunMinutes }: { taskId: string; overrunMinutes: number }) {
  const [answered, setAnswered] = useState(false);

  if (answered) return null;

  return (
    <div className="card card--wait" style={{ marginBottom: 12 }}>
      <p className="small">
        That ran <span className="num">{hm(overrunMinutes)}</span> over the estimate. What happened?
      </p>
      <div className="chips" style={{ marginTop: 8 }}>
        {OVERRUN_REASONS.map(([value, label]) => (
          <form key={value} action={recordOverrunAction} onSubmit={() => setAnswered(true)}>
            <input type="hidden" name="task_id" value={taskId} />
            <input type="hidden" name="reason" value={value} />
            <input type="hidden" name="overrun_minutes" value={overrunMinutes} />
            <button type="submit" className="choice">{label}</button>
          </form>
        ))}
        <button type="button" className="choice" onClick={() => setAnswered(true)}>Skip</button>
      </div>
    </div>
  );
}
