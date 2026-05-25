import type {
  AppId,
  ClaimPromptResponse,
  CreateBranchRequest,
  CreateBranchResponse,
  ExtensionMessage,
} from '../shared/messages';
import { buildDraftedPrompt } from '../shared/prompt-template';
import { getSettings } from '../shared/settings';
import { summarize } from './anthropic';

interface PendingBranch {
  draftedPrompt: string;
  summarizationFailed: boolean;
}

const NEW_CHAT_URLS: Record<AppId, string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
  gemini: 'https://gemini.google.com/app',
};

// The last two turns (preceding user message + selected assistant message)
// are always kept verbatim. Anything before that is what summarization
// would condense — so summarization is only worth running when there are
// more than this many turns.
const VERBATIM_TAIL = 2;

const storageKey = (tabId: number) => `prompt-${tabId}`;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ai-chat-sprawler] background worker installed');
});

chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, sendResponse) => {
  if (msg?.type === 'create-branch') {
    void createBranch(msg).then(sendResponse);
    return true;
  }
  if (msg?.type === 'claim-prompt') {
    const tabId = sender.tab?.id;
    void claimPrompt(tabId).then(sendResponse);
    return true;
  }
  return false;
});

// Clean up any orphaned entry if a tab is closed before its content script claims.
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(storageKey(tabId));
});

async function createBranch(req: CreateBranchRequest): Promise<CreateBranchResponse> {
  const { appId, turns, selectedText, question } = req;

  const settings = await getSettings();
  let summary: string | undefined;
  let summarizationFailed = false;

  const shouldSummarize =
    settings.summarizationEnabled &&
    settings.anthropicApiKey.length > 0 &&
    turns.length > VERBATIM_TAIL;

  if (shouldSummarize) {
    const earlierTurns = turns.slice(0, turns.length - VERBATIM_TAIL);
    try {
      summary = await summarize(earlierTurns, settings.anthropicApiKey);
    } catch (err) {
      console.warn('[ai-chat-sprawler] summarization failed:', err);
      summarizationFailed = true;
    }
  }

  const draftedPrompt = buildDraftedPrompt({ turns, summary, selectedText, question });

  const url = NEW_CHAT_URLS[appId];
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id === undefined) {
    console.warn('[ai-chat-sprawler] new tab has no id; cannot stash prompt');
    return { ok: false };
  }
  const pending: PendingBranch = { draftedPrompt, summarizationFailed };
  await chrome.storage.session.set({ [storageKey(tab.id)]: pending });

  return { ok: true };
}

async function claimPrompt(tabId: number | undefined): Promise<ClaimPromptResponse> {
  if (tabId === undefined) return { draftedPrompt: null };
  const key = storageKey(tabId);
  const result = await chrome.storage.session.get(key);
  const stored = result[key] as PendingBranch | undefined;
  if (!stored) return { draftedPrompt: null };
  await chrome.storage.session.remove(key);
  return {
    draftedPrompt: stored.draftedPrompt,
    summarizationFailed: stored.summarizationFailed,
  };
}
