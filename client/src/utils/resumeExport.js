import { dateRange, resumeFileStem } from "./resumeModel.js";

/**
 * Resume downloads. Everything runs in the browser — no export endpoint, no
 * server-side rendering service.
 *
 * Two genuinely different PDFs are offered, because they're good at different
 * things:
 *
 *   "pdf"       — a WYSIWYG raster of the on-screen sheet (html2canvas → jsPDF).
 *                 Pixel-identical to the preview. Bigger file, and the text is
 *                 an image, so it can't be selected or parsed.
 *   "pdf-print" — laid out from the resume DATA with jsPDF's text API. Real
 *                 vector text: selectable, searchable, crisp at any print DPI,
 *                 a fraction of the size, and parseable by applicant tracking
 *                 systems. This is the one to actually send to an employer.
 *
 * html2canvas and jsPDF are both lazy-loaded on first use (same approach as
 * pdfjs-dist in parseResume.js) so they stay out of the main bundle.
 *
 * THE CHARACTER-SET LIMIT. The text PDF uses jsPDF's built-in Helvetica, which
 * only encodes Windows-1252 (Latin-1 plus curly quotes, dashes, € and a few
 * more). Worse than dropping an unsupported character, jsPDF re-encodes the
 * WHOLE string it was handed, so a single "→" garbles an entire bullet. So:
 *   - common typographic symbols outside the set are mapped to plain
 *     equivalents first (TEXT_SUBSTITUTIONS — "→" becomes "->");
 *   - if anything unencodable is left (a name in Polish, Cyrillic, Arabic,
 *     CJK…) a "print optimized" request is served as the exact-preview PDF,
 *     which renders through the browser and so handles every script, and the
 *     caller is told why (`{ fallback }` in the result). Embedding a Unicode
 *     font would lift the limit, at the cost of shipping a font per script.
 *
 * PAPER. Letter or A4, chosen by the user (`paper`); the default follows the
 * browser's region (`defaultPaper`).
 */

export const EXPORT_FORMATS = [
  {
    id: "pdf-print",
    label: "PDF — print optimized",
    hint: "Selectable text, ATS-friendly. Best for applications.",
    ext: "pdf",
  },
  {
    id: "pdf",
    label: "PDF — exact preview",
    hint: "Pixel-perfect copy of what you see.",
    ext: "pdf",
  },
  { id: "jpg", label: "JPG image", hint: "One image per page.", ext: "jpg" },
  { id: "png", label: "PNG image", hint: "Lossless image, larger file.", ext: "png" },
  { id: "txt", label: "Plain text", hint: "For pasting into web forms.", ext: "txt" },
];

/** Page geometry in points. `format` is jsPDF's name for the size. */
export const PAPER_SIZES = {
  letter: { id: "letter", label: "Letter", format: "letter", width: 612, height: 792, margin: 54 },
  a4: { id: "a4", label: "A4", format: "a4", width: 595.28, height: 841.89, margin: 52 },
};

// Regions that use US Letter; everywhere else uses A4.
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "CR", "PR"]);

/** Letter or A4 from the browser's locale — a starting point the user can change. */
export function defaultPaper(
  locale = typeof navigator !== "undefined" ? navigator.language : ""
) {
  const [lang = "", region] = String(locale || "").split(/[-_]/);
  if (region) return LETTER_REGIONS.has(region.toUpperCase()) ? "letter" : "a4";
  // No region ("de", "fr"): only bare English leans Letter; the rest is A4.
  return !lang || lang.toLowerCase() === "en" ? "letter" : "a4";
}

// --- character set --------------------------------------------------------

// Windows-1252's characters outside Latin-1 (bytes 0x80–0x9F), which jsPDF maps.
const CP1252_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** True when jsPDF's standard fonts can encode every character of `text`. */
export function isPdfEncodable(text) {
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code >= 0x20 && code <= 0x7e) continue;
    if (code >= 0xa0 && code <= 0xff) continue;
    if (CP1252_EXTRAS.has(ch)) continue;
    return false;
  }
  return true;
}

// Symbols that turn up in resumes (and in AI-written bullets) and have a plain
// equivalent that reads the same. Letters are deliberately NOT here: "ł" is not
// "l", and a name must never be silently respelled.
const TEXT_SUBSTITUTIONS = [
  [/[\u2010\u2011\u2012\u2212\u2043]/g, "-"], // hyphens, minus sign
  [/\u2015/g, "\u2014"], // horizontal bar → em dash
  [/[\u2032\u02b9]/g, "'"],
  [/[\u2033\u02ba]/g, '"'],
  [/[\u2000-\u200a\u202f\u205f\u3000]/g, " "], // odd-width spaces
  [/[\u200b-\u200d\u2060\ufeff]/g, ""], // zero-width characters
  [/[\u2028\u2029]/g, "\n"],
  [/[\u2192\u27f6\u2794\u279c]/g, "->"],
  [/[\u2190\u27f5]/g, "<-"],
  [/[\u2194\u27f7]/g, "<->"],
  [/\u2265/g, ">="],
  [/\u2264/g, "<="],
  [/\u2260/g, "!="],
  [/\u2248/g, "~"],
  [/[\u2713\u2714\u2705]/g, "-"],
  [/[\u25aa\u25cf\u25e6\u2023\u2219\u25b8\u25ba]/g, "\u2022"], // other bullets → •
];

/** `value` with TEXT_SUBSTITUTIONS applied — what the text PDF actually draws. */
export function toPdfText(value) {
  let out = String(value ?? "");
  for (const [pattern, replacement] of TEXT_SUBSTITUTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Every string the text PDF would draw. */
function resumeStrings(resume) {
  const c = resume.contact;
  const out = [c.name, c.title, c.email, c.phone, c.location, resume.summary];
  for (const l of c.links) out.push(l.label, l.url);
  for (const e of resume.experience) {
    out.push(e.role, e.company, e.location, e.start, e.end, ...e.bullets);
  }
  for (const e of resume.education) {
    out.push(e.school, e.degree, e.location, e.start, e.end, e.details);
  }
  for (const g of resume.skills) out.push(g.category, ...g.items);
  for (const p of resume.projects) out.push(p.name, p.link, ...p.bullets);
  for (const cert of resume.certifications) out.push(cert.name, cert.issuer, cert.year);
  return out.filter(Boolean).map(toPdfText);
}

/** The first character the text PDF can't draw (after substitution), or null. */
export function firstUnencodable(resume) {
  for (const text of resumeStrings(resume)) {
    for (const ch of text) if (!isPdfEncodable(ch)) return ch;
  }
  return null;
}

// --- links ------------------------------------------------------------------

/**
 * Where a contact or project link should point in the PDF, or null. Accepts
 * full http(s) URLs, bare domains ("linkedin.com/in/ada") and email addresses;
 * anything else (a label with spaces, a javascript: URL) stays plain text.
 */
export function linkTarget(value) {
  const s = String(value || "").trim();
  if (!s || /\s/.test(s)) return null;
  if (/^https?:\/\/[^/]+\.[^/]+/i.test(s)) return s;
  if (/^[^@/:]+@[^@/:]+\.[a-z]{2,}$/i.test(s)) return `mailto:${s}`;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(s)) return `https://${s}`;
  return null;
}

// --- lazy library loading -------------------------------------------------

async function loadJsPdf() {
  const mod = await import("jspdf");
  return mod.jsPDF ?? mod.default?.jsPDF ?? mod.default;
}

async function loadHtml2Canvas() {
  const mod = await import("html2canvas");
  return mod.default ?? mod;
}

// --- shared helpers -------------------------------------------------------

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Renders the resume sheet to a canvas at its natural (816px) width.
 *
 * The on-screen sheet is scaled with a CSS transform to fit the split pane, and
 * rasterizing a transformed node gives blurry, mis-positioned output. So the
 * node is deep-cloned into an off-screen container at full size, stripped of
 * editing chrome, and rendered there. The live preview is never touched.
 */
async function renderSheetToCanvas(sheetEl, { scale = 2 } = {}) {
  if (!sheetEl) throw new Error("The resume preview isn't ready yet.");

  const html2canvas = await loadHtml2Canvas();

  const holder = document.createElement("div");
  holder.style.cssText =
    "position:fixed;left:-10000px;top:0;z-index:-1;background:#ffffff;";
  const clone = sheetEl.cloneNode(true);

  // Editing affordances are on-screen only.
  clone.querySelectorAll("[data-noexport]").forEach((el) => el.remove());
  // Placeholder text is drawn by CSS `content: attr(data-placeholder)`, so
  // dropping the attribute drops the placeholder without needing the CSS class.
  clone.querySelectorAll("[data-placeholder]").forEach((el) => {
    el.removeAttribute("data-placeholder");
  });
  // No caret, no drop shadow on paper.
  clone.querySelectorAll("[contenteditable]").forEach((el) => {
    el.setAttribute("contenteditable", "false");
  });
  clone.style.boxShadow = "none";
  clone.style.margin = "0";
  clone.style.transform = "none";

  holder.appendChild(clone);
  document.body.appendChild(holder);

  try {
    return await html2canvas(clone, {
      scale,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
      windowWidth: clone.offsetWidth,
    });
  } finally {
    holder.remove();
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render the image."))),
      type,
      quality
    );
  });
}

// --- raster PDF (exact preview) ------------------------------------------

async function exportRasterPdf(sheetEl, filename, page) {
  const [JsPDF, canvas] = await Promise.all([
    loadJsPdf(),
    renderSheetToCanvas(sheetEl, { scale: 2 }),
  ]);

  const doc = new JsPDF({ unit: "pt", format: page.format, compress: true });
  const imgData = canvas.toDataURL("image/jpeg", 0.92);

  const imgWidth = page.width;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Slide the same image up a page at a time to paginate a long resume.
  let heightLeft = imgHeight;
  let position = 0;
  doc.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
  heightLeft -= page.height;

  while (heightLeft > 0) {
    position -= page.height;
    doc.addPage();
    doc.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= page.height;
  }

  download(doc.output("blob"), filename);
}

// --- print-optimized PDF (real text) --------------------------------------

/**
 * A small top-down layout engine over jsPDF's text API. Everything it draws
 * comes from the resume data model, so the output is real selectable text.
 */
function createLayout(doc, PAGE) {
  let y = PAGE.margin;
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const width = right - left;
  const bottom = PAGE.height - PAGE.margin;

  /** A link annotation over text drawn at (x, baseline). */
  function linkOver(url, x, baseline, textWidth, size) {
    if (url) doc.link(x, baseline - size * 0.85, textWidth, size * 1.1, { url });
  }

  const ctx = {
    get y() {
      return y;
    },
    left,
    right,
    width,

    /** Start a new page if `needed` points won't fit on this one. */
    ensure(needed) {
      if (y + needed > bottom) {
        doc.addPage();
        y = PAGE.margin;
        return true;
      }
      return false;
    },

    gap(pts) {
      y += pts;
    },

    /** Draw wrapped text and advance. Returns the height used. */
    text(value, { size = 10, style = "normal", color = 20, indent = 0, lead = 1.32 } = {}) {
      if (!value) return 0;
      doc.setFont("helvetica", style);
      doc.setFontSize(size);
      doc.setTextColor(color);
      const lines = doc.splitTextToSize(toPdfText(value), width - indent);
      const lineHeight = size * lead;
      for (const line of lines) {
        ctx.ensure(lineHeight);
        doc.text(line, left + indent, y + size * 0.85);
        y += lineHeight;
      }
      return lines.length * lineHeight;
    },

    /** A left label and a right-aligned value on one baseline. */
    row(
      leftText,
      rightText,
      { size = 10.5, leftStyle = "bold", rightSize = 9.5, rightUrl = null } = {}
    ) {
      leftText = leftText && toPdfText(leftText);
      rightText = rightText && toPdfText(rightText);
      const lineHeight = size * 1.35;
      ctx.ensure(lineHeight);
      const baseline = y + size * 0.85;

      if (rightText) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(rightSize);
        doc.setTextColor(90);
        doc.text(String(rightText), right, baseline, { align: "right" });
        const w = doc.getTextWidth(String(rightText));
        linkOver(rightUrl, right - w, baseline, w, rightSize);
      }
      if (leftText) {
        doc.setFont("helvetica", leftStyle);
        doc.setFontSize(size);
        doc.setTextColor(20);
        // Reserve the right-hand column so a long title can't run into the dates.
        const reserved = rightText
          ? doc.getTextWidth(String(rightText)) * (rightSize / size) + 14
          : 0;
        const lines = doc.splitTextToSize(String(leftText), width - reserved);
        doc.text(lines[0], left, baseline);
      }
      y += lineHeight;
    },

    /** An uppercase section heading with a rule under it. */
    heading(title) {
      ctx.gap(10);
      // Don't strand a heading at the foot of a page.
      ctx.ensure(46);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(20);
      doc.text(toPdfText(title).toUpperCase(), left, y + 9, { charSpace: 0.8 });
      y += 13;
      doc.setDrawColor(170);
      doc.setLineWidth(0.6);
      doc.line(left, y, right, y);
      y += 8;
    },

    bullet(value) {
      if (!value) return;
      const size = 10;
      const indent = 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(30);
      const lines = doc.splitTextToSize(toPdfText(value), width - indent);
      const lineHeight = size * 1.34;
      lines.forEach((line, i) => {
        ctx.ensure(lineHeight);
        const baseline = y + size * 0.85;
        if (i === 0) doc.text("•", left + 2, baseline);
        doc.text(line, left + indent, baseline);
        y += lineHeight;
      });
    },

    /** Centered text, used for the contact line under the name. */
    centered(value, { size = 9.5, color = 90 } = {}) {
      if (!value) return;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(color);
      const lines = doc.splitTextToSize(toPdfText(value), width);
      const lineHeight = size * 1.35;
      for (const line of lines) {
        ctx.ensure(lineHeight);
        doc.text(line, PAGE.width / 2, y + size * 0.85, { align: "center" });
        y += lineHeight;
      }
    },

    /**
     * Centered parts on one line with separators, each part clickable when it
     * has a `url`. Falls back to plain wrapped text when the line is too long
     * to fit, since link rectangles over wrapped text would drift.
     */
    centeredParts(parts, { size = 9.5, color = 90, sep = "  |  " } = {}) {
      const items = parts
        .filter((p) => p.text)
        .map((p) => ({ ...p, text: toPdfText(p.text) }));
      if (!items.length) return;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      doc.setTextColor(color);
      const sepWidth = doc.getTextWidth(sep);
      const widths = items.map((p) => doc.getTextWidth(p.text));
      const total = widths.reduce((a, b) => a + b, 0) + sepWidth * (items.length - 1);
      if (total > width) {
        ctx.centered(items.map((p) => p.text).join(sep), { size, color });
        return;
      }
      const lineHeight = size * 1.35;
      ctx.ensure(lineHeight);
      const baseline = y + size * 0.85;
      let x = PAGE.width / 2 - total / 2;
      items.forEach((p, i) => {
        if (i > 0) {
          doc.text(sep, x, baseline);
          x += sepWidth;
        }
        doc.text(p.text, x, baseline);
        linkOver(p.url, x, baseline, widths[i], size);
        x += widths[i];
      });
      y += lineHeight;
    },

    rule() {
      ctx.ensure(6);
      doc.setDrawColor(30);
      doc.setLineWidth(1.1);
      doc.line(left, y, right, y);
      y += 6;
    },
  };

  return ctx;
}

async function exportTextPdf(resume, filename, PAGE) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: "pt", format: PAGE.format, compress: true });
  doc.setProperties({
    title: toPdfText(resume.contact.name || "Resume"),
    subject: toPdfText(resume.contact.title || "Resume"),
    creator: "Jobassist",
  });

  const L = createLayout(doc, PAGE);
  const c = resume.contact;

  // --- header
  if (c.name) {
    L.ensure(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    doc.setTextColor(20);
    doc.text(toPdfText(c.name), PAGE.width / 2, L.y + 18, { align: "center" });
    L.gap(26);
  }
  if (c.title) L.centered(c.title, { size: 11.5, color: 60 });

  const contactBits = [
    { text: c.email, url: linkTarget(c.email) },
    { text: c.phone },
    { text: c.location },
  ].filter((p) => p.text);
  if (contactBits.length) {
    L.gap(2);
    L.centeredParts(contactBits);
  }
  // Clickable in the PDF — a recruiter reading it on screen will click these.
  const links = c.links
    .map((l) => ({ text: l.url || l.label, url: linkTarget(l.url || l.label) }))
    .filter((p) => p.text);
  if (links.length) L.centeredParts(links);

  L.gap(6);
  L.rule();

  // --- sections
  if (resume.summary) {
    L.heading("Summary");
    L.text(resume.summary, { size: 10 });
  }

  if (resume.experience.length) {
    L.heading("Experience");
    resume.experience.forEach((e, i) => {
      if (i > 0) L.gap(7);
      L.row(e.role || e.company, dateRange(e.start, e.end));
      const sub = [e.company && e.role ? e.company : "", e.location]
        .filter(Boolean)
        .join(" — ");
      if (sub) L.text(sub, { size: 9.5, style: "italic", color: 90 });
      L.gap(2);
      e.bullets.forEach((b) => L.bullet(b));
    });
  }

  if (resume.education.length) {
    L.heading("Education");
    resume.education.forEach((e, i) => {
      if (i > 0) L.gap(6);
      L.row(e.school, dateRange(e.start, e.end));
      const sub = [e.degree, e.location].filter(Boolean).join(" — ");
      if (sub) L.text(sub, { size: 9.5, style: "italic", color: 90 });
      if (e.details) L.text(e.details, { size: 9.5, color: 70 });
    });
  }

  if (resume.skills.length) {
    L.heading("Skills");
    resume.skills.forEach((g) => {
      const items = toPdfText(g.items.join(", "));
      if (!items && !g.category) return;
      // Category in bold, items in normal weight, on the same wrapped block.
      const size = 10;
      const label = g.category ? `${toPdfText(g.category)}: ` : "";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(size);
      const labelWidth = label ? doc.getTextWidth(label) : 0;

      doc.setFont("helvetica", "normal");
      const firstLineWidth = L.width - labelWidth;
      const words = items.split(" ");
      // Fit as much as possible next to the bold label, wrap the rest full width.
      let head = "";
      let rest = items;
      for (let i = words.length; i > 0; i -= 1) {
        const candidate = words.slice(0, i).join(" ");
        if (doc.getTextWidth(candidate) <= firstLineWidth) {
          head = candidate;
          rest = words.slice(i).join(" ");
          break;
        }
      }

      const lineHeight = size * 1.35;
      L.ensure(lineHeight);
      const baseline = L.y + size * 0.85;
      if (label) {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(20);
        doc.text(label, L.left, baseline);
      }
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30);
      if (head) doc.text(head, L.left + labelWidth, baseline);
      L.gap(lineHeight);
      if (rest) L.text(rest, { size, color: 30 });
      L.gap(2);
    });
  }

  if (resume.projects.length) {
    L.heading("Projects");
    resume.projects.forEach((p, i) => {
      if (i > 0) L.gap(6);
      L.row(p.name, p.link, { rightUrl: linkTarget(p.link) });
      L.gap(2);
      p.bullets.forEach((b) => L.bullet(b));
    });
  }

  if (resume.certifications.length) {
    L.heading("Certifications");
    resume.certifications.forEach((cert) => {
      const line = [cert.name, cert.issuer, cert.year].filter(Boolean).join(" — ");
      L.bullet(line);
    });
  }

  download(doc.output("blob"), filename);
}

// --- images ---------------------------------------------------------------

async function exportImage(sheetEl, filename, type, quality) {
  const canvas = await renderSheetToCanvas(sheetEl, { scale: 2 });
  const blob = await canvasToBlob(canvas, type, quality);
  download(blob, filename);
}

// --- plain text -----------------------------------------------------------

export function resumeToPlainText(resume) {
  const out = [];
  const c = resume.contact;

  if (c.name) out.push(c.name);
  if (c.title) out.push(c.title);
  const bits = [c.email, c.phone, c.location].filter(Boolean);
  if (bits.length) out.push(bits.join(" | "));
  const links = c.links.map((l) => l.url || l.label).filter(Boolean);
  if (links.length) out.push(links.join(" | "));

  const section = (title, lines) => {
    if (!lines.length) return;
    out.push("", title.toUpperCase(), "-".repeat(title.length));
    out.push(...lines);
  };

  if (resume.summary) section("Summary", [resume.summary]);

  section(
    "Experience",
    resume.experience.flatMap((e, i) => {
      const head = [e.role, e.company].filter(Boolean).join(" — ");
      const meta = [dateRange(e.start, e.end), e.location].filter(Boolean).join(" | ");
      return [
        ...(i > 0 ? [""] : []),
        head,
        ...(meta ? [meta] : []),
        ...e.bullets.map((b) => `- ${b}`),
      ];
    })
  );

  section(
    "Education",
    resume.education.flatMap((e, i) => {
      const head = [e.school, e.degree].filter(Boolean).join(" — ");
      const meta = [dateRange(e.start, e.end), e.location].filter(Boolean).join(" | ");
      return [
        ...(i > 0 ? [""] : []),
        head,
        ...(meta ? [meta] : []),
        ...(e.details ? [e.details] : []),
      ];
    })
  );

  section(
    "Skills",
    resume.skills.map((g) =>
      g.category ? `${g.category}: ${g.items.join(", ")}` : g.items.join(", ")
    )
  );

  section(
    "Projects",
    resume.projects.flatMap((p, i) => [
      ...(i > 0 ? [""] : []),
      [p.name, p.link].filter(Boolean).join(" — "),
      ...p.bullets.map((b) => `- ${b}`),
    ])
  );

  section(
    "Certifications",
    resume.certifications.map((cert) =>
      [cert.name, cert.issuer, cert.year].filter(Boolean).join(" — ")
    )
  );

  return out.join("\n");
}

// --- entry point ----------------------------------------------------------

/**
 * Download the resume in one of EXPORT_FORMATS.
 * @param {string} format one of the format ids
 * @param {{ resume: object, sheetEl: HTMLElement|null, paper?: "letter" | "a4" }} ctx
 * @returns {Promise<{ fallback?: string } | undefined>} `fallback` explains why
 *   a different file than the one asked for was produced.
 */
export async function exportResume(format, { resume, sheetEl, paper }) {
  const stem = resumeFileStem(resume);
  const page = PAPER_SIZES[paper] || PAPER_SIZES[defaultPaper()];

  switch (format) {
    case "pdf-print": {
      const bad = firstUnencodable(resume);
      if (bad) {
        await exportRasterPdf(sheetEl, `${stem}.pdf`, page);
        return {
          fallback: `Your resume contains characters the text PDF can't encode (such as “${bad}”), so you got the exact-preview PDF instead. It looks right, but its text can't be selected or read by applicant tracking systems. For online forms, paste the plain-text download.`,
        };
      }
      await exportTextPdf(resume, `${stem}.pdf`, page);
      return undefined;
    }
    case "pdf":
      return exportRasterPdf(sheetEl, `${stem}.pdf`, page);
    case "jpg":
      return exportImage(sheetEl, `${stem}.jpg`, "image/jpeg", 0.92);
    case "png":
      return exportImage(sheetEl, `${stem}.png`, "image/png");
    case "txt":
      return download(
        new Blob([resumeToPlainText(resume)], { type: "text/plain;charset=utf-8" }),
        `${stem}.txt`
      );
    default:
      throw new Error("Unknown download format.");
  }
}
