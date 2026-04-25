import "./Sidebar.css";
import { useContext, useEffect, useRef, useState, useCallback } from "react";
import { MyContext } from "../context/MyContext.jsx";
import toast from "react-hot-toast";
import { getAuthHeaders, signOutCurrentSession } from "../utils/authSession.js";
import {
  Plus, Search, Pin, PinOff, Pencil, Trash2, Check, X,
  Bot, Code2, PenLine, Lightbulb, GraduationCap,
  Zap, Brain, Scale, Sun, Moon, ChevronLeft, ChevronRight,
  MessageSquare, LogOut,
} from "lucide-react";

const API_URL     = import.meta.env.VITE_API_URL || "http://localhost:5000";
const THREADS_URL = `${API_URL}/api/chat/threads`;
const THREAD_URL  = (id) => `${API_URL}/api/chat/threads/${id}`;

const hasAuthHeaders = (headers) =>
  Boolean(headers.Authorization || headers["X-Guest-Id"]);

const PERSONAS = [
  { id: "general",   name: "SigmaGPT",        icon: <Bot size={15} /> },
  { id: "coder",     name: "Sigma Coder",      icon: <Code2 size={15} /> },
  { id: "writer",    name: "Sigma Writer",     icon: <PenLine size={15} /> },
  { id: "explainer", name: "Sigma Simplified", icon: <Lightbulb size={15} /> },
  { id: "mentor",    name: "Sigma Mentor",     icon: <GraduationCap size={15} /> },
];

const MODELS = [
  { id: "smart",    name: "Smart",    desc: "Best quality",  icon: <Brain size={14} /> },
  { id: "fast",     name: "Fast",     desc: "Quick replies", icon: <Zap size={14} /> },
  { id: "balanced", name: "Balanced", desc: "Middle ground", icon: <Scale size={14} /> },
];

function formatThreadDate(dateStr) {
  if (!dateStr) return "";
  const date      = new Date(dateStr);
  const now       = new Date();
  const diffMs    = now - date;
  const diffMins  = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays  = Math.floor(diffHours / 24);
  if (diffMins < 1)   return "Just now";
  if (diffMins < 60)  return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7)   return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ✅ ThreadItem is OUTSIDE Sidebar — prevents remount on re-render (fixes rename bug!)
function ThreadItem({
  thread, currThreadId,
  renamingId, renameValue, renameInputRef,
  setRenameValue, setRenamingId,
  onThreadClick, onDelete, onPin, onStartRename, onRename,
}) {
  const isRenaming = renamingId === thread.threadId;
  const isActive   = thread.threadId === currThreadId;

  return (
    <li
      className={`threadItem ${isActive ? "active" : ""}`}
      onClick={() => { if (!isRenaming) onThreadClick(thread.threadId); }}
    >
      {isRenaming ? (
        <div className="renameBox" onClick={e => e.stopPropagation()}>
          <input
            ref={renameInputRef}
            value={renameValue}
            onClick={e => e.stopPropagation()}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === "Enter")  onRename(thread.threadId);
              if (e.key === "Escape") setRenamingId(null);
            }}
          />
          <button onClick={e => { e.stopPropagation(); onRename(thread.threadId); }}>
            <Check size={13} />
          </button>
          <button onClick={e => { e.stopPropagation(); setRenamingId(null); }}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="threadContent">
          <div className="threadInfo">
            <span className="threadTitle">{thread.title || "New Chat"}</span>
            <span className="threadDate">{formatThreadDate(thread.updatedAt)}</span>
          </div>
          <div className="threadActions">
            <button title={thread.pinned ? "Unpin" : "Pin"} onClick={e => onPin(e, thread.threadId)}>
              {thread.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
            <button title="Rename" onClick={e => onStartRename(e, thread)}>
              <Pencil size={13} />
            </button>
            <button title="Delete" className="danger" onClick={e => onDelete(e, thread.threadId)}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Sidebar() {
  const {
    currThreadId, setCurrThreadId,
    updateCurrentChatTitle,
    setIsNewChat, setPrompt, setReply,
    isDarkMode, setIsDarkMode,
    isSidebarOpen, setIsSidebarOpen,
    searchQuery, setSearchQuery,
    selectedPersona, setSelectedPersona,
    selectedModel, setSelectedModel,
    startNewChat, isOnline,
    currentUser, isMobile,
  } = useContext(MyContext);

  // ✅ KEY FIX — Sidebar owns its OWN threads state (not from context!)
  // Context's setAllThreads = syncThreads() which reads localStorage — useless for Firestore!
  const [threads, setThreads]           = useState([]);
  const [renamingId, setRenamingId]     = useState(null);
  const [renameValue, setRenameValue]   = useState("");
  const [showPersonas, setShowPersonas] = useState(false);
  const [showModels, setShowModels]     = useState(false);
  const [isLoading, setIsLoading]       = useState(false);
  const renameInputRef = useRef(null);

  // ✅ Fetch threads from Firestore
  const fetchThreads = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (!hasAuthHeaders(headers)) {
        setThreads([]);
        setIsLoading(false);
        return;
      }

      const res = await fetch(THREADS_URL, {
        headers,
      });

      if (!res.ok) throw new Error(`Status: ${res.status}`);
      const data = await res.json();
      setThreads(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Fetch threads error:", err);
      setThreads([]);
    }
    setIsLoading(false);
  }, []);

  // ✅ Fetch on mount + whenever currThreadId changes (new chat was created)
 useEffect(() => { fetchThreads(); }, []);
// ✅ ADD THIS SEPARATELY — refetch when new chat created
const prevThreadIdRef = useRef(currThreadId);
useEffect(() => {
  // Only refetch if a genuinely NEW thread was created
  if (prevThreadIdRef.current !== currThreadId) {
    prevThreadIdRef.current = currThreadId;
    // Small delay to let Firestore propagate
    const timer = setTimeout(() => fetchThreads(), 800);
    return () => clearTimeout(timer);
  }
}, [currThreadId]);
  // ✅ Focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // ✅ Click thread
  const handleThreadClick = (threadId) => {
    if (threadId === currThreadId) return;
    setCurrThreadId(threadId);
    setIsNewChat(false);
    setPrompt("");
    setReply(null);
    if (isMobile) setIsSidebarOpen(false);
  };

const handleDelete = async (e, threadId) => {
  e.stopPropagation();
  e.preventDefault();
  
  // Optimistic update first
  setThreads(prev => prev.filter(t => t.threadId !== threadId));

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(THREAD_URL(threadId), {
      method: "DELETE",
      headers,
    });
    if (!res.ok) throw new Error();
    toast.success("Chat deleted!");
    if (threadId === currThreadId) startNewChat();
  } catch {
    toast.error("Delete failed!");
    fetchThreads(); // only rollback on error
  }
};

  const handlePin = async (e, threadId) => {
  e.stopPropagation();
  e.preventDefault();

  const thread = threads.find(t => t.threadId === threadId);
  const newPinned = !thread?.pinned;

  // Optimistic update
  setThreads(prev =>
    prev.map(t => t.threadId === threadId ? { ...t, pinned: newPinned } : t)
  );

  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`${THREAD_URL(threadId)}/pin`, {
      method: "PUT",
      headers,
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    setThreads(prev =>
      prev.map(t => t.threadId === threadId ? { ...t, pinned: data.pinned } : t)
    );
    toast.success(data.pinned ? "📌 Pinned!" : "Unpinned!");
  } catch {
    toast.error("Pin failed!");
    // ✅ Revert — don't refetch!
    setThreads(prev =>
      prev.map(t => t.threadId === threadId ? { ...t, pinned: !newPinned } : t)
    );
  }
};

  // ✅ Start rename
  const handleStartRename = (e, thread) => {
    e.stopPropagation();
    e.preventDefault();
    setRenamingId(thread.threadId);
    setRenameValue(thread.title || "");
  };

  const handleRename = async (threadId) => {
  const newTitle = renameValue.trim();
  const oldTitle = threads.find(t => t.threadId === threadId)?.title || "";
  if (!newTitle) { setRenamingId(null); return; }

  // Optimistic update
  setThreads(prev =>
    prev.map(t => t.threadId === threadId ? { ...t, title: newTitle } : t)
  );
  setRenamingId(null);

  if (threadId === currThreadId && updateCurrentChatTitle) {
    updateCurrentChatTitle(threadId, newTitle);
  }

  try {
    const headers = await getAuthHeaders({ "Content-Type": "application/json" });
    const res = await fetch(`${THREAD_URL(threadId)}/rename`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ title: newTitle }),
    });
    if (!res.ok) throw new Error();
    toast.success("Renamed!");
  } catch {
    toast.error("Rename failed!");
    // ✅ Revert — don't refetch!
    setThreads(prev =>
      prev.map(t => t.threadId === threadId ? { ...t, title: oldTitle } : t)
    );
  }
};

  // ✅ Sign out
  const handleSignOut = async () => {
    try { await signOutCurrentSession(); toast.success("Signed out!"); }
    catch { toast.error("Sign out failed!"); }
  };

  // ✅ Filter + split
  const filtered = threads.filter(t =>
    t.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const pinned = filtered.filter(t => t.pinned);
  const recent = filtered.filter(t => !t.pinned);

  const currentPersona = PERSONAS.find(p => p.id === selectedPersona) || PERSONAS[0];
  const currentModel   = MODELS.find(m => m.id === selectedModel) || MODELS[0];

  const threadItemProps = {
    currThreadId, renamingId, renameValue,
    renameInputRef, setRenameValue, setRenamingId,
    onThreadClick: handleThreadClick,
    onDelete:      handleDelete,
    onPin:         handlePin,
    onStartRename: handleStartRename,
    onRename:      handleRename,
  };

  // ✅ Collapsed
  if (!isSidebarOpen) {
    if (isMobile) return null;

    return (
      <aside className="sidebar collapsed">
        <button className="collapseBtn" onClick={() => setIsSidebarOpen(true)}>
          <ChevronRight size={18} />
        </button>
        <button className="newChatIconBtn" onClick={startNewChat}>
          <Plus size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">

      {/* ── Header ── */}
      <div className="sidebarHeader">
        <div className="logoArea">
          <span className="sigmaSymbol">Σ</span>
          <span className="appName">igmaGPT</span>
        </div>
        <div className="headerActions">
          <button className="iconBtn" title="New Chat" onClick={startNewChat}>
            <Plus size={18} />
          </button>
          <button className="iconBtn" title="Collapse" onClick={() => setIsSidebarOpen(false)}>
            <ChevronLeft size={18} />
          </button>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="searchRow">
        <Search size={14} className="searchIcon" />
        <input
          className="searchInput"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="iconBtn" onClick={() => setSearchQuery("")}>
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Thread list ── */}
      <div className="threadList">
        {isLoading && <p className="emptyThreads">Loading chats...</p>}

        {!isLoading && pinned.length > 0 && (
          <>
            <p className="sectionLabel"><Pin size={11} /> Pinned</p>
            <ul>{pinned.map(t => <ThreadItem key={t.threadId} thread={t} {...threadItemProps} />)}</ul>
          </>
        )}

        {!isLoading && recent.length > 0 && (
          <>
            <p className="sectionLabel"><MessageSquare size={11} /> Recent</p>
            <ul>{recent.map(t => <ThreadItem key={t.threadId} thread={t} {...threadItemProps} />)}</ul>
          </>
        )}

        {!isLoading && filtered.length === 0 && (
          <p className="emptyThreads">
            {searchQuery ? "No chats found" : "No chats yet — start one!"}
          </p>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="sidebarFooter">

        {/* Persona selector */}
        <div className="selectorRow">
          <button className="selectorBtn"
            onClick={() => { setShowPersonas(!showPersonas); setShowModels(false); }}>
            {currentPersona.icon}
            <span>{currentPersona.name}</span>
          </button>
          {showPersonas && (
            <div className="selectorMenu">
              {PERSONAS.map(p => (
                <button key={p.id}
                  className={`selectorItem ${selectedPersona === p.id ? "selected" : ""}`}
                  onClick={() => { setSelectedPersona(p.id); setShowPersonas(false); toast.success(`Switched to ${p.name}!`); }}>
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Model selector */}
        <div className="selectorRow">
          <button className="selectorBtn"
            onClick={() => { setShowModels(!showModels); setShowPersonas(false); }}>
            {currentModel.icon}
            <span>{currentModel.name} — {currentModel.desc}</span>
          </button>
          {showModels && (
            <div className="selectorMenu">
              {MODELS.map(m => (
                <button key={m.id}
                  className={`selectorItem ${selectedModel === m.id ? "selected" : ""}`}
                  onClick={() => { setSelectedModel(m.id); setShowModels(false); toast.success(`Switched to ${m.name}!`); }}>
                  {m.icon} <span>{m.name}</span> <small>{m.desc}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom row */}
        <div className="footerBottom">
          <div className={`onlineBadge ${isOnline ? "online" : "offline"}`}>
            <span className="dot" />
            {isOnline ? "Online" : "Offline"}
          </div>
          <div className="footerControls">
            <button className="iconBtn" title="Toggle theme"
              onClick={() => setIsDarkMode(!isDarkMode)}>
              {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="iconBtn danger" title="Sign out" onClick={handleSignOut}>
              <LogOut size={16} />
            </button>
          </div>
        </div>

        {currentUser && (
          <p className="userEmail">{currentUser.displayName || currentUser.email}</p>
        )}

        <p className="poweredBy">Powered by Groq ⚡</p>
      </div>
    </aside>
  );
}

export default Sidebar;