/**
 * Small Shadow-DOM toast for transient notifications on the parent tab.
 * Mirrors the popup's shadow-isolation pattern so chat-app styles can't leak
 * in. Auto-dismisses after DISMISS_MS.
 */
export interface ToastHandle {
  show(message: string): void;
  destroy(): void;
}

const DISMISS_MS = 4000;

const STYLES = /* css */ `
  :host { all: initial; }
  .toast {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #f5f5f7;
    background: #1f1f23;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 10px 14px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
    max-width: 360px;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 180ms ease-out, transform 180ms ease-out;
    pointer-events: none;
  }
  .toast[data-visible="true"] {
    opacity: 1;
    transform: translateY(0);
  }
`;

export function createToast(): ToastHandle {
  const host = document.createElement('div');
  host.setAttribute('data-ai-chat-sprawler', 'toast-host');
  host.style.cssText = [
    'position: fixed',
    'bottom: 24px',
    'left: 50%',
    'transform: translateX(-50%)',
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

  const toast = document.createElement('div');
  toast.className = 'toast';
  shadow.appendChild(toast);

  let dismissTimer: number | null = null;

  return {
    show(message: string) {
      toast.textContent = message;
      toast.setAttribute('data-visible', 'true');
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => {
        toast.removeAttribute('data-visible');
        dismissTimer = null;
      }, DISMISS_MS);
    },
    destroy() {
      if (dismissTimer !== null) window.clearTimeout(dismissTimer);
      host.remove();
    },
  };
}
