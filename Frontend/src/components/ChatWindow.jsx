import "./ChatWindow.css";
import Chat from "./Chat.jsx";
import { MyContext } from "../context/MyContext.jsx";
import { useContext, useState, useRef, useEffect } from "react";
import { ScaleLoader } from "react-spinners";
import toast from "react-hot-toast";
import {
  Send, Mic, MicOff, Download, FileText, FileDown,
  MoreVertical, Trash2, RefreshCw, Menu,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { getAuthHeaders } from "../utils/authSession.js";
import { requestTextToImage } from "../utils/aiClient.js";

const API_BASE   = import.meta.env.VITE_API_URL || "http://localhost:5000";
const CHAT_URL   = `${API_BASE}/api/chat/chat`;
const THREADS_URL = `${API_BASE}/api/chat/threads`;

const hasAuthHeaders = (headers) =>
  Boolean(headers.Authorization || headers["X-Guest-Id"]);

const IMAGE_MODEL = "nano-banana-2";
const IMAGE_RATIO = "9:16";

const COMMANDS = [
  {
    id: "image",
    command: "/image",
    description: "Generate an image from text",
  },
];

const parseImageCommand = (rawText) => {
  const text = String(rawText || "").trim();
  if (!text.toLowerCase().startsWith("/image")) return null;

  return {
    prompt: text.slice(6).trim(),
  };
};

function ChatWindow() {
  const {
    prompt, setPrompt,
    currThreadId,
    prevChats, setPrevChats,
    setIsNewChat,
    isLoading, setIsLoading,
    selectedPersona, selectedModel,
    isListening, setIsListening,
    isOnline,
    startNewChat,
    isSidebarOpen, setIsSidebarOpen,
    allThreads, setAllThreads,
    currentChatTitle,
    isLoadingConversation,
  } = useContext(MyContext);

  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu]     = useState(false);
  const chatBodyRef    = useRef(null);
  const inputRef       = useRef(null);
  const recognitionRef = useRef(null);

  const trimmedPrompt = prompt.trimStart();
  const showCommandSuggestions = trimmedPrompt.startsWith("/") && !trimmedPrompt.startsWith("/image");

  // ✅ Auto scroll to bottom
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [prevChats, isLoadingConversation]);

  // ✅ Send message with streaming
  const getReply = async (overridePrompt) => {
    const text = (overridePrompt || prompt).trim();
    const imageCommand = parseImageCommand(text);
    if (!text || isLoading) return;
    if (!isOnline) { toast.error("You're offline!"); return; }

    if (imageCommand) {
      if (!imageCommand.prompt) {
        toast.error("Usage: /image your prompt");
        return;
      }

      setIsLoading(true);
      setIsNewChat(false);
      setPrompt("");

      setPrevChats(prev => [
        ...prev,
        { role: "user", content: text, timestamp: new Date().toISOString() },
        { role: "assistant", content: "Generating image...", timestamp: new Date().toISOString(), persona: "image" },
      ]);

      try {
        const result = await requestTextToImage({
          prompt: imageCommand.prompt,
          threadId: currThreadId,
          model: IMAGE_MODEL,
          ratio: IMAGE_RATIO,
        });

        const content = result.content || [
          `Generated image (${result.model || IMAGE_MODEL}, ${result.ratio || IMAGE_RATIO}):`,
          "",
          `![Generated image](${result.imageUrl})`,
          "",
          `[Open image](${result.imageUrl})`,
        ].join("\n");

        setPrevChats(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content,
            persona: "image",
          };
          return updated;
        });

        try {
          const threadHeaders = await getAuthHeaders();
          const res = await fetch(THREADS_URL, { headers: threadHeaders });
          if (res.ok) {
            const threads = await res.json();
            setAllThreads(Array.isArray(threads) ? threads : []);
          }
        } catch {}

        toast.success("Image generated!");
      } catch (err) {
        const message = err?.message || "Image generation failed";
        setPrevChats(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: `Image generation failed: ${message}`,
            persona: "image",
          };
          return updated;
        });
        toast.error(message);
      }

      setIsLoading(false);
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setIsNewChat(false);
    setPrompt("");

    // Add user + empty assistant placeholder
    setPrevChats(prev => [
      ...prev,
      { role: "user", content: text, timestamp: new Date().toISOString() },
      { role: "assistant", content: "", timestamp: new Date().toISOString(), persona: selectedPersona },
    ]);

    try {
      const headers = await getAuthHeaders({
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      });
      if (!hasAuthHeaders(headers)) {
        throw new Error("No auth session");
      }

      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: text,
          threadId: currThreadId,
          persona: selectedPersona,
          model: selectedModel,
        }),
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.chunk) {
              setPrevChats(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, content: last.content + data.chunk };
                return updated;
              });
            }

            if (data.done) {
              try {
                const threadHeaders = await getAuthHeaders();
                const res = await fetch(THREADS_URL, { headers: threadHeaders });
                if (res.ok) {
                  const threads = await res.json();
                  setAllThreads(Array.isArray(threads) ? threads : []);
                }
              } catch {}
            }
          } catch {}
        }
      }

    } catch (err) {
      console.error("Chat error:", err);
      toast.error("Failed to get response. Try again!");
      setPrevChats(prev => prev.slice(0, -1));
    }

    setIsLoading(false);
    inputRef.current?.focus();
  };

  // ✅ Voice input
  const toggleVoice = () => {
    if (!("SpeechRecognition" in window || "webkitSpeechRecognition" in window)) {
      toast.error("Voice not supported in this browser!");
      return;
    }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      setPrompt(e.results[0][0].transcript);
      setIsListening(false);
      toast.success("Voice captured!");
    };
    recognition.onerror = () => { setIsListening(false); toast.error("Voice failed!"); };
    recognition.onend   = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  // ✅ Export TXT
  const exportTXT = () => {
    if (!prevChats.length) { toast.error("No chat to export!"); return; }
    const lines = prevChats.map(c => {
      const who  = c.role === "user" ? "You" : "SigmaGPT";
      const time = c.timestamp ? new Date(c.timestamp).toLocaleString() : "";
      return `[${time}] ${who}:\n${c.content}\n`;
    });
    const text = `SigmaGPT Chat Export\nExported: ${new Date().toLocaleString()}\n${"─".repeat(40)}\n\n${lines.join("\n")}`;
    const blob = new Blob([text], { type: "text/plain" });
    const a    = document.createElement("a");
    a.href     = URL.createObjectURL(blob);
    a.download = `sigmagpt-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Exported as TXT!");
    setShowExportMenu(false);
  };

  // ✅ Export PDF
  const exportPDF = () => {
    if (!prevChats.length) { toast.error("No chat to export!"); return; }
    try {
      const doc   = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();
      let y = 20;

      doc.setFontSize(18); doc.setTextColor(124, 58, 237);
      doc.text("ΣigmaGPT", 20, y); y += 8;

      doc.setFontSize(9); doc.setTextColor(120, 120, 120);
      doc.text(`Exported: ${new Date().toLocaleString()}`, 20, y); y += 10;

      doc.setDrawColor(200, 200, 200);
      doc.line(20, y, pageW - 20, y); y += 10;

      prevChats.forEach(chat => {
        const who  = chat.role === "user" ? "You" : "SigmaGPT";
        const time = chat.timestamp
          ? new Date(chat.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
          : "";

        doc.setFontSize(9); doc.setTextColor(124, 58, 237);
        doc.text(`${who}  ${time}`, 20, y); y += 6;

        doc.setFontSize(10); doc.setTextColor(30, 30, 30);
        const clean = chat.content.replace(/[#*`_~]/g, "");
        const lines = doc.splitTextToSize(clean, pageW - 40);
        if (y + lines.length * 5 > 275) { doc.addPage(); y = 20; }
        doc.text(lines, 20, y);
        y += lines.length * 5 + 8;
      });

      doc.setFontSize(8); doc.setTextColor(150, 150, 150);
      doc.text("Powered by SigmaGPT + Groq", 20, 290);
      doc.save(`sigmagpt-${Date.now()}.pdf`);
      toast.success("Exported as PDF!");
    } catch { toast.error("PDF export failed!"); }
    setShowExportMenu(false);
  };

  // ✅ Clear all chats
  const clearChat = async () => {
    setShowMoreMenu(false);
    if (!window.confirm("Clear all chats? This cannot be undone.")) return;
    try {
      const headers = await getAuthHeaders();
      await fetch(THREADS_URL, { method: "DELETE", headers });
      startNewChat();
      setAllThreads([]);
      toast.success("All chats cleared!");
    } catch { toast.error("Failed to clear chats!"); }
  };

  const handleQuickPrompt = (text) => {
    setPrompt(text);
    inputRef.current?.focus();
  };

  const currentPersonaName = {
    general: "SigmaGPT", coder: "Sigma Coder",
    writer: "Sigma Writer", explainer: "Sigma Simplified", mentor: "Sigma Mentor",
  }[selectedPersona] || "SigmaGPT";

  const currentModelLabel = { smart: "Smart", fast: "Fast", balanced: "Balanced" }[selectedModel] || "Smart";

  return (
    <div className="chatWindow">

      {/* ── Navbar ── */}
      <div className="navbar">
        <div className="navLeft">
          {!isSidebarOpen && (
            <button className="navIconBtn" onClick={() => setIsSidebarOpen(true)} title="Open sidebar">
              <Menu size={18} />
            </button>
          )}
          <div className="navTitle">
            <span className="navName">{currentChatTitle || currentPersonaName}</span>
            <span className="navModel">{currentModelLabel} · Groq</span>
          </div>
        </div>

        <div className="navRight">
          {/* Export dropdown */}
          <div className="navDropdownWrap">
            <button className="navIconBtn" title="Export chat"
              onClick={() => { setShowExportMenu(!showExportMenu); setShowMoreMenu(false); }}>
              <Download size={17} />
            </button>
            {showExportMenu && (
              <div className="navDropdown">
                <button onClick={exportTXT}><FileText size={14} /> Export as TXT</button>
                <button onClick={exportPDF}><FileDown size={14} /> Export as PDF</button>
              </div>
            )}
          </div>

          {/* More dropdown */}
          <div className="navDropdownWrap">
            <button className="navIconBtn" title="More options"
              onClick={() => { setShowMoreMenu(!showMoreMenu); setShowExportMenu(false); }}>
              <MoreVertical size={17} />
            </button>
            {showMoreMenu && (
              <div className="navDropdown">
                <button onClick={() => { startNewChat(); setShowMoreMenu(false); }}>
                  <RefreshCw size={14} /> New Chat
                </button>
                <button className="danger" onClick={clearChat}>
                  <Trash2 size={14} /> Clear All Chats
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Chat body ── */}
      <div className="chatBody" ref={chatBodyRef}
        onClick={() => { setShowExportMenu(false); setShowMoreMenu(false); }}>
        {isLoadingConversation ? (
          <div className="chatSkeleton">
            <div className="skeletonLine short" />
            <div className="skeletonBubble" />
            <div className="skeletonBubble right" />
            <div className="skeletonBubble" />
          </div>
        ) : (
          <Chat onQuickPrompt={handleQuickPrompt} />
        )}
      </div>

      {/* ── Loading indicator ── */}
      {isLoading && (
        <div className="loadingBar">
          <ScaleLoader color="var(--accent)" height={18} width={2} radius={2} margin={2} />
          <span>SigmaGPT is thinking...</span>
        </div>
      )}

      {/* ── Input area ── */}
      <div className="inputArea">
        <div className="inputBox">
          <button
            className={`inputIconBtn ${isListening ? "listening" : ""}`}
            onClick={toggleVoice}
            title={isListening ? "Stop listening" : "Voice input"}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          <textarea
            ref={inputRef}
            className="chatTextarea"
            placeholder={isListening ? "🎙 Listening..." : "Ask SigmaGPT anything..."}
            value={prompt}
            rows={1}
            onChange={e => {
              setPrompt(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); getReply(); }
            }}
          />

          <button
            className={`sendBtn ${prompt.trim() && !isLoading ? "active" : ""}`}
            onClick={() => getReply()}
            disabled={!prompt.trim() || isLoading}
            title="Send (Enter)"
          >
            <Send size={17} />
          </button>
        </div>

        {showCommandSuggestions && (
          <div className="commandSuggestions" role="listbox" aria-label="Command suggestions">
            {COMMANDS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="commandSuggestionBtn"
                onClick={() => {
                  setPrompt(`${item.command} `);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <span className="commandSuggestionCmd">{item.command}</span>
                <span className="commandSuggestionDesc">{item.description}</span>
              </button>
            ))}
          </div>
        )}

        <p className="inputHint">
          Press <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line · Type <kbd>/</kbd> for commands · <kbd>/image</kbd> uses nano-banana-2 (9:16)
        </p>
      </div>
    </div>
  );
}

export default ChatWindow;