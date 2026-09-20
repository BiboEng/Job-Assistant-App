import Icon from "./Icon.jsx";
import styles from "./BrandMark.module.css";

/**
 * The wordmark badge — the same gradient mic as the favicon. Shared by the app
 * header and the public site header so the front door and the product carry
 * one identity.
 */
export default function BrandMark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <Icon name="mic" size={15} strokeWidth={2} />
    </span>
  );
}
