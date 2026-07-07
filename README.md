# Agent SillyTavern

An early TypeScript runtime for SillyTavern-compatible character and lorebook assets.

This first slice intentionally avoids databases, ORMs, and vector stores. It uses:

- TypeScript and Node.js
- JSON files for imported assets
- Per-conversation workspace folders
- JSONL event logs
- A runtime model client for Mock, DeepSeek, Kimi, Pi, and OpenAI-compatible APIs

## Quick Start

```bash
npm install
npm run build
npm run demo
```

The demo imports the sample character card and lorebook, creates a conversation workspace, runs one agent turn, and writes events to disk.

## Useful Commands

Start the compact local validation UI:

```bash
npm run dev
```

The API defaults to `http://127.0.0.1:8787` and the Vite UI defaults to `http://127.0.0.1:5173`. If 5173 is busy, run:

```bash
npm run web -- --port 5174
```

If a previous local dev server is still holding the ports, run:

```bash
npm run dev:stop
```

## Model Providers

The settings panel stores provider config locally in `data/settings.json`. You can
also use environment variables instead of pasting keys into the UI:

```bash
DEEPSEEK_API_KEY=...
MOONSHOT_API_KEY=... # or KIMI_API_KEY
OPENAI_API_KEY=...   # fallback for Pi/OpenAI-compatible
```

The chat header has a compact provider/model switcher for the active
conversation. New conversations start from the default provider/model in
settings.

CLI helpers:

```bash
npm run import:character -- ./samples/character-card.json
npm run import:lorebook -- ./samples/lorebook.json
npm run conversation:new -- <character-id> [lorebook-id...]
npm run send -- <conversation-id> "Your message here"
```

The UI character importer accepts SillyTavern JSON cards and PNG character
cards. If a card contains an embedded `character_book`, it is imported as a
regular lorebook alongside the character.

## SillyTavern Compatibility Notes

The runtime now handles the parts of ST assets that matter most during chat:

- Character Card V2 fields: first message, alternate greetings, examples,
  system prompt, post-history instructions, creator metadata, tags, extensions,
  and embedded character books.
- Opening messages: new conversations are seeded with the character greeting
  before the first user turn.
- Macros: common placeholders such as `{{char}}`, `{{user}}`,
  `{{scenario}}`, `{{charFirstMessage}}`, recent-message macros, local
  variables, simple random/roll helpers, and legacy `<USER>/<BOT>/<CHAR>`
  markers are expanded in prompts, greetings, lore, and regex find strings.
- World Info: regex keys, optional filters, scan depth, case sensitivity,
  whole-word matching, constants, insertion order, probability, and recursive
  activation are supported. Matched entries are recorded in `pipeline_trace`.
- Regex scripts: scoped character regex scripts and global settings regex
  scripts can run on user input, AI output, injected World Info, and outgoing
  prompts with `{{match}}`, capture groups, trim strings, and macro-aware find
  patterns.
- Chat rendering: the local UI safely renders common Markdown and a small safe
  HTML subset for chat messages, including emphasis, lists, quotes, code, links,
  images, spoilers, and line breaks.

Vector storage matching, full STscript automation, timed effects, and full
SillyTavern prompt-manager parity are intentionally not implemented in this
slice.

## Runtime Shape

One user message runs this pipeline:

1. Load conversation config and state.
2. Load the active character and lorebooks.
3. Append the user input to the event log.
4. Retrieve recent messages.
5. Match lorebook entries.
6. Compose a runtime prompt snapshot.
7. Generate a draft with the model client.
8. Validate the draft.
9. Append the final assistant output.
10. Update conversation state.
