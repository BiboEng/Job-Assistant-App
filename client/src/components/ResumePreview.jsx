import { useCallback, useEffect, useRef, useState } from "react";
import EditableText from "./EditableText.jsx";
import Icon from "./Icon.jsx";
import { RESUME_LIMITS } from "../constants.js";
import {
  setContactField,
  setSummary,
  setEntryField,
  addEntry,
  removeEntry,
  moveEntry,
  setBullet,
  addBullet,
  removeBullet,
  skillItemsToText,
  skillItemsFromText,
  setLink,
  addLink,
  removeLink,
  sectionFull,
} from "../utils/resumeModel.js";
import styles from "./ResumePreview.module.css";

/**
 * The live resume preview — a single-column, ATS-friendly sheet rendered
 * entirely from the resume data model.
 *
 * Every visible field is an `EditableText` bound straight to that model, so
 * "the AI writes it" and "the user types it" are the same code path: both end
 * up calling `onChange` with a new document. There is no second copy of the
 * resume anywhere.
 *
 * Updates are dispatched as FUNCTIONS of the current document, never as objects
 * built from the render closure, so two updates in one event (commit the bullet
 * text, then split the bullet) compose instead of clobbering each other.
 *
 * `locked` is set while the AI is generating. It disables every field and every
 * structural control, and the parent lays a labelled overlay over the sheet.
 *
 * Layout notes for ATS parsing: one column, real headings in document order,
 * no tables, no icons carrying meaning, no text inside images. Editing chrome
 * (add/remove/reorder buttons) is marked `data-noexport` so the exporter can
 * strip it from the cloned sheet.
 */
export default function ResumePreview({ resume, onChange, locked = false, sheetRef }) {
  const ro = locked; // read-only shorthand
  const edit = onChange; // always called with an updater fn

  // After Enter splits a bullet, move the caret into the new one instead of
  // making the user click it.
  const [focusKey, setFocusKey] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!focusKey) return;
    const el = rootRef.current?.querySelector(`[data-fkey="${CSS.escape(focusKey)}"]`);
    if (el) {
      el.focus();
      // Put the caret at the end of whatever is already there.
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    setFocusKey(null);
  }, [focusKey]);

  // Stable identity: an inline arrow here would be a new callback every render,
  // so React would detach (null) and reattach the ref on each one.
  const setSheetRef = useCallback(
    (node) => {
      rootRef.current = node;
      if (sheetRef) sheetRef.current = node;
    },
    [sheetRef]
  );

  return (
    <div className={styles.sheet} ref={setSheetRef} aria-label="Resume preview">
      {/* --- header / contact ------------------------------------------ */}
      <header className={styles.header}>
        <h1 className={styles.name}>
          <EditableText
            value={resume.contact.name}
            onChange={(v) => edit((r) => setContactField(r, "name", v))}
            placeholder="Your name"
            ariaLabel="Full name"
            maxLength={RESUME_LIMITS.short}
            disabled={ro}
          />
        </h1>

        <p className={styles.headline}>
          <EditableText
            value={resume.contact.title}
            onChange={(v) => edit((r) => setContactField(r, "title", v))}
            placeholder="Target job title"
            ariaLabel="Professional title"
            maxLength={RESUME_LIMITS.short}
            disabled={ro}
          />
        </p>

        <p className={styles.contactLine}>
          <EditableText
            value={resume.contact.email}
            onChange={(v) => edit((r) => setContactField(r, "email", v))}
            placeholder="email@example.com"
            ariaLabel="Email address"
            maxLength={RESUME_LIMITS.line}
            disabled={ro}
          />
          <span className={styles.sep} aria-hidden="true">·</span>
          <EditableText
            value={resume.contact.phone}
            onChange={(v) => edit((r) => setContactField(r, "phone", v))}
            placeholder="Phone"
            ariaLabel="Phone number"
            maxLength={RESUME_LIMITS.short}
            disabled={ro}
          />
          <span className={styles.sep} aria-hidden="true">·</span>
          <EditableText
            value={resume.contact.location}
            onChange={(v) => edit((r) => setContactField(r, "location", v))}
            placeholder="City, State"
            ariaLabel="Location"
            maxLength={RESUME_LIMITS.line}
            disabled={ro}
          />
        </p>

        {(resume.contact.links.length > 0 || !ro) && (
          <p className={styles.contactLine}>
            {resume.contact.links.map((link, i) => (
              <span key={i} className={styles.link}>
                {i > 0 && <span className={styles.sep} aria-hidden="true">·</span>}
                <EditableText
                  value={link.url || link.label}
                  onChange={(v) => edit((r) => setLink(r, i, "url", v))}
                  placeholder="linkedin.com/in/you"
                  ariaLabel={`Link ${i + 1}`}
                  maxLength={RESUME_LIMITS.line}
                  disabled={ro}
                />
                {!ro && (
                  <button
                    type="button"
                    data-noexport=""
                    className={styles.iconBtn}
                    onClick={() => edit((r) => removeLink(r, i))}
                    title="Remove link"
                  >
                    <Icon name="x" size={12} strokeWidth={2.2} />
                    <span className="sr-only">Remove link {i + 1}</span>
                  </button>
                )}
              </span>
            ))}
            {!ro && resume.contact.links.length < RESUME_LIMITS.maxLinks && (
              <button
                type="button"
                data-noexport=""
                className={styles.addInline}
                onClick={() => edit(addLink)}
              >
                <Icon name="plus" size={11} strokeWidth={2.4} />
                Link
              </button>
            )}
          </p>
        )}
      </header>

      {/* --- summary ---------------------------------------------------- */}
      {(resume.summary || !ro) && (
        <Section title="Summary" empty={!resume.summary} locked={ro}>
          <p className={styles.summary}>
            <EditableText
              value={resume.summary}
              onChange={(v) => edit((r) => setSummary(r, v))}
              placeholder="A two or three sentence professional summary."
              ariaLabel="Professional summary"
              maxLength={RESUME_LIMITS.summary}
              multiline
              disabled={ro}
            />
          </p>
        </Section>
      )}

      {/* --- experience -------------------------------------------------- */}
      {(resume.experience.length > 0 || !ro) && (
        <Section
          title="Experience"
          empty={resume.experience.length === 0}
          locked={ro}
          onAdd={
            sectionFull(resume, "experience")
              ? null
              : () => edit((r) => addEntry(r, "experience"))
          }
          addLabel="Add role"
        >
          {resume.experience.map((entry, index) => (
            <article key={entry.id} className={styles.entry}>
              <EntryControls
                locked={ro}
                index={index}
                total={resume.experience.length}
                label={entry.role || "role"}
                onMove={(d) => edit((r) => moveEntry(r, "experience", entry.id, d))}
                onRemove={() => edit((r) => removeEntry(r, "experience", entry.id))}
              />

              <div className={styles.entryHead}>
                <h3 className={styles.entryTitle}>
                  <EditableText
                    value={entry.role}
                    onChange={(v) =>
                      edit((r) => setEntryField(r, "experience", entry.id, "role", v))
                    }
                    placeholder="Job title"
                    ariaLabel="Job title"
                    maxLength={RESUME_LIMITS.short}
                    disabled={ro}
                  />
                </h3>
                <DateRangeFields
                  section="experience"
                  entry={entry}
                  edit={edit}
                  locked={ro}
                  endPlaceholder="Present"
                />
              </div>

              <p className={styles.entrySub}>
                <EditableText
                  value={entry.company}
                  onChange={(v) =>
                    edit((r) => setEntryField(r, "experience", entry.id, "company", v))
                  }
                  placeholder="Company"
                  ariaLabel="Company"
                  maxLength={RESUME_LIMITS.short}
                  disabled={ro}
                />
                {(entry.location || !ro) && (
                  <>
                    <span className={styles.sep} aria-hidden="true">·</span>
                    <EditableText
                      value={entry.location}
                      onChange={(v) =>
                        edit((r) =>
                          setEntryField(r, "experience", entry.id, "location", v)
                        )
                      }
                      placeholder="Location"
                      ariaLabel="Job location"
                      maxLength={RESUME_LIMITS.line}
                      disabled={ro}
                    />
                  </>
                )}
              </p>

              <Bullets
                section="experience"
                entry={entry}
                edit={edit}
                locked={ro}
                onSplit={setFocusKey}
              />
            </article>
          ))}
        </Section>
      )}

      {/* --- education --------------------------------------------------- */}
      {(resume.education.length > 0 || !ro) && (
        <Section
          title="Education"
          empty={resume.education.length === 0}
          locked={ro}
          onAdd={
            sectionFull(resume, "education")
              ? null
              : () => edit((r) => addEntry(r, "education"))
          }
          addLabel="Add education"
        >
          {resume.education.map((entry, index) => (
            <article key={entry.id} className={styles.entry}>
              <EntryControls
                locked={ro}
                index={index}
                total={resume.education.length}
                label={entry.school || "education entry"}
                onMove={(d) => edit((r) => moveEntry(r, "education", entry.id, d))}
                onRemove={() => edit((r) => removeEntry(r, "education", entry.id))}
              />

              <div className={styles.entryHead}>
                <h3 className={styles.entryTitle}>
                  <EditableText
                    value={entry.school}
                    onChange={(v) =>
                      edit((r) => setEntryField(r, "education", entry.id, "school", v))
                    }
                    placeholder="School"
                    ariaLabel="School"
                    maxLength={RESUME_LIMITS.short}
                    disabled={ro}
                  />
                </h3>
                <DateRangeFields
                  section="education"
                  entry={entry}
                  edit={edit}
                  locked={ro}
                  endPlaceholder="Year"
                />
              </div>

              <p className={styles.entrySub}>
                <EditableText
                  value={entry.degree}
                  onChange={(v) =>
                    edit((r) => setEntryField(r, "education", entry.id, "degree", v))
                  }
                  placeholder="Degree"
                  ariaLabel="Degree"
                  maxLength={RESUME_LIMITS.line}
                  disabled={ro}
                />
                {(entry.location || !ro) && (
                  <>
                    <span className={styles.sep} aria-hidden="true">·</span>
                    <EditableText
                      value={entry.location}
                      onChange={(v) =>
                        edit((r) =>
                          setEntryField(r, "education", entry.id, "location", v)
                        )
                      }
                      placeholder="Location"
                      ariaLabel="School location"
                      maxLength={RESUME_LIMITS.line}
                      disabled={ro}
                    />
                  </>
                )}
              </p>

              {(entry.details || !ro) && (
                <p className={styles.details}>
                  <EditableText
                    value={entry.details}
                    onChange={(v) =>
                      edit((r) => setEntryField(r, "education", entry.id, "details", v))
                    }
                    placeholder="Honors, coursework, GPA (optional)"
                    ariaLabel="Education details"
                    maxLength={RESUME_LIMITS.details}
                    multiline
                    disabled={ro}
                  />
                </p>
              )}
            </article>
          ))}
        </Section>
      )}

      {/* --- skills ------------------------------------------------------ */}
      {(resume.skills.length > 0 || !ro) && (
        <Section
          title="Skills"
          empty={resume.skills.length === 0}
          locked={ro}
          onAdd={
            sectionFull(resume, "skills")
              ? null
              : () => edit((r) => addEntry(r, "skills"))
          }
          addLabel="Add skill group"
        >
          {resume.skills.map((group, index) => (
            <p key={group.id} className={styles.skillRow}>
              <EntryControls
                locked={ro}
                index={index}
                total={resume.skills.length}
                label={group.category || "skill group"}
                onMove={(d) => edit((r) => moveEntry(r, "skills", group.id, d))}
                onRemove={() => edit((r) => removeEntry(r, "skills", group.id))}
                inline
              />
              <strong className={styles.skillCategory}>
                <EditableText
                  value={group.category}
                  onChange={(v) =>
                    edit((r) => setEntryField(r, "skills", group.id, "category", v))
                  }
                  placeholder="Category"
                  ariaLabel="Skill category"
                  maxLength={RESUME_LIMITS.short}
                  disabled={ro}
                />
                :
              </strong>{" "}
              <EditableText
                value={skillItemsToText(group.items)}
                onChange={(v) =>
                  edit((r) =>
                    setEntryField(r, "skills", group.id, "items", skillItemsFromText(v))
                  )
                }
                placeholder="Comma, separated, skills"
                ariaLabel={`Skills in ${group.category || "this group"}`}
                disabled={ro}
              />
            </p>
          ))}
        </Section>
      )}

      {/* --- projects ---------------------------------------------------- */}
      {(resume.projects.length > 0 || !ro) && (
        <Section
          title="Projects"
          empty={resume.projects.length === 0}
          locked={ro}
          onAdd={
            sectionFull(resume, "projects")
              ? null
              : () => edit((r) => addEntry(r, "projects"))
          }
          addLabel="Add project"
        >
          {resume.projects.map((entry, index) => (
            <article key={entry.id} className={styles.entry}>
              <EntryControls
                locked={ro}
                index={index}
                total={resume.projects.length}
                label={entry.name || "project"}
                onMove={(d) => edit((r) => moveEntry(r, "projects", entry.id, d))}
                onRemove={() => edit((r) => removeEntry(r, "projects", entry.id))}
              />
              <div className={styles.entryHead}>
                <h3 className={styles.entryTitle}>
                  <EditableText
                    value={entry.name}
                    onChange={(v) =>
                      edit((r) => setEntryField(r, "projects", entry.id, "name", v))
                    }
                    placeholder="Project name"
                    ariaLabel="Project name"
                    maxLength={RESUME_LIMITS.short}
                    disabled={ro}
                  />
                </h3>
                {(entry.link || !ro) && (
                  <span className={styles.entryDates}>
                    <EditableText
                      value={entry.link}
                      onChange={(v) =>
                        edit((r) => setEntryField(r, "projects", entry.id, "link", v))
                      }
                      placeholder="Link"
                      ariaLabel="Project link"
                      maxLength={RESUME_LIMITS.line}
                      disabled={ro}
                    />
                  </span>
                )}
              </div>
              <Bullets
                section="projects"
                entry={entry}
                edit={edit}
                locked={ro}
                onSplit={setFocusKey}
              />
            </article>
          ))}
        </Section>
      )}

      {/* --- certifications ---------------------------------------------- */}
      {(resume.certifications.length > 0 || !ro) && (
        <Section
          title="Certifications"
          empty={resume.certifications.length === 0}
          locked={ro}
          onAdd={
            sectionFull(resume, "certifications")
              ? null
              : () => edit((r) => addEntry(r, "certifications"))
          }
          addLabel="Add certification"
        >
          {resume.certifications.map((entry, index) => (
            <p key={entry.id} className={styles.certRow}>
              <EntryControls
                locked={ro}
                index={index}
                total={resume.certifications.length}
                label={entry.name || "certification"}
                onMove={(d) => edit((r) => moveEntry(r, "certifications", entry.id, d))}
                onRemove={() => edit((r) => removeEntry(r, "certifications", entry.id))}
                inline
              />
              <EditableText
                value={entry.name}
                onChange={(v) =>
                  edit((r) => setEntryField(r, "certifications", entry.id, "name", v))
                }
                placeholder="Certification"
                ariaLabel="Certification name"
                maxLength={RESUME_LIMITS.line}
                disabled={ro}
              />
              {(entry.issuer || !ro) && (
                <>
                  <span className={styles.sep} aria-hidden="true">·</span>
                  <EditableText
                    value={entry.issuer}
                    onChange={(v) =>
                      edit((r) => setEntryField(r, "certifications", entry.id, "issuer", v))
                    }
                    placeholder="Issuer"
                    ariaLabel="Issuing organization"
                    maxLength={RESUME_LIMITS.short}
                    disabled={ro}
                  />
                </>
              )}
              {(entry.year || !ro) && (
                <>
                  <span className={styles.sep} aria-hidden="true">·</span>
                  <EditableText
                    value={entry.year}
                    onChange={(v) =>
                      edit((r) => setEntryField(r, "certifications", entry.id, "year", v))
                    }
                    placeholder="Year"
                    ariaLabel="Year earned"
                    maxLength={RESUME_LIMITS.short}
                    disabled={ro}
                  />
                </>
              )}
            </p>
          ))}
        </Section>
      )}
    </div>
  );
}

/** Start — end date pair, shared by experience and education. */
function DateRangeFields({ section, entry, edit, locked, endPlaceholder }) {
  return (
    <span className={styles.entryDates}>
      <EditableText
        value={entry.start}
        onChange={(v) => edit((r) => setEntryField(r, section, entry.id, "start", v))}
        placeholder="Start"
        ariaLabel="Start date"
        maxLength={RESUME_LIMITS.short}
        disabled={locked}
      />
      <span className={styles.dash} aria-hidden="true">—</span>
      <EditableText
        value={entry.end}
        onChange={(v) => edit((r) => setEntryField(r, section, entry.id, "end", v))}
        placeholder={endPlaceholder}
        ariaLabel="End date"
        maxLength={RESUME_LIMITS.short}
        disabled={locked}
      />
    </span>
  );
}

/**
 * One resume section. When the section has no entries yet, the heading and the
 * add button are both marked `data-noexport` — an empty "Projects" heading
 * should be an editing affordance on screen, not a line in the PDF.
 */
function Section({ title, children, empty = false, locked, onAdd, addLabel }) {
  return (
    <section className={styles.section} data-noexport={empty ? "" : undefined}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
      {!locked && onAdd && (
        <button type="button" data-noexport="" className={styles.addBtn} onClick={onAdd}>
          <Icon name="plus" size={12} strokeWidth={2.4} />
          {addLabel}
        </button>
      )}
    </section>
  );
}

/** Reorder / delete controls for one entry. Never exported. */
function EntryControls({ locked, index, total, label, onMove, onRemove, inline = false }) {
  if (locked) return null;
  return (
    <span
      data-noexport=""
      className={`${styles.entryControls} ${inline ? styles.entryControlsInline : ""}`}
    >
      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => onMove(-1)}
        disabled={index === 0}
        title="Move up"
      >
        <Icon name="arrowUp" size={12} strokeWidth={2.2} />
        <span className="sr-only">Move {label} up</span>
      </button>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => onMove(1)}
        disabled={index === total - 1}
        title="Move down"
      >
        <Icon name="arrowDown" size={12} strokeWidth={2.2} />
        <span className="sr-only">Move {label} down</span>
      </button>
      <button type="button" className={styles.iconBtn} onClick={onRemove} title="Remove">
        <Icon name="x" size={12} strokeWidth={2.2} />
        <span className="sr-only">Remove {label}</span>
      </button>
    </span>
  );
}

/**
 * The bullet list for an experience or project entry. Enter splits into a new
 * bullet (and moves the caret there) and Backspace on an empty one removes it,
 * so a list can be built without reaching for the mouse.
 */
function Bullets({ section, entry, edit, locked, onSplit }) {
  const bullets = entry.bullets ?? [];
  if (bullets.length === 0 && locked) return null;

  return (
    <>
      {bullets.length > 0 && (
        <ul className={styles.bullets}>
          {bullets.map((b, i) => (
            <li key={i} className={styles.bullet}>
              <EditableText
                value={b}
                focusKey={`${entry.id}:${i}`}
                onChange={(v) => edit((r) => setBullet(r, section, entry.id, i, v))}
                placeholder="What you did and what came of it"
                ariaLabel={`Bullet ${i + 1}`}
                maxLength={RESUME_LIMITS.bullet}
                disabled={locked}
                onEnter={() => {
                  edit((r) => addBullet(r, section, entry.id, i));
                  onSplit(`${entry.id}:${i + 1}`);
                }}
                onEmptyBackspace={
                  bullets.length > 1
                    ? () => {
                        edit((r) => removeBullet(r, section, entry.id, i));
                        if (i > 0) onSplit(`${entry.id}:${i - 1}`);
                      }
                    : undefined
                }
              />
              {!locked && (
                <button
                  type="button"
                  data-noexport=""
                  className={styles.iconBtn}
                  onClick={() => edit((r) => removeBullet(r, section, entry.id, i))}
                  title="Remove bullet"
                >
                  <Icon name="x" size={12} strokeWidth={2.2} />
                  <span className="sr-only">Remove bullet {i + 1}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!locked && bullets.length < RESUME_LIMITS.maxBullets && (
        <button
          type="button"
          data-noexport=""
          className={styles.addBtn}
          onClick={() => {
            edit((r) => addBullet(r, section, entry.id));
            onSplit(`${entry.id}:${bullets.length}`);
          }}
        >
          <Icon name="plus" size={11} strokeWidth={2.4} />
          Bullet
        </button>
      )}
    </>
  );
}
