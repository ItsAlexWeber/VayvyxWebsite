type Props = {
  busy: boolean;
  result: string;
  onTestImap: () => void;
  onTestSmtp: () => void;
};

export function MailConnectionTestPanel({ busy, result, onTestImap, onTestSmtp }: Props) {
  return (
    <div className="mail-admin-panel">
      <h3>Connection tests</h3>
      <div className="mail-admin-actions">
        <button type="button" onClick={onTestImap} disabled={busy}>Test IMAP</button>
        <button type="button" onClick={onTestSmtp} disabled={busy}>Test SMTP</button>
      </div>
      {result && <p className="mail-status" aria-live="polite">{result}</p>}
    </div>
  );
}
