import { Edit3, RefreshCcw, Search } from "lucide-react";

type Props = {
  title: string;
  search: string;
  unreadOnly: boolean;
  flaggedOnly: boolean;
  canCompose: boolean;
  onSearch: (value: string) => void;
  onUnreadOnly: (value: boolean) => void;
  onFlaggedOnly: (value: boolean) => void;
  onRefresh: () => void;
  onCompose: () => void;
};

export function MailToolbar({
  title,
  search,
  unreadOnly,
  flaggedOnly,
  canCompose,
  onSearch,
  onUnreadOnly,
  onFlaggedOnly,
  onRefresh,
  onCompose,
}: Props) {
  return (
    <header className="mail-list-toolbar">
      <div>
        <p className="mail-section-label">Mailbox</p>
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
      <label className="mail-check">
        <input type="checkbox" checked={unreadOnly} onChange={(event) => onUnreadOnly(event.target.checked)} />
        Unread
      </label>
      <label className="mail-check">
        <input type="checkbox" checked={flaggedOnly} onChange={(event) => onFlaggedOnly(event.target.checked)} />
        Flagged
      </label>
      <button type="button" onClick={onRefresh} aria-label="Refresh">
        <RefreshCcw size={17} />
      </button>
      {canCompose && (
        <button className="mail-primary-action" type="button" onClick={onCompose}>
          <Edit3 size={17} />
          Compose
        </button>
      )}
    </header>
  );
}
