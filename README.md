# AI Chat Sprawler

Chrome extension (Manifest V3) that lets you branch a new chat session from any selected text in an AI chatbot response. Select text → choose a follow-up question → a new chat opens in the same app, pre-filled with the selection, surrounding context, and your question.

## Why

Long AI conversations end up as one linear thread, but exploring a side question rarely is. Today, digging into a sub-topic (*"why did you choose X?"*, *"explain this part more"*) means either polluting the main thread with off-topic follow-ups, or manually copying context into a new chat and re-establishing setup. This extension turns "select → ask" into one click, opens the follow-up in its own tab, and keeps the main thread clean.

## Supported chat apps

- **ChatGPT** — `chatgpt.com`, `chat.openai.com`
- **Claude** — `claude.ai`
- **Gemini** — `gemini.google.com`

## Install (from source)

Until the extension is packaged for the Chrome Web Store, install from source:

```bash
git clone https://github.com/vinamrajain99/ai-chat-sprawler.git
cd ai-chat-sprawler
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist/` directory

Requires Node 18+ and modern npm.

## Usage

1. On any supported chat app, **select text inside an assistant response**.
2. A small floating popup appears with preset follow-up buttons and a `[+]` for a custom question.
3. Click a preset, or click `[+]` and type your own (Enter to submit, Esc to dismiss).
4. A new tab opens in the same chat app, pre-filled with:
   - The full prior conversation transcript (or a summary — see [Settings](#settings))
   - The selected text as a blockquote
   - Your question
5. Review the draft and press Enter to send.

Branches do not share state with the parent thread — each new tab is an independent chat.

## Settings

Open the extension's options page: right-click the extension icon → **Options**.

### Preset questions

- Edit, reorder (↑/↓), or remove the buttons shown in the selection popup.
- Up to 6 presets. An empty list is valid — the popup will show only the `[+]` custom-input button.
- Defaults: `What is this?`, `Why?`, `Explain more`.
- Changes apply on next reload of the chat tab.

### Opt-in summarization (Anthropic API key)

- **Off by default.** The extension works without any API key — it pre-fills the new chat with the full prior conversation verbatim.
- When enabled, earlier turns are summarized via Claude Haiku 4.5 (using your own Anthropic API key) before being included in the drafted prompt. The last two turns — the preceding user message and the assistant message containing your selection — are always kept verbatim.
- Useful for long conversations where the verbatim transcript would crowd the branch app's input.
- The API key is stored in `chrome.storage.local` (deliberately not synced to your Google account, since it's a secret). Only the extension's background service worker reads it; content scripts never see it.
- On summarization failure, the branch still happens with the verbatim transcript, and a non-blocking toast notifies you on the new tab.

## Privacy

- **No telemetry, no analytics, no third-party servers.** The extension talks to (a) the chat apps you already use and (b) the Anthropic API — and (b) only when you've explicitly enabled summarization and provided your own key.
- Selection content, transcript text, and your typed questions reach the destination chat app via its input field — the same path as if you'd pasted them yourself.
- The drafted prompt is stored briefly in `chrome.storage.session` (cleared when Chrome closes) keyed by the new tab's id, and deleted as soon as the new tab claims it.
- The Anthropic API key, when set, is stored locally via `chrome.storage.local` and is removed when the extension is uninstalled.

## Build and develop

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build into dist/
npm run dev          # Vite watch mode — reload the extension in chrome://extensions after content-script changes
```

## Architecture

Four execution contexts work together:

1. **Content script (parent tab)** — detects text selections, renders the floating popup in a Shadow DOM, extracts the conversation transcript via the active chat-app adapter, sends a `create-branch` message to the background.
2. **Background service worker** — receives `create-branch`, optionally calls the Anthropic API to summarize earlier turns, builds the final drafted prompt, opens a new tab via `chrome.tabs.create`, and stashes the prompt in `chrome.storage.session` keyed by the new tab's id.
3. **Content script (branch tab)** — on load, sends `claim-prompt` to the background, receives the drafted prompt for its tab id, and injects it into the chat app's input via the adapter.
4. **Options page** — settings UI for preset questions and the summarization toggle + API key. Persists via `chrome.storage.local`.

Each chat app is encapsulated behind a `ChatAppAdapter` interface that owns its DOM selectors, transcript extraction, and input-injection logic. Shared utilities (`insertTextIntoEditor`, `waitForElement`, `buildDraftedPrompt`) keep adapters thin.

Key design choices: the popup lives in a Shadow DOM so chat-app styles don't leak into it; handoff between parent and branch tabs uses `chrome.storage.session` keyed by the new tab's id (survives the gap between `chrome.tabs.create` and the new tab's content script booting); the default context is the full prior conversation (no LLM call, deterministic, zero setup); opt-in summarization shortens this for long chats; injection uses `execCommand('insertText')` with a `beforeinput` `InputEvent` fallback for editor families like ProseMirror/Quill/Lexical that ignore naive `.value =` assignment.

See [`DECISIONS.md`](./DECISIONS.md) for the full ADR-style rationale behind each major choice, [`PROGRESS.md`](./PROGRESS.md) for the dated session log, and [`TODO.md`](./TODO.md) for the current backlog.

### Directory layout

```
src/
  manifest.ts                  # @crxjs MV3 manifest
  background/
    index.ts                   # service worker
    anthropic.ts               # Haiku 4.5 client (summarization)
  content/
    index.ts                   # content-script entry (parent + branch tabs)
    selection.ts               # selection watcher
    popup.ts                   # shadow-DOM floating popup
    highlight.ts               # CSS Custom Highlight wrapper
    toast.ts                   # shadow-DOM toast
    dom-wait.ts                # waitForElement helper
    inject.ts                  # insertTextIntoEditor (replaces editor contents)
    adapters/
      types.ts                 # ChatAppAdapter interface
      index.ts                 # registry + findAdapter()
      chatgpt.ts, claude.ts, gemini.ts
  options/                     # settings page
  shared/                      # messages, prompt template, settings
```

### Adding a new chat-app adapter

1. **Manifest:** add the chat app's origin to `CHAT_HOSTS` in `src/manifest.ts`.
2. **App id:** add a string id to the `AppId` union in `src/shared/messages.ts`.
3. **New-chat URL:** add an entry to `NEW_CHAT_URLS` in `src/background/index.ts`. TypeScript's `Record<AppId, string>` enforces exhaustiveness here — a missed update is a build error, not a runtime surprise.
4. **Adapter file** `src/content/adapters/<your-app>.ts` implementing `ChatAppAdapter`:
   - `id`, `matches(url)`, `newChatUrl`
   - `findAssistantMessageRoot(node)` — given a DOM node from a selection, return the assistant-message container element, or `null` if the selection isn't inside an assistant message.
   - `getContext(assistantRoot)` — walk the conversation in DOM order, return ordered `{ role: 'user' | 'assistant', text }` turns from chat start through and including the assistant message.
   - `injectPrompt(text)` — wait for the chat input element (use `waitForElement`), then call `insertTextIntoEditor(editor, text)` from `src/content/inject.ts`.
5. **Register** the adapter in `src/content/adapters/index.ts`.
6. **Test end-to-end** in a real browser: select assistant text → branch → confirm pre-fill in the new tab.

**Tip:** before writing selectors, paste live DOM samples (an assistant message, a user message, the input element) into your prompt / scratch buffer. First-pass selector guesses against unfamiliar DOMs tend to miss — verifying against the actual page saves a debug cycle.

## Known limitations

- **ChatGPT login redirect.** If you're logged out, opening a new ChatGPT tab lands on a login page. The injection times out and the drafted prompt is lost. Inject-failure recovery is on the backlog.
- **`document.execCommand('insertText')` is deprecated.** A `beforeinput` `InputEvent` fallback is in place, but no removal date has been announced and the fallback hasn't been exercised in production.
- **Selectors can break.** Adapters depend on chat-app DOM structure. They log a console warning when expected selectors don't resolve, so breakage is visible rather than silent — but you may see the popup stop appearing if an app ships a significant DOM change.

## License

MIT — see [`LICENSE`](./LICENSE).
