import { useEffect, useRef } from "react";
import styles from "./EditableText.module.css";

/**
 * An inline-editable run of text backed by the resume data model.
 *
 * contentEditable + React needs care: re-rendering a controlled contentEditable
 * on every keystroke resets the caret to the start. So this component is
 * deliberately *uncontrolled while focused* —
 *
 *   - the DOM text is only written from props when the element is NOT focused
 *     (and only when it actually differs), so an AI update or an undo lands
 *     immediately but typing is never interrupted;
 *   - the change is committed to state on blur (and on Enter), not per keystroke.
 *
 * Everything here is plain text: paste is intercepted and flattened, and no
 * markup can enter the document. That keeps the resume ATS-parseable and means
 * model output is never treated as HTML.
 */
export default function EditableText({
  value,
  onChange,
  placeholder = "",
  className = "",
  disabled = false,
  ariaLabel,
  maxLength,
  multiline = false,
  onEnter,
  onEmptyBackspace,
  focusKey,
}) {
  const ref = useRef(null);
  const focusedRef = useRef(false);

  // Sync DOM <- props, but never while the user is typing in this node.
  useEffect(() => {
    const el = ref.current;
    if (!el || focusedRef.current) return;
    const next = value ?? "";
    if (el.textContent !== next) el.textContent = next;
  }, [value]);

  // A locked field must not keep focus — otherwise the caret sits in a field the
  // user can no longer type into.
  useEffect(() => {
    if (disabled && focusedRef.current) {
      focusedRef.current = false;
      ref.current?.blur();
    }
  }, [disabled]);

  function readValue() {
    const raw = ref.current?.textContent ?? "";
    const collapsed = multiline
      ? raw.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n")
      : raw.replace(/\s+/g, " ");
    const trimmed = collapsed.trim();
    return maxLength ? trimmed.slice(0, maxLength) : trimmed;
  }

  function commit() {
    const next = readValue();
    // Write the cleaned text back so what's on screen matches what's in state.
    if (ref.current && ref.current.textContent !== next) {
      ref.current.textContent = next;
    }
    if (next !== (value ?? "")) onChange(next);
    return next;
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      if (onEnter) {
        e.preventDefault();
        commit();
        onEnter();
        return;
      }
      if (!multiline) {
        e.preventDefault();
        e.currentTarget.blur();
        return;
      }
    }
    if (e.key === "Escape") {
      // Abandon the edit: restore the value from state.
      e.preventDefault();
      if (ref.current) ref.current.textContent = value ?? "";
      e.currentTarget.blur();
      return;
    }
    if (
      e.key === "Backspace" &&
      onEmptyBackspace &&
      (ref.current?.textContent ?? "") === ""
    ) {
      e.preventDefault();
      onEmptyBackspace();
    }
  }

  // Strip formatting from pasted content — rich text would smuggle markup into
  // the document and break both the model round-trip and ATS parsing.
  function handlePaste(e) {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(
      /\r\n?/g,
      multiline ? "\n" : " "
    );
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return (
    <span
      ref={ref}
      className={`${styles.field} ${multiline ? styles.multiline : ""} ${className}`}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline={multiline || undefined}
      aria-readonly={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      spellCheck
      data-placeholder={placeholder}
      data-fkey={focusKey}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  );
}
