import type { jsPDF } from "jspdf";

export type CreatedPdf = {
  data: ArrayBuffer;
  fileName: string;
};

type PdfBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; marker: string; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; lines: string[] }
  | { type: "rule" };

function cleanInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function parseMarkdown(markdown: string): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  let paragraph: string[] = [];
  let codeLines: string[] | null = null;

  const flushParagraph = () => {
    const text = cleanInlineMarkdown(paragraph.join(" "));
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  };

  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fence = rawLine.match(/^\s*(```|~~~)/);
    if (fence) {
      if (codeLines) {
        blocks.push({ type: "code", lines: codeLines });
        codeLines = null;
      } else {
        flushParagraph();
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(rawLine.replace(/\t/g, "  "));
      continue;
    }
    if (!rawLine.trim()) {
      flushParagraph();
      continue;
    }

    const heading = rawLine.match(/^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1].length, text: cleanInlineMarkdown(heading[2]) });
      continue;
    }
    if (/^\s{0,3}([-*_]\s*){3,}$/.test(rawLine)) {
      flushParagraph();
      blocks.push({ type: "rule" });
      continue;
    }

    const quote = rawLine.match(/^\s{0,3}>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({ type: "quote", text: cleanInlineMarkdown(quote[1]) });
      continue;
    }
    const unordered = rawLine.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      blocks.push({ type: "bullet", marker: "•", text: cleanInlineMarkdown(unordered[1]) });
      continue;
    }
    const ordered = rawLine.match(/^\s*(\d{1,3}[.)])\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      blocks.push({ type: "bullet", marker: ordered[1], text: cleanInlineMarkdown(ordered[2]) });
      continue;
    }

    if (rawLine.trim().startsWith("|") && rawLine.includes("|")) {
      flushParagraph();
      const cells = rawLine.split("|").map(cell => cleanInlineMarkdown(cell)).filter(Boolean);
      if (cells.length && !cells.every(cell => /^:?-{2,}:?$/.test(cell))) {
        blocks.push({ type: "paragraph", text: cells.join("   •   ") });
      }
      continue;
    }
    paragraph.push(rawLine.trim());
  }

  flushParagraph();
  if (codeLines) blocks.push({ type: "code", lines: codeLines });
  return blocks;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "answer";
}

function printableTitle(value: string) {
  return cleanInlineMarkdown(value).replace(/\s+/g, " ").trim().slice(0, 120) || "AskOrbit answer";
}

export async function createAnswerPdf(markdown: string, fallbackTitle: string): Promise<CreatedPdf> {
  const { jsPDF } = await import("jspdf");
  const headingTitle = markdown.match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m)?.[1];
  const title = printableTitle(headingTitle ?? fallbackTitle);
  const blocks = parseMarkdown(markdown);
  if (headingTitle) {
    const titleIndex = blocks.findIndex(block => block.type === "heading" && block.level === 1 && block.text === cleanInlineMarkdown(headingTitle));
    if (titleIndex >= 0) blocks.splice(titleIndex, 1);
  }

  const document = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  const pageWidth = document.internal.pageSize.getWidth();
  const pageHeight = document.internal.pageSize.getHeight();
  const margin = 56;
  const contentWidth = pageWidth - margin * 2;
  const footerY = pageHeight - 52;
  const dateLabel = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  let y = 78;

  const drawHeader = () => {
    document.setFont("helvetica", "bold");
    document.setFontSize(9);
    document.setTextColor(99, 82, 176);
    document.text("ASKORBIT  /  ANSWER DOCUMENT", margin, 32);
    document.setFont("helvetica", "normal");
    document.setTextColor(117, 118, 136);
    document.text(dateLabel, pageWidth - margin, 32, { align: "right" });
    document.setDrawColor(227, 225, 236);
    document.setLineWidth(0.7);
    document.line(margin, 44, pageWidth - margin, 44);
  };

  const addPage = () => {
    document.addPage();
    drawHeader();
    y = 72;
  };

  const ensureSpace = (height: number) => {
    if (y + height > footerY) addPage();
  };

  const addWrappedText = (
    value: string,
    options: {
      fontSize: number;
      style?: "normal" | "bold" | "italic";
      color?: [number, number, number];
      indent?: number;
      marker?: string;
      before?: number;
      after?: number;
    },
  ) => {
    const { fontSize, style = "normal", color = [51, 52, 67], indent = 0, marker, before = 0, after = 8 } = options;
    document.setFont("helvetica", style);
    document.setFontSize(fontSize);
    document.setTextColor(...color);
    const markerWidth = marker ? 17 : 0;
    const lines = document.splitTextToSize(value, contentWidth - indent - markerWidth) as string[];
    const leading = fontSize * 1.48;
    y += before;
    for (const [index, line] of lines.entries()) {
      ensureSpace(leading);
      if (marker && index === 0) {
        document.setFont("helvetica", "bold");
        document.setTextColor(106, 91, 183);
        document.text(marker, margin + indent, y);
        document.setFont("helvetica", style);
        document.setTextColor(...color);
      }
      document.text(line, margin + indent + markerWidth, y);
      y += leading;
    }
    y += after;
  };

  document.setProperties({
    title,
    subject: "A document created from an AskOrbit answer",
    author: "AskOrbit",
    creator: "AskOrbit",
  });
  drawHeader();

  document.setFont("helvetica", "bold");
  document.setFontSize(25);
  document.setTextColor(34, 35, 55);
  const titleLines = document.splitTextToSize(title, contentWidth) as string[];
  for (const line of titleLines) {
    ensureSpace(34);
    document.text(line, margin, y);
    y += 31;
  }
  y += 2;
  document.setFont("helvetica", "normal");
  document.setFontSize(10);
  document.setTextColor(113, 114, 132);
  document.text("Prepared with AskOrbit  ·  " + dateLabel, margin, y);
  y += 25;

  for (const block of blocks) {
    if (block.type === "heading") {
      const fontSize = block.level === 1 ? 19 : block.level === 2 ? 15 : 12.5;
      addWrappedText(block.text, {
        fontSize,
        style: "bold",
        color: block.level === 1 ? [51, 47, 88] : [54, 55, 73],
        before: block.level === 1 ? 10 : 7,
        after: 7,
      });
    } else if (block.type === "paragraph") {
      addWrappedText(block.text, { fontSize: 11, after: 8 });
    } else if (block.type === "bullet") {
      addWrappedText(block.text, { fontSize: 10.8, indent: 6, marker: block.marker, after: 6 });
    } else if (block.type === "quote") {
      addWrappedText(block.text, { fontSize: 10.8, style: "italic", color: [83, 77, 118], indent: 14, marker: "│", before: 2, after: 9 });
    } else if (block.type === "rule") {
      ensureSpace(16);
      document.setDrawColor(222, 220, 233);
      document.line(margin, y, pageWidth - margin, y);
      y += 13;
    } else {
      document.setFont("courier", "normal");
      document.setFontSize(9);
      const codeLines = block.lines.flatMap(line => document.splitTextToSize(line || " ", contentWidth - 24) as string[]);
      for (const line of codeLines) {
        ensureSpace(15);
        document.setFillColor(245, 244, 250);
        document.setDrawColor(236, 234, 243);
        document.roundedRect(margin, y - 10, contentWidth, 14, 2, 2, "FD");
        document.setTextColor(58, 59, 76);
        document.text(line, margin + 12, y);
        y += 14;
      }
      y += 9;
    }
  }

  const pageCount = document.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    document.setPage(page);
    document.setDrawColor(227, 225, 236);
    document.setLineWidth(0.6);
    document.line(margin, pageHeight - 38, pageWidth - margin, pageHeight - 38);
    document.setFont("helvetica", "normal");
    document.setFontSize(8);
    document.setTextColor(126, 126, 143);
    document.text("CREATED WITH ASKORBIT", margin, pageHeight - 23);
    document.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - 23, { align: "right" });
  }

  return {
    data: document.output("arraybuffer") as ArrayBuffer,
    fileName: `askorbit-${slugify(title)}.pdf`,
  };
}

export function downloadPdfFile(file: CreatedPdf) {
  const url = URL.createObjectURL(new Blob([file.data], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
