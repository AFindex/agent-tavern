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
import type { ChangeEvent, FormEvent, KeyboardEvent, ReactNode } from "react";

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
  updateConversationConfig,
  updateConversationState,
  updateLorebook,
  updateSettings,
  type ConversationSnapshot,
  type Overview,
} from "./api";
import { readImportFile } from "./card-file";

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
  const [lorebookDrafts, setLorebookDrafts] = useState<Record<string, Lorebook>>({});
  const [expandedLorebooks, setExpandedLorebooks] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConversationId = snapshot?.config.id ?? "";
  const activeCharacterId = snapshot?.config.characterId ?? "";
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

    await runTask("send", async () => {
      const response = await sendMessage(activeConversationId, trimmed);
      setOverview(response.overview);
      setSnapshot(response.snapshot);
      setLastMatchedLore(response.result.matchedLoreEntries);
      setMessage("");
    });
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

  async function openConversation(id: string) {
    await runTask("refresh", async () => {
      const nextSnapshot = await fetchConversation(id);
      setSnapshot(nextSnapshot);
      setLastMatchedLore(nextSnapshot.matchedLoreEntries);
    });
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
            <span>{snapshot?.config.title ?? "未选择会话"}</span>
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
                <p>{messageItem.content}</p>
                <small className="time">{formatTime(messageItem.timestamp)}</small>
              </div>
            </div>
          ))}
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
                label="世界书"
                value={props.draft.agent.maxLoreEntries}
                onChange={(value) =>
                  updateAgent({
                    maxLoreEntries: value ?? DEFAULT_SETTINGS.agent.maxLoreEntries,
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
