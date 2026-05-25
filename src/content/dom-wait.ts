/**
 * Waits for an element matching `selector` to appear in the document.
 * Resolves with the element, or null if `timeoutMs` elapses first.
 *
 * Both ChatGPT and Claude hydrate their input editors asynchronously after
 * the initial document load, so injecting into them requires waiting.
 */
export function waitForElement<T extends Element = Element>(
  selector: string,
  timeoutMs: number,
): Promise<T | null> {
  const existing = document.querySelector<T>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise<T | null>((resolve) => {
    const observer = new MutationObserver(() => {
      const el = document.querySelector<T>(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}
