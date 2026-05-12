const STORAGE_KEY = "sigmagpt.storage.v1";

const DEFAULT_SETTINGS = {
  theme: "dark",
  sidebarOpen: true,
  selectedPersona: "general",
  selectedModel: "smart",
  searchQuery: "",
};

const DEFAULT_STORE = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  chats: {},
};

const sessionChats = new Map();

const isBrowser = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const createId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `chat_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

const now = () => new Date().toISOString();

const clone = (value) => JSON.parse(JSON.stringify(value));

const readStorage = () => {
  if (!isBrowser) return clone(DEFAULT_STORE);

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(DEFAULT_STORE);

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return clone(DEFAULT_STORE);

    return sanitizeStore(parsed);
  } catch {
    return clone(DEFAULT_STORE);
  }
};

const writeStorage = (store) => {
  if (!isBrowser) return store;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  return store;
};

const normalizeMessage = (message) => ({
  id: message?.id || createId(),
  role: message?.role === "assistant" ? "assistant" : "user",
  content: String(message?.content || ""),
  timestamp: message?.timestamp || now(),
  persona: message?.persona || null,
  model: message?.model || null,
  isImage: message?.isImage || false,        // ✅ ADD
  imageUrl: message?.imageUrl || null,       // ✅ ADD
  isGenerating: message?.isGenerating || false, // ✅ ADD
});

const normalizeChat = (chat) => ({
  id: chat?.id || createId(),
  title: String(chat?.title || "Untitled chat").trim() || "Untitled chat",
  createdAt: chat?.createdAt || now(),
  updatedAt: chat?.updatedAt || now(),
  pinned: Boolean(chat?.pinned),
  persona: chat?.persona || DEFAULT_SETTINGS.selectedPersona,
  model: chat?.model || DEFAULT_SETTINGS.selectedModel,
  messages: Array.isArray(chat?.messages) ? chat.messages.map(normalizeMessage) : [],
  incognito: Boolean(chat?.incognito),
});

const sanitizeStore = (store) => {
  const normalizedChats = {};

  if (store?.chats && typeof store.chats === "object") {
    for (const [id, chat] of Object.entries(store.chats)) {
      const normalized = normalizeChat({ ...chat, id });
      normalizedChats[normalized.id] = normalized;
    }
  } else if (Array.isArray(store?.chats)) {
    for (const chat of store.chats) {
      const normalized = normalizeChat(chat);
      normalizedChats[normalized.id] = normalized;
    }
  }

  return {
    version: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(store?.settings || {}),
    },
    chats: normalizedChats,
  };
};

const sortChats = (chats) =>
  [...chats].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });

export const getStore = () => readStorage();

export const saveStore = (store) => writeStorage(sanitizeStore(store));

export const getSettings = () => readStorage().settings;

export const updateSettings = (patch) => {
  const store = readStorage();
  store.settings = {
    ...store.settings,
    ...patch,
  };
  return writeStorage(sanitizeStore(store));
};

export const listChats = () => sortChats(Object.values(readStorage().chats));

export const listSessionChats = () => sortChats(Array.from(sessionChats.values()));

export const getChat = (chatId) => {
  if (!chatId) return null;
  return sessionChats.get(chatId) || readStorage().chats[chatId] || null;
};

export const ensureChat = (chatId, defaults = {}) => {
  const store = readStorage();
  const existing = store.chats[chatId];

  if (existing) return existing;

  const chat = normalizeChat({
    id: chatId,
    title: defaults.title,
    persona: defaults.persona,
    model: defaults.model,
    messages: defaults.messages || [],
    pinned: defaults.pinned,
    createdAt: defaults.createdAt,
    updatedAt: defaults.updatedAt,
  });

  store.chats[chat.id] = chat;
  writeStorage(store);
  return chat;
};

export const createChat = (defaults = {}) => {
  const chat = normalizeChat({
    id: defaults.id || createId(),
    title: defaults.title,
    persona: defaults.persona,
    model: defaults.model,
    messages: defaults.messages || [],
    pinned: defaults.pinned,
    createdAt: defaults.createdAt,
    updatedAt: defaults.updatedAt,
  });

  const store = readStorage();
  store.chats[chat.id] = chat;
  writeStorage(store);
  return chat;
};

export const createSessionChat = (defaults = {}) => {
  const chat = normalizeChat({
    id: defaults.id || createId(),
    title: defaults.title,
    persona: defaults.persona,
    model: defaults.model,
    messages: defaults.messages || [],
    pinned: defaults.pinned,
    createdAt: defaults.createdAt,
    updatedAt: defaults.updatedAt,
    incognito: true,
  });

  sessionChats.set(chat.id, chat);
  return chat;
};

export const updateChat = (chatId, patch = {}) => {
  if (sessionChats.has(chatId)) {
    return updateSessionChat(chatId, patch);
  }

  const store = readStorage();
  const current = store.chats[chatId];
  if (!current) return null;

  const updated = normalizeChat({
    ...current,
    ...patch,
    id: chatId,
    messages: patch.messages || current.messages,
    updatedAt: patch.updatedAt || now(),
  });

  store.chats[chatId] = updated;
  writeStorage(store);
  return updated;
};

export const updateSessionChat = (chatId, patch = {}) => {
  const current = sessionChats.get(chatId);
  if (!current) return null;

  const updated = normalizeChat({
    ...current,
    ...patch,
    id: chatId,
    messages: patch.messages || current.messages,
    updatedAt: patch.updatedAt || now(),
    incognito: true,
  });

  sessionChats.set(chatId, updated);
  return updated;
};

export const replaceChatMessages = (chatId, messages) => updateChat(chatId, {
  messages: Array.isArray(messages) ? messages.map(normalizeMessage) : [],
  updatedAt: now(),
});

export const replaceSessionChatMessages = (chatId, messages) => updateSessionChat(chatId, {
  messages: Array.isArray(messages) ? messages.map(normalizeMessage) : [],
  updatedAt: now(),
});

export const appendMessage = (chatId, message) => {
  const current = getChat(chatId);
  if (!current) return null;

  const nextMessages = [...current.messages, normalizeMessage(message)];
  return updateChat(chatId, {
    messages: nextMessages,
    updatedAt: now(),
  });
};

export const appendSessionMessage = (chatId, message) => {
  const current = getChat(chatId);
  if (!current) return null;

  const nextMessages = [...current.messages, normalizeMessage(message)];
  return updateSessionChat(chatId, {
    messages: nextMessages,
    updatedAt: now(),
  });
};

export const renameChat = (chatId, title) => updateChat(chatId, {
  title: String(title || "Untitled chat").trim() || "Untitled chat",
  updatedAt: now(),
});

export const renameSessionChat = (chatId, title) => updateSessionChat(chatId, {
  title: String(title || "Untitled chat").trim() || "Untitled chat",
  updatedAt: now(),
});

export const togglePinned = (chatId) => {
  const current = getChat(chatId);
  if (!current) return null;

  if (sessionChats.has(chatId)) {
    return updateSessionChat(chatId, {
      pinned: !current.pinned,
      updatedAt: now(),
    });
  }

  return updateChat(chatId, {
    pinned: !current.pinned,
    updatedAt: now(),
  });
};

export const toggleSessionPinned = (chatId) => {
  const current = sessionChats.get(chatId);
  if (!current) return null;

  return updateSessionChat(chatId, {
    pinned: !current.pinned,
    updatedAt: now(),
  });
};

export const deleteChat = (chatId) => {
  if (sessionChats.has(chatId)) {
    sessionChats.delete(chatId);
    return true;
  }

  const store = readStorage();
  if (!store.chats[chatId]) return false;

  delete store.chats[chatId];
  writeStorage(store);
  return true;
};

export const clearChats = () => {
  const store = readStorage();
  store.chats = {};
  writeStorage(store);
  return store;
};

export const clearSessionChats = () => {
  sessionChats.clear();
};

export const searchChats = (query) => {
  const needle = String(query || "").trim().toLowerCase();
  const chats = listChats();

  if (!needle) return chats;

  return chats.filter((chat) => {
    const titleMatch = chat.title.toLowerCase().includes(needle);
    const messageMatch = chat.messages.some((message) =>
      String(message.content || "").toLowerCase().includes(needle)
    );
    return titleMatch || messageMatch;
  });
};

export const exportSnapshot = () => JSON.stringify(readStorage(), null, 2);

export const importSnapshot = (payload) => {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  const store = sanitizeStore(parsed);
  return writeStorage(store);
};

export const getChatCount = () => Object.keys(readStorage().chats).length;

export const getLatestChatId = () => {
  const chats = listChats();
  return chats[0]?.id || null;
};

export const isSessionChat = (chatId) => sessionChats.has(chatId);

export const createFallbackTitle = (message) => {
  const words = String(message || "")
    .replace(/[`*_#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 4);

  return words.join(" ") || "New chat";
};

export { DEFAULT_SETTINGS, STORAGE_KEY };