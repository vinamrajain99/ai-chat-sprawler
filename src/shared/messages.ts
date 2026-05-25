import type { ConversationTurn } from './prompt-template';

export type AppId = 'chatgpt' | 'claude' | 'gemini';

export interface CreateBranchRequest {
  type: 'create-branch';
  appId: AppId;
  /** Full conversation transcript up to and including the assistant message
   *  containing the selection. The background worker decides whether to
   *  summarize earlier turns based on user settings. */
  turns: ConversationTurn[];
  selectedText: string;
  question: string;
}

export interface CreateBranchResponse {
  ok: boolean;
}

export interface ClaimPromptRequest {
  type: 'claim-prompt';
}

export interface ClaimPromptResponse {
  draftedPrompt: string | null;
  /** True if summarization was attempted but failed for this branch. The
   *  branch-tab content script shows a toast — the parent tab can't,
   *  because by the time the response lands the user has already been
   *  navigated to the new tab. */
  summarizationFailed?: boolean;
}

export type ExtensionMessage = CreateBranchRequest | ClaimPromptRequest;
