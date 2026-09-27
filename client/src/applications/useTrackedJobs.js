import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider.jsx";
import { createApplication, listTrackedJobIds } from "./applicationsApi.js";
import { draftFromJob } from "./applicationModel.js";

/**
 * Job Matches' side of the tracker: which listings are already on the board,
 * and "Track this".
 *
 * `available` is false until the read confirms the table exists — so the
 * button never flashes in and then disappears for a project that hasn't
 * applied the migration. A failed read also leaves it false: an error banner
 * about a secondary button on a results page is worse than no button.
 *
 * `stateOf(job)` → "idle" | "saving" | "tracked" | "error".
 */
export function useTrackedJobs() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [available, setAvailable] = useState(false);
  const [tracked, setTracked] = useState(() => new Set());
  const [pending, setPending] = useState(() => new Map()); // jobId → "saving" | "error"
  const inFlight = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    listTrackedJobIds(userId)
      .then((result) => {
        if (cancelled) return;
        setTracked(result.ids);
        setAvailable(result.available);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setJobState = useCallback((id, state) => {
    setPending((prev) => {
      const next = new Map(prev);
      if (state) next.set(id, state);
      else next.delete(id);
      return next;
    });
  }, []);

  const track = useCallback(
    async (job) => {
      const id = job?.id;
      if (!id || inFlight.current.has(id)) return false;
      inFlight.current.add(id);
      setJobState(id, "saving");
      try {
        await createApplication(userId, draftFromJob(job));
      } catch (err) {
        // Already on the board (another tab, or a click that beat the
        // button's disabled state): that's the outcome the user wanted.
        if (!err.duplicate) {
          setJobState(id, "error");
          inFlight.current.delete(id);
          throw err;
        }
      }
      setTracked((prev) => new Set(prev).add(id));
      setJobState(id, null);
      inFlight.current.delete(id);
      return true;
    },
    [userId, setJobState]
  );

  const stateOf = useCallback(
    (job) => (tracked.has(job.id) ? "tracked" : pending.get(job.id) || "idle"),
    [tracked, pending]
  );

  return { available, track, stateOf };
}
