import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  Upload,
  UserRound,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent as ReactDragEvent, FormEvent, KeyboardEvent, ReactNode } from "react";

import { DEFAULT_SETTINGS, PROVIDER_PRESETS, getProviderPreset } from "../settings/defaults";
import type {
  ConversationEvent,
  JsonValue,
  Lorebook,
  LorebookEntry,
  ModelProvider,
  ProviderConfig,
  Settings as SettingsType,
} from "../types";
import {
  createConversation,
  fetchConversation,
  fetchOverview,
  fetchSettings,
  importCharacter,
  importLorebook,
  runDemo,
  sendMessage,
  streamMessage,
  updateConversationConfig,
  updateConversationState,
  updateLorebook,
  updateSettings,
  type ConversationSnapshot,
  type Overview,
} from "./api";
import { isPngFile, readImportFile } from "./card-file";

type BusyKey =
  | "boot"
  | "refresh"
  | "demo"
  | "create"
  | "send"
  | "import-character"
  | "import-lorebook"
  | "update-config"
  | "update-model"
  | "update-state"
  | "update-lorebook"
  | "update-settings";

export function App() {
  const [overview, setOverview] = useState<Overview>({
    characters: [],
    lorebooks: [],
    conversations: [],
  });
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<BusyKey | null>("boot");
  const [error, setError] = useState<string | null>(null);
  const [lastMatchedLore, setLastMatchedLore] = useState<LorebookEntry[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [quickModelDraft, setQuickModelDraft] = useState("");
  const [newConversationTitle, setNewConversationTitle] = useState("新会话");
  const [newCharacterId, setNewCharacterId] = useState("");
  const [newLorebookIds, setNewLorebookIds] = useState<string[]>([]);
  const [draftState, setDraftState] = useState({
    summary: "",
    currentScene: "",
    variables: "{}",
  });
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [streamingThinking, setStreamingThinking] = useState<string | null>(null);
  const [lorebookDrafts, setLorebookDrafts] = useState<Record<string, Lorebook>>({});
  const [expandedLorebooks, setExpandedLorebooks] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [globalDragActive, setGlobalDragActive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversationId = snapshot?.config.id ?? "";
  const activeCharacterId = snapshot?.config.characterId ?? "";
  const activeLoreIds = snapshot?.config.lorebookIds ?? [];

  useEffect(() => {
    void refresh("boot");
  }, []);

  useEffect(() => {
    function handleDragEnter(event: DragEvent) {
      event.preventDefault();
      setGlobalDragActive(true);
    }

    function handleDragOver(event: DragEvent) {
      event.preventDefault();
    }

    function handleDrop(event: DragEvent) {
      event.preventDefault();
      setGlobalDragActive(false);
    }

    document.addEventListener("dragenter", handleDragEnter);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("dragenter", handleDragEnter);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [snapshot?.messages.length]);

  useEffect(() => {
    if (snapshot) {
      setDraftState({
        summary: snapshot.state.summary,
        currentScene: snapshot.state.currentScene,
        variables: JSON.stringify(snapshot.state.variables, null, 2),
      });
      const expanded = new Set(expandedLorebooks);
      for (const id of snapshot.config.lorebookIds) {
        expanded.add(id);
      }
      setExpandedLorebooks(expanded);
    }
  }, [snapshot?.config.id]);

  useEffect(() => {
    setQuickModelDraft(snapshot?.config.model.name ?? "");
  }, [
    snapshot?.config.id,
    snapshot?.config.model.provider,
    snapshot?.config.model.name,
  ]);

  useEffect(() => {
    setLorebookDrafts((drafts) => {
      const next: Record<string, Lorebook> = { ...drafts };
      for (const lorebook of overview.lorebooks) {
        next[lorebook.id] = drafts[lorebook.id] ?? lorebook;
      }
      return next;
    });
  }, [overview.lorebooks]);

  useEffect(() => {
    if (overview.characters.length > 0 && !newCharacterId) {
      setNewCharacterId(overview.characters[0].id);
    }
  }, [overview.characters, newCharacterId]);

  async function refresh(nextBusy: BusyKey = "refresh") {
    await runTask(nextBusy, async () => {
      const [nextOverview, nextSettings] = await Promise.all([
        fetchOverview(),
        fetchSettings(),
      ]);
      setOverview(nextOverview);
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);

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
      setLastMatchedLore(response.snapshot.matchedLoreEntries);
    });
  }

  async function handleCreateConversation(event: FormEvent) {
    event.preventDefault();
    if (!newCharacterId) return;

    await runTask("create", async () => {
      const response = await createConversation({
        title: newConversationTitle.trim() || "新会话",
        characterId: newCharacterId,
        lorebookIds: newLorebookIds,
      });
      setOverview(response.overview);
      setSnapshot(response.snapshot);
      setLastMatchedLore([]);
      setNewConversationTitle("新会话");
      setNewLorebookIds([]);
      setShowCreateForm(false);
    });
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = message.trim();
    if (!activeConversationId || trimmed.length === 0) return;

    setBusy("send");
    setError(null);
    setMessage("");
    setStreamingContent("");
    setStreamingThinking("");

    try {
      await streamMessage(activeConversationId, trimmed, (event) => {
        if (
          event.type === "message_start" ||
          event.type === "message_update" ||
          event.type === "message_end"
        ) {
          const message = event.message as Record<string, unknown> | undefined;
          setStreamingContent(extractTextFromPiMessage(message));
          setStreamingThinking(extractThinkingFromPiMessage(message));
        } else if (event.type === "done") {
          setOverview(event.overview);
          setSnapshot(event.snapshot);
          setLastMatchedLore(event.snapshot.matchedLoreEntries);
        }
      });
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : String(sendError);
      setError(message);
    } finally {
      setBusy(null);
      setStreamingContent(null);
      setStreamingThinking(null);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  async function handleFileImport(
    kind: "character" | "lorebook",
    file: File | null,
  ) {
    if (!file) return;

    await runTask(
      kind === "character" ? "import-character" : "import-lorebook",
      async () => {
        const raw = await readImportFile(file, kind);
        const response =
          kind === "character"
            ? await importCharacter(raw, file.name)
            : await importLorebook(raw, file.name);
        setOverview(response.overview);
      },
    );
  }


  async function handleGlobalDrop(event: {
    preventDefault: () => void;
    dataTransfer: DataTransfer | null;
  }) {
    event.preventDefault();
    setGlobalDragActive(false);

    const file = event.dataTransfer?.files[0] ?? null;
    if (!file) return;

    if (isPngFile(file)) {
      await handleFileImport("character", file);
      return;
    }

    if (file.name.toLowerCase().endsWith(".json")) {
      await handleFileImport("lorebook", file);
      return;
    }

    setError("仅支持 PNG 角色卡或 JSON 世界书文件");
  }

  async function openConversation(id: string) {
    await runTask("refresh", async () => {
      const nextSnapshot = await fetchConversation(id);
      setSnapshot(nextSnapshot);
      setLastMatchedLore(nextSnapshot.matchedLoreEntries);
    });
  }

  function handleSelectCharacter(characterId: string) {
    setNewCharacterId(characterId);
    setShowCreateForm(true);
  }

  async function handleUpdateState() {
    if (!activeConversationId) return;

    await runTask("update-state", async () => {
      let variables: Record<string, JsonValue> = {};
      try {
        variables = JSON.parse(draftState.variables) as Record<string, JsonValue>;
      } catch {
        setError("变量 JSON 格式错误");
        return;
      }

      const response = await updateConversationState(activeConversationId, {
        summary: draftState.summary,
        currentScene: draftState.currentScene,
        variables,
      });
      setSnapshot(response.snapshot);
    });
  }

  async function handleToggleLorebook(lorebookId: string) {
    if (!activeConversationId) return;

    const nextIds = activeLoreIds.includes(lorebookId)
      ? activeLoreIds.filter((id) => id !== lorebookId)
      : [...activeLoreIds, lorebookId];

    await runTask("update-config", async () => {
      const response = await updateConversationConfig(activeConversationId, {
        lorebookIds: nextIds,
      });
      setOverview(response.overview);
      setSnapshot(response.snapshot);
      setExpandedLorebooks((set) => {
        const next = new Set(set);
        if (nextIds.includes(lorebookId)) next.add(lorebookId);
        return next;
      });
    });
  }

  async function handleSwitchConversationModel(
    provider: ModelProvider,
    modelName?: string,
  ) {
    if (!activeConversationId || !snapshot) return;

    const preset = getProviderPreset(provider);
    const providerConfig = settings.providers[provider] ?? {};
    const requestedModel = modelName?.trim();
    const configuredModel = providerConfig.model?.trim();
    const presetModel = preset?.defaultModel.trim();
    const nextModel =
      requestedModel && requestedModel.length > 0
        ? requestedModel
        : configuredModel && configuredModel.length > 0
          ? configuredModel
          : presetModel && presetModel.length > 0
            ? presetModel
            : provider === snapshot.config.model.provider
              ? snapshot.config.model.name
              : "";

    await runTask("update-model", async () => {
      const response = await updateConversationConfig(activeConversationId, {
        model: {
          provider,
          name: nextModel,
        },
      });
      setOverview(response.overview);
      setSnapshot(response.snapshot);
      setQuickModelDraft(response.snapshot.config.model.name);
    });
  }

  function commitQuickModelDraft() {
    const nextModel = quickModelDraft.trim();
    if (!snapshot || nextModel.length === 0) return;
    if (nextModel === snapshot.config.model.name) return;
    void handleSwitchConversationModel(currentModelProvider, nextModel);
  }

  async function handleSaveLorebook(lorebookId: string) {
    const draft = lorebookDrafts[lorebookId];
    if (!draft) return;

    await runTask("update-lorebook", async () => {
      const response = await updateLorebook(lorebookId, { entries: draft.entries });
      setOverview(response.overview);
      setSnapshot((prev) =>
        prev ? { ...prev, lorebooks: prev.lorebooks.map((lb) => (lb.id === lorebookId ? response.lorebook : lb)) } : prev,
      );
      setLorebookDrafts((drafts) => ({ ...drafts, [lorebookId]: response.lorebook }));
    });
  }

  async function handleSaveSettings() {
    await runTask("update-settings", async () => {
      const saved = await updateSettings(settingsDraft);
      setSettings(saved);
      setSettingsDraft(saved);
      setShowSettings(false);
    });
  }

  function updateLorebookEntry(
    lorebookId: string,
    entryId: string,
    patch: Partial<LorebookEntry>,
  ) {
    setLorebookDrafts((drafts) => {
      const draft = drafts[lorebookId];
      if (!draft) return drafts;
      return {
        ...drafts,
        [lorebookId]: {
          ...draft,
          entries: draft.entries.map((entry) =>
            entry.id === entryId ? { ...entry, ...patch } : entry,
          ),
        },
      };
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
    if (lastMatchedLore.length > 0) return lastMatchedLore;
    return snapshot?.matchedLoreEntries ?? [];
  }, [lastMatchedLore, snapshot?.matchedLoreEntries]);

  const currentModelProvider =
    snapshot?.config.model.provider ?? settings.defaultModel.provider;
  const currentModelPreset = getProviderPreset(currentModelProvider);
  const currentModelOptions = currentModelPreset?.models ?? [];
  const currentModelName =
    snapshot?.config.model.name ??
    settings.providers[currentModelProvider]?.model ??
    currentModelPreset?.defaultModel ??
    "";

  const groupedConversations = useMemo(() => {
    const characterMap = new Map(overview.characters.map((c) => [c.id, c]));
    const groups = new Map<string, typeof overview.conversations>();
    const unknownKey = "未指定角色";

    for (const conversation of overview.conversations) {
      const character = characterMap.get(conversation.characterId);
      const key = character?.name ?? unknownKey;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(conversation);
    }

    const sorted = new Map(
      Array.from(groups.entries()).sort(([a], [b]) => {
        if (a === unknownKey) return 1;
        if (b === unknownKey) return -1;
        return a.localeCompare(b);
      }),
    );

    return sorted;
  }, [overview.conversations, overview.characters]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groupedConversations;

    const result = new Map<string, typeof overview.conversations>();
    for (const [name, conversations] of groupedConversations) {
      const filtered = conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          name.toLowerCase().includes(query),
      );
      if (filtered.length > 0) result.set(name, filtered);
    }
    return result;
  }, [groupedConversations, searchQuery]);

  function toggleGroup(name: string) {
    setExpandedGroups((set) => {
      const next = new Set(set);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleLorebookExpand(id: string) {
    setExpandedLorebooks((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="app-shell">
      <aside className="left-panel">
        <header className="panel-header">
          <div className="brand">
            <span>Agent 酒馆</span>
          </div>
          <div className="toolbar">
            <FileImporter
              label="角色"
              icon={<UserRound size={13} />}
              accept=".json,.png,application/json,image/png"
              busy={busy === "import-character"}
              onFile={(file) => void handleFileImport("character", file)}
            />
            <FileImporter
              label="世界书"
              icon={<BookOpen size={13} />}
              accept=".json,application/json"
              busy={busy === "import-lorebook"}
              onFile={(file) => void handleFileImport("lorebook", file)}
            />
            <button
              className="tool-button"
              type="button"
              onClick={() => setShowCreateForm((v) => !v)}
              disabled={busy !== null || overview.characters.length === 0}
            >
              <Plus size={13} />
              新建
            </button>
            <button
              className="tool-button"
              type="button"
              onClick={() => {
                setSettingsDraft(settings);
                setShowSettings(true);
              }}
              disabled={busy !== null}
              title="设置"
            >
              <Settings size={13} />
            </button>
          </div>
        </header>

        <div className="left-panel-body">
          {showCreateForm && (
            <form className="create-form" onSubmit={handleCreateConversation}>
              <div className="create-form-head">
                <span>新建会话</span>
                <button
                  className="icon-button ghost"
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                >
                  <X size={13} />
                </button>
              </div>
              <label className="field">
                <span>标题</span>
                <input
                  value={newConversationTitle}
                  onChange={(event) => setNewConversationTitle(event.target.value)}
                />
              </label>
              <label className="field">
                <span>角色</span>
                <select
                  value={newCharacterId}
                  onChange={(event) => setNewCharacterId(event.target.value)}
                >
                  {overview.characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="check-list compact">
                {overview.lorebooks.map((lorebook) => (
                  <label key={lorebook.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={newLorebookIds.includes(lorebook.id)}
                      onChange={(event) => {
                        setNewLorebookIds((ids) =>
                          event.target.checked
                            ? [...ids, lorebook.id]
                            : ids.filter((id) => id !== lorebook.id),
                        );
                      }}
                    />
                    <span>{lorebook.name}</span>
                  </label>
                ))}
                {overview.lorebooks.length === 0 && (
                  <div className="empty subtle">暂无世界书</div>
                )}
              </div>
              <button
                className="primary-button"
                type="submit"
                disabled={busy !== null || !newCharacterId}
              >
                {busy === "create" ? <Loader2 size={13} /> : <MessageSquare size={13} />}
                创建会话
              </button>
            </form>
          )}

          <div className="search-row">
            <Search size={13} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索会话或角色"
            />
          </div>

          <div className="character-list">
            <div className="character-list-head">
              <span>角色</span>
              <small>{overview.characters.length}</small>
            </div>
            {overview.characters.length === 0 ? (
              <div className="empty subtle">拖入 PNG 角色卡导入</div>
            ) : (
              <div className="character-items">
                {overview.characters.map((character) => (
                  <button
                    key={character.id}
                    className={
                      character.id === newCharacterId
                        ? "character-item active"
                        : "character-item"
                    }
                    type="button"
                    title={character.name}
                    onClick={() => handleSelectCharacter(character.id)}
                  >
                    <UserRound size={13} />
                    <span>{character.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="conversation-tree">
            {Array.from(filteredGroups.entries()).map(([name, conversations]) => {
              const expanded = expandedGroups.has(name) || searchQuery.trim().length > 0;
              return (
                <div key={name} className="group">
                  <button
                    className="group-header"
                    type="button"
                    onClick={() => toggleGroup(name)}
                  >
                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>{name}</span>
                    <small>{conversations.length}</small>
                  </button>
                  {expanded && (
                    <div className="group-items">
                      {conversations.map((conversation) => (
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
                          <small>{formatDate(conversation.updatedAt)}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredGroups.size === 0 && (
              <div className="empty">未找到会话</div>
            )}
          </div>
        </div>

        <div className="panel-footer">
          <button
            className="tool-button"
            type="button"
            onClick={() => void handleDemo()}
            disabled={busy !== null}
          >
            {busy === "demo" ? <Loader2 size={13} /> : <Wand2 size={13} />}
            示例一轮
          </button>
          <button
            className="icon-button"
            type="button"
            title="刷新"
            onClick={() => void refresh()}
            disabled={busy !== null}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </aside>

      <main className="chat-panel">
        <header className="chat-head">
          <div className="chat-head-main">
            <strong>{snapshot?.character.name ?? "未选择角色"}</strong>
            <span>
              {snapshot?.config.title ?? "未选择会话"}
              {snapshot?.tokenUsage && (
                <>
                  {" · "}
                  提示 {formatTokens(snapshot.tokenUsage.promptTokens)} / 输出{" "}
                  {formatTokens(snapshot.tokenUsage.completionTokens)} / 总计{" "}
                  {formatTokens(snapshot.tokenUsage.totalTokens)}
                </>
              )}
            </span>
          </div>
          {snapshot && (
            <div className="model-switcher">
              <select
                value={currentModelProvider}
                aria-label="AI provider"
                title="AI provider"
                disabled={busy !== null}
                onChange={(event) =>
                  void handleSwitchConversationModel(
                    event.target.value as ModelProvider,
                  )
                }
              >
                {PROVIDER_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              {currentModelOptions.length > 0 ? (
                <select
                  value={currentModelName}
                  aria-label="AI model"
                  title={currentModelName}
                  disabled={busy !== null}
                  onChange={(event) =>
                    void handleSwitchConversationModel(
                      currentModelProvider,
                      event.target.value,
                    )
                  }
                >
                  {currentModelName.length > 0 &&
                    !currentModelOptions.includes(currentModelName) && (
                      <option value={currentModelName}>{currentModelName}</option>
                    )}
                  {currentModelOptions.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={quickModelDraft}
                  aria-label="AI model"
                  title={quickModelDraft}
                  disabled={busy !== null}
                  onChange={(event) => setQuickModelDraft(event.target.value)}
                  onBlur={commitQuickModelDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              )}
            </div>
          )}
        </header>

        {error && <div className="error-line">{error}</div>}

        <div className="messages" ref={scrollRef}>
          {snapshot?.messages.map((messageItem, index) => (
            <div
              key={`${messageItem.timestamp}-${index}`}
              className={`message ${messageItem.role}`}
            >
              <div className="message-inner">
                <span className="role">{roleLabel(messageItem.role)}</span>
                <MessageContent text={messageItem.content} />
                <small className="time">{formatTime(messageItem.timestamp)}</small>
              </div>
            </div>
          ))}
          {(streamingContent !== null || streamingThinking !== null) && (
            <div className="message assistant streaming">
              <div className="message-inner">
                <span className="role">{roleLabel("assistant")}</span>
                {streamingThinking && streamingThinking.length > 0 && (
                  <div className="thinking-stream">{streamingThinking}</div>
                )}
                <MessageContent text={streamingContent ?? ""} />
                <small className="time">生成中…</small>
              </div>
            </div>
          )}
          {!snapshot && (
            <div className="empty center">
              <span>选择一个会话开始，或导入角色卡</span>
            </div>
          )}
        </div>

        <div className="composer-area">
          {matchedLore.length > 0 && (
            <div className="lore-hint">
              <BookOpen size={11} />
              <span>命中 {matchedLore.length} 条世界书：</span>
              {matchedLore.map((entry) => (
                <span key={entry.id} className="lore-hint-chip" title={entry.content}>
                  {entry.title}
                </span>
              ))}
            </div>
          )}
          <form className="composer" onSubmit={handleSend}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={snapshot ? "输入消息，Enter 发送" : "先选择或创建会话"}
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
        </div>
      </main>

      <aside className="right-panel">
        <div className="panel-section">
          <div className="section-title">
            <span>角色状态</span>
            <button
              className="icon-button ghost"
              type="button"
              onClick={handleUpdateState}
              disabled={busy !== null || !snapshot}
              title="保存状态"
            >
              {busy === "update-state" ? <Loader2 size={13} /> : <Save size={13} />}
            </button>
          </div>
          {!snapshot ? (
            <div className="empty subtle">未选择会话</div>
          ) : (
            <div className="state-form">
              <StateField label="角色" value={snapshot.character.name} readOnly />
              <StateField label="回合" value={String(snapshot.state.turnCount)} readOnly />
              <label className="state-field">
                <span>场景</span>
                <input
                  value={draftState.currentScene}
                  onChange={(event) =>
                    setDraftState((s) => ({ ...s, currentScene: event.target.value }))
                  }
                />
              </label>
              <label className="state-field">
                <span>摘要</span>
                <textarea
                  value={draftState.summary}
                  onChange={(event) =>
                    setDraftState((s) => ({ ...s, summary: event.target.value }))
                  }
                  rows={3}
                />
              </label>
              <label className="state-field">
                <span>变量</span>
                <textarea
                  value={draftState.variables}
                  onChange={(event) =>
                    setDraftState((s) => ({ ...s, variables: event.target.value }))
                  }
                  rows={4}
                  className="mono"
                />
              </label>
            </div>
          )}
        </div>

        <div className="panel-section fill">
          <div className="section-title">
            <span>世界书</span>
          </div>
          {!snapshot ? (
            <div className="empty subtle">未选择会话</div>
          ) : (
            <div className="lorebook-panel">
              {overview.lorebooks.map((lorebook) => {
                const active = activeLoreIds.includes(lorebook.id);
                const expanded = expandedLorebooks.has(lorebook.id);
                const draft = lorebookDrafts[lorebook.id] ?? lorebook;
                const dirty = JSON.stringify(draft.entries) !== JSON.stringify(lorebook.entries);

                return (
                  <div
                    key={lorebook.id}
                    className={active ? "lorebook active" : "lorebook"}
                  >
                    <div className="lorebook-header">
                      <button
                        className="expand-button"
                        type="button"
                        onClick={() => toggleLorebookExpand(lorebook.id)}
                      >
                        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>
                      <span className="lorebook-name">{lorebook.name}</span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={() => void handleToggleLorebook(lorebook.id)}
                          disabled={busy !== null}
                        />
                        <span className="switch-track" />
                      </label>
                    </div>
                    {expanded && (
                      <div className="lorebook-entries">
                        {draft.entries.map((entry) => {
                          const hit = matchedLore.some((m) => m.id === entry.id);
                          return (
                            <div
                              key={entry.id}
                              className={hit ? "lore-entry hit" : "lore-entry"}
                            >
                              <div className="lore-entry-header">
                                <input
                                  className="lore-title-input"
                                  value={entry.title}
                                  onChange={(event) =>
                                    updateLorebookEntry(lorebook.id, entry.id, {
                                      title: event.target.value,
                                    })
                                  }
                                  placeholder="条目标题"
                                />
                                <small>uid {entry.uid}</small>
                              </div>
                              <div className="lore-entry-controls">
                                <label className="toggle">
                                  <input
                                    type="checkbox"
                                    checked={entry.enabled}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        enabled: event.target.checked,
                                      })
                                    }
                                  />
                                  <span>启用</span>
                                </label>
                                <label className="toggle">
                                  <input
                                    type="checkbox"
                                    checked={entry.constant}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        constant: event.target.checked,
                                      })
                                    }
                                  />
                                  <span>恒定</span>
                                </label>
                                <label className="toggle">
                                  <input
                                    type="checkbox"
                                    checked={entry.selective}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        selective: event.target.checked,
                                      })
                                    }
                                  />
                                  <span>过滤</span>
                                </label>
                                <label className="toggle">
                                  <input
                                    type="checkbox"
                                    checked={entry.caseSensitive ?? false}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        caseSensitive: event.target.checked,
                                      })
                                    }
                                  />
                                  <span>大小写</span>
                                </label>
                                <label className="toggle">
                                  <input
                                    type="checkbox"
                                    checked={entry.matchWholeWords ?? true}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        matchWholeWords: event.target.checked,
                                      })
                                    }
                                  />
                                  <span>整词</span>
                                </label>
                                <label className="priority">
                                  <span>逻辑</span>
                                  <select
                                    value={entry.selectiveLogic ?? "and_any"}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        selectiveLogic: event.target.value as LorebookEntry["selectiveLogic"],
                                      })
                                    }
                                  >
                                    <option value="and_any">AND ANY</option>
                                    <option value="and_all">AND ALL</option>
                                    <option value="not_any">NOT ANY</option>
                                    <option value="not_all">NOT ALL</option>
                                  </select>
                                </label>
                                <label className="priority">
                                  <span>优先级</span>
                                  <input
                                    type="number"
                                    value={entry.priority}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        priority: Number(event.target.value),
                                      })
                                    }
                                  />
                                </label>
                                <label className="priority">
                                  <span>概率</span>
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={entry.probability ?? 100}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        probability: Number(event.target.value),
                                        useProbability: Number(event.target.value) < 100,
                                      })
                                    }
                                  />
                                </label>
                                <label className="priority">
                                  <span>位置</span>
                                  <select
                                    value={entry.position ?? "after_char"}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        position: event.target.value as LorebookEntry["position"],
                                      })
                                    }
                                  >
                                    <option value="before_char">角色前</option>
                                    <option value="after_char">角色后</option>
                                    <option value="before_example">例句前</option>
                                    <option value="after_example">例句后</option>
                                    <option value="top_an">AN 顶部</option>
                                    <option value="bottom_an">AN 底部</option>
                                    <option value="at_depth">@Depth</option>
                                    <option value="outlet">Outlet</option>
                                  </select>
                                </label>
                              </div>
                              <div className="lore-key-grid">
                                <label>
                                  <span>主 Keys</span>
                                  <textarea
                                    className="lore-key-input"
                                    value={formatKeyList(entry.keys)}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        keys: parseKeyList(event.target.value),
                                      })
                                    }
                                    rows={2}
                                    placeholder="每行一个 key，支持 /regex/flags"
                                  />
                                </label>
                                <label>
                                  <span>过滤 Keys</span>
                                  <textarea
                                    className="lore-key-input"
                                    value={formatKeyList(entry.secondaryKeys)}
                                    onChange={(event) =>
                                      updateLorebookEntry(lorebook.id, entry.id, {
                                        secondaryKeys: parseKeyList(event.target.value),
                                      })
                                    }
                                    rows={2}
                                    placeholder="selective 启用时使用"
                                  />
                                </label>
                              </div>
                              <textarea
                                className="lore-content"
                                value={entry.content}
                                onChange={(event) =>
                                  updateLorebookEntry(lorebook.id, entry.id, {
                                    content: event.target.value,
                                  })
                                }
                                rows={2}
                                placeholder="条目内容"
                              />
                            </div>
                          );
                        })}
                        {dirty && (
                          <button
                            className="primary-button small"
                            type="button"
                            onClick={() => void handleSaveLorebook(lorebook.id)}
                            disabled={busy !== null}
                          >
                            {busy === "update-lorebook" ? (
                              <Loader2 size={12} />
                            ) : (
                              <Save size={12} />
                            )}
                            保存世界书
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {overview.lorebooks.length === 0 && (
                <div className="empty subtle">暂无世界书</div>
              )}
            </div>
          )}
        </div>
      </aside>

      {showSettings && (
        <RuntimeSettingsPanel
          draft={settingsDraft}
          onChange={setSettingsDraft}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          busy={busy === "update-settings"}
        />
      )}

      <DropOverlay
        active={globalDragActive}
        onDrop={handleGlobalDrop}
        onLeave={() => setGlobalDragActive(false)}
      />
    </div>
  );
}

function SettingsPanel(props: {
  draft: SettingsType;
  onChange: (draft: SettingsType) => void;
  onSave: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  function updateProvider(name: string, patch: Partial<SettingsType["providers"][string]>) {
    props.onChange({
      ...props.draft,
      providers: {
        ...props.draft.providers,
        [name]: { ...props.draft.providers[name], ...patch },
      },
    });
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <header className="settings-head">
          <strong>设置</strong>
          <button className="icon-button ghost" type="button" onClick={props.onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <div className="section-title">默认模型</div>
            <label className="field">
              <span>提供商</span>
              <select
                value={props.draft.defaultModel.provider}
                onChange={(event) =>
                  props.onChange({
                    ...props.draft,
                    defaultModel: {
                      ...props.draft.defaultModel,
                      provider: event.target.value as SettingsType["defaultModel"]["provider"],
                    },
                  })
                }
              >
                <option value="mock">mock</option>
                <option value="pi">pi</option>
                <option value="openai-compatible">openai-compatible</option>
              </select>
            </label>
            <label className="field">
              <span>模型名</span>
              <input
                value={props.draft.defaultModel.name}
                onChange={(event) =>
                  props.onChange({
                    ...props.draft,
                    defaultModel: {
                      ...props.draft.defaultModel,
                      name: event.target.value,
                    },
                  })
                }
              />
            </label>
          </section>

          <section className="settings-section">
            <div className="section-title">PI</div>
            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={props.draft.providers.pi?.apiKey ?? ""}
                onChange={(event) => updateProvider("pi", { apiKey: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input
                value={props.draft.providers.pi?.baseUrl ?? ""}
                onChange={(event) => updateProvider("pi", { baseUrl: event.target.value })}
              />
            </label>
          </section>

          <section className="settings-section">
            <div className="section-title">OpenAI Compatible</div>
            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={props.draft.providers["openai-compatible"]?.apiKey ?? ""}
                onChange={(event) =>
                  updateProvider("openai-compatible", { apiKey: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input
                value={props.draft.providers["openai-compatible"]?.baseUrl ?? ""}
                onChange={(event) =>
                  updateProvider("openai-compatible", { baseUrl: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>模型</span>
              <input
                value={props.draft.providers["openai-compatible"]?.model ?? ""}
                onChange={(event) =>
                  updateProvider("openai-compatible", { model: event.target.value })
                }
              />
            </label>
          </section>
        </div>

        <footer className="settings-foot">
          <button className="tool-button" type="button" onClick={props.onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={props.onSave}
            disabled={props.busy}
          >
            {props.busy ? <Loader2 size={13} /> : <Save size={13} />}
            保存设置
          </button>
        </footer>
      </div>
    </div>
  );
}

function RuntimeSettingsPanel(props: {
  draft: SettingsType;
  onChange: (draft: SettingsType) => void;
  onSave: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const activeProvider = props.draft.defaultModel.provider;
  const activePreset = getProviderPreset(activeProvider);
  const activeConfig = props.draft.providers[activeProvider] ?? {};

  function updateDefaultModel(patch: Partial<SettingsType["defaultModel"]>) {
    props.onChange({
      ...props.draft,
      defaultModel: {
        ...props.draft.defaultModel,
        ...patch,
      },
    });
  }

  function updateProvider(name: string, patch: Partial<ProviderConfig>) {
    props.onChange({
      ...props.draft,
      providers: {
        ...props.draft.providers,
        [name]: { ...props.draft.providers[name], ...patch },
      },
    });
  }

  function switchProvider(provider: ModelProvider) {
    const preset = getProviderPreset(provider);
    const providerConfig = props.draft.providers[provider] ?? {};
    const model = providerConfig.model || preset?.defaultModel || "";

    props.onChange({
      ...props.draft,
      defaultModel: { provider, name: model },
      providers: {
        ...props.draft.providers,
        [provider]: {
          ...providerConfig,
          model,
          baseUrl: providerConfig.baseUrl || preset?.baseUrl,
        },
      },
    });
  }

  function updateGeneration(patch: Partial<SettingsType["generation"]>) {
    props.onChange({
      ...props.draft,
      generation: { ...props.draft.generation, ...patch },
    });
  }

  function updateAgent(patch: Partial<SettingsType["agent"]>) {
    props.onChange({
      ...props.draft,
      agent: { ...props.draft.agent, ...patch },
    });
  }

  function updateWorkspace(patch: Partial<SettingsType["workspace"]>) {
    props.onChange({
      ...props.draft,
      workspace: { ...props.draft.workspace, ...patch },
    });
  }

  function syncActiveModel(model: string) {
    updateDefaultModel({ name: model });
    updateProvider(activeProvider, { model });
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel settings-panel-wide">
        <header className="settings-head">
          <div>
            <strong>设置</strong>
            <span>API / Agent / Workspace</span>
          </div>
          <button className="icon-button ghost" type="button" onClick={props.onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="settings-body settings-body-grid">
          <section className="settings-section settings-section-full">
            <div className="section-title">默认模型</div>
            <div className="provider-tabs">
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={
                    activeProvider === preset.id
                      ? "provider-tab active"
                      : "provider-tab"
                  }
                  type="button"
                  onClick={() => switchProvider(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="settings-grid two default-model-grid">
              <label className="field wide">
                <span>模型</span>
                {activePreset && activePreset.models.length > 0 ? (
                  <select
                    value={props.draft.defaultModel.name}
                    onChange={(event) => syncActiveModel(event.target.value)}
                  >
                    {activePreset.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={props.draft.defaultModel.name}
                    placeholder="model name"
                    onChange={(event) => syncActiveModel(event.target.value)}
                  />
                )}
              </label>
              <label className="field wide settings-grid-span">
                <span>Base</span>
                <input
                  value={activeConfig.baseUrl ?? ""}
                  placeholder={activePreset?.baseUrl || "https://..."}
                  onChange={(event) =>
                    updateProvider(activeProvider, { baseUrl: event.target.value })
                  }
                />
              </label>
            </div>
          </section>

          <ProviderBasics
            title="DeepSeek 接入"
            provider="deepseek"
            config={props.draft.providers.deepseek ?? {}}
            onChange={updateProvider}
          />
          <section className="settings-section dense">
            <div className="section-title">DeepSeek 特化</div>
            <div className="settings-grid three">
              <label className="field wide settings-grid-span">
                <span>模型</span>
                <select
                  value={props.draft.providers.deepseek?.model ?? "deepseek-v4-flash"}
                  onChange={(event) =>
                    updateProvider("deepseek", { model: event.target.value })
                  }
                >
                  <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                  <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                </select>
              </label>
              <label className="field wide settings-grid-span">
                <span>思考</span>
                <select
                  value={props.draft.providers.deepseek?.thinking ?? "enabled"}
                  onChange={(event) =>
                    updateProvider("deepseek", {
                      thinking: event.target.value as ProviderConfig["thinking"],
                    })
                  }
                >
                  <option value="enabled">enabled</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <label className="field wide settings-grid-span">
                <span>推理</span>
                <select
                  value={props.draft.providers.deepseek?.reasoningEffort ?? "high"}
                  onChange={(event) =>
                    updateProvider("deepseek", {
                      reasoningEffort: event.target
                        .value as ProviderConfig["reasoningEffort"],
                    })
                  }
                >
                  <option value="high">high</option>
                  <option value="max">max</option>
                </select>
              </label>
              <NumberField
                label="Max"
                value={props.draft.providers.deepseek?.maxTokens}
                onChange={(value) => updateProvider("deepseek", { maxTokens: value })}
              />
              <NumberField
                label="温度"
                value={props.draft.providers.deepseek?.temperature}
                step="0.1"
                onChange={(value) => updateProvider("deepseek", { temperature: value })}
              />
              <NumberField
                label="Top P"
                value={props.draft.providers.deepseek?.topP}
                step="0.05"
                onChange={(value) => updateProvider("deepseek", { topP: value })}
              />
            </div>
            <div className="settings-note">
              deepseek-chat / deepseek-reasoner 将于 2026-07-24 15:59 UTC 废弃。
            </div>
          </section>

          <ProviderBasics
            title="Kimi 接入"
            provider="kimi"
            config={props.draft.providers.kimi ?? {}}
            onChange={updateProvider}
          />
          <section className="settings-section dense">
            <div className="section-title">Kimi 特化</div>
            <div className="settings-grid three">
              <label className="field wide">
                <span>模型</span>
                <select
                  value={props.draft.providers.kimi?.model ?? "kimi-k2.6"}
                  onChange={(event) => {
                    const model = event.target.value;
                    updateProvider("kimi", {
                      model,
                      thinking: model.startsWith("kimi-k2.7-code")
                        ? "enabled"
                        : props.draft.providers.kimi?.thinking,
                    });
                  }}
                >
                  {getProviderPreset("kimi")?.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
              <NumberField
                label="Max"
                value={props.draft.providers.kimi?.maxCompletionTokens}
                onChange={(value) =>
                  updateProvider("kimi", { maxCompletionTokens: value })
                }
              />
              <label className="field wide">
                <span>思考</span>
                <select
                  value={props.draft.providers.kimi?.thinking ?? "disabled"}
                  disabled={(props.draft.providers.kimi?.model ?? "").startsWith(
                    "kimi-k2.7-code",
                  )}
                  onChange={(event) =>
                    updateProvider("kimi", {
                      thinking: event.target.value as ProviderConfig["thinking"],
                    })
                  }
                >
                  <option value="enabled">enabled</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <NumberField
                label="温度"
                value={props.draft.providers.kimi?.temperature}
                step="0.1"
                onChange={(value) => updateProvider("kimi", { temperature: value })}
              />
              <NumberField
                label="Top P"
                value={props.draft.providers.kimi?.topP}
                step="0.05"
                onChange={(value) => updateProvider("kimi", { topP: value })}
              />
              <label className="field wide">
                <span>缓存</span>
                <input
                  value={props.draft.providers.kimi?.promptCacheKey ?? ""}
                  placeholder="prompt_cache_key"
                  onChange={(event) =>
                    updateProvider("kimi", { promptCacheKey: event.target.value })
                  }
                />
              </label>
              <label className="field wide settings-grid-full">
                <span>安全 ID</span>
                <input
                  value={props.draft.providers.kimi?.safetyIdentifier ?? ""}
                  placeholder="hashed user/session id"
                  onChange={(event) =>
                    updateProvider("kimi", { safetyIdentifier: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="settings-note">
              K2.7 Code 系列 thinking 固定 enabled；K2.6 可开关 thinking。
            </div>
          </section>

          <section className="settings-section dense">
            <div className="section-title">OpenAI Compatible / Pi</div>
            <div className="settings-grid two">
              <label className="field wide settings-grid-span">
                <span>Pi Key</span>
                <input
                  type="password"
                  value={props.draft.providers.pi?.apiKey ?? ""}
                  onChange={(event) => updateProvider("pi", { apiKey: event.target.value })}
                />
              </label>
              <label className="field wide settings-grid-span">
                <span>Pi Base</span>
                <input
                  value={props.draft.providers.pi?.baseUrl ?? ""}
                  onChange={(event) => updateProvider("pi", { baseUrl: event.target.value })}
                />
              </label>
              <label className="field wide">
                <span>API Key</span>
                <input
                  type="password"
                  value={props.draft.providers["openai-compatible"]?.apiKey ?? ""}
                  onChange={(event) =>
                    updateProvider("openai-compatible", { apiKey: event.target.value })
                  }
                />
              </label>
              <label className="field wide">
                <span>Base</span>
                <input
                  value={props.draft.providers["openai-compatible"]?.baseUrl ?? ""}
                  onChange={(event) =>
                    updateProvider("openai-compatible", { baseUrl: event.target.value })
                  }
                />
              </label>
              <label className="field wide">
                <span>模型</span>
                <input
                  value={props.draft.providers["openai-compatible"]?.model ?? ""}
                  onChange={(event) =>
                    updateProvider("openai-compatible", { model: event.target.value })
                  }
                />
              </label>
              <label className="field wide">
                <span>工具</span>
                <select
                  value={props.draft.providers["openai-compatible"]?.toolChoice ?? "auto"}
                  onChange={(event) =>
                    updateProvider("openai-compatible", {
                      toolChoice: event.target.value as ProviderConfig["toolChoice"],
                    })
                  }
                >
                  <option value="none">none</option>
                  <option value="auto">auto</option>
                  <option value="required">required</option>
                </select>
              </label>
            </div>
          </section>

          <section className="settings-section dense">
            <div className="section-title">生成默认值</div>
            <div className="settings-grid three">
              <NumberField
                label="温度"
                value={props.draft.generation.temperature}
                step="0.1"
                onChange={(value) =>
                  updateGeneration({ temperature: value ?? DEFAULT_SETTINGS.generation.temperature })
                }
              />
              <NumberField
                label="Top P"
                value={props.draft.generation.topP}
                step="0.05"
                onChange={(value) =>
                  updateGeneration({ topP: value ?? DEFAULT_SETTINGS.generation.topP })
                }
              />
              <NumberField
                label="输出"
                value={props.draft.generation.maxOutputTokens}
                onChange={(value) =>
                  updateGeneration({
                    maxOutputTokens:
                      value ?? DEFAULT_SETTINGS.generation.maxOutputTokens,
                  })
                }
              />
              <label className="field wide">
                <span>格式</span>
                <select
                  value={props.draft.generation.responseFormat}
                  onChange={(event) =>
                    updateGeneration({
                      responseFormat: event.target.value as SettingsType["generation"]["responseFormat"],
                    })
                  }
                >
                  <option value="text">text</option>
                  <option value="json_object">json_object</option>
                </select>
              </label>
              <ToggleField
                label="流式"
                checked={props.draft.generation.stream}
                onChange={(stream) => updateGeneration({ stream })}
              />
              <label className="field wide">
                <span>Stop</span>
                <input
                  value={props.draft.generation.stopSequences.join("\\n")}
                  placeholder="one per line"
                  onChange={(event) =>
                    updateGeneration({
                      stopSequences: splitLines(event.target.value),
                    })
                  }
                />
              </label>
            </div>
          </section>

          <section className="settings-section dense">
            <div className="section-title">Agent 运行</div>
            <div className="settings-grid three">
              <label className="field wide">
                <span>用户</span>
                <input
                  value={props.draft.agent.userName}
                  onChange={(event) =>
                    updateAgent({ userName: event.target.value || DEFAULT_SETTINGS.agent.userName })
                  }
                />
              </label>
              <NumberField
                label="近文"
                value={props.draft.agent.recentMessageLimit}
                onChange={(value) =>
                  updateAgent({
                    recentMessageLimit:
                      value ?? DEFAULT_SETTINGS.agent.recentMessageLimit,
                  })
                }
              />
              <NumberField
                label="扫描"
                value={props.draft.agent.loreScanDepth}
                onChange={(value) =>
                  updateAgent({
                    loreScanDepth: value ?? DEFAULT_SETTINGS.agent.loreScanDepth,
                  })
                }
              />
              <NumberField
                label="世界书"
                value={props.draft.agent.maxLoreEntries}
                onChange={(value) =>
                  updateAgent({
                    maxLoreEntries: value ?? DEFAULT_SETTINGS.agent.maxLoreEntries,
                  })
                }
              />
              <NumberField
                label="递归"
                value={props.draft.agent.loreMaxRecursionSteps}
                onChange={(value) =>
                  updateAgent({
                    loreMaxRecursionSteps:
                      value ?? DEFAULT_SETTINGS.agent.loreMaxRecursionSteps,
                  })
                }
              />
              <NumberField
                label="字数"
                value={props.draft.agent.maxOutputChars}
                onChange={(value) =>
                  updateAgent({
                    maxOutputChars: value ?? DEFAULT_SETTINGS.agent.maxOutputChars,
                  })
                }
              />
              <NumberField
                label="摘要"
                value={props.draft.agent.summaryMaxChars}
                onChange={(value) =>
                  updateAgent({
                    summaryMaxChars: value ?? DEFAULT_SETTINGS.agent.summaryMaxChars,
                  })
                }
              />
              <ToggleField
                label="验证"
                checked={props.draft.agent.validationEnabled}
                onChange={(validationEnabled) => updateAgent({ validationEnabled })}
              />
              <ToggleField
                label="Trace"
                checked={props.draft.agent.storePromptTrace}
                onChange={(storePromptTrace) => updateAgent({ storePromptTrace })}
              />
              <ToggleField
                label="递归"
                checked={props.draft.agent.loreRecursiveScanning}
                onChange={(loreRecursiveScanning) => updateAgent({ loreRecursiveScanning })}
              />
              <ToggleField
                label="大小写"
                checked={props.draft.agent.loreCaseSensitive}
                onChange={(loreCaseSensitive) => updateAgent({ loreCaseSensitive })}
              />
              <ToggleField
                label="整词"
                checked={props.draft.agent.loreMatchWholeWords}
                onChange={(loreMatchWholeWords) => updateAgent({ loreMatchWholeWords })}
              />
              <ToggleField
                label="状态"
                checked={props.draft.agent.autoUpdateState}
                onChange={(autoUpdateState) => updateAgent({ autoUpdateState })}
              />
            </div>
          </section>

          <section className="settings-section dense">
            <div className="section-title">Workspace</div>
            <div className="settings-grid three">
              <NumberField
                label="事件"
                value={props.draft.workspace.eventPreviewLimit}
                onChange={(value) =>
                  updateWorkspace({
                    eventPreviewLimit:
                      value ?? DEFAULT_SETTINGS.workspace.eventPreviewLimit,
                  })
                }
              />
              <ToggleField
                label="脱敏"
                checked={props.draft.workspace.redactApiKeys}
                onChange={(redactApiKeys) => updateWorkspace({ redactApiKeys })}
              />
              <label className="field wide">
                <span>标题</span>
                <input
                  value={props.draft.workspace.defaultConversationTitle}
                  onChange={(event) =>
                    updateWorkspace({
                      defaultConversationTitle: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          </section>
        </div>

        <footer className="settings-foot">
          <button className="tool-button" type="button" onClick={props.onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={props.onSave}
            disabled={props.busy}
          >
            {props.busy ? <Loader2 size={13} /> : <Save size={13} />}
            保存设置
          </button>
        </footer>
      </div>
    </div>
  );
}

function ProviderBasics(props: {
  title: string;
  provider: string;
  config: ProviderConfig;
  onChange: (provider: string, patch: Partial<ProviderConfig>) => void;
}) {
  return (
    <section className="settings-section dense">
      <div className="section-title">{props.title}</div>
      <div className="settings-grid provider-basics-grid">
        <label className="field wide">
          <span>API Key</span>
          <input
            type="password"
            value={props.config.apiKey ?? ""}
            onChange={(event) =>
              props.onChange(props.provider, { apiKey: event.target.value })
            }
          />
        </label>
        <label className="field wide">
          <span>Base</span>
          <input
            value={props.config.baseUrl ?? ""}
            onChange={(event) =>
              props.onChange(props.provider, { baseUrl: event.target.value })
            }
          />
        </label>
      </div>
    </section>
  );
}

function NumberField(props: {
  label: string;
  value: number | undefined;
  step?: string;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <label className="field wide">
      <span>{props.label}</span>
      <input
        type="number"
        step={props.step ?? "1"}
        value={formatOptionalNumber(props.value)}
        onChange={(event) => props.onChange(parseOptionalNumber(event.target.value))}
      />
    </label>
  );
}

function ToggleField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
    </label>
  );
}

function formatOptionalNumber(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatKeyList(keys: string[]): string {
  return keys.join("\n");
}

function parseKeyList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];

  const parts = trimmed.includes("\n")
    ? trimmed.split(/\r?\n/)
    : splitCommaSeparatedKeys(trimmed);

  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))];
}

function splitCommaSeparatedKeys(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let regexOpen = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const atTokenStart = current.trim().length === 0;

    if (char === "\\" && regexOpen) {
      current += char;
      escaped = !escaped;
      continue;
    }

    if (char === "/" && !escaped) {
      if (atTokenStart && !regexOpen) {
        regexOpen = true;
      } else if (regexOpen) {
        regexOpen = false;
      }
      current += char;
      continue;
    }

    if (char === "," && !regexOpen) {
      parts.push(current);
      current = "";
      escaped = false;
      continue;
    }

    if (regexOpen && char === "," && !escaped) {
      current += char;
      continue;
    }

    current += char;
    escaped = false;
  }

  parts.push(current);
  return parts;
}

function FileImporter(props: {
  label: string;
  icon: ReactNode;
  accept: string;
  busy: boolean;
  onFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  return (
    <button
      className={dragActive ? "tool-button drop-active" : "tool-button"}
      type="button"
      disabled={props.busy}
      onClick={() => inputRef.current?.click()}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        props.onFile(event.dataTransfer.files[0] ?? null);
      }}
    >
      {props.busy ? <Loader2 size={13} /> : props.icon}
      {props.label}
      <Upload size={11} />
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

function DropOverlay(props: {
  active: boolean;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onLeave: () => void;
}) {
  if (!props.active) return null;

  return (
    <div
      className="drop-overlay"
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={props.onLeave}
      onDrop={props.onDrop}
    >
      <div className="drop-overlay-content">
        <Upload size={48} strokeWidth={1.5} />
        <p>拖入文件导入</p>
        <div className="drop-zones">
          <div className="drop-zone">
            <UserRound size={28} />
            <span>角色卡</span>
            <small>PNG</small>
          </div>
          <div className="drop-zone">
            <BookOpen size={28} />
            <span>世界书</span>
            <small>JSON</small>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageContent(props: { text: string }) {
  return <div className="message-content">{renderMessageBlocks(props.text)}</div>;
}

function renderMessageBlocks(text: string): ReactNode[] {
  if (text.length === 0) {
    return [<p key="empty" className="message-paragraph muted">...</p>];
  }

  const blocks: ReactNode[] = [];
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push(...renderTextBlocks(text.slice(lastIndex, match.index), `t${blocks.length}`));
    }

    blocks.push(
      <pre key={`code-${blocks.length}`} className="message-code-block">
        <code>{match[2]}</code>
      </pre>,
    );
    lastIndex = fencePattern.lastIndex;
  }

  if (lastIndex < text.length) {
    blocks.push(...renderTextBlocks(text.slice(lastIndex), `t${blocks.length}`));
  }

  return blocks.length > 0 ? blocks : [<p key="empty" className="message-paragraph muted">...</p>];
}

function renderTextBlocks(text: string, keyPrefix: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <div key={`${keyPrefix}-h-${index}`} className={`message-heading h${level}`}>
          {renderInline(heading[2], `${keyPrefix}-h-${index}`)}
        </div>,
      );
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`${keyPrefix}-q-${index}`}>
          {renderInline(quoteLines.join("\n"), `${keyPrefix}-q-${index}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`${keyPrefix}-ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `${keyPrefix}-ul-${index}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`${keyPrefix}-ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `${keyPrefix}-ol-${index}-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(
      <p key={`${keyPrefix}-p-${index}`} className="message-paragraph">
        {renderInline(paragraphLines.join("\n"), `${keyPrefix}-p-${index}`)}
      </p>,
    );
  }

  return blocks;
}

function renderInline(text: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (text.length === 0) return [];
  if (depth > 6) return [text];

  const specs: Array<{
    pattern: RegExp;
    render: (match: RegExpExecArray, key: string) => ReactNode;
  }> = [
    {
      pattern: /<br\s*\/?>/i,
      render: (_match, key) => <br key={key} />,
    },
    {
      pattern: /!\[([^\]]*)\]\((https?:\/\/[^)\s]+|data:image\/[^)\s]+)\)/i,
      render: (match, key) => (
        <img key={key} className="message-image" src={match[2]} alt={match[1]} />
      ),
    },
    {
      pattern: /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i,
      render: (match, key) => (
        <a key={key} href={match[2]} target="_blank" rel="noreferrer">
          {renderInline(match[1], `${key}-label`, depth + 1)}
        </a>
      ),
    },
    inlinePair(/<strong>([\s\S]+?)<\/strong>/i, "strong"),
    inlinePair(/<b>([\s\S]+?)<\/b>/i, "strong"),
    inlinePair(/<em>([\s\S]+?)<\/em>/i, "em"),
    inlinePair(/<i>([\s\S]+?)<\/i>/i, "em"),
    inlinePair(/<u>([\s\S]+?)<\/u>/i, "u"),
    inlinePair(/<s>([\s\S]+?)<\/s>/i, "s"),
    inlinePair(/<del>([\s\S]+?)<\/del>/i, "s"),
    inlinePair(/\*\*([\s\S]+?)\*\*/, "strong"),
    inlinePair(/__([\s\S]+?)__/, "strong"),
    inlinePair(/~~([\s\S]+?)~~/, "s"),
    inlinePair(/\|\|([\s\S]+?)\|\|/, "spoiler"),
    {
      pattern: /`([^`\n]+?)`/,
      render: (match, key) => <code key={key}>{match[1]}</code>,
    },
    inlinePair(/\*([^*\n]+?)\*/, "em"),
    inlinePair(/_([^_\n]+?)_/, "em"),
  ];

  let selected:
    | {
        match: RegExpExecArray;
        spec: (typeof specs)[number];
      }
    | null = null;

  for (const spec of specs) {
    const match = spec.pattern.exec(text);
    if (!match) continue;
    if (!selected || match.index < selected.match.index) {
      selected = { match, spec };
    }
  }

  if (!selected) {
    return splitLineBreaks(text, keyPrefix);
  }

  const nodes: ReactNode[] = [];
  if (selected.match.index > 0) {
    nodes.push(...splitLineBreaks(text.slice(0, selected.match.index), `${keyPrefix}-pre`));
  }
  nodes.push(selected.spec.render(selected.match, `${keyPrefix}-hit`));

  const nextStart = selected.match.index + selected.match[0].length;
  if (nextStart < text.length) {
    nodes.push(...renderInline(text.slice(nextStart), `${keyPrefix}-post`, depth));
  }

  return nodes;
}

function inlinePair(
  pattern: RegExp,
  tag: "strong" | "em" | "u" | "s" | "spoiler",
): {
  pattern: RegExp;
  render: (match: RegExpExecArray, key: string) => ReactNode;
} {
  return {
    pattern,
    render(match, key) {
      const children = renderInline(match[1], `${key}-inner`);
      if (tag === "strong") return <strong key={key}>{children}</strong>;
      if (tag === "em") return <em key={key}>{children}</em>;
      if (tag === "u") return <u key={key}>{children}</u>;
      if (tag === "s") return <s key={key}>{children}</s>;
      return (
        <span key={key} className="spoiler" tabIndex={0}>
          {children}
        </span>
      );
    },
  };
}

function splitLineBreaks(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split("\n");
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [<br key={`${keyPrefix}-br-${index}`} />, part],
  );
}

function StateField(props: { label: string; value: string; readOnly?: boolean }) {
  return (
    <div className="state-field">
      <span>{props.label}</span>
      <input value={props.value} readOnly={props.readOnly} />
    </div>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "user":
      return "你";
    case "assistant":
      return "角色";
    case "system":
      return "系统";
    case "tool":
      return "工具";
    default:
      return role;
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatTokens(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return String(value);
}

function extractTextFromPiMessage(message: unknown): string {
  return extractPiContent(message, "text");
}

function extractThinkingFromPiMessage(message: unknown): string {
  return extractPiContent(message, "thinking");
}

function extractPiContent(message: unknown, field: "text" | "thinking"): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") return "";
      if (part && typeof part === "object" && field in part) {
        return String((part as Record<string, unknown>)[field] ?? "");
      }
      return "";
    })
    .join("");
}
