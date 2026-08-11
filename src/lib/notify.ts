// Operator notifications land on Discord via webhook — outbound only,
// same posture as the bot gateway (no inbound ports anywhere).

export async function notifyOperator(message: string): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return; // notifications are best-effort; never crash a job over them
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message.slice(0, 1900) }),
    });
  } catch {
    // swallow — the job result itself is the source of truth
  }
}
