import express from "express";
import "dotenv/config";
import cors from "cors";
import chatRoutes from "./routes/chat.js";
import { authMiddleware } from "./middleware/auth.js";
import { telemetry } from "./utils/telemetry.js";

const app  = express();
const PORT = process.env.PORT || 8080;

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:4173",
  "https://sigma-gpt-4m1p.vercel.app",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.endsWith(".vercel.app")) return callback(null, true);
    if (origin.startsWith("http://localhost")) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
}));

app.use(express.json({ limit: "1mb" }));

// Public metrics endpoint
app.get("/api/metrics", async (req, res) => {
  try {
    const snapshot = await telemetry.getSnapshot();
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: "Could not retrieve metrics" });
  }
});

app.use("/api/chat", authMiddleware, chatRoutes);

app.get("/", (req, res) => {
  res.json({ status: "SigmaGPT running" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.use((err, req, res, next) => {
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));