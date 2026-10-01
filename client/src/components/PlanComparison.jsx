import Icon from "./Icon.jsx";
import SegmentedControl from "./SegmentedControl.jsx";
import {
  PLAN_COPY,
  PLAN_ORDER,
  comparisonRows,
  formatPrice,
  planHighlights,
  taxNote,
  yearlySaving,
} from "../billing/plans.js";
import styles from "./PlanComparison.module.css";

/**
 * The three plans side by side, then the full comparison table. Shared by the
 * landing page's "More features" section and the in-app Plans page; each
 * passes its own call to action through `renderAction(planId)`.
 *
 * Prices come from `catalog` (GET /api/billing/plans), i.e. from Stripe, so
 * what's shown is what Checkout charges. With billing off — or a price that
 * can't be read — a paid card says so instead of showing a made-up number.
 */
export default function PlanComparison({
  catalog,
  interval,
  onIntervalChange,
  renderAction,
  currentPlan = null,
  headingLevel = 3,
  collapseTable = false,
}) {
  const prices = catalog?.prices ?? {};
  const hasYearly = Boolean(prices.pro?.year || prices.ultimate?.year);
  const evaluator = Boolean(catalog?.strongerEvaluator);
  const automaticTax = Boolean(catalog?.automaticTax);
  const H = `h${headingLevel}`;
  const rows = comparisonRows({ evaluator });

  return (
    <div className={styles.wrap}>
      {hasYearly && onIntervalChange && (
        <div className={styles.intervalRow}>
          <SegmentedControl
            options={[
              { value: "month", label: "Monthly" },
              { value: "year", label: "Yearly" },
            ]}
            value={interval}
            onChange={onIntervalChange}
            ariaLabel="Billing period"
          />
        </div>
      )}

      <ul className={styles.cards}>
        {PLAN_ORDER.map((id) => {
          const price = id === "regular" ? null : prices[id]?.[interval] ?? null;
          const saving =
            id !== "regular" && interval === "year"
              ? yearlySaving(prices[id]?.month, prices[id]?.year)
              : null;
          const isCurrent = currentPlan === id;
          return (
            <li
              key={id}
              className={`${styles.card} ${id === "pro" ? styles.featured : ""} ${
                isCurrent ? styles.current : ""
              }`}
            >
              <div className={styles.cardHead}>
                <H className={styles.name}>{PLAN_COPY[id].name}</H>
                {isCurrent && <span className={styles.badge}>Your plan</span>}
              </div>
              <p className={styles.pitch}>{PLAN_COPY[id].pitch}</p>

              <div className={styles.price}>
                {id === "regular" ? (
                  <>
                    <span className={`mono ${styles.amount}`}>Free</span>
                    <span className={styles.per}>forever</span>
                  </>
                ) : price ? (
                  <>
                    <span className={`mono ${styles.amount}`}>{formatPrice(price)}</span>
                    <span className={styles.per}>/ {interval === "year" ? "year" : "month"}</span>
                  </>
                ) : (
                  <span className={styles.unavailable}>
                    {!catalog?.enabled
                      ? "Coming soon"
                      : interval === "year" && prices[id]?.month
                        ? "Monthly billing only"
                        : "Not available right now"}
                  </span>
                )}
              </div>
              <p className={styles.priceNote}>
                {id === "regular"
                  ? "No card needed."
                  : price
                    ? [
                        saving ? `Save ${saving}% vs. monthly.` : null,
                        "Renews automatically. Cancel any time.",
                        taxNote(price, { automaticTax }),
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : " "}
              </p>

              <ul className={styles.highlights}>
                {planHighlights(id, { evaluator }).map((line) => (
                  <li key={line}>
                    <Icon name="check" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <div className={styles.action}>{renderAction?.(id, { price })}</div>
            </li>
          );
        })}
      </ul>

      <TableDisclosure collapsed={collapseTable}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="sr-only">What each plan includes</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Feature</span>
                </th>
                {PLAN_ORDER.map((id) => (
                  <th key={id} scope="col">
                    {PLAN_COPY[id].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {PLAN_ORDER.map((id) => {
                    const v = row.values[id];
                    return (
                      <td key={id}>
                        {v === true ? (
                          <span className={styles.yes}>
                            <Icon name="check" />
                            <span className="sr-only">Included</span>
                          </span>
                        ) : v === false ? (
                          <span className={styles.no}>
                            <Icon name="minus" />
                            <span className="sr-only">Not included</span>
                          </span>
                        ) : (
                          v
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.footnote}>
          Daily limits reset at midnight UTC. Downgrading or cancelling never deletes your data.
        </p>
      </TableDisclosure>
    </div>
  );
}

/**
 * The full comparison table is reference material: on the Plans page it's
 * shown outright, on the landing page it folds behind a native <details> so
 * the three cards carry the section.
 */
function TableDisclosure({ collapsed, children }) {
  if (!collapsed) return children;
  return (
    <details className={styles.disclosure}>
      <summary className={styles.disclosureSummary}>
        <Icon name="chevronDown" />
        Compare every feature
      </summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}
