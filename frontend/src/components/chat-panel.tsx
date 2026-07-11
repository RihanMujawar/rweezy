import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { setActiveChat } from "@/lib/active-chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { socket } from "@/lib/socket";

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
  const [partnerTyping, setPartnerTyping] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(0);
  const typingTimeoutRef = useRef<number | null>(null);

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

  // WebSocket Chat integration
  useEffect(() => {
    if (!user || disabled) {
      setLoading(false);
      return;
    }

    socket.join(serviceId);
    socket.join(`chat:${serviceId}`);

    load(true);

    const handleNewMessage = (msg: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        lastMessageCountRef.current = next.length;
        return next;
      });
    };

    // Listen to typing event in room
    const handleTyping = (data: { room: string; senderId: string; isTyping: boolean }) => {
      if ((data.room === serviceId || data.room === `chat:${serviceId}`) && data.senderId !== user.id) {
        setPartnerTyping(data.isTyping);
      }
    };

    socket.on("chat_message", handleNewMessage);
    socket.on("typing", handleTyping);

    // Fallback polling ONLY if websocket is offline
    const pollTimer = window.setInterval(() => {
      if (!socket.connected) {
        load();
      }
    }, 6000);

    return () => {
      socket.leave(serviceId);
      socket.leave(`chat:${serviceId}`);
      socket.off("chat_message", handleNewMessage);
      socket.off("typing", handleTyping);
      window.clearInterval(pollTimer);
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [disabled, load, serviceId, user]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, partnerTyping]);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!user || disabled) return;

    // Send typing = true
    socket.emit("typing", { isTyping: true }, serviceId);

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      socket.emit("typing", { isTyping: false }, serviceId);
    }, 2500);
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending || disabled) return;

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    // Turn off typing indicator immediately when sending
    socket.emit("typing", { isTyping: false }, serviceId);

    setSending(true);
    try {
      await api.chat.send(kind, serviceId, body);
      setDraft("");
      // No need to manually load, WebSocket message event will receive and update it!
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>

      <div
        ref={listRef}
        className="mt-3 flex h-72 flex-col gap-2 overflow-y-auto rounded-lg border bg-background p-3"
      >
        {disabled ? (
          <p className="m-auto text-center text-sm text-muted-foreground">
            Chat starts when a partner is assigned.
          </p>
        ) : loading ? (
          <p className="m-auto text-sm text-muted-foreground">Loading chat...</p>
        ) : error ? (
          <p className="m-auto text-center text-sm text-red-600">{error}</p>
        ) : messages.length === 0 && !partnerTyping ? (
          <p className="m-auto text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <>
            {messages.map((message) => {
              const mine = message.sender_id === user?.id;
              return (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[82%] rounded-lg px-3 py-2 text-sm",
                    mine ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-muted",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <p
                    className={cn(
                      "mt-1 text-[11px]",
                      mine ? "text-primary-foreground/75" : "text-muted-foreground",
                    )}
                  >
                    {mine ? "You" : "Partner"} ·{" "}
                    {new Date(message.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              );
            })}
            {partnerTyping && (
              <div className="mr-auto bg-muted max-w-[82%] rounded-lg px-3 py-2 text-sm italic text-muted-foreground">
                Partner is typing...
              </div>
            )}
          </>
        )}
      </div>

      <form onSubmit={send} className="mt-3 flex gap-2">
        <Textarea
          value={draft}
          onChange={(event) => handleDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          maxLength={1000}
          disabled={disabled || sending}
          placeholder="Type a message"
          className="min-h-11 resize-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={disabled || sending || draft.trim().length === 0}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Send message</span>
        </Button>
      </form>
    </section>
  );
}
