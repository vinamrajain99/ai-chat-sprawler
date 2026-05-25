import { getSettings, setSettings } from '../shared/settings';

const toggle = document.getElementById('toggle') as HTMLInputElement;
const apiKey = document.getElementById('apiKey') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLSpanElement;
const presetsList = document.getElementById('presets') as HTMLDivElement;
const addPresetBtn = document.getElementById('addPreset') as HTMLButtonElement;

const PRESET_CAP = 6;

// Local working copy of the preset list — the source of truth while the user
// is editing. Persisted to settings on Save (after trimming + dropping empties).
let presets: string[] = [];

function renderPresets(): void {
  presetsList.replaceChildren();
  presets.forEach((value, i) => {
    const row = document.createElement('div');
    row.className = 'preset-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.maxLength = 80;
    input.placeholder = 'Preset question…';
    input.addEventListener('input', () => {
      presets[i] = input.value;
    });
    row.appendChild(input);

    row.appendChild(
      makeIconBtn('↑', 'Move up', i === 0, () => {
        const prev = presets[i - 1];
        const cur = presets[i];
        if (prev === undefined || cur === undefined) return;
        presets[i - 1] = cur;
        presets[i] = prev;
        renderPresets();
      }),
    );
    row.appendChild(
      makeIconBtn('↓', 'Move down', i === presets.length - 1, () => {
        const cur = presets[i];
        const next = presets[i + 1];
        if (cur === undefined || next === undefined) return;
        presets[i] = next;
        presets[i + 1] = cur;
        renderPresets();
      }),
    );
    row.appendChild(
      makeIconBtn('×', 'Remove', false, () => {
        presets.splice(i, 1);
        renderPresets();
      }),
    );

    presetsList.appendChild(row);
  });
  addPresetBtn.disabled = presets.length >= PRESET_CAP;
}

function makeIconBtn(
  text: string,
  label: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.textContent = text;
  btn.setAttribute('aria-label', label);
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

async function load(): Promise<void> {
  const s = await getSettings();
  toggle.checked = s.summarizationEnabled;
  apiKey.value = s.anthropicApiKey;
  presets = [...s.presetQuestions];
  renderPresets();
}

function showStatus(text: string, tone: 'success' | 'error' | 'muted'): void {
  status.textContent = text;
  status.setAttribute('data-tone', tone);
}

async function save(): Promise<void> {
  const enabled = toggle.checked;
  const key = apiKey.value.trim();
  if (enabled && !key) {
    showStatus('Enable summarization requires an API key.', 'error');
    return;
  }
  const cleaned = presets.map((p) => p.trim()).filter((p) => p.length > 0);
  try {
    await setSettings({
      summarizationEnabled: enabled,
      anthropicApiKey: key,
      presetQuestions: cleaned,
    });
    // Reflect the cleaned list back into the UI so the user sees what was saved.
    presets = [...cleaned];
    renderPresets();
    showStatus('Saved.', 'success');
    window.setTimeout(() => showStatus('', 'muted'), 2500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showStatus(`Save failed: ${msg}`, 'error');
  }
}

saveBtn.addEventListener('click', () => {
  void save();
});

apiKey.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void save();
});

addPresetBtn.addEventListener('click', () => {
  if (presets.length >= PRESET_CAP) return;
  presets.push('');
  renderPresets();
  // Focus the input that was just added.
  const lastInput = presetsList.querySelector<HTMLInputElement>(
    '.preset-row:last-child input',
  );
  lastInput?.focus();
});

void load();
