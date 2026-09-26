import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";
import styles from "./CameraPreview.module.css";

/**
 * The self-view shown during a Speak-mode interview.
 *
 * It exists so nobody is ever being watched by a camera they've forgotten about:
 * while the mode is active the preview is on screen, and when it disappears the
 * camera is genuinely off. It's also the fastest way to notice you've drifted
 * out of frame and correct it.
 *
 * Mirrored horizontally, the way every video-call self-view is — an unmirrored
 * view of yourself is disconcerting enough to be a distraction during an
 * interview. The mirroring is presentational only; the tracker reads the
 * unmirrored element.
 */
export default function CameraPreview({ attachVideo, recording, eyeTracking }) {
  const ref = useRef(null);

  useEffect(() => {
    attachVideo(ref.current);
    return () => attachVideo(null);
  }, [attachVideo]);

  return (
    <div className={styles.wrap}>
      <video
        ref={ref}
        className={styles.video}
        autoPlay
        playsInline
        // Never play the candidate's own microphone back at them.
        muted
      />

      <div className={styles.badge}>
        {recording ? (
          <>
            <span className={styles.dot} aria-hidden="true" />
            Recording
          </>
        ) : (
          <>
            <Icon name="video" />
            Camera on
          </>
        )}
      </div>

      {!eyeTracking && (
        <span className={styles.noTrack} title="Eye-contact tracking couldn't start">
          <Icon name="videoOff" />
        </span>
      )}

      {/* Short enough not to wrap to three lines under a 132px tile. The full
          explanation lives on the setup screen and in the composer note. */}
      <p className={styles.caption}>Analysed in your browser</p>
    </div>
  );
}
