# Architectural Decisions

## 2026-05-22 — Initial MVP decisions

### D1. Chrome extension (Manifest V3), not a web app or desktop app
**Choice:** Build as a Chrome extension targeting MV3.
**Why:** The product needs to (a) observe text selections inside third-party AI chatbot pages and (b) open and pre-populate new chats in those same apps. Only a browser extension can do both without the user leaving their existing workflow.
**Alternatives considered:** Bookmarklet (no persistent UI), separate web app (would force users out of the chat app — breaks the core UX requirement).

### D2. MVP targets ChatGPT + Claude only; Gemini deferred
**Choice:** Ship adapters for chatgpt.com and claude.ai first. Gemini comes later behind the same adapter interface.
**Why:** Two apps is enough to prove the adapter abstraction. Gemini's DOM is Angular-rendered with hashed classes — higher maintenance cost, not worth blocking MVP on.
**Reversal cost:** Low — adding Gemini is one new adapter file.

### D3. Adapter pattern for per-app DOM logic
**Choice:** Each chat app implements a `ChatAppAdapter` interface: `matches`, `newChatUrl`, `findAssistantMessageRoot`, `getPrecedingUserPrompt`, `getAssistantText`, `injectPrompt`.
**Why:** Keeps app-specific selectors and quirks isolated. Core selection/popup/handoff logic stays app-agnostic. Easy to add or replace a single adapter when an app's DOM changes.
**Alternatives considered:** Per-app forked content scripts (rejected — duplicates UI code).

### D4. Pre-fill only, no auto-submit
**Choice:** On the branch tab, paste the drafted prompt into the input and stop. User reviews and hits Enter.
**Why:** Auto-submit is brittle (timing, focus, failed injections produce broken sends). Pre-fill is safe and lets the user adjust the draft if they want. Can revisit once injection reliability is proven.

### D5. Heuristic context, no LLM API call (MVP)
**Choice:** Context = full text of the assistant message containing the selection + the immediately preceding user prompt. No summarization call.
**Why:** Zero setup friction (no API key), deterministic, fast. Quality is fine for typical threads. We can layer optional LLM summarization later for very long conversations behind a settings toggle without changing the wire format.

### D6. Handoff via `chrome.storage.session`, keyed by new tabId
**Choice:** When a branch is requested, the content script messages the background worker, which calls `chrome.tabs.create` for the new-chat URL, then writes the drafted prompt to `chrome.storage.session` under the new `tabId`. The branch tab's content script reads and clears that entry on load.
**Why:** Survives the gap between `tabs.create` and the new tab's content script booting. `session` storage is cleared automatically when the browser closes — no leftover prompts. Keyed by tabId so concurrent branches don't collide.
**Alternatives considered:** URL query params (visible, length-limited, ChatGPT/Claude don't reliably honor a prompt query param); `chrome.runtime.sendMessage` to the new tab (race condition — tab may not have content script ready yet).

### D7. Shadow DOM for the popup
**Choice:** Render the floating popup inside a Shadow root attached to a host `<div>` in the page body.
**Why:** Chat apps (especially Claude) have heavy global styles that would otherwise leak into and corrupt the popup. Shadow DOM gives clean style isolation without iframe overhead.

### D8. Input injection via simulated input events, not `.value =`
**Choice:** ChatGPT (ProseMirror) and Claude (rich contenteditable) reject naive `.value =` assignment — their internal state stays empty and the send button stays disabled. Inject text via `InputEvent` / `document.execCommand('insertText')` after focusing the editor.
**Why:** Both apps use rich-text editors that listen to input events, not value mutations. This is the only reliable way to make the editor "see" the inserted text.
**Risk:** `execCommand` is deprecated; fallback to dispatching synthesized `InputEvent` with `inputType: 'insertText'` if it stops working.

## 2026-05-23 — Phase B/C refinements

### D9. CSS Custom Highlight API for selection persistence
**Context:** Focusing the popup's custom-question input collapses the page's native text selection, so the visual "what you had selected" disappears the moment the user clicks `+`. We need to keep the selection visually present until the user dismisses the popup.
**Decision:** Use the **CSS Custom Highlight API** (`CSS.highlights.set(name, new Highlight(range))` + a `::highlight(name)` rule injected into the page's `<head>`). Activate only when the user clicks `+` (via a new `popup.onExpand` callback), clear on dismiss.
**Alternatives considered:**
  - **DOM-overlay highlight** built from `Range.getClientRects()` rects (initial implementation). Rejected because `getClientRects` returns line-box-sized rects (full line-height), so the overlay extended visibly above and below the actual text characters. Replicating the browser's text-selection sizing in our own renderer would require font-metrics work; not worth it when the browser already does it correctly.
  - **Re-applying the saved `Range` to `window.getSelection()` after focusing the input.** Inconsistent visual across browsers (often renders as an "inactive" greyed selection), and changes the document's selection state in ways that could interact badly with the chat apps' own selection-sensitive UI.
**Consequences:**
  - Requires Chrome 105+ (released Aug 2022). We're a Chrome-only extension, so this is fine. The module no-ops if `CSS.highlights` is absent.
  - Injects one `<style>` element (`id="sprawler-highlight-style"`) into the page's head. That style affects only `::highlight(sprawler-selection)`, no other selectors, so no risk of bleeding into chat-app styles.
  - `background-color` is the only widely supported `::highlight` property today. If we want underline / border style highlights later we'll need to revisit.

### D10. Branch-tab claim is pull-from-content, not push-from-background
**Context:** When the background worker opens a new tab via `chrome.tabs.create`, the new tab's content script doesn't know its own `tabId`, and there's a race between `tabs.create` resolving and the content script booting in the new tab. We need a reliable way for the content script to receive the pending drafted prompt.
**Decision:** The branch tab's content script sends `chrome.runtime.sendMessage({ type: 'claim-prompt' })` on every page load. The background worker uses `sender.tab.id` (from the MessageSender) to look up `chrome.storage.session[prompt-<tabId>]`, returns the value, and deletes the entry. Background also clears entries on `chrome.tabs.onRemoved` to handle the case where the user closes the tab before injection.
**Alternatives considered:**
  - **Push from background**: have the background worker call `chrome.tabs.sendMessage(tabId, ...)` after creating the tab. Rejected because the receiving tab's content script may not yet be listening when the message is sent → message is dropped silently. Requires either retries or `chrome.scripting` orchestration, both more complex than pull.
  - **URL query param / fragment** carrying the prompt. Rejected: visible in URL bar, length-limited, and chat apps don't reliably honor a `?q=` parameter on their landing pages.
**Consequences:**
  - Every page load on a matched host fires one `claim-prompt` message, even tabs that weren't opened as branches. The background handler returns `{ draftedPrompt: null }` in that case — cheap and safe, but it's a small constant message-passing cost.
  - There's still a theoretical race: if the new tab's content script runs and sends `claim-prompt` *before* the background's `chrome.storage.session.set` resolves, the claim returns null. Hasn't been observed because the new tab takes hundreds of ms to load and storage.set is sub-ms. Mitigation (claim retries) is in TODO.md as a follow-up.

## 2026-05-24 — Full conversation transcript as context default

### D11. The drafted prompt carries the full prior conversation, not just the immediate preceding turn
**Context:** The original heuristic (D5: "assistant message text + preceding user prompt") fails on multi-turn conversations where the selected text refers to concepts established many turns earlier — the branch AI starts without that history and gives a worse answer than the parent thread could. User raised this after MVP polish was complete.
**Decision:** Adapter `getContext` now returns `{ turns: ConversationTurn[] }` covering every message from chat start through and including the assistant message containing the selection. `buildDraftedPrompt` renders a `## Conversation so far:` section with `[User] / [AI]` prefixes. No truncation or summarization in this default path.
**Alternatives considered:**
  - **Last K turns (windowed)** — picks the wrong K for every conversation. Misses turn-1 framing in long chats; redundant on short chats. Rejected.
  - **LLM-based summarization as the default** — best quality but requires API key + setup + cost. D5 already deferred this to opt-in. Kept as a backlog item (see TODO.md) where it makes sense: behind a settings toggle for users who hit input-size limits or want shorter prompts.
  - **In-popup picker** ("include all / last N / minimal") — adds UI friction; the "pre-fill and let me edit" pattern already gives the user an escape hatch.
**Consequences:**
  - Drafted prompts grow O(conversation length) in tokens. On long chats this can push against the branch app's input character/token limit (ChatGPT ~32k chars in practice; Claude similar order). User sees the pre-fill before sending and can manually trim, so this isn't a blocker today.
  - The LLM-summarization backlog item is now load-bearing for very long chats — it's the escape valve when transcripts get too big. TODO.md cross-references this decision.
  - Per-adapter `getContext` walk is slightly heavier (queries all messages in the conversation, not just the assistantRoot + one preceding user message). Still O(n) but with n being the visible message count — fine.

### D12. `USER_SELECTOR` must avoid double-counting in the transcript walk
**Context:** Polish #1 (in the prior session) added `[data-user-message-bubble="true"]` as a resilience fallback alongside `[data-testid="user-message"]` for Claude. That was safe when the selector was only used to find the preceding user prompt (where backwards-walking would naturally hit the inner testid first). After D11, the same selector drives the transcript walk — and both selectors matching for the same logical user message would emit two turns from one message.
**Decision:** Roll back to a single canonical selector per role: `[data-testid="user-message"]` for users, `.standard-markdown` for assistants. No combined selector with overlapping matches. Comment in `claude.ts` explicitly flags this so future maintainers don't reintroduce a duplicating fallback without dedup logic.
**Alternatives considered:**
  - **Keep combined selector, dedup in the walk via ancestor checks** (e.g. discard any element that's an ancestor of another). More code, easy to get wrong, and the resilience value is hypothetical (Claude hasn't stripped testids in any observed build).
  - **Two separate querySelectorAll calls, merge by document position.** Equally complex and no clearer.
**Consequences:**
  - If Claude ever drops the `data-testid` attribute, user messages will silently disappear from the transcript. Mitigation: the comment in `claude.ts` documents the dedup constraint for whoever adds a fallback.

## 2026-05-24 — Gemini adapter selector + text-extraction choices

### D13. Gemini selectors: custom-element tag for assistant, `.query-text` + screen-reader strip for user
**Context:** Building the Gemini adapter (`src/content/adapters/gemini.ts`). DECISIONS.md D2 specifically called out that Gemini's DOM is Angular-rendered with hashed classes, which makes the "best-guess selector, verify in browser" workflow we used for Claude high-risk. User pasted live DOM samples (assistant message, user message, input element) before any code was written, so selectors were chosen with full visibility into the actual DOM.
**Decision:**
  - **Assistant:** `ASSISTANT_SELECTOR = 'message-content'` — Gemini wraps each assistant turn in a `<message-content>` custom element. Tag-name selector is the most stable hook on a page full of Angular hashed classes.
  - **User:** `USER_SELECTOR = '.query-text'`. The user-message div is named semantically ("query-text") which is unlikely to be reused for non-user content.
  - **Screen-reader label stripping:** Gemini wraps user messages with `<span class="cdk-visually-hidden screen-reader-user-query-label"> You said </span>` for accessibility. Reading raw `textContent` would emit user turns as `"You said <message>"` and pollute the drafted prompt. New `readTurnText(el)` helper clones the node, removes `.cdk-visually-hidden` descendants, and reads `textContent`. Gated by an `el.querySelector('.cdk-visually-hidden')` check so the cheap path runs when no stripping is needed.
  - **Input:** `INPUT_SELECTOR = 'div.ql-editor[contenteditable="true"]'` — Gemini uses Quill inside a `<rich-textarea>` custom element. `.ql-editor` is Quill's stable class across versions. Same shape as Claude's `div.ProseMirror[contenteditable="true"]` — `insertTextIntoEditor` in `inject.ts` handles both editor families with the same execCommand-then-InputEvent path.
**Alternatives considered:**
  - **Assistant `.markdown-main-panel`** (the inner div, more specific to model responses given its `model-response-message-contentr_...` id pattern). Rejected because the outer `<message-content>` tag is just as specific (only assistant turns use it), is semantically meaningful, and captures the full assistant message including any future siblings (citations, tool calls) added inside `<message-content>` but outside `.markdown-main-panel`.
  - **User `.query-text-line`** (the inner `<p>` containing the text, which would skip the screen-reader span without any cloning). Rejected because multi-paragraph user inputs render as multiple `.query-text-line` siblings inside one `.query-text` — selecting at the line level would emit each paragraph as its own turn in the transcript walk.
  - **`.query-text` without stripping, then trim leading "You said "** (string-level fix). Rejected as fragile — Gemini localizes the screen-reader label; the literal text would change in non-English locales. DOM-level strip is locale-independent.
  - **Input `[aria-label="Enter a prompt for Gemini"]`**. Rejected — localized string, would break in non-English Gemini locales.
**Consequences:**
  - `readTurnText` is the first instance of per-adapter text-extraction logic. ChatGPT and Claude adapters still inline `el.textContent.trim()`. If a future adapter needs similar stripping, consider promoting `readTurnText` to a shared utility — but two data points is too few; YAGNI for now.
  - The `.cdk-visually-hidden` class name comes from Angular Material's CDK. If Gemini ever migrates off CDK, the class name would change and our strip would silently no-op, re-introducing "You said " leakage. Mitigation: the `readTurnText` comment flags this.
  - Quill's blank state shows `<p><br></p>` as placeholder content inside `.ql-editor`. Verified empirically that `execCommand('insertText')` against the focused editor replaces the placeholder correctly. If Quill ever changes its blank-state handling, the InputEvent fallback should still work (Quill listens to `beforeinput`).

### D14. Per-app new-chat URLs kept duplicated between background worker and adapter
**Context:** Each adapter exposes a `newChatUrl: string` on its interface, and `src/background/index.ts` independently maintains a `NEW_CHAT_URLS: Record<AppId, string>` map used by `createBranch`. Adding Gemini required touching both — the typecheck caught the missed second update on the first build. This is a duplication the codebase has carried since Phase C and now spans three apps.
**Decision:** Keep the duplication. Do not refactor to a single source of truth in this session.
**Alternatives considered:**
  - **Single source of truth in adapters; background imports adapter URLs.** Cleanest. Rejected for now because background worker and content scripts run in separate JS contexts in MV3 — the import works at build time (same source tree) but bundling adapters into the service worker pulls in DOM-dependent code (`waitForElement`, `insertTextIntoEditor`, `document.querySelectorAll`) that the service-worker context can't execute. Would require splitting each adapter into a "metadata" module (id, host, newChatUrl) and an "implementation" module — a real refactor, not in scope for "ship Gemini".
  - **Send the new-chat URL in the `create-branch` message payload** (content script tells background where to open the new tab). Simpler than the import split, removes the background's `NEW_CHAT_URLS` map entirely. Defensible but expands the wire format and trusts the content script's adapter to pick the right URL.
**Consequences:**
  - Future adapters will need updates in two places. TypeScript's `Record<AppId, string>` ensures the typecheck catches a missed background update (it did this session), so the failure mode is loud, not silent.
  - If we ever ship the metadata/implementation split (worthwhile if a fourth adapter joins, or if the LLM-summarization feature needs background-context access to adapter metadata), this decision should be revisited.

## 2026-05-24 — Phase F: opt-in LLM summarization architecture

### D15. Settings storage in `chrome.storage.local`, never `sync`; API call lives only in the background worker
**Context:** Phase F adds a BYO Anthropic API key for opt-in summarization. Two related questions: (a) where to persist the key, and (b) where in the extension to make the API call.
**Decision:**
  - Persist settings (toggle + key) in `chrome.storage.local`. New module `src/shared/settings.ts` wraps `getSettings`/`setSettings` with a single namespaced object under the `settings` key. Defaults: `summarizationEnabled: false`, `anthropicApiKey: ''`.
  - The API call (`src/background/anthropic.ts`'s `summarize`) is invoked only from the background service worker. The content script never reads `anthropicApiKey` — it doesn't import `settings.ts` for that purpose; it only reads `summarizationEnabled` to decide whether to show the popup's "Summarizing…" state.
**Alternatives considered:**
  - **`chrome.storage.sync`** would propagate the key across every device signed into the user's Google account. Convenient (set once, works everywhere) but wrong default for a secret — the user may have set up the key on a trusted laptop and not realized a shared work computer now has it. `local` opts-into per-device setup as a deliberate friction.
  - **Calling Anthropic from the content script** (read key in content script too) — would put the key in the same JS heap as the chat app's first-party code. Even with the chat apps being "trustworthy", a compromised script injected via the page (e.g. an XSS or a malicious extension) could exfiltrate the key. Background-only access limits the exposure surface to the extension itself.
**Consequences:**
  - User must re-enter the key on each device they install the extension on. Acceptable.
  - If we ever add a "test connection" button to the options page, that test needs to round-trip through the background worker (via a message), not call the API directly. Slightly more plumbing but preserves the isolation.
  - `host_permissions` for `https://api.anthropic.com/*` was added separately from the content-script `matches` list (split `CHAT_HOSTS` from `API_HOSTS` in `manifest.ts`) so the API endpoint isn't a content-script injection target.

### D16. Wire format refactored to send raw transcript data to the background; drafted-prompt format harmonized with labeled sections
**Context:** Before Phase F, the content script built the drafted prompt itself and sent a finished string to the background via `CreateBranchRequest.draftedPrompt`. With summarization, the background needs to know the raw turns (to optionally call Haiku) and selectedText/question (to build the prompt with the summary inserted). Either we round-trip a summary request back to the content script and let it finish the prompt, or we move prompt assembly entirely to the background. Separately: the existing prompt format (`## Conversation so far:` + raw transcript + unlabeled selected-text + unlabeled question) didn't differentiate summary prose from verbatim turns — once a summary is present, the branch AI couldn't tell the summary from the user's request.
**Decision:**
  - **Wire format:** `CreateBranchRequest` now carries `{ appId, turns, selectedText, question }` (raw data). `buildDraftedPrompt` call moves to `src/background/index.ts`. `CreateBranchResponse` simplified to `{ ok: boolean }` (summarization-failure signaling moved to the claim path — see D17).
  - **Prompt format:** both summarized and non-summarized paths share the same shape:
    - One-line preamble ("I'm continuing a conversation from another chat. Below is …, then a snippet I want to ask about.")
    - Middle section: `## Earlier in the conversation (summary):` + `## Recent turns (verbatim):` (summarized path) OR `## Conversation so far:` (non-summarized path)
    - `## Selected from the AI's last message:` with the snippet as a `>` blockquote
    - `## My question:` with the user's text
  - **Verbatim tail:** the last 2 turns (preceding user message + selected assistant message) are always rendered verbatim regardless of path. `VERBATIM_TAIL = 2` constant in both `prompt-template.ts` and `background/index.ts`.
**Alternatives considered:**
  - **Keep prompt assembly in the content script, expose a "summarize" round-trip to the background.** Two messages instead of one, content script has to know whether to ask for a summary. Rejected — the background is the natural owner of LLM calls and the prompt template doesn't belong on the brittle content-script side anyway.
  - **Last-K-turns windowing** as the verbatim tail size. Picks the wrong K for every conversation. Two is the minimum that makes semantic sense (the user's question prompted the assistant's reply containing the selection — both need to be intact).
  - **Single unified `## Conversation:` header for both paths** without the summarized/verbatim distinction. Branch AI couldn't tell which parts to treat as authoritative reference vs. editor's-note summary. Rejected.
  - **In-popup picker for include-all / summarize / minimal context.** Adds UI friction; the harmonized format + toggle covers the same ground without per-branch decisions.
**Consequences:**
  - Adding a new chat-app adapter no longer touches prompt assembly at all — adapters only need to expose `turns`. The wire boundary moved cleanly.
  - The harmonization means the `## Conversation so far:` non-summarized path also changes shape slightly (now has the preamble + labeled selection/question footers). Existing users will see a different-looking pre-filled prompt; verified the change reads naturally in the smoke test.
  - The `VERBATIM_TAIL` constant lives in two files (template + background). Small duplication; both reference each other's role in code comments. If we ever want to make it configurable, single-source-of-truth via a shared constant module.

### D17. Summarization-failure toast lives on the branch tab, not the parent
**Context:** During Test C of Phase F (toggle on + invalid Anthropic key), the user reported the failure toast never appeared. Investigation: by the time the background's `create-branch` response lands on the content script, the user has already been navigated to the newly-opened branch tab (because `chrome.tabs.create({ active: true })` shifts focus immediately). The parent tab's toast fires correctly but on a tab nobody's looking at.
**Decision:** Move the failure surface from the parent tab's create-branch response to the branch tab's claim response. The background now stashes `{ draftedPrompt: string, summarizationFailed: boolean }` (rather than a bare string) under the tabId key in `chrome.storage.session`. `ClaimPromptResponse` returns both fields. The branch tab's `claimAndInject` calls `createToast().show(...)` after a successful inject when `summarizationFailed` is true. `CreateBranchResponse` no longer carries the failure flag.
**Alternatives considered:**
  - **`chrome.notifications` API** for a native OS-level notification. Visible regardless of tab focus, but requires an additional permission, can feel out-of-place for an in-page extension, and OSes can suppress them. Rejected — keep the UX inside the page.
  - **Delay tab activation until after the response lands**, so the parent stays in focus for the toast. Awkward sequencing (the user clicks "branch" and nothing visible happens for 200ms-3s while the parent shows the toast before the new tab finally activates), and conflicts with the user's expected "open new tab now" mental model.
  - **Show toast on both tabs**, parent + branch. Doubles the implementation, and the parent toast is still invisible to anyone using the feature normally. Rejected.
**Consequences:**
  - Storage shape change: anything reading `chrome.storage.session[storageKey(tabId)]` now needs to expect the `PendingBranch` object, not a raw string. Both producers and consumers in `background/index.ts` updated.
  - The toast is contextually well-placed — the user sees "Summarization failed" at the moment they're about to use the pre-filled prompt, which is the right moment to know.
  - If we ever want a *success* toast (e.g. "Branched with summarized context (~280 words)"), the same plumbing works — add a `summarizationSuccess?: { wordCount: number }` field to `PendingBranch`. Not on the immediate roadmap.

### D18. Claude-only first, Haiku 4.5 hardcoded; multi-provider deferred to backlog
**Context:** BYO-key summarization could be built against any LLM provider, and users will already have whichever provider's key they currently use (likely OpenAI). Two product questions: (a) which provider(s) to support in v1, and (b) which model tier to use.
**Decision:**
  - **Claude only in v1.** Multi-provider (OpenAI, Gemini, local via Ollama) moved to backlog as the natural follow-on feature.
  - **Haiku 4.5 hardcoded** (`claude-haiku-4-5-20251001`). No model dropdown in v1.
  - **Off by default.** Users explicitly opt in via the settings toggle. Extension's default behavior remains "full conversation transcript, no API call".
  - **Sync summarization** with a popup "Summarizing…" busy state. The new tab does not open until the summary completes (or fails over to verbatim).
  - **Silent fallback to verbatim** on summarization failure, with a toast on the branch tab. The branch still happens; the user is informed.
**Alternatives considered:**
  - **Multi-provider day one** — doubles implementation surface, no clear quality differentiator between providers for summarization, and forces a provider abstraction we'd rather design once we know what *both* providers need (e.g. some providers stream by default, some have different system-prompt mechanics).
  - **Sonnet/Opus tier** — overkill for summarization (not a reasoning task), 5–25× the cost per branch with no observable quality lift on this workload.
  - **On by default** — sends data to a third party (Anthropic) on every branch. Wrong default for a tool that previously had zero network IO.
  - **Async summarization** (open new tab immediately with a placeholder, replace when summary lands) — risk of user hitting Enter on a half-baked prompt; the sync wait is short enough (1-3s) that the cleaner UX wins.
  - **Hard-error on summarization failure** (block the branch entirely) — punishes the user for a backend issue; the fallback path is functionally complete.
**Consequences:**
  - Users without an Anthropic key can't use summarization until multi-provider lands. Acceptable — the default-off, verbatim-transcript path works for them.
  - The `summarize` function in `src/background/anthropic.ts` is provider-specific (Anthropic SDK shape, `anthropic-version` header, `anthropic-dangerous-direct-browser-access`). When we add OpenAI etc., extract a `SummarizationProvider` interface and refactor — don't shoehorn other providers into this file.
  - Hardcoding Haiku means the cost story is predictable for users (no "I accidentally selected Opus and now every branch costs $0.20"). Trade-off: power users who want Sonnet/Opus quality will have to wait for the multi-provider work to gain a model dropdown.

## 2026-05-24 — Phase G: customize preset questions

### D19. Static popup width estimate, not dynamic `offsetWidth` measurement
**Context:** Phase G raises the preset-button cap from 3 to 6. The original right-edge viewport clamp in `popup.show()` was a hardcoded `window.innerWidth - 320`, which assumed a popup width of ~320px and would let the popup overflow the right edge with 6 buttons (~400-450px wide in practice). The natural-feeling fix is to measure the popup's actual rendered width after open and use that for the clamp. First attempt did exactly this: park the host at `-9999px` offscreen, set `data-open=true`, read `host.offsetWidth`/`offsetHeight`, then reposition properly.
**Decision:** Reverted to a static `POPUP_EST_WIDTH = 480` constant. Sized to comfortably fit the 6-button cap with a small safety margin.
**Why dynamic measurement was wrong:** `offsetWidth` is a layout-reading property, and reading it forces a synchronous layout flush. The popup's `show()` runs in response to selection events. The layout flush at that moment appears to fire focus-management observers on the page — and on Claude (which has aggressive ProseMirror focus management), this interacts badly with the later `+` → custom-input focus call. The static-width approach removes one variable from the focus-regression investigation. As of session close, the deeper focus-regression on Claude remains unresolved (see TODO.md Tech backlog "Claude focus-trap") — eliminating the layout flush narrows the surface area for the next debugging pass.
**Alternatives considered:**
  - **CSS `visibility: hidden` for measuring without rendering** — initial root state would be `visibility: hidden` (laid out and measurable, invisible). `show()` would toggle to visible. Avoids the `-9999px` positioning trick but still requires an `offsetWidth` read, which still flushes layout. Doesn't solve the underlying issue.
  - **Cap presets below 6** — keeps the 320 constant viable. Punts on the feature scope without addressing the focus issue.
  - **Dynamic measurement only when `presets.length > 3`** — conditional version of the dynamic approach. Adds branching for a marginal benefit; same root cause if Claude focus issue stems from layout-flushing.
**Consequences:**
  - At 6 buttons with typical preset lengths (~10-15 chars each), popup width is ~400-450px in practice — the 480 estimate gives a ~30px safety margin. If we ever raise the cap above 6, this constant must be revisited; the alternative is to revisit dynamic measurement once the Claude focus issue is understood and the layout-flush hypothesis is confirmed or disproven.
  - On narrow viewports (mobile, partial-screen, side-by-side window layouts), the 480 clamp pushes the popup further left when near the right edge than the old 320 clamp would have. Acceptable — popup remains within `POPUP_MIN_PADDING` of the left edge.
  - The dynamic-measurement work is preserved in PROGRESS.md ("Aborted approach") so it can be revived if/when the layout-flush hypothesis is ruled in or out.

**Addendum 2026-05-25 — the layout-flush hypothesis was wrong.** The 2026-05-25 instrument-first debugging session (see D20) proved the focus regression had nothing to do with `offsetWidth`-triggered layout flushes or focus-stealing observers. The actual cause was Claude's document-level `keydown` handler refocusing ProseMirror on any keystroke. Our `input.focus()` worked correctly; focus only left our input when the user typed. The static-width choice is still fine on simplicity grounds, but the "layout flush risks the focus race" reasoning above should not be load-bearing for future decisions. Dynamic measurement could be revived if there's a real product reason; the original concern is disproven.

## 2026-05-25 — Claude focus regression: stopPropagation on key events as the popup-input contract

### D20. The popup input stops propagation of `keydown`/`keypress`/`beforeinput` events
**Context:** After Phase G shipped, Claude's `+` → custom-input flow appeared broken: the popup textbox was visible and our `input.focus()` was succeeding, but typing went into Claude's ProseMirror chat input at the bottom of the page. The 2026-05-24 session tried three timing-based fixes (sync vs. setTimeout focus, `void input.offsetWidth` layout-flush, `requestAnimationFrame` re-assert) without resolving the bug, and left it as a "Claude focus-trap" item in Tech backlog with a list of candidate next-session approaches.

**The diagnostic approach that worked:** instead of trying another fix attempt, the 2026-05-25 session instrumented and observed before touching the fix. Added temporary logs in three spots:
1. Before/after `input.focus()` in `popup.ts` showing `document.activeElement` (with tag + class) to confirm whether focus actually landed.
2. A `blur` listener on the input — fires the moment something else takes focus, logs the new `activeElement`.
3. A document-level capture-phase `focusin` listener in `content/index.ts` logging every focus event with `isTrusted`.
A single reproduction on Claude gave the full picture:
- `activeElement` before focus was `body`, not ProseMirror.
- `input.focus()` worked — `activeElement` became the shadow host immediately and stayed there through rAF.
- `BLUR` fired only after the user pressed a key. (Confirmed by a second test: click `+`, wait 5s without typing → no blur.)
- Focus then went briefly to `body`, then to `div.tiptap ProseMirror`.

**Decision:** Add a bubble-phase event listener on the popup input that calls `e.stopPropagation()` for `keydown`, `keypress`, and `beforeinput`. Claude's document-level keydown handler — which refocuses ProseMirror on any keystroke ("type-anywhere-goes-to-chat" UX pattern) — never sees the event, so it doesn't refocus. `stopPropagation` does not affect the input's own text insertion (only `preventDefault` would cancel that), so typing into the input works normally.

Also reverted the three timing-based "fix attempts" from 2026-05-24 (`void input.offsetWidth`, sync focus, `requestAnimationFrame` re-assert) — the logs proved focus was landing correctly at all three observation points, so those were addressing a non-existent problem and complicated the click handler. Click handler is back to a single `input.focus()` call.

**Alternatives considered:**
  - **Capture-phase listener on `document`** with `stopImmediatePropagation` when target is our host. Would defend against Claude using capture-phase listeners (which would fire before our input ever receives the event in bubble phase). Rejected for now because: (a) capture-phase keydown handlers on document are uncommon — most app keystroke handling uses bubble; (b) the bubble-phase fix at the input is local to the popup component, while a document-level capture-phase blocker is a global side effect that's easy to forget when refactoring; (c) the bubble-phase fix verified working end-to-end on the first test cycle. If Claude (or a future adapter target) ever switches to capture-phase keydown handling, the symptom will re-appear and we'd revisit with the capture-phase approach.
  - **Bounded refocus-on-blur retry** (candidate (2) from the prior session's Tech backlog) — listen for blur on the input and refocus N times. Treats the symptom not the cause; would create a focus-fight loop with Claude that wastes cycles every keystroke. Rejected.
  - **Workaround: skip `+` UI on Claude, render custom-input directly** (candidate (4)) — gave up the UI consistency across apps to avoid the bug. Rejected because the actual fix is small and clean.
  - **Restore document selection after `input.focus()` to keep page selection alive** — earlier hypothesis was that the bug was Claude reacting to selectionchange. Logs disproved this (blur only fired on keystroke), so this wasn't needed.

**Consequences:**
  - The bubble-phase fix only works if Claude (and future chat-app integrations) use bubble-phase keydown handlers on document. If any of them ever moves to capture phase, the bug returns. Mitigation: the inline comment in `popup.ts` documents what's being blocked and why, so when re-debugging this becomes step one of the next investigation.
  - Other shadow-DOM popups in the future that also need a keyboard-input affordance must apply the same stopPropagation pattern. Documented in code; not extracted to a shared utility yet (two data points needed, we have one).
  - The lesson for future bug investigations: instrument-first beats guess-and-try. The previous session burned a session trying three fixes for a hypothesis that turned out to be wrong; this session's eight log lines pinpointed the cause and the fix was three lines. This is now the recommended diagnostic pattern for any focus/event/timing bug in this codebase.

## 2026-05-25 — Editor injection replaces existing content, not appends

### D21. `insertTextIntoEditor` selects all existing editor content before inserting
**Context:** User reported that branching repeatedly into ChatGPT produced inputs containing the concatenated drafted prompts from every prior branch. Symptoms: the drafted prompt visibly repeated, and "previous branches' prompt gets appended before the new prompt." Root cause: ChatGPT persists the `#prompt-textarea` draft across tab loads (a UX feature: in-progress messages survive a refresh). The branch tab opens, ChatGPT restores the prior draft into the editor, our `claimAndInject` calls `editor.focus()` (cursor lands at end of restored content) and `execCommand('insertText', false, text)` which inserts at the cursor — i.e., appends. Each successive branch compounds the previous draft text.

**Decision:** `insertTextIntoEditor` in `src/content/inject.ts` now selects all existing editor content before calling `insertText`. Mechanism:
```ts
const range = document.createRange();
range.selectNodeContents(editor);
const sel = window.getSelection();
if (sel) {
  sel.removeAllRanges();
  sel.addRange(range);
}
```
With a non-collapsed selection covering the editor's content, `execCommand('insertText', ...)` replaces the selection rather than inserting at a collapsed cursor. The same selection state is in place if the path falls through to the `InputEvent` fallback — `beforeinput` with `inputType: 'insertText'` and a non-collapsed selection is the standard "replace" semantic, which ProseMirror and Lexical-style editors honor.

Verified working on all three apps: ChatGPT (the bug case — multi-branch test no longer accumulates drafts), Claude, Gemini (no regression for the empty-editor case where the selection step is effectively a no-op).

**Alternatives considered:**
  - **`document.execCommand('selectAll', false)` before `execCommand('insertText', ...)`.** Functionally similar, both deprecated together. Range + Selection API is slightly less deprecated and more explicit about what's being selected.
  - **`editor.textContent = ''` before insertion.** Rejected — ProseMirror (and other rich-text editors) maintain internal state separately from the DOM and don't respond correctly to direct `textContent` mutation. Would leave the editor's internal model out of sync with what the user sees.
  - **Adapter-specific clear logic per chat app.** Rejected — every adapter we have today uses `insertTextIntoEditor`, and "replace whatever is there" is the consistent contract we want regardless of which editor is the target. Centralizing in `inject.ts` keeps adapters thin and applies the same defense across all three.
  - **Skip the clear step on apps that don't persist drafts.** Rejected — selection-then-insert is a no-op for empty editors (selecting nothing, insertText inserts at start), so there's no cost to defaulting it on. And we don't have a reliable signal for "this app persists drafts" — Claude and Gemini may persist briefly in ways we haven't tested.

**Consequences:**
  - `insertTextIntoEditor`'s contract is now: **replace the editor's content with `text`**, not **append `text` to the editor**. The function name is a slight misnomer (insert → replace); rename to `setEditorContent` is a small follow-up if the API surface ever expands. Documented in the function's docstring.
  - The Range + Selection API call assumes `editor` is a contenteditable element with mutable selection. All three current adapters target either ProseMirror (`div.ProseMirror`) or Quill (`div.ql-editor`) instances inside a contenteditable host — both work. If a future adapter targets a `<textarea>` (Bard's old UI, e.g.), this code path will need a textarea branch (`editor.setSelectionRange(0, editor.value.length)` then `insertText`).
  - The fix is defensive across all three apps, not just ChatGPT. If Claude or Gemini ever introduce draft persistence we won't need to revisit.

## 2026-05-25 — Project docs ship with the public repo

### D22. All session-handoff docs are checked into the public GitHub repo, not gitignored
**Context:** Preparing the project for open-sourcing surfaced a question about which files to publish. The session-handoff docs — `PROGRESS.md` (dated session log including AI-assisted-dev signals and some self-critical dev history), `TODO.md` (backlog), `DECISIONS.md` (ADR log), `Project requirements.md` (original product brief in first person) — contain dev-process material that some maintainers prefer to keep private. The initial commit had them excluded via `.gitignore` as a caution; the user re-examined that choice partway through the session.

**Decision:** All four docs ship publicly alongside the code. The `.gitignore` was trimmed to only build/cache artifacts and a scratch screenshots folder (`node_modules/`, `dist/`, `.DS_Store`, `*.log`, `.vite/`, `local testing screenshots/`). README's architecture section links into `DECISIONS.md` / `PROGRESS.md` / `TODO.md` so readers can find them.

The triggers for the reversal:
1. **Backup risk** — gitignored files have no GitHub copy. If the laptop is lost, the docs are gone. The user explicitly raised this concern.
2. **Audit confirmed safety** — full read-through of all four files found no filesystem paths, no API keys, no emails, no contact info. The only personal-identifier hit was "Vinamra Jain" in `TODO.md`, which is also on the public `LICENSE` — no net new exposure.
3. **Single-history value** — keeping all project context (decisions, backlog, dev log) in the same repo means future contributors get the full picture without chasing private side-channels.

**Alternatives considered:**
- **Gitignore the docs, rely on local backup (Time Machine / iCloud / external drive).** Rejected — no version history on the docs, harder to migrate to a new machine, harder to share with collaborators. Backup is a different problem than version control.
- **A separate private GitHub repo for the docs.** Rejected — splits project history across two places; future contributors lose context; setup and remote-juggling friction every session.
- **Selective publish** (e.g., publish `DECISIONS.md` because it's ADR-style, keep `PROGRESS.md` because it has dev-history rough edges). Rejected — adds complexity, and the audit showed no file is meaningfully more sensitive than the others.
- **Rewrite/sanitize PROGRESS.md before publishing** to strip self-critical phrases and AI-assistance signals. Rejected — honest dev history is increasingly common and valued in OSS; rewriting introduces drift between the file and what actually happened.

**Consequences:**
- Future commits to `TODO`, `PROGRESS`, `DECISIONS` will be public. Mind what gets written in them, especially URLs, IDs, third-party names, customer references, or anything that wouldn't belong in a public commit.
- AI-assisted-dev workflow is visible: session logs, /save-progress entries, mentions of "the user", and prior-session self-correction (e.g., the D19 addendum disproving an earlier hypothesis). This is intentional transparency, not a leak.
- `local testing screenshots/` stays gitignored — that's a scratch convention for in-progress debug captures, not part of the published surface. New developers who want to add their own debug screenshots can use the same path locally without polluting the repo.
- If a future session needs to add genuinely private material (a customer name, a private URL, etc.), use a different storage location — these docs are no longer a safe private channel.

**Addendum 2026-05-25 (same session) — narrowed: PROGRESS.md gitignored after one session of public visibility.** After D22 was committed and pushed, the user reconsidered the publish-all-docs default specifically for `PROGRESS.md`. The argument: `PROGRESS.md` is a session-by-session delta — useful for handoff between dev sessions, but mostly noise for a new visitor cloning the repo. The other three docs (TODO, DECISIONS, Project requirements) carry distinct outside-reader value (current state, long-lived rationale, original framing); PROGRESS doesn't. The earlier reasoning in D22 (backup safety, single-history, audit-confirmed safe) still applies to the other three, so they remain published. `PROGRESS.md` was un-tracked via `git rm --cached PROGRESS.md`, added back to `.gitignore`, and CLAUDE.md "Files of note" updated to mark it local-only. The local file is preserved for session continuity — the global CLAUDE.md's "Session start protocol" still expects to read it on the project owner's machine; AI sessions on a freshly-cloned third-party copy won't have access to it and should fall back to TODO + DECISIONS for context.
