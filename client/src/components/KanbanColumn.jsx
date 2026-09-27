import { useEffect, useState } from "react";
import styles from "./KanbanColumn.module.css";
import { stageLabel } from "../applications/applicationModel.js";

/**
 * One board column: a header with its count, then its cards.
 *
 * It's a drop target while a card is being dragged. Most columns map to one
 * stage, so the whole column accepts the drop. "Accepted / Rejected" maps to
 * two, and a drop there has to say which — so while a drag is in progress
 * that column shows two drop zones, one per outcome, instead of guessing.
 *
 * Dropping a card on the column it's already in does nothing. The drag
 * itself is mouse-only; every card also has a stage <select>, which is how a
 * keyboard or touch user moves it.
 */
export default function KanbanColumn({ column, count, dragActive, draggingStage, onDrop, children }) {
  const [hovered, setOver] = useState(null); // the stage currently hovered, if any
  // A drag cancelled with Escape over a column may never fire dragleave, so
  // the highlight only counts while a drag is actually in progress.
  const over = dragActive ? hovered : null;
  useEffect(() => {
    if (!dragActive) setOver(null); // and it mustn't carry into the next drag
  }, [dragActive]);

  const multi = column.stages.length > 1;
  const isHome = column.stages.includes(draggingStage);

  function zoneProps(stage) {
    const accepts = dragActive && stage !== draggingStage;
    return {
      onDragOver: (e) => {
        if (!accepts) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (hovered !== stage) setOver(stage);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOver(null);
      },
      onDrop: (e) => {
        if (!accepts) return;
        e.preventDefault();
        setOver(null);
        onDrop?.(e.dataTransfer.getData("text/plain"), stage);
      },
    };
  }

  const singleZone = !multi ? zoneProps(column.stages[0]) : {};
  const headingId = `col-${column.id}`;

  return (
    <section
      className={[
        styles.column,
        dragActive && !multi && !isHome ? styles.target : "",
        !multi && over ? styles.over : "",
      ].join(" ")}
      aria-labelledby={headingId}
      {...singleZone}
    >
      <header className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {column.label}
        </h2>
        <span className={`${styles.count} mono`} aria-label={`${count} applications`}>
          {count}
        </span>
      </header>

      {multi && dragActive && (
        <div className={styles.zones}>
          {column.stages.map((stage) => (
            <div
              key={stage}
              className={[
                styles.zone,
                styles[`zone_${stage}`] || "",
                stage === draggingStage ? styles.zoneHome : "",
                over === stage ? styles.zoneOver : "",
              ].join(" ")}
              {...zoneProps(stage)}
            >
              {stage === draggingStage ? `Already ${stageLabel(stage).toLowerCase()}` : `Drop as ${stageLabel(stage).toLowerCase()}`}
            </div>
          ))}
        </div>
      )}

      {count > 0 ? (
        <ul className={styles.list}>{children}</ul>
      ) : (
        !(multi && dragActive) && (
          <p className={styles.empty}>{dragActive && !isHome ? "Drop here" : "Nothing here yet"}</p>
        )
      )}
    </section>
  );
}
