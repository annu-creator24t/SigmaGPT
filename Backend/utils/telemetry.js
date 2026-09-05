import { db } from "../config/firebase.js";
import { getAuth } from "firebase-admin/auth";

class TelemetryTracker {
  constructor() {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.latencies = []; // Rolling window (max 1000)
    this.ttftLatencies = []; // Rolling window (max 1000)
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalTokens = 0;
    this.modelUsage = {
      smart: 0,
      fast: 0,
      balanced: 0,
    };
    this.personaUsage = {
      general: 0,
      coder: 0,
      writer: 0,
      explainer: 0,
      mentor: 0,
    };
    this.startTime = Date.now();
  }

  recordRequest({
    success = true,
    latencyMs = 0,
    ttftMs = null,
    promptTokens = 0,
    completionTokens = 0,
    totalTokens = 0,
    model = "smart",
    persona = "general",
  }) {
    this.totalRequests++;
    if (success) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
    }

    if (latencyMs > 0) {
      this.latencies.push(latencyMs);
      if (this.latencies.length > 1000) this.latencies.shift();
    }

    if (ttftMs && ttftMs > 0) {
      this.ttftLatencies.push(ttftMs);
      if (this.ttftLatencies.length > 1000) this.ttftLatencies.shift();
    }

    this.totalPromptTokens += Number(promptTokens) || 0;
    this.totalCompletionTokens += Number(completionTokens) || 0;
    this.totalTokens += Number(totalTokens) || 0;

    if (model && this.modelUsage[model] !== undefined) {
      this.modelUsage[model]++;
    } else if (model) {
      this.modelUsage[model] = (this.modelUsage[model] || 0) + 1;
    }

    if (persona && this.personaUsage[persona] !== undefined) {
      this.personaUsage[persona]++;
    } else if (persona) {
      this.personaUsage[persona] = (this.personaUsage[persona] || 0) + 1;
    }
  }

  getPercentile(arr, p) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  getAverage(arr) {
    if (!arr || arr.length === 0) return 0;
    return Math.round(arr.reduce((sum, val) => sum + val, 0) / arr.length);
  }

  async getSnapshot() {
    let dbStats = {
      totalRegisteredUsers: 0,
      verifiedUsers: 0,
      totalThreads: 0,
      totalMessages: 0,
      avgMessagesPerThread: 0,
    };

    try {
      if (db) {
        const usersRecord = await getAuth().listUsers(1000).catch(() => ({ users: [] }));
        dbStats.totalRegisteredUsers = usersRecord.users.length;
        dbStats.verifiedUsers = usersRecord.users.filter((u) => u.emailVerified).length;

        const threadsSnap = await db.collection("threads").count().get().catch(() => ({ data: () => ({ count: 0 }) }));
        dbStats.totalThreads = threadsSnap.data().count;

        const messagesSnap = await db.collectionGroup("messages").count().get().catch(() => ({ data: () => ({ count: 0 }) }));
        dbStats.totalMessages = messagesSnap.data().count;

        if (dbStats.totalThreads > 0) {
          dbStats.avgMessagesPerThread = Number((dbStats.totalMessages / dbStats.totalThreads).toFixed(1));
        }
      }
    } catch (err) {
      console.warn("⚠️ Telemetry db stats warning:", err.message);
    }

    const successRatePct = this.totalRequests > 0
      ? Number(((this.successfulRequests / this.totalRequests) * 100).toFixed(2))
      : 100;

    const errorRatePct = this.totalRequests > 0
      ? Number(((this.failedRequests / this.totalRequests) * 100).toFixed(2))
      : 0;

    return {
      runtime: {
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        totalRequests: this.totalRequests,
        successfulRequests: this.successfulRequests,
        failedRequests: this.failedRequests,
        successRate: `${successRatePct}%`,
        errorRate: `${errorRatePct}%`,
      },
      latency: {
        sampleSize: this.latencies.length,
        avgLatencyMs: this.getAverage(this.latencies),
        p50LatencyMs: this.getPercentile(this.latencies, 50),
        p90LatencyMs: this.getPercentile(this.latencies, 90),
        p95LatencyMs: this.getPercentile(this.latencies, 95),
        minLatencyMs: this.latencies.length ? Math.min(...this.latencies) : 0,
        maxLatencyMs: this.latencies.length ? Math.max(...this.latencies) : 0,
      },
      timeToFirstToken: {
        sampleSize: this.ttftLatencies.length,
        avgTtftMs: this.getAverage(this.ttftLatencies),
        p50TtftMs: this.getPercentile(this.ttftLatencies, 50),
        p90TtftMs: this.getPercentile(this.ttftLatencies, 90),
        p95TtftMs: this.getPercentile(this.ttftLatencies, 95),
      },
      tokens: {
        totalPromptTokens: this.totalPromptTokens,
        totalCompletionTokens: this.totalCompletionTokens,
        totalTokens: this.totalTokens,
        avgTokensPerRequest: this.successfulRequests > 0
          ? Math.round(this.totalTokens / this.successfulRequests)
          : 0,
      },
      distribution: {
        models: this.modelUsage,
        personas: this.personaUsage,
      },
      database: dbStats,
      timestamp: new Date().toISOString(),
    };
  }
}

export const telemetry = new TelemetryTracker();
