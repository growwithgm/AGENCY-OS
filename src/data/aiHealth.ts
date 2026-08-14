/**
 * Feature switches for the assistant's optional inputs.
 *
 * There is no offline mode and no health gate: the assistant is the chat,
 * always, and a turn that fails says so in a line and the conversation
 * carries on (the guards live in runAssistant and sendMessageAction).
 */

export function transcriptionConfigured(): boolean {
  return Boolean(process.env.TRANSCRIPTION_URL && process.env.TRANSCRIPTION_KEY);
}
