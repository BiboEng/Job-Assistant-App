import { useEffect } from "react";
import { Link } from "react-router";
import PublicHeader from "../components/PublicHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import Icon from "../components/Icon.jsx";
import { LEGAL_DOCUMENTS } from "../legal/documents.js";
import { BUSINESS, missingBusinessDetails } from "../legal/business.js";
import { PATHS } from "../routes.js";
import styles from "./LegalScreen.module.css";

/**
 * /terms, /privacy and /refunds — public, because they have to be readable
 * before anyone signs up or pays (Stripe Checkout links to two of them).
 *
 * The text lives in legal/documents.js. While the seller's details in
 * legal/business.js are incomplete, the page says it's a draft rather than
 * presenting placeholder text as a finished agreement.
 */

const OTHERS = [
  { id: "terms", to: PATHS.terms, label: "Terms of Service" },
  { id: "privacy", to: PATHS.privacy, label: "Privacy Policy" },
  { id: "refunds", to: PATHS.refunds, label: "Refund & Cancellation Policy" },
];

function formatDate(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function Paragraph({ block }) {
  const parts = Array.isArray(block) ? block : [block];
  return (
    <p>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
      )}
    </p>
  );
}

export default function LegalScreen({ doc }) {
  const build = LEGAL_DOCUMENTS[doc] ?? LEGAL_DOCUMENTS.terms;
  const content = build(BUSINESS);
  const missing = missingBusinessDetails();

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const previous = document.title;
    document.title = `${content.title} · ${BUSINESS.tradeName}`;
    return () => {
      document.title = previous;
    };
  }, [content.title]);

  return (
    <div className="public-site">
      <PublicHeader />
      <main id="main-content" tabIndex={-1} className={`app-shell app-shell--public ${styles.page}`}>
        <article className={styles.doc} aria-labelledby="legal-title">
          <header className={styles.head}>
            <p className="eyebrow">Legal</p>
            <h1 id="legal-title" className={styles.title}>
              {content.title}
            </h1>
            <p className={styles.updated}>
              Effective <time dateTime={content.updated}>{formatDate(content.updated)}</time>
            </p>
          </header>

          {missing.length > 0 && (
            <div className="warn-banner" role="note">
              <Icon name="alert" />
              <span className={styles.bannerText}>
                Draft: this document isn't final yet. Still to be filled in: {missing.join(", ")}.
              </span>
            </div>
          )}

          {content.intro.map((block, i) => (
            <Paragraph key={i} block={block} />
          ))}

          {content.sections.map((section) => (
            <section key={section.heading} className={styles.section}>
              <h2 className={styles.heading}>{section.heading}</h2>
              {section.blocks.map((block, i) =>
                block && typeof block === "object" && !Array.isArray(block) && block.list ? (
                  <ul key={i} className={styles.list}>
                    {block.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <Paragraph key={i} block={block} />
                )
              )}
            </section>
          ))}

          <nav className={styles.others} aria-label="Other policies">
            {OTHERS.filter((o) => o.id !== content.id).map((o) => (
              <Link key={o.id} to={o.to} className={styles.otherLink}>
                {o.label}
                <Icon name="chevronRight" />
              </Link>
            ))}
          </nav>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
