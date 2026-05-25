/**
 * Inserts `text` into a contenteditable editor, focusing it first.
 *
 * Primary path: `document.execCommand('insertText', ...)`. Deprecated but
 * works in current Chrome on ProseMirror and other rich-text editors.
 *
 * Fallback: dispatch a synthesized `InputEvent('beforeinput', { inputType:
 * 'insertText', data })`. Modern rich-text editors (ProseMirror, Lexical)
 * apply their own insertion in a `beforeinput` handler and then call
 * `event.preventDefault()` — so `dispatchEvent` returning false is our
 * signal that the editor accepted and handled the event.
 */
export async function insertTextIntoEditor(
  editor: HTMLElement,
  text: string,
): Promise<boolean> {
  editor.focus();
  // Give the editor a tick to register focus before insertion.
  await new Promise((r) => window.setTimeout(r, 30));

  // Select any existing content so insertText REPLACES rather than appends.
  // ChatGPT persists input drafts across tab loads — a fresh branch tab can
  // come up with stale draft text already in the editor, and execCommand
  // inserts at the cursor (which lands at end after focus), so without this
  // step prompts accumulate across branches.
  const range = document.createRange();
  range.selectNodeContents(editor);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }

  if (document.execCommand('insertText', false, text)) return true;

  const evt = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: text,
    bubbles: true,
    cancelable: true,
  });
  const editorHandled = !editor.dispatchEvent(evt);
  if (editorHandled) return true;

  console.warn('[ai-chat-sprawler] insertText fallback did not insert text');
  return false;
}
