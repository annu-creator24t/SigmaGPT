import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import { db } from "../config/firebase.js";
import { getAuth } from "firebase-admin/auth";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "../.env") });

async function extractAllMetrics() {
  console.log("==================================================");
  console.log("🔍 EXTRACTING LIVE PRODUCTION & BENCHMARK FIGURES");
  console.log("==================================================");

  let dbData = {
    usersCount: 0,
    verifiedUsersCount: 0,
    threadsCount: 0,
    messagesCount: 0,
    pinnedThreadsCount: 0,
    avgMessagesPerThread: 0,
  };

  try {
    if (db) {
      const usersList = await getAuth().listUsers(1000);
      dbData.usersCount = usersList.users.length;
      dbData.verifiedUsersCount = usersList.users.filter(u => u.emailVerified).length;

      const threadsSnapshot = await db.collection("threads").get();
      dbData.threadsCount = threadsSnapshot.size;

      let pinnedCount = 0;
      threadsSnapshot.forEach(doc => {
        if (doc.data()?.pinned) pinnedCount++;
      });
      dbData.pinnedThreadsCount = pinnedCount;

      const messagesSnapshot = await db.collectionGroup("messages").get();
      dbData.messagesCount = messagesSnapshot.size;

      if (dbData.threadsCount > 0) {
        dbData.avgMessagesPerThread = Number((dbData.messagesCount / dbData.threadsCount).toFixed(1));
      }
    }
  } catch (err) {
    console.warn("⚠️ Firebase live query note:", err.message);
  }

  // Load benchmark results if available
  let benchmarkData = null;
  const benchmarkFile = join(__dirname, "../benchmark_results.json");
  if (fs.existsSync(benchmarkFile)) {
    try {
      benchmarkData = JSON.parse(fs.readFileSync(benchmarkFile, "utf-8")).summary;
    } catch {}
  }

  const verifiedReport = {
    system: "SigmaGPT",
    generatedAt: new Date().toISOString(),
    databaseAndUsers: {
      totalRegisteredUsers: dbData.usersCount,
      verifiedEmailUsers: dbData.verifiedUsersCount,
      totalConversationThreads: dbData.threadsCount,
      totalCloudMessages: dbData.messagesCount,
      pinnedThreads: dbData.pinnedThreadsCount,
      avgMessagesPerConversation: dbData.avgMessagesPerThread,
    },
    performanceAndInference: benchmarkData ? {
      benchmarkSuccessRate: `${benchmarkData.successRatePct}%`,
      avgTimeToFirstTokenMs: benchmarkData.ttft.avgMs,
      p50TimeToFirstTokenMs: benchmarkData.ttft.p50Ms,
      p90TimeToFirstTokenMs: benchmarkData.ttft.p90Ms,
      avgFullResponseLatencyMs: benchmarkData.latency.avgMs,
      p50FullResponseLatencyMs: benchmarkData.latency.p50Ms,
      totalTokensBenchmarked: benchmarkData.tokens.totalTokens,
      avgTokensPerQuery: benchmarkData.tokens.avgTokensPerRun,
      modelBreakdown: benchmarkData.modelBreakdown,
    } : { status: "Run benchmark.js to populate latency & token metrics" },
  };

  const outputPath = join(__dirname, "../verified_figures.json");
  fs.writeFileSync(outputPath, JSON.stringify(verifiedReport, null, 2));

  console.log("\n✅ VERIFIED FIGURES COLLECTED:");
  console.log(JSON.stringify(verifiedReport, null, 2));
  console.log("\nSaved to:", outputPath);

  return verifiedReport;
}

extractAllMetrics().catch(console.error);
