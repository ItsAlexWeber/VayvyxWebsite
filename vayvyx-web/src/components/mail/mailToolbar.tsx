import { MailOpen, MoreHorizontal, RefreshCcw, Search, Star } from "lucide-react";

type Props = {
  title: string;
  search: string;
  unreadOnly: boolean;
  flaggedOnly: boolean;
  onSearch: (value: string) => void;
  onUnreadOnly: (value: boolean) => void;
  onFlaggedOnly: (value: boolean) => void;
  onRefresh: () => void;
};

export function MailToolbar({
  title,
  search,
  unreadOnly,
  flaggedOnly,
  onSearch,
  onUnreadOnly,
  onFlaggedOnly,
  onRefresh,
}: Props) {
  return (
    <header className="mail-list-toolbar">
      <div className="mail-toolbar-context">
        <p className="mail-section-label">Viewing</p>
        <h1>{title}</h1>
      </div>
      <label className="mail-search">
        <Search size={16} />
        <input
          aria-label="Search messages"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search"
        />
      </label>
      <div className="mail-filter-group" aria-label="Message filters">
        <button
          type="button"
          className={`mail-filter-toggle ${unreadOnly ? "active" : ""}`}
          aria-pressed={unreadOnly}
          title="Unread only"
          onClick={() => onUnreadOnly(!unreadOnly)}
        >
          <MailOpen size={16} />
          <span>Unread</span>
        </button>
        <button
          type="button"
          className={`mail-filter-toggle ${flaggedOnly ? "active" : ""}`}
          aria-pressed={flaggedOnly}
          title="Flagged only"
          onClick={() => onFlaggedOnly(!flaggedOnly)}
        >
          <Star size={16} />
          <span>Flagged</span>
        </button>
      </div>
      <button type="button" onClick={onRefresh} aria-label="Refresh" title="Refresh">
        <RefreshCcw size={17} />
      </button>
      <button type="button" aria-label="Message options" title="Message options">
        <MoreHorizontal size={17} />
      </button>
    </header>
  );
}
