import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { setActiveChat } from "@/lib/active-chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type ChatKind = "ride" | "package" | "food" | "grocery";

type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

type ChatPanelProps = {
  kind: ChatKind;
  serviceId: string;
  title?: string;
  disabled?: boolean;
};

export function ChatPanel({ kind, serviceId, title = "Chat", disabled = false }: ChatPanelProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(0);

  const load = useCallback(
    async (showLoading = false) => {
      if (!user || disabled) return;
      if (showLoading) setLoading(true);
      try {
        const data = await api.chat.get(kind, serviceId);
        const nextMessages = (data.messages as ChatMessage[]) ?? [];
        const previousCount = lastMessageCountRef.current;
        const latest = nextMessages[nextMessages.length - 1];

        if (
          !showLoading &&
          latest &&
          latest.sender_id !== user.id &&
          nextMessages.length > previousCount &&
          document.hidden
        ) {
          toast.info("New chat message", {
            description: latest.body.length > 100 ? `${latest.body.slice(0, 97)}...` : latest.body,
          });
        }

        lastMessageCountRef.current = nextMessages.length;
        setMessages(nextMessages);
        setError(null);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to load chat");
      } finally {
        setLoading(false);
      }
    },
    [disabled, kind, serviceId, user],
  );

  useEffect(() => {
    if (!user || disabled) {
      setActiveChat(null);
      return;
    }

    setActiveChat({ kind, serviceId });
    return () => setActiveChat(null);
  }, [disabled, kind, serviceId, user]);

  useEffect(() => {
    if (!user || disabled) {
      setLoading(false);
      return;
    }

    load(true);
    const timer = window.setInterval(() => load(), 2500);
    return () => window.clearInterval(timer);
  }, [disabled, load, user]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending || disabled) return;

    setSending(true);
    try {
      await api.chat.send(kind, serviceId, body);
      setDraft("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-[2.5rem] border border-white/10 bg-card/40 p-6 backdrop-blur-2xl shadow-2xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/20">
          <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-black tracking-tight">{title}</h2>
      </div>

      <div
        ref={listRef}
        className="mt-3 flex h-96 flex-col gap-3 overflow-y-auto rounded-[2rem] border border-white/10 bg-black/5 dark:bg-black/20 p-4 custom-scrollbar"
      >
        {disabled ? (
          <p className="m-auto text-center text-sm font-medium text-muted-foreground bg-white/5 p-4 rounded-2xl backdrop-blur-md">
            Chat starts when a partner is assigned.
          </p>
        ) : loading ? (
          <div className="m-auto flex flex-col items-center gap-2">
            <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">
              Loading chat...
            </p>
          </div>
        ) : error ? (
          <p className="m-auto text-center text-sm text-red-600 bg-red-500/10 p-4 rounded-2xl">
            {error}
          </p>
        ) : messages.length === 0 ? (
          <p className="m-auto text-center text-sm font-medium text-muted-foreground opacity-50 uppercase tracking-widest">
            No messages yet.
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message) => {
              const mine = message.sender_id === user?.id;
              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className={cn(
                    "max-w-[85%] rounded-[1.5rem] px-4 py-3 text-sm shadow-sm",
                    mine
                      ? "ml-auto bg-primary text-primary-foreground rounded-tr-none shadow-primary/20"
                      : "mr-auto bg-white/10 dark:bg-white/5 backdrop-blur-md border border-white/5 rounded-tl-none",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
                  <div
                    className={cn(
                      "mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider",
                      mine ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    <span>{mine ? "You" : "Partner"}</span>
                    <span className="opacity-30">·</span>
                    <span>
                      {new Date(message.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      <form onSubmit={send} className="mt-4 flex gap-3">
        <div className="relative flex-1">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={1000}
            disabled={disabled || sending}
            placeholder="Type a message..."
            className="min-h-14 resize-none rounded-[1.5rem] bg-white/5 border-white/10 focus:border-primary/50 focus:ring-primary/20 backdrop-blur-md px-5 py-4 text-sm font-medium transition-all"
          />
        </div>
        <Button
          type="submit"
          size="icon"
          className="h-14 w-14 rounded-[1.5rem] bg-primary text-primary-foreground shadow-xl shadow-primary/20 hover:scale-105 active:scale-90 transition-all shrink-0"
          disabled={disabled || sending || draft.trim().length === 0}
        >
          <Send className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Send message</span>
        </Button>
      </form>
    </section>
  );
}
