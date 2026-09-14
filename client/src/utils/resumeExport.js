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

const PAGE = { width: 612, height: 792, margin: 54 }; // US Letter, in points

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

async function exportRasterPdf(sheetEl, filename) {
  const [JsPDF, canvas] = await Promise.all([
    loadJsPdf(),
    renderSheetToCanvas(sheetEl, { scale: 2 }),
  ]);

  const doc = new JsPDF({ unit: "pt", format: "letter", compress: true });
  const imgData = canvas.toDataURL("image/jpeg", 0.92);

  const imgWidth = PAGE.width;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Slide the same image up a page at a time to paginate a long resume.
  let heightLeft = imgHeight;
  let position = 0;
  doc.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
  heightLeft -= PAGE.height;

  while (heightLeft > 0) {
    position -= PAGE.height;
    doc.addPage();
    doc.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= PAGE.height;
  }

  download(doc.output("blob"), filename);
}

// --- print-optimized PDF (real text) --------------------------------------

/**
 * A small top-down layout engine over jsPDF's text API. Everything it draws
 * comes from the resume data model, so the output is real selectable text.
 */
function createLayout(doc) {
  let y = PAGE.margin;
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const width = right - left;
  const bottom = PAGE.height - PAGE.margin;

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
      const lines = doc.splitTextToSize(String(value), width - indent);
      const lineHeight = size * lead;
      for (const line of lines) {
        ctx.ensure(lineHeight);
        doc.text(line, left + indent, y + size * 0.85);
        y += lineHeight;
      }
      return lines.length * lineHeight;
    },

    /** A left label and a right-aligned value on one baseline. */
    row(leftText, rightText, { size = 10.5, leftStyle = "bold", rightSize = 9.5 } = {}) {
      const lineHeight = size * 1.35;
      ctx.ensure(lineHeight);
      const baseline = y + size * 0.85;

      if (rightText) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(rightSize);
        doc.setTextColor(90);
        doc.text(String(rightText), right, baseline, { align: "right" });
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
      doc.text(String(title).toUpperCase(), left, y + 9, { charSpace: 0.8 });
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
      const lines = doc.splitTextToSize(String(value), width - indent);
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
      const lines = doc.splitTextToSize(String(value), width);
      const lineHeight = size * 1.35;
      for (const line of lines) {
        ctx.ensure(lineHeight);
        doc.text(line, PAGE.width / 2, y + size * 0.85, { align: "center" });
        y += lineHeight;
      }
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

async function exportTextPdf(resume, filename) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: "pt", format: "letter", compress: true });
  doc.setProperties({
    title: `${resume.contact.name || "Resume"}`,
    subject: resume.contact.title || "Resume",
    creator: "Mock Interview App",
  });

  const L = createLayout(doc);
  const c = resume.contact;

  // --- header
  if (c.name) {
    L.ensure(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    doc.setTextColor(20);
    doc.text(c.name, PAGE.width / 2, L.y + 18, { align: "center" });
    L.gap(26);
  }
  if (c.title) L.centered(c.title, { size: 11.5, color: 60 });

  const contactBits = [c.email, c.phone, c.location].filter(Boolean);
  if (contactBits.length) {
    L.gap(2);
    L.centered(contactBits.join("  |  "));
  }
  const links = c.links.map((l) => l.url || l.label).filter(Boolean);
  if (links.length) L.centered(links.join("  |  "));

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
      const items = g.items.join(", ");
      if (!items && !g.category) return;
      // Category in bold, items in normal weight, on the same wrapped block.
      const size = 10;
      const label = g.category ? `${g.category}: ` : "";
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
      L.row(p.name, p.link);
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
 * @param {{ resume: object, sheetEl: HTMLElement|null }} ctx
 */
export async function exportResume(format, { resume, sheetEl }) {
  const stem = resumeFileStem(resume);

  switch (format) {
    case "pdf-print":
      return exportTextPdf(resume, `${stem}.pdf`);
    case "pdf":
      return exportRasterPdf(sheetEl, `${stem}.pdf`);
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
