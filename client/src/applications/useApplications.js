import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider.jsx";
import {
  createApplication,
  deleteApplication,
  listApplications,
  updateApplication,
} from "./applicationsApi.js";
import { stagePatch } from "./applicationModel.js";

/**
 * The signed-in user's applications, and the writes that change them.
 *
 * `status` is one of:
 *   "loading"      first read in flight
 *   "ready"        `applications` is the list
 *   "unavailable"  no Supabase, or the migration hasn't been applied
 *   "error"        the read failed; `error` says why, `reload()` retries
 *
 * Moves and edits are optimistic: the board changes on the drop, not on the
 * round trip. If the write fails, only the fields that write touched are put
 * back — and only if nothing has changed them since — and the promise rejects
 * so the screen can say so. A card that snaps back without a word reads as a
 * broken drag.
 */
export function useApplications() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [applications, setApplications] = useState([]);

  const appsRef = useRef(applications);
  const commit = useCallback((next) => {
    appsRef.current = typeof next === "function" ? next(appsRef.current) : next;
    setApplications(appsRef.current);
  }, []);

  const reload = useCallback(() => {
    let cancelled = false;
    setStatus("loading");
    setError("");
    listApplications(userId)
      .then((result) => {
        if (cancelled) return;
        commit(result.applications);
        setStatus(result.available ? "ready" : "unavailable");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Could not load your applications.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, commit]);

  useEffect(() => reload(), [reload]);

  const add = useCallback(
    async (draft) => {
      const created = await createApplication(userId, draft);
      commit((list) => [created, ...list.filter((a) => a.id !== created.id)]);
      return created;
    },
    [userId, commit]
  );

  const update = useCallback(
    async (id, patch) => {
      const before = appsRef.current.find((a) => a.id === id);
      if (!before) throw new Error("That application no longer exists.");

      const optimistic = { ...patch, updatedAt: new Date().toISOString() };
      commit((list) => list.map((a) => (a.id === id ? { ...a, ...optimistic } : a)));

      try {
        const saved = await updateApplication(userId, id, patch);
        // Take the server's timestamp, and its normalized version of exactly
        // the fields this write sent. Not the whole row: two edits in flight
        // can resolve out of order, and the older row would undo the newer.
        const confirmed = { updatedAt: saved.updatedAt };
        for (const key of Object.keys(patch)) confirmed[key] = saved[key];
        commit((list) => list.map((a) => (a.id === id ? { ...a, ...confirmed } : a)));
        return saved;
      } catch (err) {
        commit((list) =>
          list.map((a) => {
            if (a.id !== id) return a;
            const reverted = { ...a };
            for (const key of Object.keys(patch)) {
              if (a[key] === patch[key]) reverted[key] = before[key];
            }
            if (a.updatedAt === optimistic.updatedAt) reverted.updatedAt = before.updatedAt;
            return reverted;
          })
        );
        throw err;
      }
    },
    [userId, commit]
  );

  const move = useCallback(
    (id, stage) => {
      const app = appsRef.current.find((a) => a.id === id);
      if (!app || app.stage === stage) return Promise.resolve(app);
      return update(id, stagePatch(app, stage));
    },
    [update]
  );

  const remove = useCallback(
    async (id) => {
      const index = appsRef.current.findIndex((a) => a.id === id);
      if (index === -1) return;
      const removed = appsRef.current[index];
      commit((list) => list.filter((a) => a.id !== id));
      try {
        await deleteApplication(userId, id);
      } catch (err) {
        commit((list) => {
          const next = [...list];
          next.splice(Math.min(index, next.length), 0, removed);
          return next;
        });
        throw err;
      }
    },
    [userId, commit]
  );

  return { status, error, applications, reload, add, update, move, remove };
}
