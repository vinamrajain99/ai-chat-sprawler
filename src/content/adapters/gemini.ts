import type { ChatAppAdapter } from './types';
import type { ConversationTurn } from '../../shared/prompt-template';
import { waitForElement } from '../dom-wait';
import { insertTextIntoEditor } from '../inject';

// Gemini DOM hooks (verified against live DOM 2026-05-24):
//   - Assistant turns are wrapped in <message-content> custom elements (the
//     inner .markdown-main-panel holds the rendered markdown). The custom-
//     element tag name is the most stable hook — Angular hashed classes on
//     surrounding nodes are not.
//   - User turns expose a `.query-text` div containing the message text plus
//     a visually-hidden "You said" screen-reader label
//     (`.cdk-visually-hidden`). readTurnText strips that before reading text
//     so it doesn't leak into the drafted prompt.
//   - The chat input is a Quill editor (`div.ql-editor[contenteditable]`)
//     inside a <rich-textarea> custom element. Same shape as the Claude
//     ProseMirror editor for our purposes.
const ASSISTANT_SELECTOR = 'message-content';
const USER_SELECTOR = '.query-text';
const INPUT_SELECTOR = 'div.ql-editor[contenteditable="true"]';
const INPUT_WAIT_MS = 8000;

function readTurnText(el: HTMLElement): string {
  if (!el.querySelector('.cdk-visually-hidden')) {
    return (el.textContent ?? '').trim();
  }
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.cdk-visually-hidden').forEach((n) => n.remove());
  return (clone.textContent ?? '').trim();
}

export const geminiAdapter: ChatAppAdapter = {
  id: 'gemini',
  matches(url) {
    return new URL(url).hostname === 'gemini.google.com';
  },
  newChatUrl: 'https://gemini.google.com/app',

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
      const role: 'user' | 'assistant' = el.matches(USER_SELECTOR) ? 'user' : 'assistant';
      const text = readTurnText(el);
      if (!text) continue;
      turns.push({ role, text });
    }
    return { turns };
  },

  async injectPrompt(text) {
    const editor = await waitForElement<HTMLElement>(INPUT_SELECTOR, INPUT_WAIT_MS);
    if (!editor) {
      console.warn('[ai-chat-sprawler] Gemini input not found within timeout');
      return false;
    }
    return insertTextIntoEditor(editor, text);
  },
};
