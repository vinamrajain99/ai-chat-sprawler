/**
 * User-configurable settings persisted in `chrome.storage.local`.
 *
 * `local` rather than `sync` because we store the Anthropic API key — sync
 * would propagate it across every device signed into the user's Google
 * account, which is the wrong default for a secret.
 */
export interface Settings {
  /** When true, the background worker calls the Anthropic API to summarize
   *  earlier turns before building the drafted prompt. Off by default; the
   *  extension works fine without an API key. */
  summarizationEnabled: boolean;
  /** Anthropic API key. Empty string when unset. Only the background worker
   *  reads this — content scripts never see it. */
  anthropicApiKey: string;
  /** Buttons shown in the floating popup's presets row. Up to 6. An empty
   *  array is valid and means "no presets, custom input only". */
  presetQuestions: string[];
}

const STORAGE_KEY = 'settings';

export const DEFAULT_PRESET_QUESTIONS = ['What is this?', 'Why?', 'Explain more'];

const DEFAULTS: Settings = {
  summarizationEnabled: false,
  anthropicApiKey: '',
  presetQuestions: DEFAULT_PRESET_QUESTIONS,
};

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULTS, ...(stored ?? {}) };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...current, ...patch } });
}
