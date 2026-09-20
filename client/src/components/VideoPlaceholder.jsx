import Icon from "./Icon.jsx";
import styles from "./VideoPlaceholder.module.css";

/**
 * A 16:9 slot for a feature's tutorial video.
 *
 * Until a video exists it renders a labelled placeholder. To fill it in, give
 * the feature in LandingScreen's HOW_IT_WORKS list one of:
 *   - `src`      a video file (e.g. "/videos/resume-builder.mp4" dropped in
 *                client/public/videos/) → a native <video> with controls
 *   - `embedUrl` a hosted player URL (e.g. "https://www.youtube-nocookie.com/embed/<id>")
 *                → a sandboxed iframe
 * `src` wins if both are set. `poster` is an optional still for `src`.
 *
 * `label` is used as the accessible name either way, so every video says which
 * feature it's teaching.
 */
export default function VideoPlaceholder({ label, src, embedUrl, poster }) {
  if (src) {
    return (
      <div className={styles.frame}>
        <video
          className={styles.media}
          controls
          preload="metadata"
          playsInline
          poster={poster || undefined}
          aria-label={label}
        >
          <source src={src} />
          Your browser can't play this video.
        </video>
      </div>
    );
  }

  if (embedUrl) {
    return (
      <div className={styles.frame}>
        <iframe
          className={styles.media}
          src={embedUrl}
          title={label}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className={`${styles.frame} ${styles.placeholder}`} role="img" aria-label={`${label} — coming soon`}>
      <span className={styles.play} aria-hidden="true">
        <Icon name="play" size={22} strokeWidth={2} />
      </span>
      <span className={styles.label}>{label}</span>
      <span className={styles.hint}>Tutorial video coming soon</span>
    </div>
  );
}
