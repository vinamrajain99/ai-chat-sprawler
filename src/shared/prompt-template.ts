export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface DraftedPromptInput {
  /** All turns from the start of the chat through and including the
   *  assistant message containing the selection. */
  turns: ConversationTurn[];
  /** If provided, replaces all turns except the last two (the preceding
   *  user message + the selected assistant message) with this summary. The
   *  last two are always rendered verbatim. Omit for the today-style
   *  full-transcript prompt. */
  summary?: string;
  selectedText: string;
  question: string;
}

const VERBATIM_TAIL = 2;

export function buildDraftedPrompt(input: DraftedPromptInput): string {
  const { turns, summary, selectedText, question } = input;
  const sections: string[] = [];

  if (summary) {
    const tailCount = Math.min(VERBATIM_TAIL, turns.length);
    const tailTurns = turns.slice(turns.length - tailCount);
    sections.push(
      "I'm continuing a conversation from another chat. Below is context (earlier turns summarized, recent turns verbatim), then a snippet I want to ask about.",
    );
    sections.push(`## Earlier in the conversation (summary):\n\n${summary.trim()}`);
    sections.push(`## Recent turns (verbatim):\n\n${formatTurns(tailTurns)}`);
  } else {
    sections.push(
      "I'm continuing a conversation from another chat. Below is the full prior conversation, then a snippet I want to ask about.",
    );
    sections.push(`## Conversation so far:\n\n${formatTurns(turns)}`);
  }

  sections.push(`## Selected from the AI's last message:\n\n> ${selectedText.trim()}`);
  sections.push(`## My question:\n\n${question.trim()}`);

  return sections.join('\n\n');
}

function formatTurns(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `[${t.role === 'user' ? 'User' : 'AI'}]\n${t.text.trim()}`)
    .join('\n\n');
}
