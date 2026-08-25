import { getIdToken } from "./firebase.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";

// ✅ Helper — makes authenticated POST requests
const postJson = async (path, body) => {
  const token = await getIdToken();

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : { Authorization: "Bearer guest", "x-guest-user": "true" }),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Cannot reach backend at ${API_BASE}. Is the server running?`);
  }

  if (!response.ok) {
    const error = await response.text().catch(() => "");
    throw new Error(error || `Request failed with status ${response.status}`);
  }

  return response.json();
};

// ✅ Helper — authenticated GET
export const getJson = async (path) => {
  const token = await getIdToken();

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : { Authorization: "Bearer guest", "x-guest-user": "true" }),
    },
  });

  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
};

// ✅ Helper — authenticated DELETE/PUT
export const mutateJson = async (path, method = "DELETE", body = null) => {
  const token = await getIdToken();

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : { Authorization: "Bearer guest", "x-guest-user": "true" }),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
};

// ✅ Streaming chat request
export const requestChatStream = async (path, body, onChunk, onDone) => {
  const token = await getIdToken();

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : { Authorization: "Bearer guest", "x-guest-user": "true" }),
    },
    body: JSON.stringify(body),
  });


  if (!response.ok) throw new Error(`API Error: ${response.status}`);

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.chunk) onChunk(data.chunk);
        if (data.done)  onDone(data);
        if (data.error) throw new Error(data.error);
      } catch { /* skip malformed JSON */ }
    }
  }
};

// ✅ Original non-streaming endpoints (kept for compatibility)
export const requestChatReply = (messages, persona, model) =>
  postJson("/api/chat/respond", { messages, persona, model });

export const requestChatTitle = (message) =>
  postJson("/api/chat/title", { message });

export const requestImageGeneration = (prompt, threadId) =>
  postJson("/api/chat/image", { prompt, threadId });