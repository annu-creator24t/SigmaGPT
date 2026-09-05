import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import { getChatResponse, getChatStream, MODELS, PERSONAS } from "../utils/groq.js";
import { telemetry } from "../utils/telemetry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

const TEST_PROMPTS = [
  { prompt: "Explain binary search in 2 sentences.", persona: "general" },
  { prompt: "Write a short JavaScript debounce function.", persona: "coder" },
  { prompt: "Summarize the key benefits of caching in web systems.", persona: "explainer" },
  { prompt: "Give 3 tips on optimizing database query performance.", persona: "mentor" },
  { prompt: "Draft a concise 2-sentence release announcement for a new feature.", persona: "writer" },
];

async function runStreamingBenchmark(modelKey, testItem) {
  const start = Date.now();
  let firstTokenTime = null;
  let fullText = "";
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  try {
    const streamObj = await getChatStream(
      [{ role: "user", content: testItem.prompt }],
      testItem.persona,
      modelKey
    );

    for await (const chunk of streamObj.stream) {
      if (!firstTokenTime) {
        firstTokenTime = Date.now();
      }
      const delta = chunk.choices?.[0]?.delta?.content || "";
      fullText += delta;
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }

    const totalDuration = Date.now() - start;
    const ttft = firstTokenTime ? firstTokenTime - start : totalDuration;
    const promptTokens = usage.prompt_tokens || Math.ceil(testItem.prompt.length / 4);
    const completionTokens = usage.completion_tokens || Math.ceil(fullText.length / 4);
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);
    const tokensPerSec = totalDuration > 0 ? Number(((completionTokens / totalDuration) * 1000).toFixed(1)) : 0;

    telemetry.recordRequest({
      success: true,
      latencyMs: totalDuration,
      ttftMs: ttft,
      promptTokens,
      completionTokens,
      totalTokens,
      model: modelKey,
      persona: testItem.persona,
    });

    return {
      success: true,
      model: modelKey,
      modelName: MODELS[modelKey],
      persona: testItem.persona,
      prompt: testItem.prompt,
      ttftMs: ttft,
      totalDurationMs: totalDuration,
      promptTokens,
      completionTokens,
      totalTokens,
      tokensPerSec,
    };
  } catch (error) {
    const totalDuration = Date.now() - start;
    telemetry.recordRequest({
      success: false,
      latencyMs: totalDuration,
      model: modelKey,
      persona: testItem.persona,
    });
    return {
      success: false,
      model: modelKey,
      modelName: MODELS[modelKey],
      persona: testItem.persona,
      error: error.message,
      totalDurationMs: totalDuration,
    };
  }
}

async function runNonStreamingBenchmark(modelKey, testItem) {
  try {
    const res = await getChatResponse(
      [{ role: "user", content: testItem.prompt }],
      testItem.persona,
      modelKey
    );

    telemetry.recordRequest({
      success: true,
      latencyMs: res.latencyMs,
      promptTokens: res.usage.promptTokens,
      completionTokens: res.usage.completionTokens,
      totalTokens: res.usage.totalTokens,
      model: modelKey,
      persona: testItem.persona,
    });

    const tokensPerSec = res.latencyMs > 0
      ? Number(((res.usage.completionTokens / res.latencyMs) * 1000).toFixed(1))
      : 0;

    return {
      success: true,
      model: modelKey,
      modelName: res.model,
      persona: testItem.persona,
      totalDurationMs: res.latencyMs,
      promptTokens: res.usage.promptTokens,
      completionTokens: res.usage.completionTokens,
      totalTokens: res.usage.totalTokens,
      tokensPerSec,
    };
  } catch (error) {
    return {
      success: false,
      model: modelKey,
      error: error.message,
    };
  }
}

async function runSuite() {
  console.log("==================================================");
  console.log("🚀 STARTING SIGMAGPT SYSTEM BENCHMARK SUITE");
  console.log("==================================================");

  const models = ["fast", "smart", "balanced"];
  const allResults = [];

  for (const model of models) {
    console.log(`\n▶ Benchmarking Model: ${model} (${MODELS[model]})...`);
    for (const test of TEST_PROMPTS) {
      process.stdout.write(`  • [Stream] Persona: ${test.persona} -> `);
      const res = await runStreamingBenchmark(model, test);
      if (res.success) {
        console.log(`✅ TTFT: ${res.ttftMs}ms | Latency: ${res.totalDurationMs}ms | Tokens: ${res.totalTokens} (${res.tokensPerSec} t/s)`);
      } else {
        console.log(`❌ Failed: ${res.error}`);
      }
      allResults.push(res);
      // Brief pause between requests to prevent aggressive rate limiting
      await new Promise(r => setTimeout(r, 400));
    }

    // Also run a non-streaming test
    process.stdout.write(`  • [Non-stream] Persona: general -> `);
    const nonStreamRes = await runNonStreamingBenchmark(model, TEST_PROMPTS[0]);
    if (nonStreamRes.success) {
      console.log(`✅ Latency: ${nonStreamRes.totalDurationMs}ms | Tokens: ${nonStreamRes.totalTokens} (${nonStreamRes.tokensPerSec} t/s)`);
    } else {
      console.log(`❌ Failed: ${nonStreamRes.error}`);
    }
    allResults.push(nonStreamRes);
  }

  // Calculate Aggregates
  const successful = allResults.filter(r => r.success);
  const ttfts = successful.filter(r => r.ttftMs !== undefined).map(r => r.ttftMs);
  const latencies = successful.map(r => r.totalDurationMs);
  const totalTokens = successful.reduce((sum, r) => sum + (r.totalTokens || 0), 0);
  const promptTokens = successful.reduce((sum, r) => sum + (r.promptTokens || 0), 0);
  const completionTokens = successful.reduce((sum, r) => sum + (r.completionTokens || 0), 0);

  const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const percentile = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.ceil((p / 100) * s.length) - 1];
  };

  const benchmarkSummary = {
    totalRuns: allResults.length,
    successfulRuns: successful.length,
    successRatePct: Number(((successful.length / allResults.length) * 100).toFixed(1)),
    ttft: {
      avgMs: avg(ttfts),
      p50Ms: percentile(ttfts, 50),
      p90Ms: percentile(ttfts, 90),
      minMs: ttfts.length ? Math.min(...ttfts) : 0,
      maxMs: ttfts.length ? Math.max(...ttfts) : 0,
    },
    latency: {
      avgMs: avg(latencies),
      p50Ms: percentile(latencies, 50),
      p90Ms: percentile(latencies, 90),
      minMs: latencies.length ? Math.min(...latencies) : 0,
      maxMs: latencies.length ? Math.max(...latencies) : 0,
    },
    tokens: {
      totalTokens,
      promptTokens,
      completionTokens,
      avgTokensPerRun: Math.round(totalTokens / (successful.length || 1)),
    },
    modelBreakdown: models.map(m => {
      const modelRuns = successful.filter(r => r.model === m);
      const modelTtfts = modelRuns.filter(r => r.ttftMs !== undefined).map(r => r.ttftMs);
      const modelLatencies = modelRuns.map(r => r.totalDurationMs);
      return {
        modelKey: m,
        modelName: MODELS[m],
        runs: modelRuns.length,
        avgTtftMs: avg(modelTtfts),
        avgLatencyMs: avg(modelLatencies),
      };
    }),
    timestamp: new Date().toISOString(),
  };

  const outputPath = join(__dirname, "../benchmark_results.json");
  fs.writeFileSync(outputPath, JSON.stringify({ summary: benchmarkSummary, details: allResults }, null, 2));

  console.log("\n==================================================");
  console.log("📊 BENCHMARK COMPLETE - SUMMARY OF EMPIRICAL METRICS");
  console.log("==================================================");
  console.log(`• Success Rate:             ${benchmarkSummary.successRatePct}% (${successful.length}/${allResults.length})`);
  console.log(`• Average TTFT (Stream):    ${benchmarkSummary.ttft.avgMs} ms (p50: ${benchmarkSummary.ttft.p50Ms} ms, p90: ${benchmarkSummary.ttft.p90Ms} ms)`);
  console.log(`• Average Full Latency:     ${benchmarkSummary.latency.avgMs} ms (p50: ${benchmarkSummary.latency.p50Ms} ms)`);
  console.log(`• Total Tokens Processed:   ${benchmarkSummary.tokens.totalTokens} tokens`);
  console.log(`• Fast Model (8B) Avg TTFT: ${benchmarkSummary.modelBreakdown.find(m => m.modelKey === "fast")?.avgTtftMs} ms`);
  console.log(`• Smart Model (70B) Avg TTFT: ${benchmarkSummary.modelBreakdown.find(m => m.modelKey === "smart")?.avgTtftMs} ms`);
  console.log("==================================================\n");

  return benchmarkSummary;
}

runSuite().catch(console.error);
