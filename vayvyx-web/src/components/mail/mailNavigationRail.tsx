import { Home, Mail, Settings, UserRound } from "lucide-react";

type Props = {
  canManage: boolean;
  onHome: () => void;
  onAccount: () => void;
  onSettings: () => void;
};

export function MailNavigationRail({ canManage, onHome, onAccount, onSettings }: Props) {
  return (
    <aside className="mail-navigation-rail" aria-label="Primary mail navigation">
      <div className="mail-rail-logo" title="Vayvyx Mail" aria-label="Vayvyx Mail">
        <img src="/vayvyx-logo.png" alt="" />
      </div>
      <nav>
        <button className="active" type="button" aria-label="Mail" title="Mail">
          <Mail size={19} />
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
