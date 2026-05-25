import type { ChatAppAdapter } from './types';
import type { ConversationTurn } from '../../shared/prompt-template';
import { waitForElement } from '../dom-wait';
import { insertTextIntoEditor } from '../inject';

// Claude DOM hooks (verified against live DOM 2026-05-23):
//   - Each assistant message's markdown body is wrapped in `.standard-markdown`
//     (paragraphs inside use `.font-claude-response-body`).
//   - Each user message has an outer `[data-user-message-bubble="true"]` and
//     an inner `[data-testid="user-message"]` (with the actual text content).
//     We canonicalize on the inner testid for cleaner textContent (no leakage
//     from buttons/attachments that may live inside the bubble). If Claude
//     ever strips testids, add bubble as a fallback — but combining them in a
//     single selector would double-count, so any fallback needs explicit
//     dedup logic.
const ASSISTANT_SELECTOR = '.standard-markdown';
const USER_SELECTOR = '[data-testid="user-message"]';
// Claude's prompt input is a ProseMirror contenteditable. Match the editable
// surface directly so we don't pick up unrelated contenteditables on the page.
const INPUT_SELECTOR = 'div.ProseMirror[contenteditable="true"]';
const INPUT_WAIT_MS = 8000;

export const claudeAdapter: ChatAppAdapter = {
  id: 'claude',
  matches(url) {
    return new URL(url).hostname === 'claude.ai';
  },
  newChatUrl: 'https://claude.ai/new',

  findAssistantMessageRoot(node) {
    const el = node instanceof Element ? node : node.parentElement;
    return el?.closest<HTMLElement>(ASSISTANT_SELECTOR) ?? null;
  },

  getContext(assistantRoot) {
    const all = Array.from(
      document.querySelectorAll<HTMLElement>(`${ASSISTANT_SELECTOR}, ${USER_SELECTOR}`),
    );
    const idx = all.indexOf(assistantRoot);
    const end = idx === -1 ? all.length - 1 : idx;
    const turns: ConversationTurn[] = [];
    for (let i = 0; i <= end; i++) {
      const el = all[i];
      if (!el) continue;
      const role: 'user' | 'assistant' = el.matches(USER_SELECTOR)
        ? 'user'
        : 'assistant';
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      turns.push({ role, text });
    }
    return { turns };
  },

  async injectPrompt(text) {
    const editor = await waitForElement<HTMLElement>(INPUT_SELECTOR, INPUT_WAIT_MS);
    if (!editor) {
      console.warn('[ai-chat-sprawler] Claude input not found within timeout');
      return false;
    }
    return insertTextIntoEditor(editor, text);
  },
};
