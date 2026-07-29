import { Edit3, Home, Mail, PanelLeftClose, PanelLeftOpen, Settings, UserRound } from "lucide-react";

type Props = {
  canManage: boolean;
  canCompose: boolean;
  isMailNavigationCollapsed: boolean;
  onCompose: () => void;
  onToggleMailNavigation: () => void;
  onHome: () => void;
  onAccount: () => void;
  onSettings: () => void;
};

export function MailNavigationRail({
  canManage,
  canCompose,
  isMailNavigationCollapsed,
  onCompose,
  onToggleMailNavigation,
  onHome,
  onAccount,
  onSettings,
}: Props) {
  const toggleLabel = isMailNavigationCollapsed ? "Expand mail navigation" : "Collapse mail navigation";

  return (
    <aside className="mail-navigation-rail" aria-label="Primary mail navigation">
      <div className="mail-rail-logo" title="Vayvyx Mail" aria-label="Vayvyx Mail">
        <img src="/vayvyx-logo.png" alt="" />
      </div>
      <nav>
        <button className="active" type="button" aria-label="Mail" title="Mail">
          <Mail size={19} />
        </button>
        {canCompose && (
          <button
            className="mail-rail-compose"
            type="button"
            onClick={onCompose}
            onKeyDown={(event) => activateButtonFromKeyboard(event, onCompose)}
            aria-label="Compose new email"
            title="New email"
          >
            <Edit3 size={19} />
          </button>
        )}
        <button
          className="mail-rail-toggle"
          type="button"
          onClick={onToggleMailNavigation}
          onKeyDown={(event) => activateButtonFromKeyboard(event, onToggleMailNavigation)}
          aria-label={toggleLabel}
          aria-controls="mail-navigation-pane"
          aria-expanded={!isMailNavigationCollapsed}
          title={toggleLabel}
        >
          {isMailNavigationCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </button>
        <button type="button" onClick={onHome} aria-label="Home" title="Home">
          <Home size={19} />
        </button>
        <button type="button" onClick={onAccount} aria-label="Account" title="Account">
          <UserRound size={19} />
        </button>
        {canManage && (
          <button type="button" onClick={onSettings} aria-label="Mail settings" title="Mail settings">
            <Settings size={19} />
          </button>
        )}
      </nav>
    </aside>
  );
}

function activateButtonFromKeyboard(
  event: React.KeyboardEvent<HTMLButtonElement>,
  action: () => void
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}
