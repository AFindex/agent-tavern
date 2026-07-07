const MODULES: Record<string, string> = {
  "lib.js": `
const fallbackLodash = {
  castArray(value){ return Array.isArray(value) ? value : [value]; },
  clamp(value, min, max){ return Math.min(max, Math.max(min, Number(value))); },
  cloneDeep(value){ return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); },
  concat(...items){ return items.flat(); },
  debounce(fn, wait = 0){ let timer; return function(...args){ clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), wait); }; },
  get(object, path, fallback){ const parts = Array.isArray(path) ? path : String(path).replace(/\\[(\\w+)\\]/g, '.$1').split('.').filter(Boolean); let cur = object; for (const part of parts){ if (cur == null || !(part in Object(cur))) return fallback; cur = cur[part]; } return cur === undefined ? fallback : cur; },
  has(object, path){ return this.get(object, path, undefined) !== undefined; },
  includes(collection, value){ return Array.isArray(collection) || typeof collection === 'string' ? collection.includes(value) : Object.values(collection ?? {}).includes(value); },
  isArray: Array.isArray,
  isBlob(value){ return value instanceof Blob; },
  isFunction(value){ return typeof value === 'function'; },
  isNil(value){ return value == null; },
  isNumber(value){ return typeof value === 'number' && Number.isFinite(value); },
  isObject(value){ return value !== null && typeof value === 'object'; },
  isPlainObject(value){ return Object.prototype.toString.call(value) === '[object Object]'; },
  isString(value){ return typeof value === 'string'; },
  map(collection, iteratee){ return Array.isArray(collection) ? collection.map(iteratee) : Object.entries(collection ?? {}).map(([key, value]) => iteratee(value, key)); },
  merge(target, ...sources){ for (const source of sources){ for (const [key, value] of Object.entries(source ?? {})){ if (this.isPlainObject(value) && this.isPlainObject(target[key])) this.merge(target[key], value); else target[key] = value; } } return target; },
  mergeWith(target, source, customizer){ for (const [key, value] of Object.entries(source ?? {})){ const next = customizer?.(target[key], value); target[key] = next === undefined && this.isPlainObject(value) && this.isPlainObject(target[key]) ? this.mergeWith(target[key], value, customizer) : next === undefined ? value : next; } return target; },
  noop(){},
  omit(object, keys){ const set = new Set(keys); return Object.fromEntries(Object.entries(object ?? {}).filter(([key]) => !set.has(key))); },
  omitBy(object, predicate){ return Object.fromEntries(Object.entries(object ?? {}).filter(([key, value]) => !predicate(value, key))); },
  partition(array, predicate){ const a = [], b = []; for (const item of array ?? []) (predicate(item) ? a : b).push(item); return [a, b]; },
  random(min = 0, max = 1){ return Math.floor(Math.random() * (max - min + 1)) + min; },
  range(start, end, step = 1){ if (end === undefined){ end = start; start = 0; } const out = []; for (let i = start; step > 0 ? i < end : i > end; i += step) out.push(i); return out; },
  reject(array, predicate){ return (array ?? []).filter((item) => !predicate(item)); },
  set(object, path, value){ const parts = Array.isArray(path) ? path : String(path).replace(/\\[(\\w+)\\]/g, '.$1').split('.').filter(Boolean); let cur = object; parts.slice(0, -1).forEach((part) => { cur[part] ??= {}; cur = cur[part]; }); cur[parts.at(-1)] = value; return object; },
  sortBy(array, iteratee){ const fn = typeof iteratee === 'function' ? iteratee : (item) => item?.[iteratee]; return [...(array ?? [])].sort((a, b) => String(fn(a)).localeCompare(String(fn(b)))); },
  times(count, iteratee){ return Array.from({ length: count }, (_, index) => iteratee(index)); },
  unset(object, path){ const parts = Array.isArray(path) ? path : String(path).replace(/\\[(\\w+)\\]/g, '.$1').split('.').filter(Boolean); const key = parts.pop(); const parent = parts.reduce((cur, part) => cur?.[part], object); if (parent && key !== undefined) delete parent[key]; return true; },
  values(object){ return Object.values(object ?? {}); },
};
export const lodash = globalThis._ ?? fallbackLodash;
export const _ = lodash;
export const DOMPurify = globalThis.DOMPurify ?? { sanitize: (value) => String(value ?? '') };
export const hljs = globalThis.hljs ?? { highlightElement(){}, highlightAuto(value){ return { value: String(value ?? '') }; } };
export const yaml = globalThis.YAML ?? { parse(value){ try { return JSON.parse(String(value)); } catch { return {}; } }, stringify(value){ return JSON.stringify(value, null, 2); } };
export const moment = globalThis.moment ?? ((value) => ({ format: () => String(value ?? '') }));
export function initLibraryShims(){ globalThis._ ??= lodash; globalThis.hljs ??= hljs; globalThis.DOMPurify ??= DOMPurify; globalThis.YAML ??= yaml; }
initLibraryShims();
`,
  "scripts/utils.js": `
export class Stopwatch { constructor(){ this.started = Date.now(); } get elapsed(){ return Date.now() - this.started; } restart(){ this.started = Date.now(); } }
export const PAGINATION_TEMPLATE = '';
export const onlyUnique = (value, index, array) => array.indexOf(value) === index;
export const debounce = (fn, wait = 0) => { let timer; return function(...args){ clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), wait); }; };
export const waitUntilCondition = async (condition, timeout = 1000, interval = 50) => { const start = Date.now(); while (Date.now() - start < timeout){ if (await condition()) return true; await delay(interval); } return false; };
export const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
export function copyText(value = ''){ navigator.clipboard?.writeText?.(String(value)); return String(value); }
export function createThumbnail(value){ return value; }
export function download(data, filename = 'download.txt', mime = 'text/plain'){ const blob = new Blob([data], { type: mime }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
export async function ensureImageFormatSupported(value){ return value; }
export function escapeRegex(value = ''){ return String(value).replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&'); }
export function extractAllWords(value = ''){ return String(value).match(/[\\p{L}\\p{N}_]+/gu) ?? []; }
export async function getBase64Async(file){ return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }
export function getCharaFilename(name = 'character'){ return getSanitizedFilename(name); }
export async function getImageSizeFromDataURL(){ return { width: 0, height: 0 }; }
export function getSanitizedFilename(value = 'file'){ return String(value).replace(/[^a-z0-9._-]+/gi, '_'); }
export function getStringHash(value = ''){ let hash = 0; for (const ch of String(value)) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0; return String(hash >>> 0); }
export function isDataURL(value){ return /^data:/i.test(String(value)); }
export function isFalseBoolean(value){ return value === false || value === 'false'; }
export function isTrueBoolean(value){ return value === true || value === 'true'; }
export function localizePagination(value){ return value; }
export function renderPaginationDropdown(){ return ''; }
export function paginationDropdownChangeHandler(){}
export function resetScrollHeight(){}
export function initScrollHeight(){}
export async function saveBase64AsFile(){ return ''; }
export function setDatasetProperty(element, key, value){ if (element?.dataset) element.dataset[key] = value; }
export async function showFontAwesomePicker(){ return null; }
export function stringToRange(value, max = 0){ return String(value ?? '').split(',').map(item => Number(item.trim())).filter(Number.isFinite).map(item => item < 0 ? max + item + 1 : item); }
export function trimSpaces(value = ''){ return String(value).trim(); }
export function uuidv4(){ return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8); return v.toString(16); }); }
`,
  "scripts/i18n.js": `
export function getCurrentLocale(){ return navigator.language || 'en-US'; }
export function t(strings, ...values){ return Array.isArray(strings) && 'raw' in strings ? strings.reduce((out, part, i) => out + part + (values[i] ?? ''), '') : String(strings ?? ''); }
`,
  "scripts/events.js": `
export { eventSource, event_types } from '../script.js';
`,
  "script.js": `
class EventBus {
  constructor(){ this.map = new Map(); }
  on(type, fn){ const list = this.map.get(type) ?? []; list.push(fn); this.map.set(type, list); return this; }
  once(type, fn){ const wrap = (...args) => { this.removeListener(type, wrap); return fn(...args); }; return this.on(type, wrap); }
  makeFirst(type, fn){ const list = this.map.get(type) ?? []; list.unshift(fn); this.map.set(type, list); return this; }
  makeLast(type, fn){ return this.on(type, fn); }
  removeListener(type, fn){ this.map.set(type, (this.map.get(type) ?? []).filter(item => item !== fn)); return this; }
  async emit(type, ...args){ for (const fn of [...(this.map.get(type) ?? [])]) await fn(...args); return true; }
}
export const eventSource = new EventBus();
export const event_types = {
  APP_INITIALIZED: 'app_initialized',
  APP_READY: 'app_ready',
  CHAT_CHANGED: 'chat_id_changed',
  CHAT_LOADED: 'chatLoaded',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
  USER_MESSAGE_RENDERED: 'user_message_rendered',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_SWIPED: 'message_swiped',
  MESSAGE_DELETED: 'message_deleted',
  MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
  MORE_MESSAGES_LOADED: 'more_messages_loaded',
  GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  GENERATE_AFTER_DATA: 'GENERATION_AFTER_DATA',
  CHAT_COMPLETION_SETTINGS_READY: 'CHAT_COMPLETION_SETTINGS_READY',
  GENERATION_STARTED: 'generation_started',
  GENERATION_STOPPED: 'generation_stopped',
  GENERATION_ENDED: 'generation_ended',
  SETTINGS_LOADED: 'settings_loaded',
  SETTINGS_UPDATED: 'settings_updated',
  EXTENSION_SETTINGS_LOADED: 'extension_settings_loaded',
  WORLDINFO_UPDATED: 'worldinfo_updated',
  WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded',
  WORLDINFO_FORCE_ACTIVATE: 'worldinfo_force_activate',
};
export const characters = [];
export const chat = [];
export const chat_metadata = {};
export const extension_prompts = {};
export const extension_prompt_roles = { SYSTEM: 'system', USER: 'user', ASSISTANT: 'assistant' };
export const extension_prompt_types = { IN_PROMPT: 0, IN_CHAT: 1 };
export const system_message_types = {};
export const MAX_INJECTION_DEPTH = 100;
export const default_avatar = 'img/ai4.png';
export const default_user_avatar = 'img/user-default.png';
export const system_avatar = 'img/five.png';
export const user_avatar = '';
export let name1 = 'User';
export let name2 = 'Character';
export let this_chid = null;
let currentChatId = 'agent-tavern-chat';
export let is_send_press = false;
export let main_api = 'openai';
export let online_status = 'no_connection';
export function Generate(){ console.warn('[Agent Tavern ST shim] Generate is not implemented.'); }
export function GenerateOptions(){}
export function addCopyToCodeBlocks(){}
export function appendMediaToMessage(){}
export function activateSendButtons(){}
export function deactivateSendButtons(){}
export function addOneMessage(message){ chat.push(message); eventSource.emit(event_types.MESSAGE_RECEIVED, message); return message; }
export function baseChatReplace(next = []){ chat.splice(0, chat.length, ...next); }
export function cleanUpMessage(value){ return String(value ?? '').trim(); }
export function clearChat(){ chat.splice(0, chat.length); }
export function countOccurrences(value, needle){ return String(value).split(String(needle)).length - 1; }
export async function deleteCharacter(){ return false; }
export function getBiasStrings(){ return []; }
export function getCharacterCardFields(){ return {}; }
export async function getCharacters(){ return characters; }
export function getCurrentChatId(){ return currentChatId; }
export function getExtensionPromptByName(name){ return extension_prompts[name]; }
export function getExtensionPromptRoleByName(){ return 'system'; }
export function getMaxContextSize(){ return 1000000; }
export function getOneCharacter(id){ return characters.find(c => c.id === id || c.avatar === id) ?? null; }
export async function getPastCharacterChats(){ return []; }
export function getRequestHeaders(){ return { 'content-type': 'application/json' }; }
export function getThumbnailUrl(_type, value){ return value || ''; }
export function isOdd(value){ return Number(value) % 2 === 1; }
function escapeHtml(value = ''){ return String(value).replaceAll('&', '&amp;').replaceAll('<%', '&lt;%').replaceAll('%>', '%&gt;'); }
function renderInlineMarkdown(value = ''){ return escapeHtml(value).replace(/\\*\\*([\\s\\S]+?)\\*\\*/g, '<strong>$1</strong>').replace(/\\*([^*\\n]+?)\\*/g, '<em>$1</em>').replace(/~~([\\s\\S]+?)~~/g, '<s>$1</s>').replace(/\\|\\|([\\s\\S]+?)\\|\\|/g, '<span class="spoiler">$1</span>'); }
export function messageFormatting(value){ const text = String(value ?? ''); const parts = []; let last = 0; const tick = String.fromCharCode(96); const fence = new RegExp(tick + '{3}([^\\\\n' + tick + ']*)\\\\n?([\\\\s\\\\S]*?)' + tick + '{3}', 'g'); let match; while ((match = fence.exec(text))){ if (match.index > last) parts.push(renderInlineMarkdown(text.slice(last, match.index)).replace(/\\n/g, '<br>')); parts.push('<pre><code class="language-' + String(match[1] ?? '').replace(/[^a-z0-9_-]/gi, '') + '">' + String(match[2] ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</code></pre>'); last = fence.lastIndex; } if (last < text.length) parts.push(renderInlineMarkdown(text.slice(last)).replace(/\\n/g, '<br>')); return parts.join(''); }
export function printCharacters(){}
export function printMessages(){}
export async function reloadCurrentChat(){ return true; }
export function reloadMarkdownProcessor(){}
export function saveCharacterDebounced(){}
export async function saveChatConditional(){ return true; }
export function saveMetadata(){}
export async function saveSettings(){ return true; }
export function saveSettingsDebounced(){}
export function scrollChatToBottom(){}
export async function selectCharacterById(id){ this_chid = id; return true; }
export function setExtensionPrompt(name, value, position, depth, scan, role){ extension_prompts[name] = { value, position, depth, scan, role }; }
export function setGenerationProgress(){}
export function setUserName(value){ name1 = String(value || 'User'); }
export function showSwipeButtons(){}
export function stopGeneration(){}
export function substituteParams(value){ return String(value ?? '').replaceAll('{{user}}', name1).replaceAll('{{char}}', name2); }
export function substituteParamsExtended(value){ return substituteParams(value); }
export async function unshallowCharacter(value){ return value; }
export function updateMessageBlock(messageId, message){ const existing = chat[messageId]; if (existing && message) Object.assign(existing, message); return existing; }
globalThis.__agentTavernEventSource = eventSource;
globalThis.__agentTavernEventTypes = event_types;
function replaceObject(target, source = {}){ for (const key of Object.keys(target)) delete target[key]; Object.assign(target, source); }
function applyAgentTavernContext(context = {}) {
  globalThis.__agentTavernContext = context;
  characters.splice(0, characters.length, ...(context.characters ?? []));
  chat.splice(0, chat.length, ...(context.chat ?? []));
  replaceObject(chat_metadata, context.chat_metadata ?? {});
  currentChatId = context.currentChatId ?? currentChatId;
  name1 = context.name1 ?? name1;
  name2 = context.name2 ?? name2;
  this_chid = context.this_chid ?? this_chid;
  eventSource.emit(event_types.CHAT_CHANGED, context.currentChatId ?? getCurrentChatId());
  eventSource.emit(event_types.CHAT_LOADED, context.currentChatId ?? getCurrentChatId());
}
globalThis.addEventListener?.('message', (event) => {
  if (event.data?.type === 'agent-tavern-context') applyAgentTavernContext(event.data.context ?? {});
});
globalThis.parent?.postMessage?.({ type: 'agent-tavern-request-context' }, '*');
queueMicrotask(() => eventSource.emit(event_types.APP_READY));
`,
  "scripts/world-info.js": `
export const DEFAULT_DEPTH = 4;
export const DEFAULT_WEIGHT = 100;
export const METADATA_KEY = 'world_info';
export const selected_world_info = [];
export const world_info = {};
export const world_info_case_sensitive = false;
export const world_info_include_names = true;
export const world_info_logic = {};
export const world_info_match_whole_words = false;
export const world_info_max_recursion_steps = 2;
export const world_info_position = {};
export const world_info_use_group_scoring = false;
export const world_names = [];
export const wi_anchor_position = { before: 0, after: 1 };
export function convertCharacterBook(value){ return value; }
export async function createNewWorldInfo(name = 'World Info'){ world_names.push(name); if (!world_info[name]) world_info[name] = { entries: {} }; return name; }
export async function deleteWorldInfo(name){ delete world_info[name]; return true; }
export async function getWorldInfoPrompt(){ return { worldInfoString: '', worldInfoBefore: '', worldInfoAfter: '', worldInfoDepth: [] }; }
export function getWorldInfoSettings(){ return { world_info_depth: DEFAULT_DEPTH }; }
export async function loadWorldInfo(name){ return world_info[name] || { entries: {} }; }
export const newWorldInfoEntryTemplate = { key: [], keysecondary: [], content: '', comment: '', disable: false };
export function parseRegexFromString(value){ const match = String(value).match(new RegExp('^/(.*)/([a-z]*)$', 'i')); return match ? new RegExp(match[1], match[2]) : null; }
export async function saveWorldInfo(name, data){ world_info[name] = data; return true; }
export function setWorldInfoButtonClass(){}
function applyAgentTavernWorldInfo(context = {}) {
  const names = context.world_names || [];
  selected_world_info.splice(0, selected_world_info.length, ...names);
  world_names.splice(0, world_names.length, ...names);
  for (const key of Object.keys(world_info)) delete world_info[key];
  Object.assign(world_info, context.world_info || {});
}
if (globalThis.addEventListener) globalThis.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'agent-tavern-context') applyAgentTavernWorldInfo(event.data.context || {});
});
`,
  "scripts/extensions/regex/engine.js": `
export const regex_placement = { USER_INPUT: 1, AI_OUTPUT: 2, SLASH_COMMAND: 3, WORLD_INFO: 4, REASONING: 5 };
export function getRegexedString(value){ return String(value ?? ''); }
`,
  "scripts/preset-manager.js": `
export function getPresetManager(){ return { getPreset: () => null, getSelectedPreset: () => null, selectPreset: () => false, savePreset: async () => false }; }
`,
  "scripts/extensions.js": `
export const extensionTypes = { LOCAL: 'local', GLOBAL: 'global', SYSTEM: 'system', JS_SLASH_RUNNER: 'local/JS-Slash-Runner', ST_PROMPT_TEMPLATE: 'local/ST-Prompt-Template' };
export const extension_settings = { variables: { global: {} } };
export function getContext(){ const context = globalThis.__agentTavernContext ?? {}; return { characters: context.characters ?? [], chat: context.chat ?? [], extensionSettings: extension_settings, extensionPrompts: globalThis.__agentTavernExtensionPrompts ?? {}, onlineStatus: 'connected', name1: context.name1 ?? 'User', name2: context.name2 ?? 'Character', characterId: context.this_chid ?? null, chatId: context.currentChatId ?? 'agent-tavern-chat', writeExtensionField: async () => true }; }
export async function renderExtensionTemplateAsync(extensionName, templateName){ const response = await fetch('/st-public/scripts/extensions/' + extensionName + '/' + templateName + '.html'); return response.ok ? await response.text() : '<div></div>'; }
export function saveMetadataDebounced(){}
`,
  "scripts/openai.js": `
export class Message { constructor(role = 'system', content = ''){ this.role = role; this.content = content; } }
export class MessageCollection extends Array {}
export class ChatCompletion {}
export const chat_completion_sources = {};
export const oai_settings = {};
export const proxies = [];
export const promptManager = {};
export function getChatCompletionModel(){ return ''; }
export async function getStreamingReply(){ return ''; }
export function isImageInliningSupported(){ return false; }
export async function prepareOpenAIMessages(){ return []; }
export async function sendOpenAIRequest(){ throw new Error('sendOpenAIRequest is not implemented in Agent Tavern shim.'); }
export function setOpenAIMessageExamples(){}
export function setOpenAIMessages(){}
export function setupChatCompletionPromptManager(){}
export function tryParseStreamingError(error){ return error; }
`,
  "scripts/macros.js": `
export class MacrosParser { parse(value){ return String(value ?? ''); } }
export function getLastMessageId(options = {}){ const chat = globalThis.__agentTavernContext?.chat ?? []; for (let index = chat.length - 1; index >= 0; index -= 1){ const item = chat[index]; if (!options.filter || options.filter(item)) return index; } return chat.length > 0 ? chat.length - 1 : null; }
`,
  "scripts/group-chats.js": `
export const groups = [];
export let selected_group = null;
export function getGroupMembers(){ return []; }
`,
  "scripts/reasoning.js": `
export function updateReasoningUI(){}
`,
  "scripts/RossAscends-mods.js": `
export const favsToHotswap = [];
export function isMobile(){ return matchMedia('(max-width: 640px)').matches; }
`,
  "scripts/power-user.js": `
export const persona_description_positions = {};
export const power_user = {};
export function flushEphemeralStoppingStrings(){}
`,
  "scripts/user.js": `
export const isAdmin = true;
`,
  "scripts/authors-note.js": `
export const NOTE_MODULE_NAME = 'authors_note';
export const metadata_keys = { prompt: 'authors_note' };
export function shouldWIAddPrompt(){ return false; }
`,
  "scripts/PromptManager.js": `
export class Prompt { constructor(data = {}){ Object.assign(this, data); } }
export class PromptCollection extends Array { collection = this; add(prompt){ this.push(prompt); return prompt; } get(identifier){ return this.find(prompt => prompt.identifier === identifier || prompt.name === identifier); } }
`,
  "scripts/sse-stream.js": `
export async function* getEventSourceStream(){ }
`,
  "scripts/personas.js": `
export let user_avatar = '';
export async function getUserAvatar(){ return user_avatar; }
export async function getUserAvatars(){ return []; }
export async function setUserAvatar(value){ user_avatar = value; return true; }
`,
  "scripts/slash-commands.js": `
export async function executeSlashCommandsWithOptions(){ return { pipe: '', result: '' }; }
`,
  "scripts/slash-commands/SlashCommand.js": `
export class SlashCommand { constructor(data = {}){ Object.assign(this, data); } static fromProps(data){ return new SlashCommand(data); } }
`,
  "scripts/slash-commands/SlashCommandArgument.js": `
export const ARGUMENT_TYPE = { STRING: 'string', NUMBER: 'number', BOOLEAN: 'boolean' };
export class SlashCommandArgument { constructor(data = {}){ Object.assign(this, data); } static fromProps(data){ return new SlashCommandArgument(data); } }
export class SlashCommandNamedArgument extends SlashCommandArgument {}
`,
  "scripts/slash-commands/SlashCommandCommonEnumsProvider.js": `
export const commonEnumProviders = {};
export const enumIcons = {};
`,
  "scripts/slash-commands/SlashCommandEnumValue.js": `
export const enumTypes = {};
export class SlashCommandEnumValue { constructor(value, description = ''){ this.value = value; this.description = description; } }
`,
  "scripts/slash-commands/SlashCommandParser.js": `
export class SlashCommandParser { constructor(){ this.commands = new Map(); } addCommandObject(command){ this.commands.set(command.name, command); } parse(value){ return { command: String(value ?? ''), args: {} }; } }
`,
  "scripts/popup.js": `
export const POPUP_TYPE = { TEXT: 'text', CONFIRM: 'confirm', INPUT: 'input' };
export async function callGenericPopup(content, type = POPUP_TYPE.TEXT){ if (type === POPUP_TYPE.CONFIRM) return confirm(String(content ?? '')); if (type === POPUP_TYPE.INPUT) return prompt(String(content ?? '')); alert(String(content ?? '')); return true; }
`,
  "scripts/tokenizers.js": `
export async function getTokenCountAsync(value){ return Math.ceil(String(value ?? '').length / 4); }
`,
};

export function getPluginApiShim(assetPath: string): string | null {
  return MODULES[assetPath] ?? null;
}
