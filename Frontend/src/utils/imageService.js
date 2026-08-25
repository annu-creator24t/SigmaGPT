import { getIdToken } from "./firebase.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8080";
const IMAGE_URL = `${API_BASE}/api/chat/image`;

// Image intent keywords to automatically detect image generation
export const IMAGE_KEYWORDS = [
  "/image", "/img", "/draw",
  "generate image", "generate a image", "generate an image",
  "create image", "create a image", "create an image",
  "draw ", "draw a ", "draw an ",
  "make image", "make a image", "make an image",
  "show image", "show a photo of", "paint ",
  "illustrate ", "sketch ", "render ",
  "generate a photo", "create a photo",
  "image of ", "picture of ", "photo of ",
];

// Available command suggestions for chat input
export const COMMAND_SUGGESTIONS = [
  {
    cmd: "/image",
    syntax: "/image [prompt]",
    desc: "Generate AI image with Pollinations AI",
    badge: "Image",
    example: "/image a futuristic neon city in cyberpunk style",
  },
  {
    cmd: "/code",
    syntax: "/code [task]",
    desc: "Ask Sigma Coder for code or debugging",
    badge: "Coding",
    example: "Write a React hook for debouncing input",
  },
  {
    cmd: "/explain",
    syntax: "/explain [concept]",
    desc: "Explain complex topics in simple terms",
    badge: "Explain",
    example: "Explain quantum computing to a 10 year old",
  },
  {
    cmd: "/new",
    syntax: "/new",
    desc: "Start a fresh new conversation",
    badge: "Chat",
    example: "Start a new conversation",
  },
];

/**
 * Checks if input text matches any image generation keywords
 */
export const detectImageIntent = (text = "") => {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return IMAGE_KEYWORDS.some((kw) => lower.startsWith(kw) || lower.includes(kw));
};

/**
 * Extracts and cleans the image prompt by stripping command prefixes
 */
export const getImagePrompt = (text = "") => {
  if (!text) return "";
  let clean = text.trim();

  // Strip known prefix commands
  const prefixes = [
    /^\/image\s+/i,
    /^\/img\s+/i,
    /^\/draw\s+/i,
    /^generate\s+(an?\s+)?image\s+(of\s+)?/i,
    /^create\s+(an?\s+)?image\s+(of\s+)?/i,
    /^draw\s+(an?\s+)?/i,
    /^paint\s+(an?\s+)?/i,
    /^make\s+(an?\s+)?image\s+(of\s+)?/i,
  ];

  for (const regex of prefixes) {
    if (regex.test(clean)) {
      clean = clean.replace(regex, "");
      break;
    }
  }

  return clean.trim() || text.trim();
};

/**
 * Builds direct Pollinations AI image URL
 */
export const buildPollinationsUrl = (prompt, width = 1024, height = 1024) => {
  const seed = Math.floor(Math.random() * 1000000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`;
};

/**
 * Generates an image via backend API or direct fallback
 */
export const generateImageService = async ({ prompt, threadId, isGuest = false }) => {
  const cleanPrompt = getImagePrompt(prompt);
  if (!cleanPrompt) throw new Error("Image prompt cannot be empty.");

  const directUrl = buildPollinationsUrl(cleanPrompt);

  // If user is guest or backend is unreachable, return direct image URL
  if (isGuest) {
    return {
      ok: true,
      imageUrl: directUrl,
      prompt: cleanPrompt,
    };
  }

  try {
    const token = await getIdToken();
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    } else {
      headers.Authorization = "Bearer guest";
      headers["x-guest-user"] = "true";
    }

    const res = await fetch(IMAGE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: cleanPrompt,
        threadId: threadId || null,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.imageUrl) return data;
    }
  } catch (err) {
    console.warn("Backend image generation fallback to direct URL:", err);
  }

  // Fallback direct URL if backend failed or offline
  return {
    ok: true,
    imageUrl: directUrl,
    prompt: cleanPrompt,
  };
};
