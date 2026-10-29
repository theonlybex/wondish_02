"use client";

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface Props {
  items: ConversationSummary[];
  activeId: string | null;
  /** First page still loading (shows placeholders, not "no chats yet"). */
  loading: boolean;
  error: string | null;
  /** A one-off problem (a delete that failed) shown above the list. */
  notice: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  /** True while Clara is replying: switching chats mid-reply would orphan it. */
  disabled: boolean;
  deletingId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (item: ConversationSummary) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { dateStyle: "medium" });
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

/** Saved Clara chats: newest first, "New chat" on top, delete per row. */
export default function ConversationList({
  items,
  activeId,
  loading,
  error,
  notice,
  hasMore,
  loadingMore,
  disabled,
  deletingId,
  onSelect,
  onNew,
  onDelete,
  onLoadMore,
  onRetry,
}: Props) {
  return (
    <nav aria-label="Your chats with Clara" className="flex flex-col min-h-0 h-full">
      <button
        type="button"
        onClick={onNew}
        disabled={disabled}
        className="flex items-center justify-center gap-2 w-full min-h-[44px] px-4 rounded-xl bg-primary text-white font-bold text-sm transition-colors hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <PlusIcon />
        New chat
      </button>

      <p className="text-[9px] tracking-[0.22em] uppercase font-bold mt-5 mb-2" style={{ color: "#ABA6A6" }}>
        Your chats
      </p>

      {notice && (
        <p className="text-xs mb-2" role="alert" style={{ color: "#B75E78" }}>
          {notice}
        </p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        {loading ? (
          <ul className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-11 rounded-lg bg-[#F9F7ED] animate-pulse" />
            ))}
          </ul>
        ) : error ? (
          <div className="text-xs leading-relaxed" style={{ color: "#848181" }} role="alert">
            {error}{" "}
            <button type="button" onClick={onRetry} className="font-bold hover:underline cursor-pointer" style={{ color: "#812549" }}>
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs leading-relaxed" style={{ color: "#848181" }}>
            No saved chats yet. Your conversations with Clara will appear here.
          </p>
        ) : (
          <ul className="space-y-1">
            {items.map((item) => {
              const active = item.id === activeId;
              const deleting = item.id === deletingId;
              return (
                <li key={item.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    disabled={disabled || deleting}
                    aria-current={active ? "true" : undefined}
                    className={`w-full text-left min-h-[44px] pl-3 pr-10 py-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed cursor-pointer ${
                      active ? "bg-primary/[0.08]" : "hover:bg-[#F9F7ED]"
                    } ${deleting ? "opacity-40" : ""}`}
                  >
                    <span
                      className={`block text-sm truncate ${active ? "font-bold" : "font-medium"}`}
                      style={{ color: active ? "#812549" : "#1E1A1A" }}
                      title={item.title}
                    >
                      {item.title || "Untitled chat"}
                    </span>
                    <span className="block text-[10px] mt-0.5 tabular-nums" style={{ color: "#848181" }}>
                      {when(item.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item)}
                    disabled={disabled || deleting}
                    aria-label={`Delete chat: ${item.title || "Untitled chat"}`}
                    title="Delete chat"
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-lg transition-colors text-[#848181] hover:text-[#EA5455] hover:bg-[#EA5455]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EA5455]/40 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <TrashIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && !error && hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="w-full mt-2 min-h-[40px] text-xs font-bold rounded-lg transition-colors hover:bg-[#F9F7ED] disabled:opacity-50 cursor-pointer"
            style={{ color: "#812549" }}
          >
            {loadingMore ? "Loading…" : "Show older chats"}
          </button>
        )}
      </div>
    </nav>
  );
}
