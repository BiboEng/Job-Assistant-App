/**
 * Resume text extraction, client-side. Accepts a PDF or a plain-text file and
 * returns its text; the caller sends that text to the backend (the server never
 * sees the file). pdf.js is loaded lazily so it only ships to users who open the
 * Job Matches screen.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PAGES = 15;

let pdfjsPromise;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (
        await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
      ).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

function tidy(text) {
  return String(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(file) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());

  let doc;
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  } catch {
    throw new Error(
      "That PDF couldn't be read. Try exporting it again, or upload a .txt file."
    );
  }

  const pages = Math.min(doc.numPages, MAX_PAGES);
  const chunks = [];
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => item.str || "").join(" "));
  }
  await doc.cleanup?.();

  const text = tidy(chunks.join("\n"));
  if (!text) {
    throw new Error(
      "No text found in that PDF — it may be a scan or an image. Export it as text-based PDF, or upload a .txt file."
    );
  }
  return text;
}

/**
 * @param {File} file
 * @returns {Promise<string>} extracted resume text
 */
export async function extractResumeText(file) {
  if (!file) throw new Error("No file selected.");
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("That file is over 10 MB. Upload a smaller resume.");
  }

  const isText =
    file.type === "text/plain" || /\.(txt|md|text)$/i.test(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (isText) return tidy(await file.text());
  if (isPdf) return extractPdf(file);

  throw new Error("Unsupported file type. Upload a PDF or a .txt file.");
}
