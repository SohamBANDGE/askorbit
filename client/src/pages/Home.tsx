import { Streamdown } from "streamdown";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Copy,
  FileDown,
  FileText,
  Lightbulb,
  Menu,
  MessageSquareText,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { trpc } from "@/lib/trpc";
import { createAnswerPdf, downloadPdfFile } from "@/lib/pdf";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
};

type FailedTurn = {
  threadId: string;
  prompt: string;
};

type PdfActionState = {
  messageId: string;
  phase: "preparing" | "saved" | "error";
};

const STORAGE_KEY = "askorbit.conversations.v1";
const MAX_THREADS = 30;
const MAX_SAVED_MESSAGES = 48;
const SUGGESTIONS = [
  { icon: Compass, label: "Plan a weekend in Kyoto", prompt: "Plan a relaxed 3-day weekend in Kyoto with great food, a little nature, and time to explore." },
  { icon: Lightbulb, label: "Make a tricky idea simple", prompt: "Explain how the internet works in a way a curious 12-year-old would understand." },
  { icon: FileText, label: "Write something together", prompt: "Help me write a warm, confident cover letter. Ask me what you need to know first." },
  { icon: CircleHelp, label: "Find a new direction", prompt: "I have an hour free this week. Suggest a small, interesting skill I could start learning." },
];

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && (item.role === "user" || item.role === "assistant")
    && typeof item.content === "string"
    && typeof item.createdAt === "number";
}

function isThread(value: unknown): value is ChatThread {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.updatedAt === "number"
    && Array.isArray(item.messages)
    && item.messages.every(isMessage);
}

function titleFromPrompt(prompt: string) {
  const compact = prompt.trim().replace(/\s+/g, " ");
  return compact.length > 44 ? `${compact.slice(0, 44).trimEnd()}…` : compact;
}

function LogoMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark${small ? " brand-mark-small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 40 40" fill="none">
        <circle cx="20" cy="20" r="6.4" fill="currentColor" />
        <ellipse cx="20" cy="20" rx="15.2" ry="7.2" stroke="currentColor" strokeWidth="1.7" transform="rotate(-38 20 20)" />
        <circle cx="31.4" cy="9.4" r="2.45" fill="currentColor" className="brand-satellite" />
      </svg>
    </span>
  );
}

export default function Home() {
  const chatMutation = trpc.chat.respond.useMutation();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [pdfAction, setPdfAction] = useState<PdfActionState | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const loaded = parsed.filter(isThread).slice(0, MAX_THREADS);
          setThreads(loaded);
          if (loaded.length > 0) setActiveThreadId(loaded[0].id);
        }
      }
    } catch {
      // A malformed or unavailable local history should never block a new chat.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
    } catch {
      // Keep the current conversation usable when browser storage is unavailable.
    }
  }, [threads, hydrated]);

  const activeThread = threads.find(thread => thread.id === activeThreadId) ?? null;
  const activeMessages = activeThread?.messages ?? [];
  const isPending = pendingThreadId !== null;
  const activeIsPending = pendingThreadId !== null && pendingThreadId === activeThreadId;
  const activeFailedTurn = failedTurn?.threadId === activeThreadId ? failedTurn : null;
  const threadDates = new Date();
  const todayThreads = threads.filter(thread => new Date(thread.updatedAt).toDateString() === threadDates.toDateString());
  const earlierThreads = threads.filter(thread => new Date(thread.updatedAt).toDateString() !== threadDates.toDateString());

  useEffect(() => {
    const area = scrollRef.current;
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
  }, [activeThreadId, activeMessages.length, activeIsPending, activeFailedTurn]);

  function saveConversation(threadId: string, nextMessages: ChatMessage[], firstPrompt?: string) {
    const existing = threads.find(thread => thread.id === threadId);
    const updated: ChatThread = {
      id: threadId,
      title: existing?.title ?? titleFromPrompt(firstPrompt ?? "New conversation"),
      messages: nextMessages.slice(-MAX_SAVED_MESSAGES),
      updatedAt: Date.now(),
    };
    setThreads(previous => [updated, ...previous.filter(thread => thread.id !== threadId)].slice(0, MAX_THREADS));
  }

  async function sendMessage(rawText: string, options?: { retry?: boolean; threadId?: string }) {
    const prompt = rawText.trim();
    if (!prompt || isPending) return;

    const targetThreadId = options?.threadId ?? activeThreadId ?? makeId();
    const currentThread = threads.find(thread => thread.id === targetThreadId);
    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: prompt,
      createdAt: Date.now(),
    };
    const nextMessages = options?.retry
      ? (currentThread?.messages ?? [])
      : [...(currentThread?.messages ?? []), userMessage];

    if (!options?.retry) {
      setActiveThreadId(targetThreadId);
      setMobileSidebarOpen(false);
      setDraft("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      saveConversation(targetThreadId, nextMessages, prompt);
    }

    setPendingThreadId(targetThreadId);
    setFailedTurn(null);
    setErrorMessage("");

    try {
      const result = await chatMutation.mutateAsync({
        messages: nextMessages.slice(-24).map(({ role, content }) => ({ role, content })),
      });
      const answer: ChatMessage = {
        id: makeId(),
        role: "assistant",
        content: result.answer,
        createdAt: Date.now(),
      };
      saveConversation(targetThreadId, [...nextMessages, answer], prompt);
      setFailedTurn(null);
    } catch {
      setFailedTurn({ threadId: targetThreadId, prompt });
      setErrorMessage("I couldn't reach the AI service just now. Your question is still here—please try again.");
    } finally {
      setPendingThreadId(null);
    }
  }

  function startNewChat() {
    setActiveThreadId(null);
    setDraft("");
    setErrorMessage("");
    setFailedTurn(null);
    setMobileSidebarOpen(false);
    textareaRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (draft.trim()) void sendMessage(draft);
    }
  }

  async function copyAnswer(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId(current => current === message.id ? null : current), 1600);
    } catch {
      setErrorMessage("Copy isn't available in this browser. You can still select the answer text.");
    }
  }

  async function saveAnswerAsPdf(message: ChatMessage, titleHint: string) {
    if (pdfAction?.phase === "preparing") return;
    setPdfAction({ messageId: message.id, phase: "preparing" });
    try {
      const pdf = await createAnswerPdf(message.content, titleHint);
      downloadPdfFile(pdf);
      setPdfAction({ messageId: message.id, phase: "saved" });
      window.setTimeout(() => setPdfAction(current => current?.messageId === message.id ? null : current), 2400);
    } catch {
      setPdfAction({ messageId: message.id, phase: "error" });
      window.setTimeout(() => setPdfAction(current => current?.messageId === message.id ? null : current), 3600);
    }
  }

  function openThread(threadId: string) {
    setActiveThreadId(threadId);
    setErrorMessage("");
    setMobileSidebarOpen(false);
  }

  function deleteThread(threadId: string) {
    if (pendingThreadId === threadId) return;
    const nextThreads = threads.filter(thread => thread.id !== threadId);
    setThreads(nextThreads);
    if (activeThreadId === threadId) setActiveThreadId(nextThreads[0]?.id ?? null);
    if (failedTurn?.threadId === threadId) {
      setFailedTurn(null);
      setErrorMessage("");
    }
  }

  function renderThreadList(items: ChatThread[]) {
    if (items.length === 0) return null;
    return items.map(thread => {
      const isGenerating = pendingThreadId === thread.id;
      return (
        <div className="history-item-row" key={thread.id}>
          <button
            className={`history-item${thread.id === activeThreadId ? " history-item-active" : ""}`}
            onClick={() => openThread(thread.id)}
            title={thread.title}
            aria-label={`Open chat: ${thread.title}`}
          >
            <MessageSquareText size={15} strokeWidth={1.8} />
            <span>{thread.title}</span>
          </button>
          <button
            className="history-delete-button"
            onClick={() => deleteThread(thread.id)}
            disabled={isGenerating}
            title={isGenerating ? "Wait for the reply to finish before deleting" : `Delete chat: ${thread.title}`}
            aria-label={`Delete chat: ${thread.title}`}
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        </div>
      );
    });
  }

  return (
    <div className="app-shell">
      {mobileSidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMobileSidebarOpen(false)} />}
      <aside className={`sidebar${mobileSidebarOpen ? " sidebar-open" : ""}`} aria-label="Chat history">
        <div className="sidebar-brand-row">
          <button className="brand-lockup" onClick={startNewChat} aria-label="AskOrbit home — start a new chat">
            <LogoMark />
            <span>ask<span className="brand-orbit">orbit</span></span>
          </button>
          <button className="icon-button sidebar-close" onClick={() => setMobileSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>

        <button className="new-chat-button" onClick={startNewChat}>
          <Plus size={17} strokeWidth={2.2} />
          <span>New conversation</span>
          <span className="new-chat-shortcut">⌘ K</span>
        </button>

        <div className="sidebar-section-heading">
          <span>YOUR CHATS</span>
          <ChevronDown size={13} />
        </div>
        <div className="history-list">
          {todayThreads.length > 0 && <div className="history-group-label">Today</div>}
          {renderThreadList(todayThreads)}
          {earlierThreads.length > 0 && <div className="history-group-label history-group-spaced">Earlier</div>}
          {renderThreadList(earlierThreads)}
          {threads.length === 0 && hydrated && (
            <div className="history-empty">Your conversations will show up here.</div>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-profile">
            <span className="profile-avatar"><Sparkles size={15} /></span>
            <span className="profile-copy"><strong>AskOrbit</strong><small>Your AI companion</small></span>
            <span className="online-indicator" aria-label="Ready" />
          </div>
          <p className="local-note">Chats are saved in this browser.</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" onClick={() => setMobileSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="topbar-context">
            <span className="topbar-kicker">GENERAL ASSISTANT</span>
            <span className="topbar-divider">/</span>
            <span className="topbar-current">{activeThread?.title ?? "New conversation"}</span>
          </div>
          <div className="topbar-actions">
            <span className="service-status"><span className="status-dot" /> AI ready</span>
            <button className="top-new-button" onClick={startNewChat}><Plus size={15} /> <span>New chat</span></button>
          </div>
        </header>

        <section className={`conversation-area${activeMessages.length === 0 ? " conversation-empty" : ""}`} ref={scrollRef} aria-label="Conversation">
          {activeMessages.length === 0 ? (
            <div className="empty-state">
              <div className="hero-art-stage" aria-hidden="true">
                <div className="hero-planet"></div>
                <div className="orbit-guide orbit-guide-one" />
                <div className="orbit-guide orbit-guide-two" />
                <div className="hero-art-glow" />
                <img className="hero-art-image" src="/askorbit-hero.webp" alt="" fetchPriority="high" onError={event => { event.currentTarget.style.display = "none"; }} />
                <span className="hero-art-spark hero-art-spark-one">✦</span>
                <span className="hero-art-spark hero-art-spark-two">✧</span>
                <span className="hero-art-spark hero-art-spark-three">·</span>
                <div className="hero-art-caption"><span>01</span><i /> <span>CURIOUS BY DESIGN</span></div>
              </div>
              <div className="hero-copy">
                <div className="hero-eyebrow"><span className="hero-eyebrow-pulse" /> A THINKING SPACE FOR THE CURIOUS <Sparkles size={13} /></div>
                <h1>Ask <span>wildly.</span><br />Learn <em>deeply.</em></h1>
                <p className="hero-description">Big questions, tiny curiosities, brilliant detours. Bring them all—we’ll follow the idea wherever it goes.</p>
                <div className="suggestion-grid" aria-label="Example prompts">
                  {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
                    <button className="suggestion-card" key={label} onClick={() => void sendMessage(prompt)} disabled={isPending}>
                      <span className="suggestion-icon"><Icon size={17} strokeWidth={1.8} /></span>
                      <span className="suggestion-label">{label}</span>
                      <ArrowUp className="suggestion-arrow" size={15} />
                    </button>
                  ))}
                </div>
                <p className="hero-footnote"><FileDown size={13} /> ASK FOR A GUIDE, ESSAY OR REPORT—THEN SAVE THE ANSWER AS PDF</p>
              </div>
            </div>
          ) : (
            <div className="message-list">
              {activeMessages.map((message, index) => (
                <article className={`message-row message-${message.role}`} key={message.id}>
                  {message.role === "assistant" && <div className="assistant-avatar"><LogoMark small /></div>}
                  <div className="message-content-column">
                    {message.role === "assistant" && <div className="message-byline">ASKORBIT <span>·</span> <time>{index === activeMessages.length - 1 ? "JUST NOW" : ""}</time></div>}
                    <div className={`message-bubble message-bubble-${message.role}`}>
                      {message.role === "assistant"
                        ? <Streamdown className="answer-markdown">{message.content}</Streamdown>
                        : <p>{message.content}</p>}
                    </div>
                    {message.role === "assistant" && (
                      <div className="answer-actions">
                        <button className="copy-answer" onClick={() => void copyAnswer(message)} aria-label="Copy answer">
                          {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                          <span>{copiedMessageId === message.id ? "Copied" : "Copy"}</span>
                        </button>
                        <button
                          className="pdf-answer-button"
                          onClick={() => void saveAnswerAsPdf(
                            message,
                            [...activeMessages.slice(0, index)].reverse().find(item => item.role === "user")?.content ?? activeThread?.title ?? "AskOrbit answer",
                          )}
                          disabled={pdfAction?.phase === "preparing"}
                          aria-label="Save this answer as a PDF"
                          title="Download this answer as a PDF"
                        >
                          {pdfAction?.messageId === message.id && pdfAction.phase === "preparing"
                            ? <RotateCcw className="pdf-action-spinner" size={14} />
                            : pdfAction?.messageId === message.id && pdfAction.phase === "saved"
                              ? <Check size={14} />
                              : <FileDown size={14} />}
                          <span>{pdfAction?.messageId === message.id
                            ? pdfAction.phase === "preparing" ? "Preparing PDF…" : pdfAction.phase === "saved" ? "PDF ready" : "Try PDF again"
                            : "Save as PDF"}</span>
                        </button>
                        {pdfAction?.messageId === message.id && pdfAction.phase === "error" && (
                          <span className="pdf-action-error" role="alert">Couldn't create the PDF. Please try again.</span>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {activeIsPending && (
                <article className="message-row message-assistant" aria-live="polite" aria-label="AskOrbit is thinking">
                  <div className="assistant-avatar"><LogoMark small /></div>
                  <div className="message-content-column">
                    <div className="message-byline">ASKORBIT <span>·</span> THINKING</div>
                    <div className="thinking-bubble"><span className="thinking-dots"><i /><i /><i /></span><span>Putting the pieces together…</span></div>
                  </div>
                </article>
              )}
              {activeFailedTurn && errorMessage && (
                <div className="error-card" role="alert">
                  <div className="error-card-copy"><span className="error-icon">!</span><span>{errorMessage}</span></div>
                  <button className="retry-button" onClick={() => void sendMessage(activeFailedTurn.prompt, { retry: true, threadId: activeFailedTurn.threadId })} disabled={isPending}>
                    <RotateCcw size={14} /> Retry
                  </button>
                </div>
              )}
              <div className="bottom-scroll-anchor" />
            </div>
          )}
        </section>

        <div className="composer-dock">
          {errorMessage && !activeFailedTurn && <div className="inline-notice" role="status">{errorMessage}</div>}
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask me anything…"
              rows={1}
              aria-label="Your message"
              maxLength={6000}
              disabled={isPending}
            />
            <div className="composer-bottom-row">
              <span className="composer-hint"><span className="composer-sparkle"><Sparkles size={14} /></span> Made for the curious</span>
              <div className="composer-tools">
                <span className="keyboard-hint"><kbd>↵</kbd> to send <kbd>⇧ ↵</kbd> for a new line</span>
                <button className={`send-button${draft.trim() && !isPending ? " send-button-ready" : ""}`} type="submit" aria-label="Send message" disabled={!draft.trim() || isPending}>
                  {isPending ? <span className="button-spinner" /> : <ArrowUp size={19} strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          </form>
          <p className="composer-disclaimer">AI can make mistakes. Double-check important information.</p>
        </div>
      </main>
    </div>
  );
}

