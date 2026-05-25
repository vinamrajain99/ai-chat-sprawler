# AI Chat Sprawler

Chrome extension (Manifest V3) that lets users branch a new chat session from selected text inside an AI chatbot response. On selection, a floating popup offers preset follow-up questions (or custom input); choosing one opens a new tab in the same chat app (ChatGPT, Claude, Gemini) with the input pre-filled with the selected text, surrounding context, and the user's question.

See `Project requirements.md` for the full product description.

## MVP scope (shipped + Phase E + Phase F)
- Target apps: **ChatGPT** (chatgpt.com), **Claude** (claude.ai), **Gemini** (gemini.google.com)
- Selection-triggered floating popup (inline button row in Shadow DOM)
- Preset questions + custom text input
- New chat opens in a new tab; input is **pre-filled only** (user hits Enter)
- Context defaults to the **full conversation transcript** from chat start through and including the assistant message containing the selection (no LLM call). Optionally — behind a settings toggle, off by default — earlier turns are summarized by **Claude Haiku 4.5** with the user's own API key; the last 2 turns (preceding user message + selected assistant message) stay verbatim. See `DECISIONS.md` D11, D16, D18.
- Settings page (`options_ui`) exposes the summarization toggle + API key field. Settings persist in `chrome.storage.local` (deliberately NOT `sync` — the key is a secret).

## Tech stack
- TypeScript (strict, `noUncheckedIndexedAccess`)
- Vite 5 + `@crxjs/vite-plugin@2.0.0-beta.x` for MV3 build
- No UI framework — vanilla DOM inside a Shadow root for the popup

## Build / dev commands
- `npm run build` — typecheck (`tsc --noEmit`) + Vite production build to `dist/`. Load `dist/` as the unpacked extension in `chrome://extensions`.
- `npm run typecheck` — typecheck only.
- `npm run dev` — Vite watch mode. Re-load the extension in `chrome://extensions` after content-script changes.

## Directory layout
```
src/
  manifest.ts                  # @crxjs MV3 manifest (CHAT_HOSTS + API_HOSTS split)
  background/
    index.ts                   # service worker — create-branch + claim-prompt handlers; calls summarize + builds the drafted prompt
    anthropic.ts               # Anthropic API client (Haiku 4.5 summarize())
  content/
    index.ts                   # content script entry (parent + branch tabs)
    selection.ts               # selection watcher (mouseup + selectionchange)
    popup.ts                   # shadow-DOM floating popup (presets / custom-input / busy "Summarizing…" modes)
    highlight.ts               # CSS Custom Highlight API wrapper
    toast.ts                   # shadow-DOM toast for transient notifications (branch-tab summarization failures)
    dom-wait.ts                # waitForElement(selector, timeoutMs) helper
    inject.ts                  # insertTextIntoEditor() — execCommand + InputEvent fallback
    adapters/
      types.ts                 # ChatAppAdapter interface
      index.ts                 # registry + findAdapter()
      chatgpt.ts
      claude.ts
      gemini.ts
  options/
    index.html                 # settings page (toggle + API key + save status)
    index.ts                   # settings page logic
  shared/
    messages.ts                # cross-context message types
    prompt-template.ts         # buildDraftedPrompt() — harmonized labeled-section format, optional summary
    settings.ts                # chrome.storage.local-backed getSettings/setSettings
```

## Architecture
Four execution contexts:
1. **Content script** (parent tab): selection detection, popup UI, transcript extraction, sends raw `{ turns, selectedText, question, appId }` to background.
2. **Background service worker**: reads settings, optionally calls `anthropic.summarize` on earlier turns, builds the drafted prompt via `buildDraftedPrompt`, opens the branch tab, stashes `{ draftedPrompt, summarizationFailed }` in `chrome.storage.session` keyed by new `tabId`.
3. **Content script** (branch tab): on load, claims the pending bundle from session storage, injects the prompt into the chatbot's input element, and shows a toast if `summarizationFailed` is true (the parent tab can't, because focus has shifted by then — see DECISIONS.md D17).
4. **Options page**: minimal settings UI for the summarization toggle + Anthropic API key. Persists via `shared/settings.ts`. The API key is read only by the background worker (D15).

Each chatbot is encapsulated behind a `ChatAppAdapter` interface (selectors + injection logic). Adding a new chat app = one new adapter file + entries in `AppId` (messages.ts), `CHAT_HOSTS` (manifest.ts), and `NEW_CHAT_URLS` (background/index.ts). TypeScript's `Record<AppId, string>` on `NEW_CHAT_URLS` makes missed wiring a build error, not a runtime surprise.

## Files of note
- `README.md` — public-facing intro, install/usage, settings, architecture, contributor guide (`add a new chat-app adapter`).
- `LICENSE` — MIT, Vinamra Jain 2026.
- `Project requirements.md` — original product brief.
- `DECISIONS.md` — architectural decisions and rationale.
- `TODO.md` — backlog and current focus.
- `PROGRESS.md` — dated session log.

All of the above are checked into the public GitHub repo. The session-handoff files (TODO, PROGRESS, DECISIONS) double as transparent dev-history for OSS visitors and as continuity aids across AI-assisted dev sessions.

## Working rules
- Don't claim a UI change works without exercising it in a real browser on chatgpt.com, claude.ai, and gemini.google.com.
- DOM selectors for chat apps are brittle. Adapters must fail loudly (console warn) if expected selectors don't resolve, so breakage is visible.
- The drafted prompt format is a wire format between adapters and the branch tab — change it deliberately.
- When adding a new chat-app adapter, ask the user for live DOM samples (outer HTML of an assistant message, a user message, the input element) before writing selectors. The Claude adapter cost a verification cycle when first-pass guesses didn't match; the Gemini adapter avoided this by pasting DOM up front.
