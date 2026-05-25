# TODO

## Current focus
**Nothing in flight.** Phase G is now fully verified on all three apps (Claude focus regression fixed in 2026-05-25 session). ChatGPT cross-branch prompt-accumulation bug fixed in same session. `README.md` + `LICENSE` (MIT, Vinamra Jain 2026) added 2026-05-25 in preparation for open-sourcing on GitHub. Repo is live at `https://github.com/vinamrajain99/ai-chat-sprawler` (public). Most project docs (TODO, DECISIONS, Project requirements) are checked into the public repo for transparency; PROGRESS.md is gitignored as session-handoff scaffolding — see DECISIONS.md D22 addendum. See `## Robustness fixes` below for the session's fixes and `## Backlog` for next-session candidates.

## Open-source rollout
- [x] Update the README install instructions — GitHub handle (`vinamrajain99`) filled in 2026-05-25 via `gh auth status` lookup
- [x] `git init` + initial commit — done 2026-05-25 on branch `main`, commit `e8116ba`, 28 files
- [x] Create the GitHub repo and push — live at `https://github.com/vinamrajain99/ai-chat-sprawler` (public), pushed 2026-05-25
- [ ] Add an extension icon (manifest currently has none — Chrome shows the default puzzle piece)
- [ ] Optional polish: demo GIF or static screenshot in README, Chrome Web Store listing assets

## MVP build order

### Phase A — Scaffold
- [x] `package.json`, `tsconfig.json`, `vite.config.ts`, `src/manifest.ts`, dir layout
- [x] Empty content script logs adapter id on chatgpt.com + claude.ai

### Phase B — Selection UI (verified working in browser)
- [x] Selection watcher (`src/content/selection.ts`) — mouseup + selectionchange, emits rect + range + anchor
- [x] Shadow-DOM popup (`src/content/popup.ts`) — `[What is this?] [Why?] [Explain more] [+]`, `+` expands to custom-input row
- [x] Adapter interface (`src/content/adapters/types.ts`) + registry (`src/content/adapters/index.ts`)
- [x] ChatGPT adapter read side (`[data-message-author-role="assistant"]`)
- [x] Claude adapter read side (`.standard-markdown` — verified working)
- [x] Drafted prompt builder (`src/shared/prompt-template.ts`)
- [x] Popup interaction-aware dismissal (`isInteracting()`) so focusing the custom input doesn't kill the popup
- [x] Click-outside dismissal via `popup.contains()` + capture-phase `mousedown` listener
- [x] Selection-preserving highlight using CSS Custom Highlight API (`src/content/highlight.ts`); only activates after `+`
- [x] **Manual verification in Chrome** — popup appears on assistant selections in both ChatGPT and Claude; preceding user prompt extracted correctly; native selection visible in presets mode; highlight kicks in on `+`; dismissal works on Esc / click-outside / scroll

### Phase C — Handoff to branch tab (verified working in browser)
- [x] Background worker: receive `create-branch`, open new tab, write prompt to `chrome.storage.session` keyed by new `tabId`
- [x] Background worker: receive `claim-prompt`, look up by `sender.tab.id`, return + delete
- [x] Background worker: clear orphaned entries on `chrome.tabs.onRemoved`
- [x] Content-script claim path on load (`claimAndInject`)
- [x] Wire `popup.onSubmit` → `chrome.runtime.sendMessage({ type: 'create-branch' })`

### Phase D — Input injection (verified working in browser)
- [x] ChatGPT adapter `injectPrompt` — waits for `#prompt-textarea`, focuses, `execCommand('insertText', false, text)`
- [x] Claude adapter `injectPrompt` — waits for `div.ProseMirror[contenteditable="true"]`, focuses, `execCommand('insertText', false, text)`
- [x] Shared `waitForElement` helper (`src/content/dom-wait.ts`)
- [x] **End-to-end smoke test on ChatGPT** — passed 2026-05-23
- [x] **End-to-end smoke test on Claude** — passed 2026-05-23

## Polish (verified working in browser)
- [x] Tighten Claude `USER_SELECTOR` — dropped dead `.font-user-message` selector. Bubble fallback was added then later reverted (the transcript walk in `getContext` would double-count user messages if both bubble and testid matched). Settled on canonical `[data-testid="user-message"]`; if Claude ever drops testids we'll need explicit dedup logic.
- [x] Synthesized `InputEvent` fallback for `injectPrompt` — extracted to shared `src/content/inject.ts` (`insertTextIntoEditor`); execCommand still primary, falls through to dispatching `new InputEvent('beforeinput', { inputType: 'insertText', data: text })` and treats `dispatchEvent` returning false (editor called preventDefault) as success
- [x] Claim-retry on the branch tab — one retry at 200ms in `claimAndInject` covers the storage-write race
- [x] Viewport clamping for popup position — flips above the selection when there's no room below, clamps to viewport top/bottom bounds

## MVP+ — context quality + orphan handling (verified working in browser)
- [x] **Full conversation transcript as context** — drafted prompt now includes every turn from chat start through and including the message containing the selection (was previously just preceding-user-prompt + selected assistant message). `AssistantContext.turns: ConversationTurn[]`. Touched `prompt-template.ts`, `adapters/types.ts`, both adapters, `content/index.ts`. See DECISIONS.md D11.
- [x] **`safeSendMessage` wrapper** in `src/content/index.ts` — wraps every `chrome.runtime.sendMessage` call so the "Extension context invalidated" error from orphaned content scripts (after an extension reload while chat tabs are still open) no-ops silently instead of surfacing as a card error. User still has to hard-refresh affected tabs to get the new content script running, but the noise is gone.

## Phase E — Gemini adapter (verified working in browser 2026-05-24)
- [x] `'gemini'` added to `AppId` union in `src/shared/messages.ts`
- [x] `https://gemini.google.com/*` added to `HOSTS` in `src/manifest.ts`
- [x] New adapter `src/content/adapters/gemini.ts`:
  - `ASSISTANT_SELECTOR = 'message-content'` (custom-element tag — see DECISIONS.md D13)
  - `USER_SELECTOR = '.query-text'`
  - `INPUT_SELECTOR = 'div.ql-editor[contenteditable="true"]'` (Quill editor inside `<rich-textarea>`)
  - `readTurnText` helper strips `.cdk-visually-hidden` screen-reader labels so "You said" doesn't leak into the prompt (Gemini-specific; first adapter to need per-role text extraction)
- [x] Registered in `src/content/adapters/index.ts`
- [x] `gemini: 'https://gemini.google.com/app'` added to `NEW_CHAT_URLS` in `src/background/index.ts`
- [x] **End-to-end smoke test on Gemini** — passed 2026-05-24 (popup appears on assistant selections, branch tab opens at `/app`, prompt pre-fills the Quill editor)

## Phase G — Customize preset questions (verified working in browser)
All three apps pass end-to-end. Claude focus regression fixed 2026-05-25 — see `## Robustness fixes` below.

- [x] `presetQuestions: string[]` added to Settings schema with default `['What is this?', 'Why?', 'Explain more']`. Exported `DEFAULT_PRESET_QUESTIONS` constant. (`src/shared/settings.ts`)
- [x] Options page preset-list editor: editable rows, ↑/↓ reorder, × remove, "+ Add preset" disabled at cap of 6. Empty rows trimmed and dropped on save. Save button moved out of the API-key card into a footer action bar so it applies across all settings cards. (`src/options/{index.html,index.ts}`)
- [x] Popup accepts presets via `PopupOptions` (renamed from `PopupCallbacks` since it now carries data + callbacks). Buttons built dynamically from the array; empty array → only `[+]` button rendered. (`src/content/popup.ts`)
- [x] Content script reads settings at init via `await getSettings()` and passes `presetQuestions` into `createPopup`. `setupSelectionPopup` now async; called with `void`. **Caveat:** preset changes only apply after the chat tab is reloaded (no `chrome.storage.onChanged` listener). (`src/content/index.ts`)
- [x] Popup width clamp bumped 320 → 480 (`POPUP_EST_WIDTH`) so 6 preset buttons fit without viewport overflow. First attempt used dynamic `offsetWidth` measurement; reverted because the layout flush interferes with focus. See DECISIONS.md D19.
- [x] End-to-end verified on **ChatGPT** (presets render, reorder, cap, empty → custom-only all work).
- [x] End-to-end verified on **Gemini** (same).
- [x] End-to-end verified on **Claude** — `+` → custom-input typing now lands in our popup input. Fix shipped 2026-05-25, see `## Robustness fixes`.

## Multi-turn branch handling — confirmed working out-of-the-box (2026-05-24)
User sanity-checked: selecting from inside a branched chat → branch again works, because branch tabs are still on the same chat-app hosts where adapters already match. No feature work needed; the verbatim-transcript / summarization paths both apply normally.

## Phase F — Opt-in LLM summarization with Claude Haiku 4.5 (verified working in browser 2026-05-24)
Claude-only first; multi-provider is now in Backlog. Off by default — extension still works fine without an API key.

- [x] **Settings storage layer** (`src/shared/settings.ts`) — `getSettings`/`setSettings` wrapping `chrome.storage.local` (NOT `sync` — API key is a secret). Schema: `{ summarizationEnabled, anthropicApiKey }`. Defaults: enabled=false, key=''.
- [x] **Options page** (`src/options/index.html` + `src/options/index.ts`) — minimal: toggle, password-typed key field, save button with status line, help link to console.anthropic.com. Wired via `options_ui` in manifest with `open_in_tab: true`.
- [x] **Anthropic API client** (`src/background/anthropic.ts`) — POSTs to `/v1/messages` with model `claude-haiku-4-5-20251001`, `max_tokens: 1024`, `anthropic-dangerous-direct-browser-access: true` header. Embedded summarization prompt instructs Haiku to skip preamble (output goes directly under a markdown heading). Throws on any failure so the caller can decide fallback.
- [x] **Manifest updates** — `options_ui` declared; `https://api.anthropic.com/*` added to host_permissions only (NOT content_scripts.matches — split `CHAT_HOSTS` from `API_HOSTS`).
- [x] **Wire format refactor** — `CreateBranchRequest` now carries `{ turns, selectedText, question, appId }` (raw data) instead of a finished `draftedPrompt` string. `buildDraftedPrompt` moved to be called from `src/background/index.ts`. See DECISIONS.md D16.
- [x] **Drafted-prompt format harmonized** (`src/shared/prompt-template.ts`) — both paths share a one-line preamble + `## Selected from the AI's last message:` / `## My question:` footer. Summary path uses `## Earlier in the conversation (summary):` + `## Recent turns (verbatim):`. Non-summary path uses `## Conversation so far:`. See DECISIONS.md D16.
- [x] **Summarization integration** (`src/background/index.ts`) — when settings enabled + key set + `turns.length > VERBATIM_TAIL` (2), summarize `turns[0..-2]`. The last 2 turns (preceding user message + selected assistant message) are always verbatim. Short conversations (≤ 2 turns) skip the API call entirely.
- [x] **Branch-tab failure toast** (`src/content/toast.ts`, used in `claimAndInject`) — Shadow-DOM toast at bottom of viewport, auto-dismiss 4s, leads with ⚠️. Triggered on `ClaimPromptResponse.summarizationFailed`. Storage stash bundle is `{ draftedPrompt, summarizationFailed }`. See DECISIONS.md D17 for why the toast lives on the branch tab rather than the parent.
- [x] **Popup busy state** (`src/content/popup.ts`) — `setBusy(true)`/`isBusy()` shows a spinner + "Summarizing…" label and suppresses outside-click/Esc/scroll dismissals until the response lands. Content script only triggers busy state when summarization will actually run (mirrors the background's gate).
- [x] **End-to-end verification** — Test A (toggle off), Test B (toggle on + valid key), Test C (toggle on + invalid key → toast), and toggle-row layout fix all passed.

## Robustness fixes (verified working in browser 2026-05-25)
- [x] **Claude `+` → custom-input focus regression** — popup input was visually appearing but keystrokes went to Claude's ProseMirror chat input. Root cause identified via instrumentation (focusin / blur logging in `popup.ts` + document-level focusin listener in `content/index.ts`): Claude has a document-level `keydown` handler that refocuses ProseMirror on any keystroke ("type-anywhere-goes-to-chat" UX pattern). Our focus call was succeeding cleanly; the steal happened on the first keystroke. **Fix:** bubble-phase `stopPropagation` on `keydown`/`keypress`/`beforeinput` at the popup's input (`src/content/popup.ts`). The previous session's three "fix attempts" (`void offsetWidth`, sync-vs-`setTimeout` focus, `requestAnimationFrame` re-assert) were addressing a hypothesis the logs disproved and have been reverted to simplify the click handler. See DECISIONS.md D19 addendum + D20.
- [x] **ChatGPT cross-branch prompt accumulation** — branching repeatedly into ChatGPT produced inputs containing the concatenated drafts from every prior branch. Root cause: ChatGPT persists `#prompt-textarea` drafts across tab loads; our `execCommand('insertText')` inserts at cursor (which lands at the end of restored content after focus), so each branch's prompt was appended to whatever was already there. **Fix:** `insertTextIntoEditor` in `src/content/inject.ts` now selects all existing editor content via `Range.selectNodeContents` + Selection API before insertion, so `insertText` replaces rather than appends. Defensive across all three adapters (Claude/Gemini may have latent draft-persistence behavior even though no user reports yet). See DECISIONS.md D21.

## Backlog (post-MVP features)
- **Multi-provider summarization (OpenAI + Gemini, possibly local via Ollama)** — Claude is fine but BYO-key users may already have a different key. Add a provider abstraction (`SummarizationProvider` interface) and adapters per provider. Settings page gains a provider dropdown. Removes the Anthropic-key gate that today blocks OpenAI/Google-key users.
- Options to customize preset questions (settings-page extension; small)
- Auto-submit toggle in settings (settings-page extension; small; watch for per-app submit-semantics differences)
- Firefox port (MV3 + WebExtensions polyfill)

## Blocked
- Nothing currently.

## Tech backlog (deferred robustness work)
Items we've consciously chosen not to fix yet. Each has a known trigger and a sketch of the fix; revisit when the symptom is observed in the wild or before a public release.

- **Inject-failure recovery (covers ChatGPT login-redirect + any other inject failure)** — when `adapter.injectPrompt` returns false in `claimAndInject` (`src/content/index.ts:26–46`), the drafted prompt is silently lost because the background already deleted it from `chrome.storage.session` when serving the claim. The most common trigger is the ChatGPT login redirect: `chrome.tabs.create('https://chatgpt.com/')` lands on a login page, `waitForElement('#prompt-textarea', 8000)` times out, prompt vanishes. Narrow today (only affects logged-out users) but mildly infuriating when it hits. **Fix sketch:** on inject failure, either (a) re-stash the prompt in `chrome.storage.session` under the same tabId for a retry on next navigation, or (b) surface a non-blocking notification with the prompt text so the user can paste it manually. Option (a) is more invisible; (b) is simpler. ~30 min work, also future-proofs against `execCommand`-and-fallback both failing.
- **`document.execCommand('insertText')` deprecation** — primary inject path in `src/content/inject.ts`. Deprecated since ~2018, no announced removal date, still works in current Chrome. We have a `beforeinput` `InputEvent` fallback in the same file, but it's never been exercised in production (execCommand never returns false today). **Risk if Chrome ever removes execCommand:** the fallback *probably* works against ProseMirror (ChatGPT) and Lexical-style editors (Claude) because both apply their edits in a `beforeinput` handler and call `preventDefault`, which is exactly what we check for. Non-zero chance an editor rejects synthesized events with `isTrusted: false`. **Fix sketch:** when removal becomes likely, swap the primary path to `beforeinput` and run a manual smoke test on both apps; if either rejects, fall back to paste-event simulation (`ClipboardEvent('paste')` with a DataTransfer payload) or app-specific deep integration.

## Known fragility (residual)
- The new ChatGPT tab can land at a redirect (login page, etc.) — claim still fires, inject fails because input isn't present. See Tech backlog → "Inject-failure recovery" for the planned fix.
- `document.execCommand('insertText')` is deprecated. We have a `beforeinput` fallback in `inject.ts`. See Tech backlog → "execCommand deprecation" for the planned migration.
