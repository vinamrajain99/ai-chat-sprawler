/**
 * Renders a selection-style highlight over a Range using the CSS Custom
 * Highlight API. This matches the browser's native text-selection look
 * (correct line height, blend mode, etc.) without us having to position
 * overlay rects ourselves.
 *
 * Used to keep the user's selection visually highlighted after focus moves
 * into the popup's custom-question input — which collapses the native
 * document selection.
 */

const HIGHLIGHT_NAME = 'sprawler-selection';
const STYLE_ID = 'sprawler-highlight-style';

export interface HighlightHandle {
  show(range: Range): void;
  hide(): void;
  destroy(): void;
}

export function createHighlight(): HighlightHandle {
  const supported =
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof Highlight !== 'undefined';

  if (!supported) {
    return { show() {}, hide() {}, destroy() {} };
  }

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // background-color is the only widely supported property on ::highlight.
    // Tuned to roughly match Chrome's native selection blue at translucent alpha.
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(70, 137, 255, 0.35); }`;
    (document.head ?? document.documentElement).appendChild(style);
  }

  return {
    show(range) {
      const highlight = new Highlight(range);
      CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    },
    hide() {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    },
    destroy() {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      document.getElementById(STYLE_ID)?.remove();
    },
  };
}
