import { useSyncExternalStore } from "react";
import Icon from "./Icon.jsx";
import { isWaking, subscribeWaking } from "../api/wake.js";
import styles from "./WakingNotice.module.css";

/**
 * "Waking up Jobuddy…", pinned to the bottom of the screen while a sleeping
 * API server starts (see api/wake.js). Shown only once a wake has taken a
 * couple of seconds, and gone the moment the server answers. Nothing to act
 * on, so it's a polite status with no close button.
 */
export default function WakingNotice() {
  const waking = useSyncExternalStore(subscribeWaking, isWaking, () => false);

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      {waking && (
        <div className={styles.notice}>
          <span className={styles.spin}>
            <Icon name="loader" />
          </span>
          <span>
            <strong>Waking up Jobuddy…</strong> After a quiet spell this can take up to a
            minute. Your request will go through on its own.
          </span>
        </div>
      )}
    </div>
  );
}
