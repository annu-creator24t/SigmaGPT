import express from "express";
import { db } from "../config/firebase.js";
import { getChatResponse, generateChatTitle } from "../utils/groq.js";

const router = express.Router();

router.get("/threads", async (req, res) => {
  try {
    const userId = req.user.uid;

    const snapshot = await db
      .collection("threads")
      .where("userId", "==", userId)
      .get();

    const threads = [];

    snapshot.forEach((doc) => {
      threads.push({
        threadId: doc.id,
        ...doc.data(),
      });
    });

    threads.sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );

    res.json(threads);

  } catch (error) {
    console.error("❌ Fetch threads error:", error.message);

    res.status(500).json({
      error: "Failed to fetch threads",
    });
  }
});

router.get("/threads/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;
    const userId = req.user.uid;

    const threadDoc = await db
      .collection("threads")
      .doc(threadId)
      .get();

    if (!threadDoc.exists) {
      return res.status(404).json({
        error: "Thread not found",
      });
    }

    if (threadDoc.data().userId !== userId) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    const messagesSnapshot = await db
      .collection("threads")
      .doc(threadId)
      .collection("messages")
      .orderBy("timestamp", "asc")
      .get();

    const messages = [];

    messagesSnapshot.forEach((doc) => {
      messages.push(doc.data());
    });

    res.json({
      threadId,
      ...threadDoc.data(),
      messages,
    });

  } catch (error) {
    console.error("❌ Fetch thread error:", error.message);

    res.status(500).json({
      error: "Failed to fetch thread",
    });
  }
});

// ✅ IMAGE GENERATION ROUTE
router.post("/image", async (req, res) => {
  try {
    const {
      prompt,
      threadId,
      model = "nano-banana-2",
      size = "9:16",
    } = req.body;

    const userId = req.user.uid;

    if (!prompt?.trim()) {
      return res.status(400).json({
        error: "Prompt is required",
      });
    }

    const apiUrl =
      `https://api.paxsenix.org/ai/text-to-image?text=${encodeURIComponent(
        prompt
      )}&model=${model}&size=${size}`;

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`Image API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.ok || !data.url) {
      throw new Error(
        data.message || "Image generation failed"
      );
    }

    const imageUrl = data.url;

    // ✅ Create thread if needed
    if (threadId) {
      const threadDoc = await db
        .collection("threads")
        .doc(threadId)
        .get();

      if (!threadDoc.exists) {
        const title = await generateChatTitle(prompt);

        await db.collection("threads").doc(threadId).set({
          title,
          userId,
          persona: "general",
          model: "smart",
          pinned: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      // ✅ Save user prompt
      await db
        .collection("threads")
        .doc(threadId)
        .collection("messages")
        .add({
          role: "user",
          content: `/image ${prompt}`,
          timestamp: new Date().toISOString(),
        });

      // ✅ Save assistant image response
      await db
        .collection("threads")
        .doc(threadId)
        .collection("messages")
        .add({
          role: "assistant",
          content: `Generated image (${model}, ${size}):`,
          imageUrl,
          isImage: true,
          timestamp: new Date().toISOString(),
          persona: "general",
        });

      // ✅ Update thread timestamp
      await db.collection("threads").doc(threadId).update({
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({
      ok: true,
      imageUrl,
      model,
      size,
      prompt,
    });

  } catch (error) {
    console.error("❌ Image generation error:", error.message);

    res.status(500).json({
      error: error.message || "Failed to generate image",
    });
  }
});

// ✅ CHAT ROUTE
router.post("/chat", async (req, res) => {
  try {
    const {
      message,
      threadId,
      persona = "general",
      model = "smart",
    } = req.body;

    // ✅ BLOCK /image COMMANDS FROM REACHING AI
    if (message?.trim().startsWith("/image")) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      res.write(
        `data: ${JSON.stringify({
          chunk:
            "Please use the image generation button or type /image correctly.",
        })}\n\n`
      );

      res.write(
        `data: ${JSON.stringify({
          done: true,
        })}\n\n`
      );

      return res.end();
    }

    const userId = req.user.uid;

    // ✅ Validate message
    if (!message?.trim()) {
      return res.status(400).json({
        error: "Message is required",
      });
    }

    // ✅ SSE HEADERS
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let currentThreadId = threadId;

    // ✅ Create new thread
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
      // ✅ Check existing thread
      const threadDoc = await db
        .collection("threads")
        .doc(currentThreadId)
        .get();

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
        res.write(
          `data: ${JSON.stringify({
            error: "Access denied",
          })}\n\n`
        );

        return res.end();
      }
    }

    // ✅ Save user message
    await db
      .collection("threads")
      .doc(currentThreadId)
      .collection("messages")
      .add({
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      });

    // ✅ Load chat history
    const messagesSnapshot = await db
      .collection("threads")
      .doc(currentThreadId)
      .collection("messages")
      .orderBy("timestamp", "asc")
      .get();

    const history = [];

    messagesSnapshot.forEach((doc) => {
      const d = doc.data();

      history.push({
        role: d.role,
        content: d.content,
      });
    });

    // ✅ Get AI response
    const result = await getChatResponse(
      history,
      persona,
      model
    );

    // ✅ Stream response
    res.write(
      `data: ${JSON.stringify({
        chunk: result.content,
      })}\n\n`
    );

    // ✅ Save assistant response
    await db
      .collection("threads")
      .doc(currentThreadId)
      .collection("messages")
      .add({
        role: "assistant",
        content: result.content,
        timestamp: new Date().toISOString(),
        persona,
      });

    // ✅ Update thread timestamp
    await db.collection("threads").doc(currentThreadId).update({
      updatedAt: new Date().toISOString(),
    });

    // ✅ Finish stream
    res.write(
      `data: ${JSON.stringify({
        done: true,
        threadId: currentThreadId,
      })}\n\n`
    );

    res.end();

  } catch (error) {
    console.error("❌ Chat error:", error.message);

    res.write(
      `data: ${JSON.stringify({
        error: error.message,
      })}\n\n`
    );

    res.end();
  }
});

router.post("/respond", async (req, res) => {
  try {
    const {
      messages,
      persona = "general",
      model = "smart",
    } = req.body;

    const result = await getChatResponse(
      messages,
      persona,
      model
    );

    res.json({
      content: result.content,
      model: result.model,
    });

  } catch (error) {
    res.status(500).json({
      error: "Failed to get AI response",
    });
  }
});

router.post("/title", async (req, res) => {
  try {
    const title = await generateChatTitle(
      req.body.message
    );

    res.json({ title });

  } catch {
    res.json({
      title: "New Chat",
    });
  }
});

router.put("/threads/:threadId/rename", async (req, res) => {
  try {
    const { threadId } = req.params;
    const { title } = req.body;

    const userId = req.user.uid;

    const threadRef = db
      .collection("threads")
      .doc(threadId);

    const threadDoc = await threadRef.get();

    if (!threadDoc.exists) {
      return res.status(404).json({
        error: "Thread not found",
      });
    }

    if (threadDoc.data().userId !== userId) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    if (!title?.trim()) {
      return res.status(400).json({
        error: "Title required",
      });
    }

    await threadRef.update({
      title: title.trim(),
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      title: title.trim(),
    });

  } catch (error) {
    res.status(500).json({
      error: "Failed to rename thread",
    });
  }
});

router.put("/threads/:threadId/pin", async (req, res) => {
  try {
    const { threadId } = req.params;

    const userId = req.user.uid;

    const threadRef = db
      .collection("threads")
      .doc(threadId);

    const threadDoc = await threadRef.get();

    if (!threadDoc.exists) {
      return res.status(404).json({
        error: "Thread not found",
      });
    }

    if (threadDoc.data().userId !== userId) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    const newPinned = !threadDoc.data().pinned;

    await threadRef.update({
      pinned: newPinned,
      updatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      pinned: newPinned,
    });

  } catch (error) {
    res.status(500).json({
      error: "Failed to pin thread",
    });
  }
});

router.delete("/threads/:threadId", async (req, res) => {
  try {
    const { threadId } = req.params;

    const userId = req.user.uid;

    const threadRef = db
      .collection("threads")
      .doc(threadId);

    const threadDoc = await threadRef.get();

    if (!threadDoc.exists) {
      return res.status(404).json({
        error: "Thread not found",
      });
    }

    if (threadDoc.data().userId !== userId) {
      return res.status(403).json({
        error: "Access denied",
      });
    }

    const messagesSnapshot = await threadRef
      .collection("messages")
      .get();

    const batch = db.batch();

    messagesSnapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });

    batch.delete(threadRef);

    await batch.commit();

    res.json({
      success: true,
      message: "Thread deleted",
    });

  } catch (error) {
    res.status(500).json({
      error: "Failed to delete thread",
    });
  }
});

router.delete("/threads", async (req, res) => {
  try {
    const userId = req.user.uid;

    const snapshot = await db
      .collection("threads")
      .where("userId", "==", userId)
      .get();

    const batch = db.batch();

    snapshot.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    res.json({
      success: true,
      message: "All your threads cleared",
    });

  } catch (error) {
    res.status(500).json({
      error: "Failed to clear threads",
    });
  }
});

export default router;