import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Trash2, Bot, User as UserIcon, Copy, Check } from 'lucide-react';
import { api } from '../api/client';
import type { AuthUser, ChatMessage } from '../types';
import { formatReadablePlainText } from '../utils/chatMarkdown';
import { ChatMessageBody } from './ChatMessageBody';

interface AdvisorTabProps {
  user: AuthUser;
}

const STARTER_PROMPTS = [
  'Đánh giá tiến độ mục tiêu tiết kiệm hiện tại của tôi',
  'Gợi ý cách phân bổ tiền tiết kiệm mỗi tuần bằng VNĐ',
  'Khi nào tôi nên dùng quỹ dự phòng?',
  'Tôi cần tiết kiệm thêm bao nhiêu mỗi ngày để đạt mục tiêu?',
];

export function AdvisorTab({ user }: AdvisorTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canChat = user.canUseChat || user.role === 'admin';

  useEffect(() => {
    if (!canChat) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await api.getAdvisorMessages();
        if (active) setMessages(res.messages);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Không tải được lịch sử chat.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [canChat]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    setSending(true);
    setInput('');
    try {
      const res = await api.sendAdvisorMessage(trimmed);
      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
    } catch (err) {
      setInput(trimmed);
      setError(err instanceof Error ? err.message : 'Trợ lý AI không thể phản hồi lúc này.');
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendText(input);
  }

  async function handleClearHistory() {
    setError(null);
    try {
      await api.clearAdvisorMessages();
      setMessages([]);
      setConfirmClear(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa lịch sử.');
    }
  }

  async function handleCopyReply(msg: ChatMessage) {
    try {
      await navigator.clipboard.writeText(formatReadablePlainText(msg.content));
      setCopiedMsgId(msg.id);
      setTimeout(() => {
        setCopiedMsgId((prev) => (prev === msg.id ? null : prev));
      }, 1800);
    } catch {
      // Clipboard API unavailable in restricted contexts
    }
  }

  if (!canChat) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-8 text-center">
        <Bot className="w-10 h-10 text-slate-400 mx-auto" />
        <h2 className="mt-3 font-display text-lg font-bold text-slate-900">
          Trợ lý AI đang được tắt
        </h2>
        <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
          Quản trị viên đã tắt quyền sử dụng Trợ lý AI tài chính cho tài khoản của bạn.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl flex flex-col h-[calc(100vh-14rem)] min-h-[460px] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Trợ lý AI tài chính VNĐ
          </h2>
          <p className="text-xs text-slate-500">
            Phạm vi tư vấn: tiết kiệm cá nhân, ngân sách và mục tiêu tích lũy VNĐ
          </p>
        </div>

        {messages.length > 0 && (
          confirmClear ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleClearHistory()}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
              >
                Xác nhận xóa
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-700 cursor-pointer"
              >
                Hủy
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-600 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa lịch sử</span>
            </button>
          )
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {loading ? (
          <div className="text-sm text-slate-500">Đang tải cuộc trò chuyện...</div>
        ) : messages.length === 0 ? (
          <div className="py-6 space-y-4">
            <div className="text-sm text-slate-600">
              Hãy hỏi về số dư hiện tại, tiến độ mục tiêu hoặc cách tối ưu tiết kiệm bằng VNĐ:
            </div>
            <div className="flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendText(prompt)}
                  className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-xs font-medium text-slate-700 text-left cursor-pointer transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    isUser ? 'bg-slate-900 text-white' : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {isUser ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    isUser
                      ? 'max-w-[82%] bg-slate-900 text-white whitespace-pre-wrap'
                      : 'max-w-[92%] sm:max-w-[85%] bg-slate-100 text-slate-800'
                  }`}
                >
                  {isUser ? (
                    <div>{msg.content}</div>
                  ) : (
                    <ChatMessageBody content={msg.content} />
                  )}
                  {!isUser && (
                    <div className="mt-2 pt-1.5 border-t border-slate-200/70 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleCopyReply(msg)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-emerald-700 cursor-pointer"
                      >
                        {copiedMsgId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" />
                            <span className="text-emerald-700">Đã chép</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Sao chép</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {sending && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="rounded-2xl px-4 py-3 bg-slate-100 text-sm text-slate-500">
              Đang phân tích dữ liệu ví của bạn...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mx-5 mb-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Composer */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-slate-100 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder="Nhập câu hỏi về tiết kiệm VNĐ..."
          aria-label="Nội dung hỏi trợ lý tài chính"
          className="flex-1 h-11 px-4 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Gửi tin nhắn"
          className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
        >
          <Send className="w-4 h-4" />
          <span className="hidden sm:inline">Gửi</span>
        </button>
      </form>
    </div>
  );
}
