import { findAdapter, type ChatAppAdapter } from './adapters';
import { watchSelection } from './selection';
import { createPopup } from './popup';
import { createHighlight } from './highlight';
import { createToast } from './toast';
import { getSettings } from '../shared/settings';
import type {
  ClaimPromptRequest,
  ClaimPromptResponse,
  CreateBranchRequest,
  CreateBranchResponse,
} from '../shared/messages';

const adapter = findAdapter();

if (!adapter) {
  console.log('[ai-chat-sprawler] no adapter matched for', window.location.hostname);
} else {
  console.log('[ai-chat-sprawler] adapter active:', adapter.id);

  // On every page load, ask the background worker whether this tab was opened
  // as a branch. If so, inject the drafted prompt into the chat input.
  void claimAndInject(adapter);

  void setupSelectionPopup(adapter);
}

async function claimAndInject(adapter: ChatAppAdapter): Promise<void> {
  const req: ClaimPromptRequest = { type: 'claim-prompt' };
  // Two attempts to cover the theoretical race where the new tab's content
  // script outpaces the background's storage.session.set. Non-branch tabs
  // pay one extra 200ms timer; acceptable.
  let claim: ClaimPromptResponse | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await safeSendMessage<ClaimPromptResponse>(req);
    if (res?.draftedPrompt) {
      claim = res;
      break;
    }
    if (attempt === 0) {
      await new Promise((r) => window.setTimeout(r, 200));
    }
  }
  if (!claim?.draftedPrompt) return;
  console.log('[ai-chat-sprawler] claimed pending prompt; injecting…');
  const ok = await adapter.injectPrompt(claim.draftedPrompt);
  console.log('[ai-chat-sprawler] inject result:', ok);
  if (claim.summarizationFailed) {
    // Toast lives on the branch tab, not the parent, because by the time
    // the create-branch response comes back the user has already been
    // navigated here.
    createToast().show('⚠️ Summarization failed — branched without summary.');
  }
}

/**
 * Wrapper around `chrome.runtime.sendMessage` that no-ops when the calling
 * context is invalidated (i.e. this content script is orphaned because the
 * extension was reloaded while this tab was open). Refreshing the tab is the
 * real fix; the wrapper just prevents the orphan from raising visible errors.
 */
async function safeSendMessage<T>(msg: unknown): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as T;
  } catch (err) {
    const msgText = err instanceof Error ? err.message : String(err);
    if (msgText.includes('Extension context invalidated')) return null;
    console.warn('[ai-chat-sprawler] sendMessage failed:', msgText);
    return null;
  }
}

// Same conditions the background uses to decide if it'll actually call the
// summarization API. We check here too so we can show "Summarizing…" only
// when the wait is going to be noticeable.
const VERBATIM_TAIL = 2;

async function setupSelectionPopup(adapter: ChatAppAdapter): Promise<void> {
  // Read presets once at init. Caveat: changing presets in the options page
  // requires the user to reload the chat tab. The simpler-is-better trade —
  // listening for storage changes here would mean rebuilding the popup mid-
  // session, which isn't worth the complexity for a setting that's rarely
  // changed.
  const initialSettings = await getSettings();

  let pending: {
    text: string;
    assistantRoot: HTMLElement;
    range: Range;
  } | null = null;

  const highlight = createHighlight();

  const dismiss = () => {
    pending = null;
    popup.hide();
    highlight.hide();
  };

  const popup = createPopup({
    presets: initialSettings.presetQuestions,
    onSubmit(question) {
      if (!pending) return;
      const { text, assistantRoot } = pending;
      void submit({ text, assistantRoot, question });
    },
    onClose() {
      dismiss();
    },
    onExpand() {
      if (pending) highlight.show(pending.range);
    },
  });

  async function submit(args: {
    text: string;
    assistantRoot: HTMLElement;
    question: string;
  }): Promise<void> {
    const { text, assistantRoot, question } = args;
    const ctx = adapter.getContext(assistantRoot);

    // Decide whether to show the busy state. Mirrors the background's
    // shouldSummarize check so a verbatim-only branch doesn't flash a
    // misleading "Summarizing…" indicator for the few-ms storage write.
    const settings = await getSettings();
    const willSummarize =
      settings.summarizationEnabled &&
      settings.anthropicApiKey.length > 0 &&
      ctx.turns.length > VERBATIM_TAIL;
    if (willSummarize) popup.setBusy(true);

    const req: CreateBranchRequest = {
      type: 'create-branch',
      appId: adapter.id,
      turns: ctx.turns,
      selectedText: text,
      question,
    };
    await safeSendMessage<CreateBranchResponse>(req);
    dismiss();
  }

  watchSelection({
    onSelect({ text, rect, range, anchorNode }) {
      const assistantRoot = adapter.findAssistantMessageRoot(anchorNode);
      if (!assistantRoot) {
        dismiss();
        return;
      }
      pending = { text, assistantRoot, range };
      popup.show(rect);
    },
    onClear() {
      if (popup.isInteracting() || popup.isBusy()) return;
      dismiss();
    },
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (!popup.isOpen()) return;
      if (popup.isBusy()) return;
      if (popup.contains(e.target)) return;
      dismiss();
    },
    true,
  );

  document.addEventListener(
    'scroll',
    () => {
      if (popup.isOpen() && !popup.isBusy()) dismiss();
    },
    true,
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popup.isOpen() && !popup.isBusy()) dismiss();
  });
}
