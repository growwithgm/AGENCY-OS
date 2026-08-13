/**
 * One quiet line when the assistant cannot answer.
 *
 * It says what is true and what still works, and it does not apologise or
 * suggest waiting: every action the assistant takes is also on a screen.
 */

export function AiHealthBanner({ healthy }: { healthy: boolean }) {
  if (healthy) return null;

  return (
    <div className="flag flag--wait" style={{ marginBottom: 12 }}>
      <span className="flag__dot" aria-hidden />
      <span>The assistant is offline — everything else works.</span>
    </div>
  );
}
