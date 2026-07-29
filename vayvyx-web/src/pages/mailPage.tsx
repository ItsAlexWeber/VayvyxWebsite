/* eslint-disable react-hooks/set-state-in-effect */
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NavigateWithTransition } from "../app.tsx";
import { MailAccountSwitcher } from "../components/mail/mailAccountSwitcher.tsx";
import { MailComposeModal } from "../components/mail/mailComposeModal.tsx";
import { MailFolderSidebar } from "../components/mail/mailFolderSidebar.tsx";
import { MailMessageList } from "../components/mail/mailMessageList.tsx";
import { MailMessageViewer } from "../components/mail/mailMessageViewer.tsx";
import { MailNavigationRail } from "../components/mail/mailNavigationRail.tsx";
import {
  readMailNavigationCollapsedPreference,
  writeMailNavigationCollapsedPreference,
} from "../components/mail/mailNavigationPreference.ts";
import { MailToolbar } from "../components/mail/mailToolbar.tsx";
import { canUseRole } from "../components/mail/mailUtils.ts";
import { mailApi, MailApiRequestError, setMailApiAuthRequiredHandler } from "../lib/mailApi.ts";
import type {
  MailAccountSummary,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  SendMessageRequest,
  UnifiedMailboxFailure,
  UnifiedMessageSummary,
} from "../types/mail.ts";
import "../styles/mailPage.css";

type Props = {
  onNavigate: NavigateWithTransition;
};

type Panel = "sidebar" | "list" | "viewer";

export function MailPage({ onNavigate }: Props) {
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("INBOX");
  const [isUnified, setIsUnified] = useState(true);
  const [messages, setMessages] = useState<Array<MailMessageSummary | UnifiedMessageSummary>>([]);
  const [selectedMessage, setSelectedMessage] = useState<MailMessageSummary | UnifiedMessageSummary | null>(null);
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [composeMode, setComposeMode] = useState<SendMessageRequest["mode"] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [unifiedFailures, setUnifiedFailures] = useState<UnifiedMailboxFailure[]>([]);
  const [panel, setPanel] = useState<Panel>("sidebar");
  const [isMailNavigationCollapsed, setIsMailNavigationCollapsed] = useState(
    readMailNavigationCollapsedPreference
  );
  const listAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const activeMessageAccount = useMemo(
    () =>
      accounts.find((account) => account.id === selectedMessage?.mailAccountId) ??
      selectedAccount,
    [accounts, selectedAccount, selectedMessage]
  );

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    setError("");
    try {
      const nextAccounts = await mailApi.getAccounts();
      if (nextAccounts.length === 0) {
        setAccounts([]);
        setError("No mailboxes are assigned to this account.");
        return;
      }
      setAccounts(nextAccounts);
      const sessionSelected = window.sessionStorage.getItem("vayvyx:selectedMailbox");
      const nextSelected =
        nextAccounts.find((account) => account.id === sessionSelected) ?? nextAccounts[0];
      setSelectedAccountId(nextSelected.id);
      setPanel("list");
    } catch (caught) {
      handleRouteError(caught, onNavigate, setError);
    } finally {
      setLoadingAccounts(false);
    }
  }, [onNavigate]);

  useEffect(() => {
    setMailApiAuthRequiredHandler(() => onNavigate("/login"));
    loadAccounts();
    return () => setMailApiAuthRequiredHandler(null);
  }, [loadAccounts, onNavigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 260);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!selectedAccountId || isUnified) return;
    const controller = new AbortController();
    mailApi
      .getFolders(selectedAccountId, controller.signal)
      .then((nextFolders) => {
        setFolders(nextFolders);
        if (!nextFolders.some((folder) => folder.path === selectedFolder)) {
          setSelectedFolder(nextFolders.find((folder) => folder.specialUse === "inbox")?.path ?? nextFolders[0]?.path ?? "INBOX");
        }
      })
      .catch((caught) => handleSoftError(caught, setError));
    return () => controller.abort();
  }, [isUnified, selectedAccountId, selectedFolder]);

  const loadMessages = useCallback(async () => {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setLoadingMessages(true);
    setError("");
    setSelectedMessage(null);
    setDetail(null);

    try {
      if (isUnified) {
        const response = await mailApi.getUnifiedMessages(
          {
            limit: 50,
            search: debouncedSearch,
            unreadOnly,
            flaggedOnly,
          },
          controller.signal
        );
        setMessages(response.messages);
        setUnifiedFailures(response.failures);
      } else if (selectedAccountId) {
        const response = await mailApi.getMessages(
          selectedAccountId,
          {
            folder: selectedFolder,
            limit: 50,
            search: debouncedSearch,
            unreadOnly,
            flaggedOnly,
            sortDirection: "desc",
          },
          controller.signal
        );
        setMessages(response.messages);
        setUnifiedFailures([]);
      }
    } catch (caught) {
      if (!controller.signal.aborted) handleSoftError(caught, setError);
    } finally {
      if (!controller.signal.aborted) setLoadingMessages(false);
    }
  }, [debouncedSearch, flaggedOnly, isUnified, selectedAccountId, selectedFolder, unreadOnly]);

  useEffect(() => {
    if (accounts.length > 0) void loadMessages();
  }, [accounts.length, loadMessages]);

  async function openMessage(message: MailMessageSummary | UnifiedMessageSummary) {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setSelectedMessage(message);
    setLoadingDetail(true);
    setPanel("viewer");
    try {
      const nextDetail = await mailApi.getMessage(
        message.mailAccountId,
        message.folder,
        message.uid,
        controller.signal
      );
      setDetail(nextDetail);
    } catch (caught) {
      if (!controller.signal.aborted) handleSoftError(caught, setError);
    } finally {
      if (!controller.signal.aborted) setLoadingDetail(false);
    }
  }

  function closeMessage() {
    detailAbortRef.current?.abort();
    setSelectedMessage(null);
    setDetail(null);
    setLoadingDetail(false);
    setPanel("list");
  }

  function selectAccount(account: MailAccountSummary) {
    window.sessionStorage.setItem("vayvyx:selectedMailbox", account.id);
    setSelectedAccountId(account.id);
    setIsUnified(false);
    setSelectedFolder("INBOX");
    setSelectedMessage(null);
    setDetail(null);
    setPanel("list");
  }

  function selectUnified() {
    setIsUnified(true);
    setSelectedMessage(null);
    setDetail(null);
    setPanel("list");
  }

  async function runAction(action: () => Promise<unknown>) {
    try {
      await action();
      await loadMessages();
    } catch (caught) {
      handleSoftError(caught, setError);
    }
  }

  async function send(input: SendMessageRequest, attachments: File[]) {
    const accountId = activeMessageAccount?.id ?? selectedAccountId;
    if (!accountId) throw new Error("Choose a mailbox first.");
    const result = await mailApi.send(accountId, input, attachments);
    await loadMessages();
    return result;
  }

  const openCompose = useCallback(() => setComposeMode("compose"), []);

  const toggleMailNavigation = useCallback(() => {
    setIsMailNavigationCollapsed((current) => {
      const next = !current;
      writeMailNavigationCollapsedPreference(next);
      return next;
    });
  }, []);

  async function downloadAttachment(attachmentId: string) {
    if (!detail) return;
    setDownloadingId(attachmentId);
    try {
      await mailApi.downloadAttachment(detail.mailAccountId, detail.folder, detail.uid, attachmentId);
    } catch (caught) {
      handleSoftError(caught, setError);
    } finally {
      setDownloadingId(null);
    }
  }

  const title = isUnified
    ? "Unified Inbox"
    : folders.find((folder) => folder.path === selectedFolder)?.displayName ?? selectedAccount?.displayName ?? "Mailbox";
  const canManage = accounts.some((account) => account.currentUserRole === "admin");
  const canCompose = canUseRole(selectedAccount, "sender");
  const readerOpen = selectedMessage !== null;

  if (loadingAccounts) {
    return <main className="mail-page"><div className="mail-state">Opening Vayvyx Mail...</div></main>;
  }

  if (accounts.length === 0) {
    return (
      <main className="mail-page">
        <section className="mail-access-state">
          <h1>Mail access unavailable</h1>
          <p>{error || "No mailboxes are assigned to this account."}</p>
          <button type="button" onClick={() => onNavigate("/account")}>Back to account</button>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`mail-page ${readerOpen ? "has-reader" : "no-reader"} ${isMailNavigationCollapsed ? "nav-collapsed" : ""}`}
      data-reader-state={readerOpen ? "open" : "closed"}
    >
      <MailNavigationRail
        canManage={canManage}
        canCompose={canCompose}
        isMailNavigationCollapsed={isMailNavigationCollapsed}
        onCompose={openCompose}
        onToggleMailNavigation={toggleMailNavigation}
        onHome={() => onNavigate("/")}
        onAccount={() => onNavigate("/account")}
        onSettings={() => onNavigate("/admin/mail/settings")}
      />
      <aside
        id="mail-navigation-pane"
        className={`mail-shell-sidebar ${panel === "sidebar" ? "mobile-active" : ""}`}
      >
        <header className="mail-brand">
          <img src="/vayvyx-logo.png" alt="" />
          <div>
            <strong>Vayvyx Mail</strong>
            <small>Company workspace</small>
          </div>
        </header>
        <MailAccountSwitcher
          accounts={accounts}
          selectedId={selectedAccountId}
          isUnified={isUnified}
          onSelectUnified={selectUnified}
          onSelectAccount={selectAccount}
          canCompose={canCompose}
          onCompose={openCompose}
        />
        {!isUnified && (
          <MailFolderSidebar
            folders={folders}
            selectedFolder={selectedFolder}
            onSelect={(folder) => {
              setSelectedFolder(folder.path);
              setSelectedMessage(null);
              setDetail(null);
              setPanel("list");
            }}
          />
        )}
      </aside>

      <section className={`mail-shell-list ${panel === "list" ? "mobile-active" : ""}`}>
        <button className="mail-mobile-back" type="button" onClick={() => setPanel("sidebar")}>
          <ArrowLeft size={16} /> Mailboxes
        </button>
        <MailToolbar
          title={title}
          search={search}
          unreadOnly={unreadOnly}
          flaggedOnly={flaggedOnly}
          onSearch={setSearch}
          onUnreadOnly={setUnreadOnly}
          onFlaggedOnly={setFlaggedOnly}
          canCompose={canCompose}
          onCompose={openCompose}
          onRefresh={loadMessages}
        />
        {unifiedFailures.length > 0 && (
          <p className="mail-warning" aria-live="polite">
            Some mailboxes are temporarily unavailable. Messages from healthy mailboxes are shown.
          </p>
        )}
        {error && <p className="mail-warning" aria-live="polite">{error}</p>}
        <MailMessageList
          messages={messages}
          selectedUid={selectedMessage?.uid ?? null}
          selectedMailAccountId={selectedMessage?.mailAccountId ?? null}
          loading={loadingMessages}
          error={error}
          emptyText={debouncedSearch ? "No messages match this search." : "No messages to show."}
          onSelect={openMessage}
        />
      </section>

      {readerOpen && (
        <section className={`mail-shell-viewer ${panel === "viewer" ? "mobile-active" : ""}`}>
          <button className="mail-mobile-back" type="button" onClick={() => setPanel("list")}>
            <ArrowLeft size={16} /> Messages
          </button>
          <MailMessageViewer
            account={activeMessageAccount}
            message={detail}
            loading={loadingDetail}
            downloadingId={downloadingId}
            onDownload={downloadAttachment}
            onReply={setComposeMode}
            onToggleRead={() => detail && runAction(() => mailApi.setRead(detail.mailAccountId, detail.folder, detail.uid, !detail.unread))}
            onToggleFlag={() => detail && runAction(() => mailApi.setFlagged(detail.mailAccountId, detail.folder, detail.uid, !detail.flagged))}
            onArchive={() => detail && runAction(() => mailApi.archive(detail.mailAccountId, detail.folder, detail.uid))}
            onTrash={() => detail && runAction(() => mailApi.trash(detail.mailAccountId, detail.folder, detail.uid))}
            onMove={() => {
              if (!detail) return;
              const destination = window.prompt("Move to folder path");
              if (destination) {
                void runAction(() =>
                  mailApi.move(detail.mailAccountId, detail.uid, detail.folder, destination)
                );
              }
            }}
            onClose={closeMessage}
          />
        </section>
      )}

      {composeMode && (activeMessageAccount ?? selectedAccount) && (
        <MailComposeModal
          account={(activeMessageAccount ?? selectedAccount)!}
          mode={composeMode}
          originalMessage={composeMode === "compose" ? null : detail}
          onClose={() => setComposeMode(null)}
          onSend={send}
        />
      )}
    </main>
  );
}

function handleRouteError(
  caught: unknown,
  onNavigate: NavigateWithTransition,
  setError: (value: string) => void
) {
  if (caught instanceof MailApiRequestError && caught.code === "AUTH_REQUIRED") {
    onNavigate("/login");
    return;
  }
  handleSoftError(caught, setError);
}

function handleSoftError(caught: unknown, setError: (value: string) => void) {
  if (caught instanceof DOMException && caught.name === "AbortError") return;
  if (caught instanceof MailApiRequestError) {
    setError(caught.message);
    return;
  }
  setError(caught instanceof Error ? caught.message : "Mail is temporarily unavailable.");
}
