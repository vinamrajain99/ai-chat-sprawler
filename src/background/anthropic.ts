import type { ConversationTurn } from '../shared/prompt-template';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const ANTHROPIC_VERSION = '2023-06-01';

const SUMMARIZATION_PROMPT = `You are summarizing the early part of an AI chat conversation. The user is branching to a new chat and wants to ask a follow-up about something the assistant said. The most recent user message and the assistant's reply that contains the user's focus point will be included verbatim in the new chat — your job is to summarize everything that came BEFORE those two turns.

Produce 200-400 words of prose that captures: the main topic, key facts/decisions/definitions established, and any reasoning the user is likely to lean on in their follow-up. Skip pleasantries and tangents. Use prose paragraphs, not bullet points. Refer to participants as "the user" and "the assistant".

Do NOT include a preamble like "Here is a summary" — your output will be placed directly under a markdown heading "## Earlier in the conversation (summary):". Start with the substance.

Conversation to summarize (everything BEFORE the most recent user message and assistant reply):

`;

interface AnthropicSuccessResponse {
  content: Array<{ type: string; text: string }>;
}

interface AnthropicErrorResponse {
  error: { type: string; message: string };
}

/**
 * Summarize the given turns using Claude Haiku. Throws on any failure
 * (network, non-2xx, malformed response) so the caller can decide fallback.
 */
export async function summarize(
  turns: ConversationTurn[],
  apiKey: string,
): Promise<string> {
  const transcript = turns
    .map((t) => `[${t.role === 'user' ? 'User' : 'AI'}]\n${t.text.trim()}`)
    .join('\n\n');

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: SUMMARIZATION_PROMPT + transcript,
      },
    ],
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Required when calling the API from a non-server context (browser /
      // extension). The "dangerous" framing is about exposing the key to
      // untrusted page JS — we only call from the background worker, so the
      // key never reaches a content script.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = (await res.json()) as AnthropicErrorResponse;
      if (err.error?.message) detail = `${detail}: ${err.error.message}`;
    } catch {
      // ignore — keep the HTTP-status detail
    }
    throw new Error(`Anthropic API error — ${detail}`);
  }

  const data = (await res.json()) as AnthropicSuccessResponse;
  const text = data.content?.[0]?.text?.trim();
  if (!text) {
    throw new Error('Anthropic API returned no text content');
  }
  return text;
}
