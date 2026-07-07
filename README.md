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
