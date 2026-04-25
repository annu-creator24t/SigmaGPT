import express from "express";
import { db } from "../config/firebase.js";
import {
  getChatResponse,
  generateChatTitle,
} from "../utils/groq.js";
import {
  ALLOWED_MODELS,
  ALLOWED_RATIOS,
  DEFAULT_MODEL,
  DEFAULT_RATIO,
  generateImageFromText,
} from "../utils/image.js";

const router = express.Router();

const memoryThreads = new Map();

const createThreadId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `thread_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

const getMemoryThread = (threadId) => memoryThreads.get(threadId) || null;

const listMemoryThreadsByUser = (userId) =>
  Array.from(memoryThreads.values())
    .filter((thread) => thread.userId === userId)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

const sanitizeMemoryThread = (thread) => ({
  threadId: thread.threadId,
  title: thread.title,
  userId: thread.userId,
  persona: thread.persona,
  model: thread.model,
  pinned: thread.pinned,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
});

const normalizeImageModel = (model) =>
  ALLOWED_MODELS.has(String(model || "").trim())
    ? String(model).trim()
    : DEFAULT_MODEL;

const normalizeImageRatio = (ratio) =>
  ALLOWED_RATIOS.has(String(ratio || "").trim())
    ? String(ratio).trim()
    : DEFAULT_RATIO;

// ═══════════════════════════════════════
// GET /api/chat/threads
// ═══════════════════════════════════════
router.get("/threads", async (req, res) => {
  try {
    const userId = req.user.uid;

    if (!db) {
      const threads = listMemoryThreadsByUser(userId).map(sanitizeMemoryThread);
      return res.json(threads);
    }

    const snapshot = await db
      .collection("threads")
      .where("userId", "==", userId)
      .get();

    const threads = [];
    snapshot.forEach(doc => {
      threads.push({ threadId: doc.id, ...doc.data() });
    });

    // Sort by updatedAt descending in JS — no index needed!
    threads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json(threads);
  } catch (error) {
    console.error("❌ Fetch threads error:", error.message);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

// ═══════════════════════════════════════
// GET /api/chat/threads/:threadId
// ═══════════════════════════════════════
router.get("/threads/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.uid;

    if (!db) {
      const thread = getMemoryThread(threadId);
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      if (thread.userId !== userId) return res.status(403).json({ error: "Access denied" });

      return res.json({
        ...sanitizeMemoryThread(thread),
        messages: thread.messages,
      });
    }

    const threadDoc = await db.collection("threads").doc(threadId).get();

    if (!threadDoc.exists) {
      return res.status(404).json({ error: "Thread not found" });
    }

    if (threadDoc.data().userId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const messagesSnapshot = await db
      .collection("threads").doc(threadId)
      .collection("messages")
      .orderBy("timestamp", "asc")
      .get();

    const messages = [];
    messagesSnapshot.forEach(doc => messages.push(doc.data()));

    res.json({ threadId, ...threadDoc.data(), messages });
  } catch (error) {
    console.error("❌ Fetch thread error:", error.message);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// ═══════════════════════════════════════
// POST /api/chat/chat
// ═══════════════════════════════════════
router.post("/chat", async (req, res) => {
  try {
    const { message, threadId, persona = "general", model = "smart" } = req.body;
    const userId = req.user.uid;

    if (!message?.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (!db) {
      let currentThreadId = threadId;

      if (!currentThreadId) {
        currentThreadId = createThreadId();
        const title = await generateChatTitle(message);
        const now = new Date().toISOString();
        memoryThreads.set(currentThreadId, {
          threadId: currentThreadId,
          title,
          userId,
          persona,
          model,
          pinned: false,
          createdAt: now,
          updatedAt: now,
          messages: [],
        });
      }

      const thread = getMemoryThread(currentThreadId);
      if (!thread) {
        const title = await generateChatTitle(message);
        const now = new Date().toISOString();
        memoryThreads.set(currentThreadId, {
          threadId: currentThreadId,
          title,
          userId,
          persona,
          model,
          pinned: false,
          createdAt: now,
          updatedAt: now,
          messages: [],
        });
      } else if (thread.userId !== userId) {
        res.write(`data: ${JSON.stringify({ error: "Access denied" })}\n\n`);
        return res.end();
      }

      const activeThread = getMemoryThread(currentThreadId);
      activeThread.persona = persona;
      activeThread.model = model;
      activeThread.messages.push({
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });

      const history = activeThread.messages.map((entry) => ({ role: entry.role, content: entry.content }));
      const result = await getChatResponse(history, persona, model);
      const fullResponse = result.content;

      res.write(`data: ${JSON.stringify({ chunk: fullResponse })}\n\n`);

      activeThread.messages.push({
        role: "assistant",
        content: fullResponse,
        timestamp: new Date().toISOString(),
        persona,
      });
      activeThread.updatedAt = new Date().toISOString();

      res.write(`data: ${JSON.stringify({ done: true, threadId: currentThreadId })}\n\n`);
      return res.end();
    }

    let currentThreadId = threadId;

    if (!currentThreadId) {
      const newThreadRef = db.collection("threads").doc();
      currentThreadId = newThreadRef.id;
      const title = await generateChatTitle(message);
      await newThreadRef.set({
        title, userId, persona, model,
        pinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const threadDoc = await db.collection("threads").doc(currentThreadId).get();
      if (!threadDoc.exists) {
        const title = await generateChatTitle(message);
        await db.collection("threads").doc(currentThreadId).set({
          title, userId, persona, model,
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else if (threadDoc.data().userId !== userId) {
        res.write(`data: ${JSON.stringify({ error: "Access denied" })}\n\n`);
        return res.end();
      }
    }

    await db.collection("threads").doc(currentThreadId)
      .collection("messages").add({
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });

    const messagesSnapshot = await db
      .collection("threads").doc(currentThreadId)
      .collection("messages")
      .orderBy("timestamp", "asc")
      .get();

    const history = [];
    messagesSnapshot.forEach(doc => {
      const data = doc.data();
      history.push({ role: data.role, content: data.content });
    });

    const result = await getChatResponse(history, persona, model);
    const fullResponse = result.content;

    res.write(`data: ${JSON.stringify({ chunk: fullResponse })}\n\n`);

    await db.collection("threads").doc(currentThreadId)
      .collection("messages").add({
        role: "assistant",
        content: fullResponse,
        timestamp: new Date().toISOString(),
        persona,
      });

    await db.collection("threads").doc(currentThreadId).update({
      updatedAt: new Date().toISOString(),
    });

    res.write(`data: ${JSON.stringify({ done: true, threadId: currentThreadId })}\n\n`);
    res.end();

  } catch (error) {
    console.error("❌ Chat error:", error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// ═══════════════════════════════════════
// POST /api/chat/respond
// ═══════════════════════════════════════
router.post("/respond", async (req, res) => {
  try {
    const { messages, persona = "general", model = "smart" } = req.body;
    const result = await getChatResponse(messages, persona, model);
    res.json({ content: result.content, model: result.model });
  } catch (error) {
    console.error("❌ Respond error:", error.message);
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

// ═══════════════════════════════════════
// POST /api/chat/title
// ═══════════════════════════════════════
router.post("/title", async (req, res) => {
  try {
    const { message } = req.body;
    const title = await generateChatTitle(message);
    res.json({ title });
  } catch (error) {
    res.json({ title: "New Chat" });
  }
});

// ═══════════════════════════════════════
// POST /api/chat/image
// ═══════════════════════════════════════
router.post("/image", async (req, res) => {
  try {
    const {
      prompt,
      threadId,
      model = DEFAULT_MODEL,
      ratio = DEFAULT_RATIO,
    } = req.body;
    const userId = req.user.uid;

    if (!String(prompt || "").trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const selectedModel = normalizeImageModel(model);
    const selectedRatio = normalizeImageRatio(ratio);

    const imageResult = await generateImageFromText({
      prompt,
      model: selectedModel,
      ratio: selectedRatio,
    });

    const assistantMessage = [
      `Generated image (${selectedModel}, ${selectedRatio}):`,
      "",
      `![Generated image](${imageResult.imageUrl})`,
      "",
      `[Open image](${imageResult.imageUrl})`,
    ].join("\n");

    if (!db) {
      let currentThreadId = threadId;
      const now = new Date().toISOString();

      if (!currentThreadId) {
        currentThreadId = createThreadId();
        const title = await generateChatTitle(prompt);
        memoryThreads.set(currentThreadId, {
          threadId: currentThreadId,
          title,
          userId,
          persona: "general",
          model: "image",
          pinned: false,
          createdAt: now,
          updatedAt: now,
          messages: [],
        });
      }

      const thread = getMemoryThread(currentThreadId);
      if (!thread) {
        const title = await generateChatTitle(prompt);
        memoryThreads.set(currentThreadId, {
          threadId: currentThreadId,
          title,
          userId,
          persona: "general",
          model: "image",
          pinned: false,
          createdAt: now,
          updatedAt: now,
          messages: [],
        });
      } else if (thread.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const activeThread = getMemoryThread(currentThreadId);
      activeThread.messages.push({
        role: "user",
        content: String(prompt).trim(),
        timestamp: new Date().toISOString(),
      });
      activeThread.messages.push({
        role: "assistant",
        content: assistantMessage,
        timestamp: new Date().toISOString(),
        persona: "image",
        imageUrl: imageResult.imageUrl,
      });
      activeThread.updatedAt = new Date().toISOString();

      return res.json({
        success: true,
        threadId: currentThreadId,
        imageUrl: imageResult.imageUrl,
        urls: imageResult.urls,
        jobId: imageResult.jobId,
        taskUrl: imageResult.taskUrl,
        model: selectedModel,
        ratio: selectedRatio,
        content: assistantMessage,
      });
    }

    let currentThreadId = threadId;
    if (!currentThreadId) {
      const newThreadRef = db.collection("threads").doc();
      currentThreadId = newThreadRef.id;
      const title = await generateChatTitle(prompt);
      await newThreadRef.set({
        title,
        userId,
        persona: "general",
        model: "image",
        pinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const threadDoc = await db.collection("threads").doc(currentThreadId).get();
      if (!threadDoc.exists) {
        const title = await generateChatTitle(prompt);
        await db.collection("threads").doc(currentThreadId).set({
          title,
          userId,
          persona: "general",
          model: "image",
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else if (threadDoc.data().userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    await db.collection("threads").doc(currentThreadId)
      .collection("messages").add({
        role: "user",
        content: String(prompt).trim(),
        timestamp: new Date().toISOString(),
      });

    await db.collection("threads").doc(currentThreadId)
      .collection("messages").add({
        role: "assistant",
        content: assistantMessage,
        timestamp: new Date().toISOString(),
        persona: "image",
        imageUrl: imageResult.imageUrl,
      });

    await db.collection("threads").doc(currentThreadId).update({
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      threadId: currentThreadId,
      imageUrl: imageResult.imageUrl,
      urls: imageResult.urls,
      jobId: imageResult.jobId,
      taskUrl: imageResult.taskUrl,
      model: selectedModel,
      ratio: selectedRatio,
      content: assistantMessage,
    });
  } catch (error) {
    console.error("❌ Image error:", error.message);
    res.status(500).json({ error: error.message || "Failed to generate image" });
  }
});

// ═══════════════════════════════════════
// PUT /api/chat/threads/:threadId/rename
// ═══════════════════════════════════════
router.put("/threads/:threadId/rename", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { title }    = req.body;
    const userId       = req.user.uid;

    if (!db) {
      const thread = getMemoryThread(threadId);
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      if (thread.userId !== userId) return res.status(403).json({ error: "Access denied" });
      if (!title?.trim()) return res.status(400).json({ error: "Title required" });

      thread.title = title.trim();
      thread.updatedAt = new Date().toISOString();
      return res.json({ success: true, title: thread.title });
    }

    const threadRef = db.collection("threads").doc(threadId);
    const threadDoc = await threadRef.get();

    if (!threadDoc.exists)                  return res.status(404).json({ error: "Thread not found" });
    if (threadDoc.data().userId !== userId) return res.status(403).json({ error: "Access denied" });
    if (!title?.trim())                     return res.status(400).json({ error: "Title required" });

    await threadRef.update({ title: title.trim(), updatedAt: new Date().toISOString() });
    res.json({ success: true, title: title.trim() });
  } catch (error) {
    console.error("❌ Rename error:", error.message);
    res.status(500).json({ error: "Failed to rename thread" });
  }
});

// ═══════════════════════════════════════
// PUT /api/chat/threads/:threadId/pin
// ═══════════════════════════════════════
router.put("/threads/:threadId/pin", async (req, res) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.uid;

    if (!db) {
      const thread = getMemoryThread(threadId);
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      if (thread.userId !== userId) return res.status(403).json({ error: "Access denied" });

      thread.pinned = !thread.pinned;
      thread.updatedAt = new Date().toISOString();
      return res.json({ success: true, pinned: thread.pinned });
    }

    const threadRef = db.collection("threads").doc(threadId);
    const threadDoc = await threadRef.get();

    if (!threadDoc.exists)                  return res.status(404).json({ error: "Thread not found" });
    if (threadDoc.data().userId !== userId) return res.status(403).json({ error: "Access denied" });

    const newPinned = !threadDoc.data().pinned;
    await threadRef.update({ pinned: newPinned, updatedAt: new Date().toISOString() });
    res.json({ success: true, pinned: newPinned });
  } catch (error) {
    console.error("❌ Pin error:", error.message);
    res.status(500).json({ error: "Failed to pin thread" });
  }
});

// ═══════════════════════════════════════
// DELETE /api/chat/threads/:threadId
// ═══════════════════════════════════════
router.delete("/threads/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.uid;

    if (!db) {
      const thread = getMemoryThread(threadId);
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      if (thread.userId !== userId) return res.status(403).json({ error: "Access denied" });

      memoryThreads.delete(threadId);
      return res.json({ success: true, message: "Thread deleted" });
    }

    const threadRef = db.collection("threads").doc(threadId);
    const threadDoc = await threadRef.get();

    if (!threadDoc.exists)                  return res.status(404).json({ error: "Thread not found" });
    if (threadDoc.data().userId !== userId) return res.status(403).json({ error: "Access denied" });

    const messagesRef      = threadRef.collection("messages");
    const messagesSnapshot = await messagesRef.get();
    const batch = db.batch();
    messagesSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(threadRef);
    await batch.commit();

    res.json({ success: true, message: "Thread deleted" });
  } catch (error) {
    console.error("❌ Delete error:", error.message);
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

// ═══════════════════════════════════════
// DELETE /api/chat/threads — clear all
// ═══════════════════════════════════════
router.delete("/threads", async (req, res) => {
  try {
    const userId   = req.user.uid;

    if (!db) {
      const toDelete = listMemoryThreadsByUser(userId);
      toDelete.forEach((thread) => memoryThreads.delete(thread.threadId));
      return res.json({ success: true, message: "All your threads cleared" });
    }

    const snapshot = await db.collection("threads")
      .where("userId", "==", userId)
      .get();

    const batch = db.batch();
    snapshot.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    res.json({ success: true, message: "All your threads cleared" });
  } catch (error) {
    console.error("❌ Clear error:", error.message);
    res.status(500).json({ error: "Failed to clear threads" });
  }
});

export default router;