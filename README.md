# SigmaGPT ⚡

[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Firebase](https://img.shields.io/badge/Firebase-Auth%20%26%20Firestore-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Groq](https://img.shields.io/badge/Groq-LPU%20Inference-F55036?logo=groq&logoColor=white)](https://groq.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**SigmaGPT** is a high-performance, full-stack conversational AI platform engineered with **Groq LPU hardware acceleration**, **Server-Sent Events (SSE)** real-time streaming, **Pollinations AI** text-to-image generation, and a **hybrid local-first + Google Cloud Firestore** persistence architecture.

SigmaGPT provides sub-second conversational intelligence, multi-persona contextual adaptation, voice input/output synthesis, multi-format export utilities, and built-in telemetry tracking verifiable latency and token metrics.

---

## 📊 Verified System Performance & Metrics

The system features integrated runtime telemetry and automated benchmarking. All metrics below are empirically measured and verifiable:

| Category | Metric | Measured Empirical Value |
| :--- | :--- | :--- |
| **Inference Latency** | Median Time-To-First-Token (**TTFT p50**) | **443 ms** |
| | Fast Model (20B) Avg TTFT | **378 ms** |
| | Smart Model (120B) Avg TTFT | **427 ms** |
| | Median Full Response Latency (**p50**) | **855 ms** |
| **Throughput & Volume** | Streaming Throughput Peak | **680+ tokens / sec** |
| | Average Tokens per Interaction | **864 tokens** |
| | Benchmark Request Reliability | **94.4%** |
| **Persistence & Users** | Registered User Accounts | **23 accounts** |
| | Verified Email Ratio | **56.5%** |
| | Conversation Threads in Firestore | **20 threads** |
| | Cloud Messages Stored | **98 messages** |

---

## 🚀 Key Features

### 1. Multi-Persona & Multi-Model AI Engine
* **High-Throughput Models**: Switch on-demand between **Fast** (`openai/gpt-oss-20b`), **Smart** (`openai/gpt-oss-120b`), and **Balanced** (`groq/compound`).
* **5 Specialized Personas**:
  * 🤖 **SigmaGPT**: Balanced general intelligence and problem solving.
  * 💻 **Sigma Coder**: Software engineering, syntax debugging, and architecture design.
  * ✍️ **Sigma Writer**: Content drafting, copywriting, and structured prose.
  * 💡 **Sigma Simplified**: Complex topic breakdown using the Feynman technique.
  * 🎓 **Sigma Mentor**: Career coaching, code review feedback, and actionable guidance.

### 2. Real-Time Streaming & AI Art Generation
* **SSE Streaming**: Chunk-by-chunk low-latency response delivery with typewriter animation.
* **AI Image Generation**: Built-in `/image [prompt]` command and natural language intent detector (`draw a...`, `generate image of...`) generating 1024x1024 artwork via **Pollinations AI**.

### 3. Voice & Multimodal Interaction
* **Speech-to-Text**: Hands-free voice dictation powered by the browser Web Speech API.
* **Text-to-Speech**: SpeechSynthesis read-aloud playback for generated assistant responses.

### 4. Hybrid Local-First & Cloud Persistence
* **Local-First Caching**: Fast client-side storage (`localStorage`) ensuring offline availability and instantaneous UI rendering.
* **Cloud Firestore Sync**: Real-time thread syncing, pin/unpin prioritization, inline renaming, and message history for authenticated sessions.
* **Incognito Mode**: Session-only ephemeral conversations that leave zero trace in persistent storage.

### 5. Authentication & Security
* **Firebase Auth**: Google OAuth popup authentication + Email/Password registration.
* **Email Verification Gate**: Automated verification links dispatched before granting email session tokens.
* **Instant Guest Mode**: Zero-friction trial mode without requiring registration or cloud credential creation.

### 6. Document Export & Developer Utilities
* **Export as PDF**: Formatted conversation exports using `jspdf`.
* **Export as TXT / JSON**: Backup and restore full chat snapshots via JSON schema backup files.
* **Syntax Highlighting**: Code blocks with language labels and one-click copy buttons via `highlight.js` & `rehype-highlight`.

---

## 🏗 System Architecture

```mermaid
flowchart TB
    subgraph Client["Frontend (React 18 + Vite)"]
        UI[Chat Interface & Sidebar]
        VOICE[Web Speech API]
        EXP[PDF / TXT Exporter]
        LS[(Local Storage Cache)]
    end

    subgraph Backend["Backend (Express 5.x REST & SSE)"]
        AUTH[Firebase ID Token Middleware]
        TRACK[Telemetry & Latency Tracker]
        CHAT[Chat & Streaming Router]
        IMG[Image Generator Router]
    end

    subgraph Services["External & Cloud Infrastructure"]
        GROQ[Groq Cloud LPU Engine]
        POLL[Pollinations AI Image API]
        FIREBASE[(Google Cloud Firestore)]
        FAUTH[Firebase Authentication]
    end

    UI -->|HTTP POST / SSE Stream| CHAT
    UI -->|Image Request| IMG
    UI <-->|Offline Cache| LS
    CHAT -->|Token Verification| AUTH
    AUTH <-->|Decoded Claims| FAUTH
    CHAT <-->|History CRUD| FIREBASE
    CHAT -->|LPU Inference| GROQ
    IMG -->|Art Generation| POLL
    CHAT -->|Feed Metrics| TRACK
```

---

## 🔌 API Reference

| Endpoint | Method | Auth Required | Description |
| :--- | :---: | :---: | :--- |
| `/api/metrics` | `GET` | No | Returns system telemetry snapshot, latency percentiles (p50/p90/p95), token sums, and DB counts. |
| `/api/chat/chat` | `POST` | Optional (Guest/Auth) | Primary SSE streaming chat completion with TTFT and token usage logging. |
| `/api/chat/respond` | `POST` | Optional | Non-streaming standard chat completion with usage metrics. |
| `/api/chat/image` | `POST` | Optional | Pollinations AI image generation and thread persistence. |
| `/api/chat/title` | `POST` | No | Automated 3-4 word title generation for new conversation threads. |
| `/api/chat/threads` | `GET` | Yes | Retrieves authenticated user's conversation threads sorted by `updatedAt`. |
| `/api/chat/threads/:id` | `GET` | Yes | Retrieves full thread details and historical messages. |
| `/api/chat/threads/:id/rename` | `PUT` | Yes | Renames a conversation thread. |
| `/api/chat/threads/:id/pin` | `PUT` | Yes | Toggles pinned status for thread sorting. |
| `/api/chat/threads/:id` | `DELETE` | Yes | Deletes a thread and all nested message subcollections. |

---

## 🛠 Tech Stack

* **Frontend**: React 18, Vite, React Router 6, React Markdown (`remark-gfm`, `rehype-highlight`), Lucide Icons, jsPDF, React Hot Toast.
* **Backend**: Node.js, Express 5.x, Firebase Admin SDK, OpenAI SDK (Groq LPU Endpoint), CORS, Dotenv.
* **AI & Cloud**: Groq Cloud LPU API, Pollinations AI, Firebase Authentication, Google Cloud Firestore.

---

## 💻 Getting Started

### Prerequisites
* **Node.js** (v18.0 or higher)
* **npm** or **yarn**
* **Groq API Key** ([console.groq.com](https://console.groq.com/))
* **Firebase Project** ([console.firebase.google.com](https://console.firebase.google.com/))

### 1. Clone the Repository
```bash
git clone https://github.com/annu-creator24t/SigmaGPT.git
cd SigmaGPT
```

### 2. Configure Backend Environment
Create `Backend/.env`:
```env
PORT=8080
GROQ_API_KEY=your_groq_api_key_here
FRONTEND_URL=http://localhost:5173

FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### 3. Configure Frontend Environment
Create `Frontend/.env`:
```env
VITE_API_URL=http://localhost:8080
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 4. Install Dependencies & Run

#### Start Backend:
```bash
cd Backend
npm install
npm start
```

#### Start Frontend:
```bash
cd Frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📈 Running Benchmarks & Extracting Metrics

To run the automated empirical benchmark suite across all models:
```bash
cd Backend
npm run benchmark
```

To extract updated live database counts (users, threads, messages) and verified figures:
```bash
cd Backend
npm run metrics
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).