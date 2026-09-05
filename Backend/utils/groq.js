import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// ✅ Create Groq client via OpenAI SDK
const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// ✅ Models (Active high-throughput models on Groq)
export const MODELS = {
  fast: "openai/gpt-oss-20b",
  smart: "openai/gpt-oss-120b",
  balanced: "groq/compound",
};

// ✅ Personas
export const PERSONAS = {
  general: {
    name: "SigmaGPT",
    prompt: `You are SigmaGPT, a highly intelligent and helpful AI assistant.`,
  },
  coder: {
    name: "Sigma Coder",
    prompt: `You are an expert software engineer.`,
  },
  writer: {
    name: "Sigma Writer",
    prompt: `You are a professional content writer.`,
  },
  explainer: {
    name: "Sigma Simplified",
    prompt: `Explain things in simple terms.`,
  },
  mentor: {
    name: "Sigma Mentor",
    prompt: `Give practical advice and guidance.`,
  },
};

// ✅ Clean messages
const cleanMessages = (messages = []) =>
  messages
    .filter(m => m && typeof m.content === "string")
    .map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

// ✅ Normalize title
const normalizeTitle = (title) => {
  return String(title || "")
    .replace(/[`*_#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ") || "New chat";
};

// ✅ Chat response (non-streaming) with token & latency tracking
export const getChatResponse = async (messages, persona = "general", model = "smart") => {
  const startTime = Date.now();
  try {
    const selectedPersona = PERSONAS[persona] || PERSONAS.general;
    const selectedModel = MODELS[model] || MODELS.smart;

    const response = await client.chat.completions.create({
      model: selectedModel,
      messages: [
        { role: "system", content: selectedPersona.prompt },
        ...cleanMessages(messages),
      ],
      temperature: 0.7,
      max_tokens: 1024,
    });

    const latencyMs = Date.now() - startTime;
    const usage = response.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    return {
      content: response.choices[0]?.message?.content || "",
      persona: selectedPersona.name,
      personaKey: persona,
      model: selectedModel,
      modelKey: model,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      },
      latencyMs,
    };

  } catch (error) {
    console.error("❌ Groq Error:", error.message);
    throw new Error("AI response failed");
  }
};

// ✅ Chat response (streaming) with usage options and chunk generator
export const getChatStream = async (messages, persona = "general", model = "smart") => {
  const selectedPersona = PERSONAS[persona] || PERSONAS.general;
  const selectedModel = MODELS[model] || MODELS.smart;

  const stream = await client.chat.completions.create({
    model: selectedModel,
    messages: [
      { role: "system", content: selectedPersona.prompt },
      ...cleanMessages(messages),
    ],
    temperature: 0.7,
    max_tokens: 1024,
    stream: true,
    stream_options: { include_usage: true },
  });

  return {
    stream,
    persona: selectedPersona.name,
    personaKey: persona,
    model: selectedModel,
    modelKey: model,
  };
};

// ✅ Title generation
export const generateChatTitle = async (message) => {
  try {
    const res = await client.chat.completions.create({
      model: MODELS.fast,
      messages: [
        { role: "system", content: "Generate a 3-4 word title." },
        { role: "user", content: message },
      ],
      max_tokens: 20,
    });

    return normalizeTitle(res.choices[0]?.message?.content);

  } catch {
    return "New chat";
  }
};

// ✅ Debug
console.log("GROQ KEY:", process.env.GROQ_API_KEY ? "Loaded ✅" : "Missing ❌");

export default client;