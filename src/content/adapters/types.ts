import type { AppId } from '../../shared/messages';
import type { ConversationTurn } from '../../shared/prompt-template';

export interface AssistantContext {
  /** All turns from the start of the chat through and including the
   *  assistant message containing the selection. */
  turns: ConversationTurn[];
}

export interface ChatAppAdapter {
  readonly id: AppId;
  matches(url: string): boolean;
  readonly newChatUrl: string;

  /**
   * Given any DOM node touched by a selection, return the root element of the
   * assistant message it belongs to, or null if the selection isn't inside one.
   */
  findAssistantMessageRoot(node: Node): HTMLElement | null;

  /**
   * Extract the full conversation transcript up to and including the
   * assistant message containing the selection.
   */
  getContext(assistantRoot: HTMLElement): AssistantContext;

  /**
   * On the branch tab, locate the chat input and paste the drafted prompt.
   * Returns true on success, false if the input couldn't be found in time.
   */
  injectPrompt(text: string): Promise<boolean>;
}
