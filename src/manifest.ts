import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

const CHAT_HOSTS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
];

// Hosts the background worker needs to fetch from but the content script
// must NOT inject into. Currently just Anthropic's API for summarization.
const API_HOSTS = ['https://api.anthropic.com/*'];

export default defineManifest({
  manifest_version: 3,
  name: 'AI Chat Sprawler',
  version: pkg.version,
  description: pkg.description,
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: CHAT_HOSTS,
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['storage', 'tabs'],
  host_permissions: [...CHAT_HOSTS, ...API_HOSTS],
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
});
