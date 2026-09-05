import express from "express";
import { db } from "../config/firebase.js";
import { getChatResponse, getChatStream, generateChatTitle } from "../utils/groq.js";
import { telemetry } from "../utils/telemetry.js";

const router = express.Router();

// ✅ GET METRICS SNAPSHOT
router.get("/metrics", async (req, res) => {
  try {
    const snapshot = await telemetry.getSnapshot();
    res.json(snapshot);
  } catch (error) {
    console.error("❌ Metrics error:", error.message);
    res.status(500).json({ error: "Failed to generate metrics snapshot" });
  }
});

router.get("/threads", async (req, res) => {
  try {
    if (req.user?.isGuest) {
      return res.json([]);
    }
    const userId = req.user.uid;
    const snapshot = await db.collection("threads").where("userId", "==", userId).get();
    const threads = [];
    snapshot.forEach((doc) => threads.push({ threadId: doc.id, ...doc.data() }));
    threads.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    res.json(threads);
  } catch (error) {
    console.error("❌ Fetch threads error:", error.message);
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

router.get("/threads/:threadId", async (req, res) => {
  try {
    if (req.user?.isGuest) {
      return res.status(404).json({ error: "Guest threads are stored client-side" });
    }
    const { threadId } = req.params;
    const userId = req.user.uid;
    const threadDoc = await db.collection("threads").doc(threadId).get();
    if (!threadDoc.exists) return res.status(404).json({ error: "Thread not found" });
    if (threadDoc.data().userId !== userId) return res.status(403).json({ error: "Access denied" });
    const messagesSnapshot = await db.collection("threads").doc(threadId).collection("messages").orderBy("timestamp", "asc").get();
    const messages = [];
    messagesSnapshot.forEach((doc) => messages.push(doc.data()));
    res.json({ threadId, ...threadDoc.data(), messages });
  } catch (error) {
    console.error("❌ Fetch thread error:", error.message);
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// ✅ IMAGE GENERATION — Uses Pollinations AI
router.post("/image", async (req, res) => {
  const startTime = Date.now();
  try {
    const { prompt, threadId, width = 1024, height = 1024 } = req.body;
    const isGuest = Boolean(req.user?.isGuest);
    const userId = req.user?.uid;

    if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });

    const seed = Math.floor(Math.random() * 1000000);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.trim())}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

    const latencyMs = Date.now() - startTime;

    // ✅ Save to Firestore only for authenticated non-guest users with threadId
    if (!isGuest && threadId && db) {
      try {
        const threadDoc = await db.collection("threads").doc(threadId).get();
        if (!threadDoc.exists) {
          const title = await generateChatTitle(prompt);
          await db.collection("threads").doc(threadId).set({
            title, userId, persona: "general", model: "smart",
            pinned: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        await db.collection("threads").doc(threadId).collection("messages").add({
          role: "user",
          content: `/image ${prompt}`,
          timestamp: new Date().toISOString(),
        });

        await db.collection("threads").doc(threadId).collection("messages").add({
          role: "assistant",
          content: `Generated image for: "${prompt}"`,
          imageUrl,
          isImage: true,
          latencyMs,
          timestamp: new Date().toISOString(),
          persona: "general",
        });

        await db.collection("threads").doc(threadId).update({
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn("Could not save image to Firestore:", err.message);
      }
    }

    telemetry.recordRequest({
      success: true,
      latencyMs,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model: "pollinations-ai",
      persona: "image-gen",
    });

    res.json({ ok: true, imageUrl, prompt: prompt.trim(), latencyMs });

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    telemetry.recordRequest({
      success: false,
      latencyMs,
      model: "pollinations-ai",
      persona: "image-gen",
    });
    console.error("❌ Image generation error:", error.message);
    res.status(500).json({ error: error.message || "Failed to generate image" });
  }
});

// ✅ CHAT ROUTE (Streaming with TTFT, Token Tracking & Firestore Persistence)
router.post("/chat", async (req, res) => {
  const startTime = Date.now();
  let firstTokenTime = null;
  let accumulatedContent = "";
  let streamUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  try {
    const { message, threadId, persona = "general", model = "smart" } = req.body;
    const isGuest = Boolean(req.user?.isGuest);
    const userId = req.user?.uid;

    if (message?.trim().startsWith("/image")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.write(`data: ${JSON.stringify({ chunk: "Use /image command for image generation." })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    if (!message?.trim()) return res.status(400).json({ error: "Message is required" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (isGuest) {
      // Guest chat streaming
      const history = [{ role: "user", content: message }];
      const streamObj = await getChatStream(history, persona, model);

      for await (const chunk of streamObj.stream) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now();
        }
        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          accumulatedContent += delta;
          res.write(`data: ${JSON.stringify({ chunk: delta })}\n\n`);
        }
        if (chunk.usage) {
          streamUsage = chunk.usage;
        }
      }

      const latencyMs = Date.now() - startTime;
      const ttftMs = firstTokenTime ? firstTokenTime - startTime : latencyMs;

      // Estimate tokens if stream_options weren't returned by provider
      const finalPromptTokens = streamUsage.prompt_tokens || Math.ceil(message.length / 4);
      const finalCompletionTokens = streamUsage.completion_tokens || Math.ceil(accumulatedContent.length / 4);
      const finalTotalTokens = streamUsage.total_tokens || (finalPromptTokens + finalCompletionTokens);

      telemetry.recordRequest({
        success: true,
        latencyMs,
        ttftMs,
        promptTokens: finalPromptTokens,
        completionTokens: finalCompletionTokens,
        totalTokens: finalTotalTokens,
        model,
        persona,
      });

      res.write(`data: ${JSON.stringify({
        done: true,
        metrics: { latencyMs, ttftMs, totalTokens: finalTotalTokens }
      })}\n\n`);
      return res.end();
    }

    // Authenticated chat flow
    let currentThreadId = threadId;

    if (!currentThreadId) {
      const newThreadRef = db.collection("threads").doc();
      currentThreadId = newThreadRef.id;
      const title = await generateChatTitle(message);
      await newThreadRef.set({
        title,
        userId,
        persona,
        model,
        pinned: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const threadDoc = await db.collection("threads").doc(currentThreadId).get();
      if (!threadDoc.exists) {
        const title = await generateChatTitle(message);
        await db.collection("threads").doc(currentThreadId).set({
          title,
          userId,
          persona,
          model,
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else if (threadDoc.data().userId !== userId) {
        res.write(`data: ${JSON.stringify({ error: "Access denied" })}\n\n`);
        return res.end();
      }
    }

    await db.collection("threads").doc(currentThreadId).collection("messages").add({
      role: "user",
      content: message,
      timestamp: new Date().toISOString(),
    });

    const messagesSnapshot = await db.collection("threads").doc(currentThreadId).collection("messages").orderBy("timestamp", "asc").get();
    const history = [];
    messagesSnapshot.forEach((doc) => {
      const d = doc.data();
      history.push({ role: d.role, content: d.content });
    });

    const streamObj = await getChatStream(history, persona, model);

    for await (const chunk of streamObj.stream) {
      if (!firstTokenTime) {
        firstTokenTime = Date.now();
      }
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        accumulatedContent += delta;
        res.write(`data: ${JSON.stringify({ chunk: delta })}\n\n`);
      }
      if (chunk.usage) {
        streamUsage = chunk.usage;
      }
    }

    const latencyMs = Date.now() - startTime;
    const ttftMs = firstTokenTime ? firstTokenTime - startTime : latencyMs;

    const finalPromptTokens = streamUsage.prompt_tokens || Math.ceil(history.reduce((a, b) => a + (b.content?.length || 0), 0) / 4);
    const finalCompletionTokens = streamUsage.completion_tokens || Math.ceil(accumulatedContent.length / 4);
    const finalTotalTokens = streamUsage.total_tokens || (finalPromptTokens + finalCompletionTokens);

    // Save message with complete token & latency telemetry in Firestore
    await db.collection("threads").doc(currentThreadId).collection("messages").add({
      role: "assistant",
      content: accumulatedContent,
      timestamp: new Date().toISOString(),
      persona,
      model,
      tokens: {
        promptTokens: finalPromptTokens,
        completionTokens: finalCompletionTokens,
        totalTokens: finalTotalTokens,
      },
      latencyMs,
      ttftMs,
    });

    await db.collection("threads").doc(currentThreadId).update({
      updatedAt: new Date().toISOString(),
      lastLatencyMs: latencyMs,
    });

    telemetry.recordRequest({
      success: true,
      latencyMs,
      ttftMs,
      promptTokens: finalPromptTokens,
      completionTokens: finalCompletionTokens,
      totalTokens: finalTotalTokens,
      model,
      persona,
    });

    res.write(`data: ${JSON.stringify({
      done: true,
      threadId: currentThreadId,
      metrics: { latencyMs, ttftMs, totalTokens: finalTotalTokens }
    })}\n\n`);
    res.end();

  } catch (error) {
    const latencyMs = Date.now() - startTime;
    telemetry.recordRequest({
      success: false,
      latencyMs,
      model: req.body?.model || "smart",
      persona: req.body?.persona || "general",
    });
    console.error("❌ Chat error:", error.message);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

// ✅ NON-STREAMING RESPOND WITH METRICS
router.post("/respond", async (req, res) => {
  const startTime = Date.now();
  try {
    const { messages, persona = "general", model = "smart" } = req.body;
    const result = await getChatResponse(messages, persona, model);

    telemetry.recordRequest({
      success: true,
      latencyMs: result.latencyMs,
      promptTokens: result.usage?.promptTokens || 0,
      completionTokens: result.usage?.completionTokens || 0,
      totalTokens: result.usage?.totalTokens || 0,
      model,
      persona,
    });

    res.json({
      content: result.content,
      model: result.model,
      persona: result.persona,
      usage: result.usage,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    telemetry.recordRequest({
      success: false,
      latencyMs,
      model: req.body?.model || "smart",
      persona: req.body?.persona || "general",
    });
    res.status(500).json({ error: "Failed to get AI response" });
  }
});

router.post("/title", async (req, res) => {
  try {
    const title = await generateChatTitle(req.body.message);
    res.json({ title });
  } catch { res.json({ title: "New Chat" }); }
});

router.put("/threads/:threadId/rename", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: "Title required" });

    if (req.user?.isGuest) {
      return res.json({ success: true, title: title.trim() });
    }

    const userId = req.user.uid;
    const threadRef = db.collection("threads").doc(threadId);
    const threadDoc = await threadRef.get();
    if (!threadDoc.exists) return res.status(404).json({ error: "Thread not found" });
    if (threadDoc.data().userId !== userId) return res.status(403).json({ error: "Access denied" });
    await threadRef.update({ title: title.trim(), updatedAt: new Date().toISOString() });
    res.json({ success: true, title: title.trim() });
  } catch (error) {
    res.status(500).json({ error: "Failed to rename thread" });
  }
});

router.put("/threads/:threadId/pin", async (req, res) => {
  try {
    const { threadId } = req.params;

    if (req.user?.isGuest) {
      return res.json({ success: true, pinned: Boolean(req.body?.pinned) });
    }

    const userId = req.user.uid;
    const threadRef = db.collection("threads").doc(threadId);
    const threadDoc = await threadRef.get();
    if (!threadDoc.exists) return res.status(404).json({ error: "Thread not found" });
    if (threadDoc.data().userId !== userId) return res.status(403).json({ error: "Access denied" });
    const newPinned = !threadDoc.data().pinned;
    await threadRef.update({ pinned: newPinned, updatedAt: new Date().toISOString() });
    res.json({ success: true, pinned: newPinned });
  } catch (error) {
    res.status(500).json({ error: "Failed to pin thread" });
  }
});

router.delete("/threads/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;

    if (req.user?.isGuest) {
      return res.json({ success: true, message: "Thread deleted" });
    }

    const userId = req.user.uid;
    const threadRef = db.collection("threads").doc(threadId);
    const threadDoc = await threadRef.get();
    if (!threadDoc.exists) return res.status(404).json({ error: "Thread not found" });
    if (threadDoc.data().userId !== userId) return res.status(403).json({ error: "Access denied" });
    const messagesSnapshot = await threadRef.collection("messages").get();
    const batch = db.batch();
    messagesSnapshot.forEach((doc) => batch.delete(doc.ref));
    batch.delete(threadRef);
    await batch.commit();
    res.json({ success: true, message: "Thread deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

router.delete("/threads", async (req, res) => {
  try {
    if (req.user?.isGuest) {
      return res.json({ success: true, message: "All your threads cleared" });
    }

    const userId = req.user.uid;
    const snapshot = await db.collection("threads").where("userId", "==", userId).get();
    const batch = db.batch();
    snapshot.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    res.json({ success: true, message: "All your threads cleared" });
  } catch (error) {
    res.status(500).json({ error: "Failed to clear threads" });
  }
});

export default router;