import type { ChatAppAdapter } from './types';
import type { ConversationTurn } from '../../shared/prompt-template';
import { waitForElement } from '../dom-wait';
import { insertTextIntoEditor } from '../inject';

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
const ANY_MESSAGE_SELECTOR = '[data-message-author-role]';
const INPUT_SELECTOR = '#prompt-textarea';
const INPUT_WAIT_MS = 8000;

export const chatgptAdapter: ChatAppAdapter = {
  id: 'chatgpt',
  matches(url) {
    const h = new URL(url).hostname;
    return h === 'chatgpt.com' || h === 'chat.openai.com';
  },
  newChatUrl: 'https://chatgpt.com/',

  findAssistantMessageRoot(node) {
    const el = node instanceof Element ? node : node.parentElement;
    return el?.closest<HTMLElement>(ASSISTANT_SELECTOR) ?? null;
  },

  getContext(assistantRoot) {
    const all = Array.from(
      document.querySelectorAll<HTMLElement>(ANY_MESSAGE_SELECTOR),
    );
    const idx = all.indexOf(assistantRoot);
    const end = idx === -1 ? all.length - 1 : idx;
    const turns: ConversationTurn[] = [];
    for (let i = 0; i <= end; i++) {
      const el = all[i];
      if (!el) continue;
      const role = el.getAttribute('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      turns.push({ role, text });
    }
    return { turns };
  },

  async injectPrompt(text) {
    const editor = await waitForElement<HTMLElement>(INPUT_SELECTOR, INPUT_WAIT_MS);
    if (!editor) {
      console.warn('[ai-chat-sprawler] ChatGPT input not found within timeout');
      return false;
    }
    return insertTextIntoEditor(editor, text);
  },
};
