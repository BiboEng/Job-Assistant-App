import { useCallback, useEffect, useMemo, useState } from "react";
import ApplicationCard from "../components/ApplicationCard.jsx";
import ApplicationDialog from "../components/ApplicationDialog.jsx";
import KanbanColumn from "../components/KanbanColumn.jsx";
import Icon from "../components/Icon.jsx";
import Toast from "../components/Toast.jsx";
import { useApplications } from "../applications/useApplications.js";
import { COLUMNS, groupByColumn, stageLabel } from "../applications/applicationModel.js";
import styles from "./TrackerScreen.module.css";

/**
 * The Application Tracker: a four-column board of every role the user is
 * pursuing — Saved, Applied, Interviewing, Accepted / Rejected.
 *
 * Cards arrive two ways: "Track this" on a Job Matches result (lands in
 * Saved), or "Add application" here for a job found anywhere else. Both write
 * the same `user_applications` row in Supabase; this screen reads them all.
 *
 * Standalone by design: no link to mock interviews or Progress, and no
 * reminders — an upcoming interview is flagged on its card, nothing more.
 */

/** Re-render every minute, so "Interview today" doesn't go stale on an open tab. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function TrackerScreen({ onFindJobs }) {
  const { status, error, applications, reload, add, update, move, remove } = useApplications();
  const now = useNow();

  const [dialog, setDialog] = useState(null); // { mode: "add" } | { mode: "edit", id }
  const [draggingId, setDraggingId] = useState(null);
  const [toast, setToast] = useState(null); // { message, tone }
  const [announcement, setAnnouncement] = useState("");
  // The card most recently moved, so it can settle visibly in its new column.
  const [landedId, setLandedId] = useState(null);

  const groups = useMemo(() => groupByColumn(applications, now), [applications, now]);
  const byId = useMemo(() => new Map(applications.map((a) => [a.id, a])), [applications]);
  const dragging = draggingId ? byId.get(draggingId) : null;
  const editing = dialog?.mode === "edit" ? byId.get(dialog.id) : null;

  const dismissToast = useCallback(() => setToast(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  function handleMove(id, stage) {
    const app = byId.get(id);
    if (!app || app.stage === stage) return;
    setAnnouncement(`Moved ${app.jobTitle} at ${app.company} to ${stageLabel(stage)}.`);
    setLandedId(id);
    move(id, stage).catch((err) => {
      setAnnouncement("");
      setToast({ tone: "error", message: `Couldn't move that card: ${err.message}` });
    });
  }

  function handleDrop(id, stage) {
    setDraggingId(null);
    if (id) handleMove(id, stage);
  }

  const handleUpdate = (id) => (patch) =>
    update(id, patch).catch((err) => {
      setToast({ tone: "error", message: `Couldn't save that change: ${err.message}` });
      throw err;
    });

  async function handleCreate(draft) {
    const created = await add(draft);
    setToast({ tone: "success", message: `Added ${created.jobTitle} to ${stageLabel(created.stage)}.` });
  }

  async function handleDelete(id) {
    const app = byId.get(id);
    try {
      await remove(id);
    } catch (err) {
      // The optimistic removal already closed the dialog, so the toast is the
      // only place left to say the card came back.
      setToast({ tone: "error", message: `Couldn't delete that application: ${err.message}` });
      throw err;
    }
    setToast({ tone: "success", message: `Deleted ${app?.jobTitle ?? "the application"}.` });
  }

  const ready = status === "ready";

  return (
    <div className={styles.wrap}>
      <div className="page-head">
        <div>
          <h1>Applications</h1>
          <p className="page-sub">
            Every role you're pursuing, from saved to signed. Drag a card, or use its stage menu, to
            move it along.
          </p>
        </div>
        {ready && (
          <button type="button" className="btn-primary" onClick={() => setDialog({ mode: "add" })}>
            <Icon name="plus" />
            Add application
          </button>
        )}
      </div>

      {status === "loading" && (
        <div className={styles.board} aria-busy="true" aria-label="Loading your applications">
          {COLUMNS.map((c) => (
            <div key={c.id} className={`${styles.skeletonColumn} skeleton`} />
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="error-banner" role="alert">
          {error}{" "}
          <button type="button" className="btn-ghost" onClick={reload}>
            Try again
          </button>
        </div>
      )}

      {status === "unavailable" && (
        <div className="empty-state">
          <Icon name="kanban" />
          <h2>The tracker isn't set up yet</h2>
          <p>
            Its database table hasn't been created. Apply{" "}
            <code className="mono">supabase/migrations/20260927100000_user_applications.sql</code> in
            the Supabase SQL editor, then reload this page.
          </p>
        </div>
      )}

      {ready && applications.length === 0 && (
        <div className="empty-state">
          <Icon name="kanban" />
          <h2>No applications yet</h2>
          <p>
            Add a role you found anywhere, or press “Track this” on a{" "}
            <button type="button" className="link-btn" onClick={onFindJobs}>
              Job Matches
            </button>{" "}
            result to save it here.
          </p>
          <button type="button" className="btn-primary" onClick={() => setDialog({ mode: "add" })}>
            <Icon name="plus" />
            Add application
          </button>
        </div>
      )}

      {ready && applications.length > 0 && (
        <div className={styles.board}>
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              count={groups[column.id].length}
              dragActive={Boolean(dragging)}
              draggingStage={dragging?.stage}
              onDrop={handleDrop}
            >
              {groups[column.id].map((app) => (
                <ApplicationCard
                  key={app.id}
                  app={app}
                  now={now}
                  dragging={app.id === draggingId}
                  landed={app.id === landedId}
                  onOpen={(id) => setDialog({ mode: "edit", id })}
                  onMove={handleMove}
                  onDragStart={setDraggingId}
                  onDragEnd={() => setDraggingId(null)}
                />
              ))}
            </KanbanColumn>
          ))}
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {dialog?.mode === "add" && (
        <ApplicationDialog mode="add" onCreate={handleCreate} onClose={closeDialog} />
      )}
      {dialog?.mode === "edit" && (
        <ApplicationDialog
          key={dialog.id}
          mode="edit"
          application={editing}
          onUpdate={handleUpdate(dialog.id)}
          onDelete={() => handleDelete(dialog.id)}
          onClose={closeDialog}
        />
      )}

      <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
    </div>
  );
}
