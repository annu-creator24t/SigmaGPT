import "./ChatWindow.css";
import Chat from "./Chat.jsx";
import { MyContext } from "../context/MyContext.jsx";
import { useContext, useState, useRef, useEffect } from "react";
import { ScaleLoader } from "react-spinners";
import toast from "react-hot-toast";
import {
  Send, Mic, MicOff, Download, FileText, FileDown,
  MoreVertical, Trash2, RefreshCw, Menu, Image,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { getIdToken } from "../utils/firebase.js";

const API_BASE    = import.meta.env.VITE_API_URL || "http://localhost:8080";
const CHAT_URL    = `${API_BASE}/api/chat/chat`;
const IMAGE_URL   = `${API_BASE}/api/chat/image`;
const THREADS_URL = `${API_BASE}/api/chat/threads`;

// ✅ Image intent keywords — user doesn't need to type /image
const IMAGE_KEYWORDS = [
  "/image", "generate image", "generate a image", "generate an image",
  "create image", "create a image", "create an image",
  "draw ", "draw a ", "draw an ",
  "make image", "make a image", "make an image",
  "show image", "show a ", "paint ",
  "illustrate", "sketch ", "render ",
  "generate a photo", "create a photo",
  "image of ", "picture of ", "photo of ",
];

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

  const [showExportMenu, setShowExportMenu]       = useState(false);
  const [showMoreMenu, setShowMoreMenu]           = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const chatBodyRef    = useRef(null);
  const inputRef       = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [prevChats, isLoadingConversation]);

  const isBusy = isLoading || isGeneratingImage;

  // ✅ Detect if message is image intent
  const detectImageIntent = (text) => {
    const lower = text.toLowerCase();
    return IMAGE_KEYWORDS.some(kw => lower.startsWith(kw) || lower.includes(kw));
  };

  // ✅ Get clean image prompt (remove command prefix if any)
  const getImagePrompt = (text) => {
    if (text.startsWith("/image ")) return text.slice(7).trim();
    return text.trim();
  };

  // ✅ Main send handler
  const handleSend = async (overridePrompt) => {
    const text = (overridePrompt || prompt).trim();
    if (!text || isBusy) return;

    if (detectImageIntent(text)) {
      await generateImage(getImagePrompt(text));
    } else {
      await getReply(text);
    }
  };

  // ✅ Image generation using Pollinations AI
  const generateImage = async (imagePrompt) => {
    if (!isOnline) { toast.error("You're offline!"); return; }
    setIsGeneratingImage(true);
    setIsNewChat(false);
    setPrompt("");

    setPrevChats(prev => [
      ...prev,
      { role: "user", content: imagePrompt, timestamp: new Date().toISOString() },
      { role: "assistant", content: "", isImage: true, isGenerating: true, timestamp: new Date().toISOString(), persona: "general" },
    ]);

    try {
      const token = await getIdToken();
      const res = await fetch(IMAGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: imagePrompt, threadId: currThreadId }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Image generation failed");

      setPrevChats(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `Generated image for: "${imagePrompt}"`,
          imageUrl: data.imageUrl,
          isImage: true,
          isGenerating: false,
          timestamp: new Date().toISOString(),
          persona: "general",
        };
        return updated;
      });

      // Refresh threads
      try {
        const t = await getIdToken();
        const r = await fetch(THREADS_URL, { headers: { Authorization: `Bearer ${t}` } });
        if (r.ok) setAllThreads(await r.json());
      } catch {}

      toast.success("Image generated! 🎨");
    } catch (err) {
      toast.error(err.message || "Image generation failed!");
      setPrevChats(prev => prev.slice(0, -1));
    }

    setIsGeneratingImage(false);
    inputRef.current?.focus();
  };

  // ✅ Regular chat
  const getReply = async (text) => {
    if (!isOnline) { toast.error("You're offline!"); return; }
    setIsLoading(true);
    setIsNewChat(false);
    setPrompt("");

    setPrevChats(prev => [
      ...prev,
      { role: "user", content: text, timestamp: new Date().toISOString() },
      { role: "assistant", content: "", timestamp: new Date().toISOString(), persona: selectedPersona },
    ]);

    try {
      const token = await getIdToken();
      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, threadId: currThreadId, persona: selectedPersona, model: selectedModel }),
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

      const reader = response.body.getReader();
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
                const t = await getIdToken();
                const r = await fetch(THREADS_URL, { headers: { Authorization: `Bearer ${t}` } });
                if (r.ok) setAllThreads(await r.json());
              } catch {}
            }
          } catch {}
        }
      }
    } catch (err) {
      toast.error("Failed to get response. Try again!");
      setPrevChats(prev => prev.slice(0, -1));
    }

    setIsLoading(false);
    inputRef.current?.focus();
  };

  const toggleVoice = () => {
    if (!("SpeechRecognition" in window || "webkitSpeechRecognition" in window)) { toast.error("Voice not supported!"); return; }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (e) => { setPrompt(e.results[0][0].transcript); setIsListening(false); toast.success("Voice captured!"); };
    recognition.onerror = () => { setIsListening(false); toast.error("Voice failed!"); };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const exportTXT = () => {
    if (!prevChats.length) { toast.error("No chat to export!"); return; }
    const lines = prevChats.map(c => {
      const who = c.role === "user" ? "You" : "SigmaGPT";
      const time = c.timestamp ? new Date(c.timestamp).toLocaleString() : "";
      const content = c.isImage ? `[Image] ${c.imageUrl || ""}` : c.content;
      return `[${time}] ${who}:\n${content}\n`;
    });
    const blob = new Blob([`SigmaGPT Chat Export\n${new Date().toLocaleString()}\n\n${lines.join("\n")}`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sigmagpt-${Date.now()}.txt`;
    a.click();
    toast.success("Exported as TXT!");
    setShowExportMenu(false);
  };

  const exportPDF = () => {
    if (!prevChats.length) { toast.error("No chat to export!"); return; }
    try {
      const doc = new jsPDF();
      const pageW = doc.internal.pageSize.getWidth();
      let y = 20;
      doc.setFontSize(18); doc.setTextColor(124, 58, 237);
      doc.text("SigmaGPT", 20, y); y += 16;
      prevChats.forEach(chat => {
        const who = chat.role === "user" ? "You" : "SigmaGPT";
        doc.setFontSize(9); doc.setTextColor(124, 58, 237);
        doc.text(who, 20, y); y += 6;
        doc.setFontSize(10); doc.setTextColor(30, 30, 30);
        const content = chat.isImage ? `[Image] ${chat.imageUrl || ""}` : chat.content.replace(/[#*`_~]/g, "");
        const lines = doc.splitTextToSize(content, pageW - 40);
        if (y + lines.length * 5 > 275) { doc.addPage(); y = 20; }
        doc.text(lines, 20, y);
        y += lines.length * 5 + 8;
      });
      doc.save(`sigmagpt-${Date.now()}.pdf`);
      toast.success("Exported as PDF!");
    } catch { toast.error("PDF export failed!"); }
    setShowExportMenu(false);
  };

  const clearChat = async () => {
    setShowMoreMenu(false);
    if (!window.confirm("Clear all chats?")) return;
    try {
      const token = await getIdToken();
      await fetch(THREADS_URL, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      startNewChat(); setAllThreads([]);
      toast.success("All chats cleared!");
    } catch { toast.error("Failed to clear chats!"); }
  };

  const currentPersonaName = { general: "SigmaGPT", coder: "Sigma Coder", writer: "Sigma Writer", explainer: "Sigma Simplified", mentor: "Sigma Mentor" }[selectedPersona] || "SigmaGPT";
  const currentModelLabel  = { smart: "Smart", fast: "Fast", balanced: "Balanced" }[selectedModel] || "Smart";
  const isImageMode = detectImageIntent(prompt);

  return (
    <div className="chatWindow">
      {/* ── Navbar ── */}
      <div className="navbar">
        <div className="navLeft">
          {!isSidebarOpen && (
            <button className="navIconBtn" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={18} />
            </button>
          )}
          <div className="navTitle">
            <span className="navName">{currentChatTitle || currentPersonaName}</span>
            <span className="navModel">{currentModelLabel} · Groq</span>
          </div>
        </div>

        <div className="navRight">
          <div className="navDropdownWrap">
            <button className="navIconBtn" title="Export"
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

          <div className="navDropdownWrap">
            <button className="navIconBtn" title="More"
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
          </div>
        ) : (
          <Chat onQuickPrompt={(t) => { setPrompt(t); inputRef.current?.focus(); }} />
        )}
      </div>

      {/* ── Loading bars ── */}
      {isLoading && (
        <div className="loadingBar">
          <ScaleLoader color="var(--accent)" height={18} width={2} radius={2} margin={2} />
          <span>SigmaGPT is thinking...</span>
        </div>
      )}
      {isGeneratingImage && (
        <div className="loadingBar" style={{ color: "#f59e0b" }}>
          <ScaleLoader color="#f59e0b" height={18} width={2} radius={2} margin={2} />
          <span>🎨 Generating your image...</span>
        </div>
      )}

      {/* ── Image mode indicator ── */}
      {isImageMode && !isBusy && (
        <div className="imageSettingsBar">
          <Image size={14} />
          <span>Image generation mode · Powered by Pollinations AI</span>
        </div>
      )}

      {/* ── Input area ── */}
      <div className="inputArea">
        <div className={`inputBox ${isImageMode ? "imageMode" : ""}`}>
          <button className={`inputIconBtn ${isListening ? "listening" : ""}`} onClick={toggleVoice}>
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          <textarea
            ref={inputRef}
            className="chatTextarea"
            placeholder={isListening ? "🎙 Listening..." : "Ask anything · Say 'draw a cat' or 'generate image of...' for images"}
            value={prompt}
            rows={1}
            onChange={e => {
              setPrompt(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
            }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />

          <button
            className={`sendBtn ${prompt.trim() && !isBusy ? "active" : ""} ${isImageMode ? "imageSendBtn" : ""}`}
            onClick={() => handleSend()}
            disabled={!prompt.trim() || isBusy}
            title={isImageMode ? "Generate Image" : "Send"}
          >
            {isImageMode ? <Image size={17} /> : <Send size={17} />}
          </button>
        </div>

        <p className="inputHint">
          <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> new line · Say "draw..." or "generate image..." for AI images
        </p>
      </div>
    </div>
  );
}

export default ChatWindow;
