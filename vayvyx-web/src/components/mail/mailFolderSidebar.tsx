import { Archive, FilePenLine, Folder, Inbox, Send, ShieldAlert, Trash2 } from "lucide-react";
import type { MailFolder } from "../../types/mail.ts";

type Props = {
  folders: MailFolder[];
  selectedFolder: string;
  onSelect: (folder: MailFolder) => void;
};

const iconMap = {
  inbox: Inbox,
  sent: Send,
  drafts: FilePenLine,
  archive: Archive,
  trash: Trash2,
  junk: ShieldAlert,
  custom: Folder,
};

export function MailFolderSidebar({ folders, selectedFolder, onSelect }: Props) {
  return (
    <section className="mail-sidebar-section" aria-label="Folders">
      <p className="mail-section-label">Folders</p>
      <div className="mail-folder-list">
        {folders.map((folder) => {
          const Icon = iconMap[folder.specialUse];
          const countLabel = folder.unreadCount
            ? `${folder.unreadCount} unread`
            : folder.totalCount !== null
              ? `${folder.totalCount} total`
              : undefined;

          return (
            <button
              className={`mail-nav-item compact ${selectedFolder === folder.path ? "active" : ""}`}
              key={folder.path}
              type="button"
              disabled={!folder.selectable}
              aria-label={countLabel ? `${folder.displayName}, ${countLabel}` : folder.displayName}
              onClick={() => onSelect(folder)}
            >
              <Icon size={16} />
              <span>
                <strong>{folder.displayName}</strong>
              </span>
              {folder.unreadCount ? <em>{folder.unreadCount}</em> : null}
              {!folder.unreadCount && folder.totalCount !== null ? <em>{folder.totalCount}</em> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
