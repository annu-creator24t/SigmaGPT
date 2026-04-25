import dotenv from "dotenv";

dotenv.config();

const API_BASE = "https://api.paxsenix.org";
const START_PATH = "/ai-image/nano-banana";
const DEFAULT_MODEL = "nano-banana-2";
const DEFAULT_RATIO = "9:16";

const ALLOWED_MODELS = new Set(["nano-banana-2"]);
const ALLOWED_RATIOS = new Set(["9:16"]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeModel = (model) => {
  const value = String(model || DEFAULT_MODEL).trim();
  return ALLOWED_MODELS.has(value) ? value : DEFAULT_MODEL;
};

const normalizeRatio = (ratio) => {
  const value = String(ratio || DEFAULT_RATIO).trim();
  return ALLOWED_RATIOS.has(value) ? value : DEFAULT_RATIO;
};

const getAuthHeader = () => {
  const apiKey = process.env.PAXSENIX_API_KEY;
  if (!apiKey) {
    throw new Error("PAXSENIX_API_KEY is missing on backend");
  }

  return { Authorization: `Bearer ${apiKey}` };
};

const parseJson = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const startImageJob = async ({ prompt, model, ratio }) => {
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeader(),
  };

  const params = new URLSearchParams({
    prompt,
    model,
    ratio,
  });

  const response = await fetch(`${API_BASE}${START_PATH}?${params.toString()}`, {
    method: "GET",
    headers,
  });

  const payload = await parseJson(response);

  if (!response.ok) {
    const detail = payload?.message || payload?.error || `PaxSenix request failed: ${response.status}`;
    throw new Error(detail);
  }

  if (!payload?.jobId && !payload?.task_url) {
    throw new Error("PaxSenix did not return a job id/task URL");
  }

  return payload;
};

const pollTaskStatus = async ({ taskUrl, maxAttempts = 45, intervalMs = 2000 }) => {
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeader(),
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(taskUrl, { method: "GET", headers });
    const payload = await parseJson(response);

    if (!response.ok) {
      const detail = payload?.message || payload?.error || `Task polling failed: ${response.status}`;
      throw new Error(detail);
    }

    const status = String(payload?.status || "").toLowerCase();
    const urls = Array.isArray(payload?.image_urls)
      ? payload.image_urls
      : Array.isArray(payload?.urls)
        ? payload.urls
        : [];

    if (payload?.ok && status === "done" && urls.length > 0) {
      return {
        status,
        urls,
        imageUrl: urls[0],
      };
    }

    if (status === "failed" || status === "error") {
      throw new Error(payload?.message || "Image generation failed");
    }

    if (attempt < maxAttempts) {
      await delay(intervalMs);
    }
  }

  throw new Error("Image generation timed out");
};

export const generateImageFromText = async ({ prompt, model, ratio }) => {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) {
    throw new Error("Prompt is required for image generation");
  }

  const selectedModel = normalizeModel(model);
  const selectedRatio = normalizeRatio(ratio);

  const startPayload = await startImageJob({
    prompt: cleanPrompt,
    model: selectedModel,
    ratio: selectedRatio,
  });

  const taskUrl = startPayload.task_url || `${API_BASE}/task/${startPayload.jobId}`;
  const donePayload = await pollTaskStatus({ taskUrl });

  return {
    jobId: startPayload.jobId || null,
    taskUrl,
    model: selectedModel,
    ratio: selectedRatio,
    prompt: cleanPrompt,
    imageUrl: donePayload.imageUrl,
    urls: donePayload.urls,
  };
};

export { ALLOWED_MODELS, ALLOWED_RATIOS, DEFAULT_MODEL, DEFAULT_RATIO };
