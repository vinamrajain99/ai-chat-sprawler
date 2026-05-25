# Progress log

## 2026-05-22 — Session 1: requirements review + MVP plan

**Worked on:** Read `Project requirements.md`. Discussed product and tech direction with the user. Locked in MVP scope and design choices. Bootstrapped project docs (`CLAUDE.md`, `DECISIONS.md`, `TODO.md`, `PROGRESS.md`).

**Decisions made:** See `DECISIONS.md` D1–D8. Highlights:
- Chrome extension MV3 with TypeScript + Vite + `@crxjs/vite-plugin`.
- MVP targets ChatGPT + Claude (Gemini deferred).
- Adapter pattern for per-app DOM logic.
- Pre-fill only, no auto-submit.
- Heuristic context (no LLM call) for MVP.
- Handoff via `chrome.storage.session` keyed by new tabId.
- Shadow DOM popup; input injection via simulated `InputEvent` / `execCommand`.

**Open questions left:** None at end of session; all clarifications answered before docs were written.

**State at end:** No code written yet. Docs scaffolded. Waiting on user approval to begin step 1 of the build order in `TODO.md` (project scaffold).

**Next session pickup:** Run `npm init`, install dev deps (`vite`, `@crxjs/vite-plugin`, `typescript`, `@types/chrome`), create `manifest.ts`, `vite.config.ts`, `tsconfig.json`, and the directory layout described in `CLAUDE.md`. Then move to step 2 (empty content script + injection sanity check).

## Session 2026-05-22 (continued) — scaffold + Phase B

**Shipped:**
- Project scaffold: `package.json`, `tsconfig.json` (strict, `noUncheckedIndexedAccess`), `vite.config.ts`, `.gitignore`. Installed `vite@5`, `@crxjs/vite-plugin@2.0.0-beta.34`, `typescript@5.6`, `@types/chrome`. `npm run build` succeeds, generates `dist/manifest.json` + content/service-worker chunks.
- MV3 manifest (`src/manifest.ts`): host_permissions and content_scripts matches for `chatgpt.com`, `chat.openai.com`, `claude.ai`; permissions `storage` + `tabs`.
- Content script entry (`src/content/index.ts`): adapter lookup, wires selection watcher + popup, logs the drafted prompt on submit (placeholder until Phase C).
- Selection watcher (`src/content/selection.ts`): mouseup-triggered, dedupes by selection text, emits `{text, rect, anchorNode}`; clears on collapsed selection via `selectionchange`.
- Shadow-DOM popup (`src/content/popup.ts`): inline button row `[What is this?] [Why?] [Explain more] [+]`, `+` swaps to a custom-input row, Enter submits, Escape closes, `mousedown` preventDefault preserves page selection.
- Adapter interface (`src/content/adapters/types.ts`) + registry (`index.ts`).
- ChatGPT adapter (`chatgpt.ts`): `[data-message-author-role="assistant"]` for assistant root; walks DOM-order list of message nodes to find preceding user prompt.
- Claude adapter (`claude.ts`): `.font-claude-message, [data-testid="assistant-message"]` for assistant root; same DOM-order walk for preceding user prompt. **Selectors unverified against live DOM.**
- Drafted prompt builder (`src/shared/prompt-template.ts`) + shared message types (`src/shared/messages.ts`).
- Docs: `CLAUDE.md`, `DECISIONS.md` (D1–D8), `TODO.md` brought to live MVP-tracking state.

**In progress:** Phase B is code-complete but **not yet verified in a real browser**. The user has not loaded the unpacked extension yet.

**Blocked:**
- Phase B browser verification — waiting on user to `npm run build`, load `dist/` at `chrome://extensions`, and report whether the popup behaves on chatgpt.com and claude.ai. Claude selectors in particular are best-guess and likely the first thing to break.

**Next session should pick up:**
1. Read the user's verification report.
2. Fix any selector / popup-positioning issues uncovered.
3. Start Phase C: `src/background/index.ts` receives `create-branch` message, creates new tab via `chrome.tabs.create`, stashes drafted prompt in `chrome.storage.session` keyed by the new `tabId`. Then add the branch-tab claim path in `src/content/index.ts`.

## Session 2026-05-23 — Phase B verification + Phases C+D code

**Shipped:**
- **Popup dismissal robustness** (`src/content/popup.ts`, `src/content/index.ts`):
  - Added `popup.isInteracting()` flag, set on `+` click. The `onClear` handler in the content script suppresses hides while interacting, because focusing the popup's input collapses the page selection and would otherwise be misread as a dismissal.
  - Added `popup.contains(target)` + capture-phase `mousedown` listener on document for click-outside dismissal that works in both presets and custom modes.
  - Funneled every hide path through a single `dismiss()` helper so the popup + highlight state stay in sync.
- **Selection-preserving highlight** (`src/content/highlight.ts`):
  - Initial implementation used a DOM overlay built from `Range.getClientRects()` rects. Visual was off — overlays were sized to the line-box (full line-height) rather than to the text characters, so they extended above and below the text.
  - Replaced with the **CSS Custom Highlight API**: a `<style>` element is injected into the page's `<head>` defining `::highlight(sprawler-selection) { background-color: rgba(70, 137, 255, 0.35); }`, and `CSS.highlights.set('sprawler-selection', new Highlight(range))` is called when the user clicks `+`. Browser renders it via its native text-selection path → matches native selection appearance exactly. Cleared on dismiss.
  - Gated activation on `+` click (via new `popup.onExpand` callback): native selection stays visible in presets mode, our highlight only kicks in when the input focus would otherwise wipe it.
- **Claude selector fix** (`src/content/adapters/claude.ts`):
  - Original guess `.font-claude-message, [data-testid="assistant-message"]` matched nothing on live DOM (user reported popup never appeared).
  - User pasted assistant-message outer HTML — the wrapper class is `.standard-markdown` (paragraphs inside use `.font-claude-response-body`). Updated `ASSISTANT_SELECTOR = '.standard-markdown'`. User confirmed the popup now works on Claude.
  - `USER_SELECTOR` still best-guess (`[data-testid="user-message"], .font-user-message`) but works in practice for current Claude builds — user verified the preceding user prompt is being extracted correctly.
- **Phase C — branch-tab handoff** (`src/background/index.ts`, `src/shared/messages.ts`, `src/content/index.ts`):
  - Background worker has two message handlers: `create-branch` (opens new tab via `chrome.tabs.create`, writes `chrome.storage.session.set({ [prompt-<tabId>]: draftedPrompt })`) and `claim-prompt` (reads `sender.tab.id`, returns + deletes the stored prompt).
  - `chrome.tabs.onRemoved` cleans up orphaned entries.
  - Content script on every load calls `claimAndInject(adapter)` which fires `chrome.runtime.sendMessage({ type: 'claim-prompt' })`. If a prompt comes back, `adapter.injectPrompt(...)` runs.
  - Parent-tab `popup.onSubmit` now sends `create-branch` instead of just logging.
- **Phase D — input injection** (`src/content/adapters/{chatgpt,claude}.ts`, `src/content/dom-wait.ts`):
  - New `waitForElement(selector, timeoutMs)` helper using `MutationObserver` + timeout.
  - ChatGPT: waits for `#prompt-textarea` (8s), focuses, briefly waits, then `document.execCommand('insertText', false, text)`.
  - Claude: same approach with `div.ProseMirror[contenteditable="true"]`.
- **Docs**: `TODO.md` updated to reflect Phase B verified + Phases C/D built. New decisions D9 + D10 added to `DECISIONS.md`. `CLAUDE.md` updated with the new file layout.

**In progress:** Phases C + D are in code and the build is clean, but **end-to-end has not yet been tested in a real browser**.

**Blocked:**
- End-to-end smoke test — waiting on user to reload the unpacked extension, run the select → branch flow on ChatGPT and Claude, and report whether the new tab opens and pre-fills the input.

**Next session should pick up:**
1. Read the user's end-to-end test report.
2. If injection works on ChatGPT but fails on Claude (or vice versa), it's almost certainly an input selector issue — fix the adapter.
3. If `execCommand('insertText')` returns false, implement the synthesized `InputEvent` fallback (already noted in TODO).
4. Once the happy path is solid: tighten the Claude `USER_SELECTOR`, then declare the MVP done.

## Session 2026-05-23 (later) — MVP end-to-end verified

**Shipped:**
- No new code this session. User executed the end-to-end smoke test on the build from the previous session.
- ChatGPT: select assistant text → click `What is this?` → new chatgpt.com tab opens → drafted prompt fills the ProseMirror input. Console showed `claimed pending prompt; injecting…` then `inject result: true`. **Passed.**
- Claude: same flow against claude.ai/new. **Passed.**
- Updated `TODO.md`: checked off both end-to-end smoke tests, replaced "Blocked" with "Nothing currently", reorganized backlog into a "Polish" group (Claude `USER_SELECTOR`, `InputEvent` fallback, claim-retry, viewport clamping) and "Backlog (post-MVP features)" group.

**In progress:** nothing.

**Blocked:** nothing.

**Next session should pick up:** one of —
- Quickest win: tighten Claude `USER_SELECTOR` (needs a paste of a user-message DOM node from claude.ai). Low effort, removes the last best-guess selector in the codebase.
- Robustness: `InputEvent` fallback for `injectPrompt` in both adapters, so we have a clean migration path away from `execCommand`.
- Or jump to a post-MVP feature: Gemini adapter is the smallest scope; branch tree is the highest user value.

## Session 2026-05-23 (polish) — all four polish items shipped and verified

**Shipped:**
- **Polish #1 — Claude `USER_SELECTOR` tightened** (`src/content/adapters/claude.ts`). User pasted a user-message DOM node, which confirmed both `[data-testid="user-message"]` (inner element with just the message text) and `[data-user-message-bubble="true"]` (outer wrapper) exist. The previous `.font-user-message` fallback was dead — Claude actually uses the Tailwind-`!important` class `!font-user-message` which `.font-user-message` doesn't match. New selector: `[data-testid="user-message"], [data-user-message-bubble="true"]`. Testid stays primary because querySelectorAll returns it after the bubble (document order), so the backwards walk in `getContext` hits the cleaner inner node first; bubble is resilience for builds that strip testids.
- **Polish #2 — Shared `insertTextIntoEditor()` with `InputEvent` fallback** (new `src/content/inject.ts`; `chatgpt.ts` and `claude.ts` now delegate). Tries `document.execCommand('insertText', false, text)` first; on `false`, dispatches `new InputEvent('beforeinput', { inputType: 'insertText', data, bubbles: true, cancelable: true })` against the editor and treats `dispatchEvent` returning `false` (rich-text editor called `preventDefault` after applying its own insertion) as success.
- **Polish #3 — Claim retry** (`src/content/index.ts` `claimAndInject`). One additional `claim-prompt` attempt at 200ms after a null first response. Non-branch tabs pay a single 200ms timer in the worst case; acceptable.
- **Polish #4 — Viewport clamping for popup placement** (`src/content/popup.ts`). New `POPUP_EST_HEIGHT = 40` constant. `show()` now picks above vs below based on `window.innerHeight - rect.bottom`, then clamps the result between `POPUP_MIN_PADDING` and `window.innerHeight - POPUP_EST_HEIGHT - POPUP_MIN_PADDING`.
- User re-tested the parent-tab interactive flow after the polish build; "everything works fine so far".
- Updated `TODO.md`: Polish group is now all `[x]`; "Known fragility" section trimmed to actual residual risks (ChatGPT login-redirect case + deprecated `execCommand`).

**In progress:** nothing.

**Blocked:** nothing.

**Next session should pick up:** a feature from the post-MVP backlog. User-recommended ordering by value vs. effort —
- Smallest scope: **Gemini adapter** (one new file mirroring `chatgpt.ts` / `claude.ts`; needs a paste of Gemini's assistant-message DOM and input element).
- Highest user value: **branch tree / parent backlink UI** (sidebar or popup that shows the lineage of branched tabs; needs a small persistence layer beyond `session` storage since branch graphs should outlive a browser restart).
- Lowest user-friction: **auto-submit toggle** (small settings page; persist via `chrome.storage.sync`).

## Session 2026-05-24 — Full conversation transcript + orphan-safe messaging

**Shipped:**
- **Full conversation transcript as the context default** — drafted prompt now embeds every prior turn (user + assistant) from the chat start through and including the assistant message containing the selection. Previously the prompt only carried the immediate preceding user prompt + the assistant message. Driving fix for the failure case where the selected text references concepts defined many turns earlier and the branch AI starts cold.
  - `src/shared/prompt-template.ts`: new `ConversationTurn = { role: 'user' | 'assistant', text }`; `DraftedPromptInput` now takes `turns: ConversationTurn[]`; rendered as `## Conversation so far:` section with `[User] / [AI]` prefixed turns.
  - `src/content/adapters/types.ts`: `AssistantContext` is now `{ turns: ConversationTurn[] }`.
  - `src/content/adapters/chatgpt.ts`: `getContext` walks all `[data-message-author-role]` nodes, slices `[0..assistantIdx]`, maps to turns. `USER_SELECTOR` constant removed (role attribute handles it).
  - `src/content/adapters/claude.ts`: `getContext` walks `${.standard-markdown}, ${[data-testid="user-message"]}` in document order, maps via `matches(USER_SELECTOR)`. `USER_SELECTOR` simplified back to `[data-testid="user-message"]` only — the `[data-user-message-bubble="true"]` fallback from the previous polish session would double-count user messages now that we walk for every turn. Comment in the file flags this for future maintainers.
  - `src/content/index.ts`: passes `turns` to `buildDraftedPrompt`.
- **`safeSendMessage` wrapper** in `src/content/index.ts` — every `chrome.runtime.sendMessage` call now goes through a try/catch that swallows `Extension context invalidated` (the error thrown by orphaned content scripts after the extension is reloaded with chat tabs still open). User saw this error on the extension card today; wrapping it means future reloads stay silent.
- `TODO.md` updated: new "MVP+ — context quality + orphan handling" group with both items checked; Polish #1 note now records that the bubble fallback was reverted; current-focus updated.
- `DECISIONS.md` updated: new D11 for transcript context.
- User re-verified end-to-end after each change.

**In progress:** nothing.

**Blocked:** nothing.

**Next session should pick up:** a post-MVP feature. User's stated next interest is the LLM-based summarization (BYO API key) — though the transcript-by-default approach is working well today, longer chats will eventually hit input limits and benefit from summarized context. That said, the smaller-scope wins (Gemini adapter, auto-submit toggle) are also good starting points depending on appetite.

## Session 2026-05-24 (later) — Gemini adapter

**Shipped:**
- **Gemini adapter** (`src/content/adapters/gemini.ts`, ~62 lines). User pasted live DOM samples up front (assistant message, user message, input element, new-chat URL) so first-pass selectors were correct — no second verification cycle needed unlike the original Claude rollout.
  - `ASSISTANT_SELECTOR = 'message-content'` — Gemini's custom element wrapping each assistant turn. See DECISIONS.md D13 for why this beat the inner `.markdown-main-panel` class.
  - `USER_SELECTOR = '.query-text'` — the user-message div. Contains a `.cdk-visually-hidden` "You said" screen-reader span that would otherwise leak into the drafted prompt; new `readTurnText` helper clones the node, strips visually-hidden descendants, and reads textContent. First adapter to need per-role text extraction logic — ChatGPT/Claude have used raw `textContent.trim()`. See D13.
  - `INPUT_SELECTOR = 'div.ql-editor[contenteditable="true"]'` — Quill editor inside Gemini's `<rich-textarea>` custom element. Same injection path as Claude's ProseMirror (execCommand primary, InputEvent fallback in `inject.ts`).
  - `newChatUrl = 'https://gemini.google.com/app'`.
- **Wiring changes (parallel to adapter)**:
  - `'gemini'` added to `AppId` union in `src/shared/messages.ts`.
  - `https://gemini.google.com/*` added to `HOSTS` in `src/manifest.ts` (auto-propagates to `matches`, `host_permissions`, and `web_accessible_resources` in the built manifest).
  - `geminiAdapter` registered in `src/content/adapters/index.ts`.
  - `gemini: 'https://gemini.google.com/app'` added to `NEW_CHAT_URLS` in `src/background/index.ts` (typecheck caught this on first build; second build passed clean).
- **Docs updates this session (pre-/save-progress)**:
  - `TODO.md`: new "Tech backlog (deferred robustness work)" section added earlier in the session to capture the two known-fragility items (ChatGPT login-redirect, `execCommand` deprecation) with concrete fix sketches and effort estimates. "Known fragility (residual)" trimmed to one-line pointers into the new section to prevent drift.
- **End-to-end verification:** user reloaded the extension, selected text in a Gemini assistant reply, branched, and confirmed the new Gemini tab opens at `/app` with the drafted prompt pre-filled in the Quill input. All four observable behaviors (popup appears, custom-input flow works, branch tab opens, prompt fills correctly without "You said" leakage) passed first try.

**In progress:** nothing.

**Blocked:** nothing.

**Next session should pick up:** user's stated next interest remains **LLM-based summarization (BYO API key)** — see `TODO.md` Backlog and DECISIONS.md D11 cross-reference. Becomes load-bearing as transcripts grow on long conversations. Alternative smaller-scope wins still on the table: auto-submit toggle, customize preset questions, multi-turn branch handling.

## Session 2026-05-24 (later still) — Phase F: opt-in LLM summarization with Haiku 4.5

**Shipped:**
- **Settings infrastructure** — new `src/shared/settings.ts` (getSettings/setSettings on `chrome.storage.local`; deliberately NOT `sync` so the API key doesn't propagate across Google-account devices), schema `{ summarizationEnabled: false, anthropicApiKey: '' }`.
- **Options page** — new `src/options/index.html` + `src/options/index.ts`. Toggle + password-typed key input + Save button + status line + help link to console.anthropic.com. Wired via `options_ui` in manifest with `open_in_tab: true`. Form validates that enabling the toggle requires a key. Mid-session bugfix: `.toggle-row` was inheriting `flex-direction: column` from `.field`, stacking the checkbox above the label — added explicit `flex-direction: row` override.
- **Anthropic API client** — new `src/background/anthropic.ts`. POSTs to `/v1/messages` with model `claude-haiku-4-5-20251001`, `max_tokens: 1024`, headers include `x-api-key`, `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true` (required for non-server contexts). Summarization system prompt embedded in the file instructs Haiku to skip preamble (output lands directly under a markdown heading).
- **Manifest updates** — split `CHAT_HOSTS` from `API_HOSTS` so `api.anthropic.com` shows up in `host_permissions` only, not in `content_scripts.matches`. Added `options_ui` declaration.
- **Wire-format refactor** — `CreateBranchRequest` now carries `{ turns, selectedText, question, appId }` (raw transcript data) instead of a finished `draftedPrompt`. `buildDraftedPrompt` call moved into `src/background/index.ts`. Background's `create-branch` handler reads settings, decides whether to call `summarize`, builds the prompt, then opens/stashes the tab. See DECISIONS.md D16.
- **Drafted-prompt format harmonized** — both summarized and non-summarized paths now share a one-line preamble + `## Selected from the AI's last message:` (with `>` blockquote) + `## My question:` footer. Summary path uses `## Earlier in the conversation (summary):` + `## Recent turns (verbatim):`. Non-summary path uses `## Conversation so far:`. Touched `src/shared/prompt-template.ts` with an optional `summary?: string` parameter; presence selects the path. Last 2 turns always rendered verbatim regardless of path (see D16 + D11 cross-ref).
- **Branch-tab failure toast** — new `src/content/toast.ts` (Shadow-DOM, bottom-fixed, 4s auto-dismiss). Mid-session bugfix: originally fired on the parent tab, but the user has already been navigated to the new tab by the time the create-branch response lands, so the toast was invisible. Plumbing change: storage now stashes `{ draftedPrompt: string, summarizationFailed: boolean }` together under the tabId key. `ClaimPromptResponse` returns both. The branch tab's `claimAndInject` creates the toast after a successful inject when `summarizationFailed` is true. See DECISIONS.md D17.
- **Toast copy polish** — leads with ⚠️ icon at the call site (kept the `createToast` component generic for future info/success toasts).
- **Popup busy state** — `setBusy(b)`/`isBusy()` added to `PopupHandle`. Spinner + "Summarizing…" label replaces the preset buttons during the wait. Outside-click, Esc, and scroll dismissals are suppressed while busy. Content script only triggers busy state when summarization will actually run (mirrors the background's `shouldSummarize` gate so verbatim-only branches don't flash a misleading busy state for the ~50ms storage write).
- **End-to-end verified** on all three apps for Tests A (toggle off, full transcript with new harmonized labels), B (toggle on + valid Anthropic key, summary appears in the new tab), and C (toggle on + invalid key, toast surfaces on the branch tab).
- **TODO/DECISIONS updates** — Phase F section added with full file/component breakdown; D15-D18 captured (settings storage, wire format + harmonization, branch-tab toast, Claude-only + Haiku-only scope decisions). LLM-based summarization removed from Backlog; replaced with "Multi-provider summarization" as the natural follow-on.

**In progress:** nothing.

**Blocked:** nothing.

**Next session should pick up:** Quickest sanity check is **multi-turn branching** — the branch tab is itself one of the three chat apps, so the existing adapter *may* already work on it. 5-min test, would convert that backlog item into "verify and document" rather than real feature work. If clean, the smallest real feature is **customize preset questions** (builds directly on the options page, mechanical work, one session). Bigger but natural follow-on is **multi-provider summarization** (OpenAI + Gemini), which requires a provider abstraction and per-provider API clients.

## Session 2026-05-24 (later still still) — Phase G: customize preset questions (partial verification)

**Shipped:**
- **Settings schema extended** (`src/shared/settings.ts`): `presetQuestions: string[]` field with `DEFAULT_PRESET_QUESTIONS = ['What is this?', 'Why?', 'Explain more']` exported. Defaults applied on first load; explicit `[]` is valid (means "no presets, custom-only").
- **Options page preset-list editor** (`src/options/index.html` + `src/options/index.ts`): editable rows, ↑/↓ reorder, × remove, "+ Add preset" disabled at cap of 6. Empty rows trimmed and dropped on save. Save button moved out of the API-key card into a footer action bar so it applies to all settings sections.
- **Popup wired to dynamic presets** (`src/content/popup.ts`): hardcoded `PRESET_QUESTIONS` constant removed. `PopupCallbacks` interface renamed to `PopupOptions` (now carries data + callbacks). Buttons built from `options.presets`; empty array renders just the `[+]` button.
- **Content script reads settings at init** (`src/content/index.ts`): `setupSelectionPopup` is now async, awaits `getSettings()`, passes `presetQuestions` into `createPopup`. Caveat (documented): preset changes only apply after the chat tab is reloaded.
- **Popup width clamp** bumped 320 → 480 (`POPUP_EST_WIDTH`) so 6 preset buttons fit. See **Aborted approach** below for the dynamic-measurement attempt that was reverted.
- **End-to-end verified** on **ChatGPT** and **Gemini**: defaults render, editing applies after tab reload, ↑↓ reorder works (with first/last disabled correctly), cap of 6 enforced, empty list → popup shows only `[+]`.

**Aborted approach (worth noting):**
- First attempt at handling wider popups used **dynamic `offsetWidth` measurement** in `show()`: park host at `-9999px` offscreen, set `data-open=true`, read `host.offsetWidth/offsetHeight`, then reposition to the proper coordinates. Reverted because reading `offsetWidth` triggers a synchronous layout flush which, on Claude in particular, fires focus observers that interact badly with the popup's `+` → custom-input focus path. Static estimate is the simpler choice and the bug investigation continues (see In progress below). Decision captured in DECISIONS.md D19.

**In progress (deferred to next session):**
- **Claude `+` → custom-input focus regression.** Selecting text → popup appears → clicking `+` makes the custom-textbox visible, but typing goes into Claude's ProseMirror chat input instead. ChatGPT and Gemini are unaffected. Hypothesis: Claude has aggressive focus management that re-grabs ProseMirror focus when another element takes focus. **Three fixes tried this session, none worked:**
  - Replacing `setTimeout(() => input.focus(), 0)` with synchronous `input.focus()` inside the click handler (to retain user-activation status).
  - `void input.offsetWidth` before focus to force layout flush so `.custom { display: flex }` had taken effect.
  - `requestAnimationFrame` re-assert after the first focus call to win late races.
  Even with all three combined, focus still ends up on ProseMirror after `+`. **Next-session candidates** (captured in TODO.md Tech backlog): (1) `focusin` listener with stopPropagation on shadow root to block Claude's document-level listeners from seeing our focus shift, (2) blur-on-input listener with bounded refocus retry, (3) DevTools inspection to identify what Claude is actually listening to, (4) workaround: skip the `+` UI on Claude and render custom-input directly.

**Blocked:** nothing — Claude focus regression is deferred, not blocked.

**Next session should pick up:** the Claude focus regression first (small, contained, real bug). After that, either **multi-provider summarization** (medium, natural Phase F continuation; biggest unlock for users without an Anthropic key) or **auto-submit toggle** (small, settings-page extension; watch for per-app submit-semantics differences).

## Session 2026-05-25 — Claude focus regression fixed + ChatGPT cross-branch prompt-accumulation fixed

**Shipped:**
- **Claude `+` → custom-input focus regression: FIXED** (`src/content/popup.ts`). Diagnosis approach was instrument-first rather than guess-and-try (the trap the previous session fell into). Added temporary logging in three spots: before/after `input.focus()` to compare `document.activeElement`, a blur listener on the input to capture *when* it loses focus and to *what*, and a document-level capture-phase `focusin` listener to see every focus shift with `isTrusted`. One reproduction on Claude gave the full picture in eight log lines:
  - `activeElement` before focus was `body` (not ProseMirror)
  - Our `input.focus()` worked — `activeElement` became the shadow host immediately and stayed there through rAF
  - **Blur fired only after the user pressed a key** (confirmed with a second test: click `+`, wait 5s without typing → no blur)
  - After blur, `activeElement` went briefly to `body` then to `div.tiptap ProseMirror ProseMirror-focused`
  - **Root cause:** Claude has a document-level `keydown` handler that refocuses ProseMirror on any keystroke ("type-anywhere-goes-to-chat" UX pattern). Not a focus-stealing observer as previously hypothesized.
  - **Fix:** bubble-phase `stopPropagation()` on `keydown`/`keypress`/`beforeinput` events at the popup's input. `stopPropagation` doesn't cancel the input's own text insertion (only `preventDefault` would), so typing still works locally; Claude's document handler just never sees the event.
  - **Cleanup:** reverted the previous session's three "fix attempts" (`void input.offsetWidth`, sync-vs-`setTimeout` focus dance, `requestAnimationFrame` re-assert) — the logs proved focus was landing correctly all along, so those were addressing a non-existent problem and complicating the click handler. Also corrected the stale `POPUP_EST_WIDTH` comment that cited the disproven layout-flush hypothesis.
- **ChatGPT cross-branch prompt accumulation: FIXED** (`src/content/inject.ts`). User reported the drafted prompt was repeating and previous branches' prompts were appended before new ones. Root cause: ChatGPT persists `#prompt-textarea` drafts across tab loads (their UX feature: in-progress messages survive a refresh). Our `execCommand('insertText')` inserts at the cursor, which lands at the end of restored draft content after `editor.focus()`, so each branch's prompt was appended to whatever was already there — compounding across branches. **Fix:** `insertTextIntoEditor` now selects all existing editor content via `document.createRange()` + `range.selectNodeContents(editor)` + `window.getSelection().addRange(range)` *before* calling `insertText`, so the existing content is selected and gets *replaced* by the new text. Lives in shared `inject.ts` so all three adapters benefit (defensive against latent draft persistence on Claude/Gemini). Verified clean on ChatGPT (multi-branch test), Claude, and Gemini.
- **DECISIONS.md addendum to D19 + new D20 + new D21** capturing the corrected cause story and the two new behavioral contracts (stopPropagation on key events, select-then-insert).

**In progress:** nothing.

**Blocked:** nothing.

**Next session should pick up:** the post-MVP backlog is the playing field now. Options in rough order of user value:
- **Multi-provider summarization (OpenAI + Gemini)** — biggest unlock for users without an Anthropic key. Medium effort: build a `SummarizationProvider` interface + per-provider clients, settings page gets a provider dropdown. Natural Phase F continuation.
- **Auto-submit toggle** — small settings extension, but watch for per-app submit-semantics (ChatGPT Enter vs. shift-Enter, Claude submit detection, Gemini's Quill).
- **Inject-failure recovery** — still in Tech backlog; covers the ChatGPT login-redirect case. ~30 min.
- **Firefox port** — larger; gets the extension to a meaningfully wider audience.

## Session 2026-05-25 (continued) — Open-source rollout: README, LICENSE, GitHub publish

**Shipped:**
- **`README.md` created** (~150 lines, technical+concise tone per user preference). Sections: tagline, motivation, supported apps, install-from-source, usage, settings (preset questions + opt-in Anthropic summarization), privacy, build/develop commands, architecture (with directory layout), `add a new chat-app adapter` contributor guide, known limitations, license.
- **`LICENSE` created** — MIT, `Copyright (c) 2026 Vinamra Jain`. (Initially had a `<Your Name>` placeholder; filled in once user confirmed the name.)
- **GitHub repo published** — `https://github.com/vinamrajain99/ai-chat-sprawler` (public). Two commits live:
  - `e8116ba` "Initial commit: AI Chat Sprawler" — 28 files, 3,678 insertions.
  - `35505a9` "Publish project docs to the open-source repo" — 7 files changed, 623+/12-.
- **GitHub handle discovered via `gh auth status`** (`vinamrajain99`) — filled into the README install command. Avoided a separate round-trip.
- **Sensitive-info audit on all four project docs.** Read `Project requirements.md`, `TODO.md`, `PROGRESS.md`, `DECISIONS.md` end-to-end and confirmed: no filesystem paths, no API keys, no emails, no contact info. "Vinamra Jain" appears only in TODO.md (same as LICENSE), no new exposure. Reported findings to user before any publish-action.
- **Reversed the initial gitignore-the-docs decision.** First commit had `Project requirements.md`, `TODO.md`, `PROGRESS.md`, `DECISIONS.md` excluded via `.gitignore` for caution. User asked about backup safety on laptop loss → explained that gitignored files have no GitHub copy → user decided to publish all docs after audit confirmed they're safe. Second commit landed them in the public repo. See DECISIONS.md D22.
- **Docs touched to reflect the published state:**
  - `CLAUDE.md` "Files of note" section rewritten — all six docs (README, LICENSE, Project requirements, DECISIONS, TODO, PROGRESS) listed as part of the public repo.
  - `TODO.md` current-focus updated with the GitHub URL and the "all docs published" note; "Open-source rollout" checklist marked done where appropriate (`git init`, repo create, push, README install command).
  - `README.md` architecture section gained a closing paragraph pointing to `DECISIONS.md` / `PROGRESS.md` / `TODO.md` for deeper context (previously stripped when docs were gitignored).
- **`.gitignore` final shape:** `node_modules/`, `dist/`, `.DS_Store`, `*.log`, `.vite/`, `local testing screenshots/`. The four project docs are no longer excluded.

**In progress:** nothing.

**Blocked:** nothing.

**Next session should pick up:** unchanged from the earlier 2026-05-25 entry — the post-MVP backlog is open. Top picks (in order of user-value):
1. **Multi-provider summarization** (OpenAI + Gemini) — biggest unlock; Phase F continuation; medium effort.
2. **Auto-submit toggle** — small settings extension.
3. **Inject-failure recovery** — narrow but mildly infuriating ChatGPT login-redirect case; ~30 min.
4. **Firefox port** — larger; reaches more users.

Open-source polish still TODO (not blockers):
- Add an extension icon (manifest currently has none; Chrome shows the default puzzle piece).
- Demo GIF or static screenshot in README.
- Chrome Web Store listing assets when ready to ship there.
