import {
  Activity,
  BookOpen,
  Database,
  FileJson,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Upload,
  UserRound,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import type { ConversationEvent, LorebookEntry } from "../types";
import {
  createConversation,
  fetchConversation,
  fetchOverview,
  importCharacter,
  importLorebook,
  runDemo,
  sendMessage,
  type ConversationSnapshot,
  type Overview,
} from "./api";

type InspectorTab = "state" | "lore" | "events";
type BusyKey =
  | "boot"
  | "refresh"
  | "demo"
  | "create"
  | "send"
  | "import-character"
  | "import-lorebook";

export function App() {
  const [overview, setOverview] = useState<Overview>({
    characters: [],
    lorebooks: [],
    conversations: [],
  });
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [selectedLorebookIds, setSelectedLorebookIds] = useState<string[]>([]);
  const [conversationTitle, setConversationTitle] = useState("Conversation");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<InspectorTab>("state");
  const [busy, setBusy] = useState<BusyKey | null>("boot");
  const [error, setError] = useState<string | null>(null);
  const [lastMatchedLore, setLastMatchedLore] = useState<LorebookEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversationId = snapshot?.config.id ?? "";
  const activeLoreIds = snapshot?.config.lorebookIds ?? [];

  useEffect(() => {
    void refresh("boot");
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [snapshot?.messages.length]);

  useEffect(() => {
    if (!selectedCharacterId && overview.characters.length > 0) {
      setSelectedCharacterId(overview.characters[0].id);
    }
  }, [overview.characters, selectedCharacterId]);

  async function refresh(nextBusy: BusyKey = "refresh") {
    await runTask(nextBusy, async () => {
      const nextOverview = await fetchOverview();
      setOverview(nextOverview);

      if (snapshot) {
        setSnapshot(await fetchConversation(snapshot.config.id));
        return;
      }

      const firstConversation = nextOverview.conversations[0];
      if (firstConversation) {
        setSnapshot(await fetchConversation(firstConversation.id));
      }
    });
  }

  async function handleDemo() {
    await runTask("demo", async () => {
      const response = await runDemo();
      setOverview(response.overview);
      setSnapshot(response.snapshot);
      setSelectedCharacterId(response.snapshot.config.characterId);
      setSelectedLorebookIds(response.snapshot.config.lorebookIds);
      setLastMatchedLore(response.snapshot.matchedLoreEntries);
      setTab("events");
    });
  }

  async function handleCreateConversation(event: FormEvent) {
    event.preventDefault();
    await runTask("create", async () => {
      const response = await createConversation({
        title: conversationTitle,
        characterId: selectedCharacterId,
        lorebookIds: selectedLorebookIds,
      });
      setOverview(response.overview);
      setSnapshot(response.snapshot);
      setLastMatchedLore([]);
      setTab("state");
    });
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!activeConversationId || trimmed.length === 0) {
      return;
    }

    await runTask("send", async () => {
      const response = await sendMessage(activeConversationId, trimmed);
      setOverview(response.overview);
      setSnapshot(response.snapshot);
      setLastMatchedLore(response.result.matchedLoreEntries);
      setMessage("");
      setTab("lore");
    });
  }

  async function handleFileImport(
    kind: "character" | "lorebook",
    file: File | null,
  ) {
    if (!file) {
      return;
    }

    await runTask(kind === "character" ? "import-character" : "import-lorebook", async () => {
      const raw = JSON.parse(await file.text()) as unknown;
      const response =
        kind === "character"
          ? await importCharacter(raw, file.name)
          : await importLorebook(raw, file.name);
      setOverview(response.overview);
    });
  }

  async function openConversation(id: string) {
    await runTask("refresh", async () => {
      const nextSnapshot = await fetchConversation(id);
      setSnapshot(nextSnapshot);
      setSelectedCharacterId(nextSnapshot.config.characterId);
      setSelectedLorebookIds(nextSnapshot.config.lorebookIds);
      setLastMatchedLore(nextSnapshot.matchedLoreEntries);
    });
  }

  async function runTask(key: BusyKey, task: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (taskError) {
      const message =
        taskError instanceof Error ? taskError.message : String(taskError);
      setError(message);
    } finally {
      setBusy(null);
    }
  }

  const matchedLore = useMemo(() => {
    if (lastMatchedLore.length > 0) {
      return lastMatchedLore;
    }

    return snapshot?.matchedLoreEntries ?? [];
  }, [lastMatchedLore, snapshot?.matchedLoreEntries]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Database size={18} />
          <span>Agent SillyTavern</span>
        </div>
        <div className="top-meta">
          <span>{overview.characters.length} 角色</span>
          <span>{overview.lorebooks.length} 世界书</span>
          <span>{overview.conversations.length} 会话</span>
        </div>
        <button
          className="icon-button"
          type="button"
          title="刷新"
          onClick={() => void refresh()}
          disabled={busy !== null}
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <aside className="left-panel">
        <section className="section">
          <div className="section-title">
            <span>资产</span>
            <button
              className="tiny-button"
              type="button"
              onClick={() => void handleDemo()}
              disabled={busy !== null}
            >
              <Wand2 size={14} />
              示例一轮
            </button>
          </div>
          <div className="import-row">
            <FileImporter
              label="角色卡"
              icon={<UserRound size={14} />}
              accept=".json,application/json"
              busy={busy === "import-character"}
              onFile={(file) => void handleFileImport("character", file)}
            />
            <FileImporter
              label="世界书"
              icon={<BookOpen size={14} />}
              accept=".json,application/json"
              busy={busy === "import-lorebook"}
              onFile={(file) => void handleFileImport("lorebook", file)}
            />
          </div>
        </section>

        <form className="section compact-form" onSubmit={handleCreateConversation}>
          <div className="section-title">
            <span>新会话</span>
            <button
              className="icon-button"
              type="submit"
              title="新建"
              disabled={busy !== null || !selectedCharacterId}
            >
              <Plus size={16} />
            </button>
          </div>
          <label className="field">
            <span>标题</span>
            <input
              value={conversationTitle}
              onChange={(event) => setConversationTitle(event.target.value)}
            />
          </label>
          <label className="field">
            <span>角色</span>
            <select
              value={selectedCharacterId}
              onChange={(event) => setSelectedCharacterId(event.target.value)}
            >
              <option value="">未选择</option>
              {overview.characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </label>
          <div className="check-list">
            {overview.lorebooks.map((lorebook) => (
              <label key={lorebook.id} className="check-row">
                <input
                  type="checkbox"
                  checked={selectedLorebookIds.includes(lorebook.id)}
                  onChange={(event) => {
                    setSelectedLorebookIds((ids) =>
                      event.target.checked
                        ? [...ids, lorebook.id]
                        : ids.filter((id) => id !== lorebook.id),
                    );
                  }}
                />
                <span>{lorebook.name}</span>
              </label>
            ))}
          </div>
        </form>

        <section className="section conversations">
          <div className="section-title">
            <span>会话</span>
            <MessageSquare size={14} />
          </div>
          <div className="conversation-list">
            {overview.conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={
                  conversation.id === activeConversationId
                    ? "conversation-item active"
                    : "conversation-item"
                }
                type="button"
                onClick={() => void openConversation(conversation.id)}
              >
                <span>{conversation.title}</span>
                <small>{conversation.id}</small>
              </button>
            ))}
            {overview.conversations.length === 0 && (
              <div className="empty">暂无会话</div>
            )}
          </div>
        </section>
      </aside>

      <main className="chat-panel">
        <div className="chat-head">
          <div>
            <strong>{snapshot?.character.name ?? "未选择角色"}</strong>
            <span>{snapshot?.config.title ?? "Conversation"}</span>
          </div>
          <code>{activeConversationId || "no conversation"}</code>
        </div>

        {error && <div className="error-line">{error}</div>}

        <div className="messages" ref={scrollRef}>
          {snapshot?.messages.map((messageItem, index) => (
            <div
              key={`${messageItem.timestamp}-${index}`}
              className={`message ${messageItem.role}`}
            >
              <span className="role">{messageItem.role}</span>
              <p>{messageItem.content}</p>
            </div>
          ))}
          {!snapshot && (
            <div className="empty center">
              <FileJson size={18} />
              <span>暂无活动会话</span>
            </div>
          )}
        </div>

        <form className="composer" onSubmit={handleSend}>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="输入一轮用户消息"
            disabled={!snapshot || busy === "send"}
          />
          <button
            className="send-button"
            type="submit"
            title="发送"
            disabled={!snapshot || busy !== null || message.trim().length === 0}
          >
            {busy === "send" ? <Loader2 size={18} /> : <Send size={18} />}
          </button>
        </form>

        <div className="matched-strip">
          {matchedLore.length > 0 ? (
            matchedLore.map((entry) => <span key={entry.id}>{entry.title}</span>)
          ) : (
            <span>无世界书命中</span>
          )}
        </div>
      </main>

      <aside className="right-panel">
        <div className="tabs">
          <TabButton
            active={tab === "state"}
            label="状态"
            icon={<Activity size={14} />}
            onClick={() => setTab("state")}
          />
          <TabButton
            active={tab === "lore"}
            label="世界书"
            icon={<BookOpen size={14} />}
            onClick={() => setTab("lore")}
          />
          <TabButton
            active={tab === "events"}
            label="事件"
            icon={<FileJson size={14} />}
            onClick={() => setTab("events")}
          />
        </div>

        <Inspector
          snapshot={snapshot}
          tab={tab}
          matchedLore={matchedLore}
          activeLoreIds={activeLoreIds}
        />
      </aside>
    </div>
  );
}

function FileImporter(props: {
  label: string;
  icon: ReactNode;
  accept: string;
  busy: boolean;
  onFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <button
      className="import-button"
      type="button"
      onClick={() => inputRef.current?.click()}
    >
      {props.busy ? <Loader2 size={14} /> : props.icon}
      <span>{props.label}</span>
      <Upload size={13} />
      <input
        ref={inputRef}
        type="file"
        accept={props.accept}
        onChange={(event) => {
          props.onFile(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </button>
  );
}

function TabButton(props: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={props.active ? "tab active" : "tab"}
      type="button"
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function Inspector(props: {
  snapshot: ConversationSnapshot | null;
  tab: InspectorTab;
  matchedLore: LorebookEntry[];
  activeLoreIds: string[];
}) {
  if (!props.snapshot) {
    return <div className="empty inspector-empty">暂无数据</div>;
  }

  if (props.tab === "state") {
    return (
      <div className="inspector-body">
        <KeyValue label="workspace" value={props.snapshot.workspacePath} />
        <KeyValue label="turns" value={String(props.snapshot.state.turnCount)} />
        <KeyValue
          label="scene"
          value={props.snapshot.state.currentScene || "-"}
        />
        <pre>{JSON.stringify(props.snapshot.state, null, 2)}</pre>
      </div>
    );
  }

  if (props.tab === "lore") {
    return (
      <div className="inspector-body lore-list">
        <div className="mini-title">启用</div>
        {props.snapshot.lorebooks.map((lorebook) => (
          <div key={lorebook.id} className="lorebook-row">
            <strong>{lorebook.name}</strong>
            <small>
              {lorebook.entries.length} entries ·{" "}
              {props.activeLoreIds.includes(lorebook.id) ? "active" : "off"}
            </small>
          </div>
        ))}
        <div className="mini-title">命中</div>
        {props.matchedLore.map((entry) => (
          <article key={entry.id} className="lore-entry">
            <header>
              <strong>{entry.title}</strong>
              <small>p{entry.priority}</small>
            </header>
            <p>{entry.content}</p>
          </article>
        ))}
        {props.matchedLore.length === 0 && <div className="empty">无命中</div>}
      </div>
    );
  }

  return (
    <div className="inspector-body event-list">
      {props.snapshot.events
        .slice()
        .reverse()
        .slice(0, 40)
        .map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
    </div>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="kv">
      <span>{props.label}</span>
      <code>{props.value}</code>
    </div>
  );
}

function EventRow(props: { event: ConversationEvent }) {
  return (
    <article className="event-row">
      <header>
        <strong>{props.event.type}</strong>
        <small>{formatTime(props.event.timestamp)}</small>
      </header>
      <pre>{JSON.stringify(props.event.payload, null, 2)}</pre>
    </article>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
