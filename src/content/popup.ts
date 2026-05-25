export interface PopupOptions {
  /** Preset-question button labels shown in the popup. Empty array → no
   *  preset buttons (the [+] custom-input affordance is always present). */
  presets: string[];
  onSubmit(question: string): void;
  onClose(): void;
  /** Fires when the user clicks `+` to open the custom-question input. */
  onExpand(): void;
}

export interface PopupHandle {
  show(rect: DOMRect): void;
  hide(): void;
  isOpen(): boolean;
  /**
   * True once the user has clicked into the popup (e.g. opened the custom
   * input). Focusing the input collapses the page's text selection, which
   * would otherwise be misread as a dismissal — use this to suppress that.
   */
  isInteracting(): boolean;
  /**
   * True while the popup is in the "summarizing…" state — set after the user
   * submits and we're waiting on the background's create-branch response.
   * Click-outside and Escape dismissals should be suppressed while busy.
   */
  isBusy(): boolean;
  setBusy(busy: boolean): void;
  /** Whether the given event target is inside the popup. */
  contains(target: EventTarget | null): boolean;
  destroy(): void;
}

const POPUP_OFFSET_Y = 8;
const POPUP_MIN_PADDING = 8;
// Approximate popup height (presets mode). Used only for the placement
// decision (below vs above the selection) when near a viewport edge.
const POPUP_EST_HEIGHT = 40;
// Approximate maximum popup width. Generous enough to cover the 6-preset
// cap (each button ~70-100px + the [+] button). Static estimate is simpler
// than measuring offsetWidth after open, which would force a layout flush
// inside the selection-event handler.
const POPUP_EST_WIDTH = 480;

const STYLES = /* css */ `
  :host { all: initial; }
  .root {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #f5f5f7;
    background: #1f1f23;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    padding: 4px;
    display: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .root[data-open="true"] { display: block; }
  .row { display: flex; align-items: center; gap: 2px; white-space: nowrap; }
  .root[data-mode="custom"] .row { display: none; }
  button {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 6px;
    color: inherit;
    font: inherit;
    line-height: 1;
  }
  button:hover { background: rgba(255, 255, 255, 0.1); }
  .expand-btn {
    padding: 6px 9px;
    font-weight: 600;
    opacity: 0.75;
  }
  .expand-btn:hover { opacity: 1; }
  .custom { display: none; gap: 4px; padding: 2px; }
  .root[data-mode="custom"] .custom { display: flex; }
  input {
    all: unset;
    background: rgba(255, 255, 255, 0.08);
    padding: 6px 10px;
    border-radius: 6px;
    min-width: 240px;
    color: inherit;
    font: inherit;
  }
  input::placeholder { color: rgba(245, 245, 247, 0.5); }
  .submit {
    background: #6f57e6;
    padding: 6px 10px;
    font-weight: 600;
  }
  .submit:hover { background: #8473ee; }
  .busy {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 13px;
    opacity: 0.85;
  }
  .root[data-mode="busy"] .row,
  .root[data-mode="busy"] .custom { display: none; }
  .root[data-mode="busy"] .busy { display: flex; }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.25);
    border-top-color: rgba(255, 255, 255, 0.9);
    animation: sprawler-spin 700ms linear infinite;
  }
  @keyframes sprawler-spin { to { transform: rotate(360deg); } }
`;

export function createPopup(options: PopupOptions): PopupHandle {
  const host = document.createElement('div');
  host.setAttribute('data-ai-chat-sprawler', 'popup-host');
  host.style.cssText = [
    'position: absolute',
    'top: 0',
    'left: 0',
    'z-index: 2147483647',
    'pointer-events: none',
    'margin: 0',
    'padding: 0',
  ].join(';');
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'root';
  root.setAttribute('data-mode', 'presets');
  root.style.pointerEvents = 'auto';
  shadow.appendChild(root);

  const presetRow = document.createElement('div');
  presetRow.className = 'row';
  for (const preset of options.presets) {
    const btn = document.createElement('button');
    btn.textContent = preset;
    btn.dataset.preset = preset;
    presetRow.appendChild(btn);
  }
  const expandBtn = document.createElement('button');
  expandBtn.className = 'expand-btn';
  expandBtn.textContent = '+';
  expandBtn.setAttribute('aria-label', 'Ask a custom question');
  expandBtn.dataset.action = 'expand';
  presetRow.appendChild(expandBtn);
  root.appendChild(presetRow);

  const customRow = document.createElement('div');
  customRow.className = 'custom';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Ask anything about this…';
  const submitBtn = document.createElement('button');
  submitBtn.className = 'submit';
  submitBtn.textContent = '↵';
  submitBtn.dataset.action = 'submit';
  customRow.appendChild(input);
  customRow.appendChild(submitBtn);
  root.appendChild(customRow);

  const busyRow = document.createElement('div');
  busyRow.className = 'busy';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  const busyLabel = document.createElement('span');
  busyLabel.textContent = 'Summarizing…';
  busyRow.appendChild(spinner);
  busyRow.appendChild(busyLabel);
  root.appendChild(busyRow);

  // Keep page selection alive when clicking the popup.
  root.addEventListener('mousedown', (e) => e.preventDefault());

  root.addEventListener('click', (e) => {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const presetEl = target.closest<HTMLElement>('[data-preset]');
    if (presetEl) {
      options.onSubmit(presetEl.dataset.preset!);
      return;
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'expand') {
      root.setAttribute('data-mode', 'custom');
      interacting = true;
      options.onExpand();
      input.focus();
      return;
    }
    if (action === 'submit') {
      const v = input.value.trim();
      if (v) options.onSubmit(v);
    }
  });

  // Stop key events from bubbling out to the chat app's document-level
  // listeners. Claude in particular has a global keydown handler that
  // refocuses ProseMirror on any keystroke ("type anywhere → goes to chat"),
  // which would steal focus from our input on the first character typed.
  // stopPropagation does not cancel the input's own text insertion (only
  // preventDefault would do that), so typing still works as expected here.
  for (const eventType of ['keydown', 'keypress', 'beforeinput'] as const) {
    input.addEventListener(eventType, (e) => e.stopPropagation());
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value.trim();
      if (v) options.onSubmit(v);
    } else if (e.key === 'Escape') {
      options.onClose();
    }
  });

  let open = false;
  let interacting = false;
  let busy = false;

  return {
    show(rect: DOMRect) {
      // Compute placement before making the popup visible — avoids reading
      // layout (offsetWidth) which can trigger chat-app focus observers.
      const spaceBelow = window.innerHeight - rect.bottom;
      const placeAbove =
        spaceBelow < POPUP_EST_HEIGHT + POPUP_OFFSET_Y &&
        rect.top > POPUP_EST_HEIGHT + POPUP_OFFSET_Y;
      const viewportTop = placeAbove
        ? rect.top - POPUP_EST_HEIGHT - POPUP_OFFSET_Y
        : rect.bottom + POPUP_OFFSET_Y;
      const clampedTop = Math.max(
        POPUP_MIN_PADDING,
        Math.min(viewportTop, window.innerHeight - POPUP_EST_HEIGHT - POPUP_MIN_PADDING),
      );
      const top = window.scrollY + clampedTop;
      const left =
        window.scrollX +
        Math.max(
          POPUP_MIN_PADDING,
          Math.min(rect.left, window.innerWidth - POPUP_EST_WIDTH),
        );
      host.style.top = `${top}px`;
      host.style.left = `${left}px`;
      root.setAttribute('data-open', 'true');
      root.setAttribute('data-mode', 'presets');
      input.value = '';
      open = true;
      interacting = false;
      busy = false;
    },
    hide() {
      root.removeAttribute('data-open');
      root.setAttribute('data-mode', 'presets');
      open = false;
      interacting = false;
      busy = false;
    },
    isOpen: () => open,
    isInteracting: () => interacting,
    isBusy: () => busy,
    setBusy(b: boolean) {
      busy = b;
      root.setAttribute('data-mode', b ? 'busy' : 'presets');
    },
    contains(target) {
      // Clicks inside the shadow root are retargeted to the host in light-DOM
      // listeners, so a host.contains check on the retargeted target works.
      return target instanceof Node && host.contains(target);
    },
    destroy() {
      host.remove();
    },
  };
}
