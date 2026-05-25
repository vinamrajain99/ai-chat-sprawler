export interface SelectionInfo {
  text: string;
  rect: DOMRect;
  /** Cloned range — safe to hold after the user's selection collapses. */
  range: Range;
  anchorNode: Node;
}

export interface SelectionCallbacks {
  onSelect(info: SelectionInfo): void;
  onClear(): void;
}

export function watchSelection(callbacks: SelectionCallbacks): () => void {
  let lastEmittedText = '';

  const evaluate = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (lastEmittedText) {
        lastEmittedText = '';
        callbacks.onClear();
      }
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      if (lastEmittedText) {
        lastEmittedText = '';
        callbacks.onClear();
      }
      return;
    }
    if (text === lastEmittedText) return;

    const liveRange = sel.getRangeAt(0);
    const rect = liveRange.getBoundingClientRect();
    const anchorNode = sel.anchorNode;
    if (!anchorNode) return;
    if (rect.width === 0 && rect.height === 0) return;

    const range = liveRange.cloneRange();
    lastEmittedText = text;
    callbacks.onSelect({ text, rect, range, anchorNode });
  };

  const onMouseUp = () => {
    // Defer so the browser has finalized the selection before we read it.
    window.setTimeout(evaluate, 10);
  };

  const onSelectionChange = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      if (lastEmittedText) {
        lastEmittedText = '';
        callbacks.onClear();
      }
    }
  };

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('selectionchange', onSelectionChange);

  return () => {
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('selectionchange', onSelectionChange);
  };
}
