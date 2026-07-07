# SillyTavern Plugin API Shim Status

Agent Tavern loads two real SillyTavern extension bundles:

- Prompt Template / 提示词模板 from `zonde306/ST-Prompt-Template`.
- JS-Slash-Runner / Tavern Helper / 酒馆助手 from `N0VI028/JS-Slash-Runner`.

Prompt Template is loaded first, matching its lower `loading_order`, then
Tavern Helper is loaded. Both bundles import SillyTavern frontend modules by
relative path. Agent Tavern serves compatible shim modules from `/st-public/*`
for those imports.

This document tracks what is implemented, what is intentionally empty, and what
still needs a real Agent Tavern integration.

## Implemented Enough For Runtime Loading

- `lib.js`
  - Implemented: `initLibraryShims`, `lodash`/`_`, `DOMPurify`, `hljs`, `yaml`,
    and `moment` fallbacks. The iframe host also attempts to load real lodash
    and jQuery from CDN before the plugin bundles run.
  - Fallback: the local lodash/yaml shims are partial and exist to keep plugin
    runtime paths alive when a browser/CDN path is unavailable.
- `scripts/utils.js`
  - Implemented: `delay`, `download`, `getBase64Async`,
    `getSanitizedFilename`, `getStringHash`, `isDataURL`, `uuidv4`,
    `Stopwatch`, `copyText`, `debounce`, `waitUntilCondition`, common boolean
    and regex helpers, and small pagination/thumbnail fallbacks.
  - Empty/fallback: image format/size helpers and FontAwesome picker.
- `scripts/events.js`
  - Implemented: re-exports the same shimmed `eventSource` and `event_types`
    as `script.js`, which Prompt Template imports directly.
- `scripts/i18n.js`
  - Implemented: `getCurrentLocale`, identity-style `t`.
- `script.js`
  - Implemented: basic event bus, `characters`, `chat`, `chat_metadata`,
    extension prompt storage, current names, macro substitution for
    `{{user}}`/`{{char}}`, message append/replace/clear, selected character id,
    and simple metadata/settings save no-ops. The iframe host now pushes the
    active Agent Tavern conversation into `characters`, `chat`, `name1`,
    `name2`, `this_chid`, and `chat_metadata` via `postMessage`. The iframe host
    also renders the raw chat into a minimal ST-like `#chat .mes .mes_text` DOM,
    so Tavern Helper can scan and transform custom tags inside its own host.
    Mutations to `.mes_text` are mirrored back to the main Agent Tavern chat as
    plugin-rendered HTML. The host now emits ST-style `chatLoaded`,
    `USER_MESSAGE_RENDERED`, and `CHARACTER_MESSAGE_RENDERED` events after each
    DOM sync so Prompt Template and Tavern Helper can run their original render
    hooks. `this_chid` is bridged as a character-array index, matching
    SillyTavern conventions.
  - Empty/no-op: generation, character deletion, rendering refresh, send button
    state, swipe buttons, and live ST DOM mutations.
- `scripts/world-info.js`
  - Implemented: in-memory `world_info`, `world_names`, load/save/create/delete
    helpers, regex parser, default constants. The iframe host now pushes
    imported Agent Tavern lorebooks into `world_info`, `world_names`, and
    `selected_world_info` via `postMessage`.
  - Empty/fallback: true World Info prompt budgeting, recursive ST engine,
    vector matching, and UI button state.
- `scripts/extensions/regex/engine.js`
  - Implemented: `regex_placement`, pass-through `getRegexedString`.
  - Not wired to Agent Tavern persisted regex scripts yet.
- `scripts/extensions.js`
  - Implemented: `extension_settings`, `getContext`, metadata-save no-op.
    `getContext` reads the latest bridged Agent Tavern conversation snapshot.
    `renderExtensionTemplateAsync` fetches real extension templates through the
    local proxy, which lets Prompt Template load `settings.html`.
- `scripts/group-chats.js`
  - Implemented: empty `groups`, `selected_group`, and `getGroupMembers`.
- `scripts/reasoning.js`
  - Implemented: no-op `updateReasoningUI`, enough for Prompt Template render
    hooks to complete without owning SillyTavern's reasoning UI.
- `scripts/preset-manager.js`
  - Implemented: minimal object returned by `getPresetManager`.
  - Not connected to Agent Tavern prompt generation yet.
- `scripts/PromptManager.js`
  - Implemented: lightweight `Prompt` and `PromptCollection` classes.
  - Not the full SillyTavern Prompt Manager runtime.
- `scripts/openai.js`
  - Implemented: lightweight message classes and settings objects.
  - Empty/no-op: OpenAI request sending, streaming, and full prompt assembly.
- `scripts/macros.js`
  - Implemented: pass-through `MacrosParser`, `getLastMessageId`.
- `scripts/slash-commands/*`
  - Implemented: class shells and parser shells.
  - Slash command execution returns an empty result.
- `scripts/popup.js`
  - Implemented: browser `alert`/`confirm`/`prompt` backed popup fallback.
- `scripts/tokenizers.js`
  - Implemented: approximate token counter.

## Currently Left Empty Or No-Op

These APIs do not fit the current Agent Tavern runtime yet and are intentionally
stubbed:

- Text generation and streaming APIs from `script.js` and `scripts/openai.js`.
- Prompt Template generation-time hooks (`GENERATION_AFTER_COMMANDS`,
  `GENERATE_AFTER_DATA`, `CHAT_COMPLETION_SETTINGS_READY`) are available as
  events, but Agent Tavern's Pi prompt assembly does not yet emit the real
  prompt payload into them. Render-time hooks are wired through iframe chat DOM
  events.
- Full ST DOM refresh APIs such as `printMessages`, `printCharacters`,
  `reloadMarkdownProcessor`, send button state, and swipe UI.
- Main Agent Tavern chat bubbles do not parse Prompt Template or Tavern Helper
  custom tags on their own. They display HTML mirrored back from the
  iframe-hosted plugin DOM after the real plugins mutate `.mes_text`.
- Character deletion, hotswap, persona image management, and thumbnail
  generation.
- Full World Info prompt manager behavior, context-budget enforcement, timed
  effects, vector storage, and ST UI settings.
- Full Slash Command / Quick Reply / STscript command execution.
- Full Prompt Manager and preset-manager state.
- Regex extension engine integration with Agent Tavern's persisted regex
  scripts.

## Next API Batches

1. Emit real generation prompt lifecycle events from the Agent Tavern Pi runtime
   so Prompt Template can process outgoing prompts before model calls.
2. Add write-back APIs so plugin-side changes to `chat_metadata`, world info,
   and extension prompts can persist into Agent Tavern instead of staying
   iframe-local.
3. Wire `getRegexedString` to Agent Tavern's regex script implementation.
4. Wire `executeSlashCommandsWithOptions` to a safe subset of STscript commands.
5. Replace `Prompt` / `PromptCollection` shells with real Prompt Manager behavior
   or a directly imported SillyTavern module once its browser dependencies are
   satisfied.
6. Add browser automation coverage for the iframe host once the Codex browser
   tool is available in this thread.
