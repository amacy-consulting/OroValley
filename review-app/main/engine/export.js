/** Turn a minutes draft (the Markdown subset minutes.js asks Claude for) into
 *  a Word document in the Town's layout, plain text, or safe HTML for the
 *  in-app preview.
 *
 *  Markdown subset: "#", "##", "###" headings; paragraphs; "- " bullets;
 *  "1. " / "A. " items; **bold**; a "Present:" (or "Absent:") label followed
 *  by bullets; the title block (the lines directly under "# MINUTES"); and
 *  signature lines made of underscores.
 */
"use strict";

const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} = require("docx");

// ---- Parsing ----------------------------------------------------------------

const ROSTER_LABEL = /^(Present|Absent|Excused|Also present|Also Present|Staff present|Staff Present):\s*$/;
const ITEM = /^(\d{1,3}|[A-Z])[.)]\s+(.*\S)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*\S)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const SIGNATURE = /^_{5,}\s*$/;

/**
 * Parse the Markdown into blocks:
 *   { type: "title", lines }                 "# MINUTES" and the lines under it
 *   { type: "heading", level, text }
 *   { type: "item", label, text }            "1." / "A."
 *   { type: "bullets", items }
 *   { type: "roster", label, names }         "Present:" + bullets
 *   { type: "para", text }
 *   { type: "signature" }
 */
function parseMinutes(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  let bullets = null;
  let pendingLabel = null;
  let titleOpen = false;

  const flushPara = () => {
    if (para.length) {
      const text = para.join(" ").replace(/\s+/g, " ").trim();
      if (ROSTER_LABEL.test(text)) pendingLabel = text;
      else blocks.push({ type: "para", text });
    }
    para = [];
  };
  const flushBullets = () => {
    if (bullets) {
      if (pendingLabel) {
        blocks.push({ type: "roster", label: pendingLabel, names: bullets });
        pendingLabel = null;
      } else {
        blocks.push({ type: "bullets", items: bullets });
      }
    }
    bullets = null;
  };
  const flushLabel = () => {
    if (pendingLabel) blocks.push({ type: "para", text: pendingLabel });
    pendingLabel = null;
  };
  const flushAll = () => {
    flushPara();
    flushBullets();
    flushLabel();
    titleOpen = false;
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim()) {
      flushPara();
      flushBullets();
      titleOpen = false;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].trim();
      if (level === 1 && !blocks.length) {
        blocks.push({ type: "title", lines: [text] });
        titleOpen = true;
      } else {
        blocks.push({ type: "heading", level: Math.min(3, level), text });
      }
      continue;
    }

    if (titleOpen) {
      blocks[blocks.length - 1].lines.push(line.trim());
      continue;
    }

    if (SIGNATURE.test(line)) {
      flushAll();
      blocks.push({ type: "signature" });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      if (!bullets) bullets = [];
      bullets.push(bullet[1]);
      continue;
    }
    if (bullets) {
      // An indented line under a bullet continues it.
      if (/^\s{2,}/.test(line)) {
        bullets[bullets.length - 1] += " " + line.trim();
        continue;
      }
      flushBullets();
    }

    const item = ITEM.exec(line);
    if (item && !para.length) {
      flushLabel();
      blocks.push({ type: "item", label: `${item[1]}.`, text: item[2] });
      continue;
    }

    if (ROSTER_LABEL.test(line.trim()) && !para.length) {
      flushLabel();
      pendingLabel = line.trim();
      continue;
    }
    if (pendingLabel && !bullets) flushLabel();
    para.push(line.trim());
  }
  flushAll();
  return blocks;
}

/** Split "**bold**" markup into [{ text, bold }] runs. */
function inlineRuns(text) {
  const runs = [];
  const parts = String(text || "").split(/(\*\*[^*]+?\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    const m = /^\*\*([^*]+?)\*\*$/.exec(part);
    if (m) runs.push({ text: m[1], bold: true });
    else runs.push({ text: part, bold: false });
  }
  return runs;
}

function plain(text) {
  return inlineRuns(text)
    .map((r) => r.text)
    .join("");
}

// ---- Shared facts about the meeting ------------------------------------------

/** "2025-11-19" -> "11/19/25" for the page footer. */
function shortDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!m) return "";
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}/${m[1].slice(2)}`;
}

/** The second line of the title block, if any ("ORO VALLEY TOWN COUNCIL"). */
function titleCase(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bOf\b/g, "of")
    .replace(/\bAnd\b/g, "and");
}

function footerText(blocks, clip = {}) {
  const title = blocks.find((b) => b.type === "title");
  const lines = title ? title.lines.slice(1) : [];
  const body = lines[0] ? titleCase(lines[0]) : "Oro Valley Town Council";
  let session = lines[1] ? titleCase(lines[1]) : "";
  if (!session) {
    const kind = String(clip.kind || "");
    session = kind === "special" ? "Special Session" : kind === "work-session" ? "Study Session" : "Regular Session";
  }
  return `Minutes, ${body} ${session}`.replace(/\s+/g, " ").trim();
}

// ---- Word -------------------------------------------------------------------

const FONT = "Arial";
const SIZE = 22; // half-points: 11pt
const INDENT = 720; // body text sits one inch in, like the Town's minutes
const TWIP_PAGE = 12240; // 8.5in
const TWIP_MARGIN = 1440;
const TEXT_WIDTH = TWIP_PAGE - 2 * TWIP_MARGIN;

function runs(text, { bold = false, caps = false } = {}) {
  return inlineRuns(text).map(
    (r) => new TextRun({ text: r.text, bold: bold || r.bold, allCaps: caps, font: FONT, size: SIZE })
  );
}

function spacing(after = 160) {
  return { after, line: 260 };
}

function docxBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case "title":
        b.lines.forEach((line, i) => {
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: i === b.lines.length - 1 ? 320 : 40, line: 260 },
              children: runs(line, { bold: true, caps: true }),
            })
          );
        });
        break;
      case "heading":
        out.push(
          new Paragraph({
            keepNext: true,
            spacing: { before: 200, after: 160, line: 260 },
            indent: b.level >= 3 ? { left: INDENT } : undefined,
            children: runs(b.text, { bold: true, caps: b.level <= 2 }),
          })
        );
        break;
      case "item":
        out.push(
          new Paragraph({
            keepNext: true,
            spacing: spacing(),
            indent: { left: INDENT, hanging: 480 },
            tabStops: [{ type: TabStopType.LEFT, position: INDENT }],
            children: [new TextRun({ children: [b.label, new Tab()], font: FONT, size: SIZE }), ...runs(b.text)],
          })
        );
        break;
      case "bullets":
        b.items.forEach((item, i) => {
          out.push(
            new Paragraph({
              spacing: { after: i === b.items.length - 1 ? 160 : 0, line: 260 },
              indent: { left: INDENT * 2, hanging: 0 },
              children: runs(item),
            })
          );
        });
        break;
      case "roster":
        out.push(rosterTable(b));
        out.push(new Paragraph({ spacing: { after: 0 }, children: [] }));
        break;
      case "signature":
        out.push(
          new Paragraph({
            keepNext: true,
            spacing: { before: 400, after: 0, line: 260 },
            children: [new TextRun({ text: "_________________________________________", font: FONT, size: SIZE })],
          })
        );
        break;
      default:
        out.push(new Paragraph({ spacing: spacing(), indent: { left: INDENT }, children: runs(b.text) }));
    }
  }
  return out;
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

function rosterTable(b) {
  const labelWidth = 1800;
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: [labelWidth, TEXT_WIDTH - labelWidth],
    borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: labelWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
            children: [new Paragraph({ spacing: { after: 0, line: 260 }, children: runs(b.label) })],
          }),
          new TableCell({
            width: { size: TEXT_WIDTH - labelWidth, type: WidthType.DXA },
            borders: NO_BORDERS,
            children: b.names.map(
              (name) => new Paragraph({ spacing: { after: 0, line: 260 }, children: runs(name) })
            ),
          }),
        ],
      }),
    ],
  });
}

function footer(blocks, clip) {
  const date = shortDate(clip.date);
  return new Footer({
    children: [
      new Paragraph({
        tabStops: [
          { type: TabStopType.CENTER, position: TEXT_WIDTH / 2 },
          { type: TabStopType.RIGHT, position: TEXT_WIDTH },
        ],
        children: [
          new TextRun({ children: [date, new Tab(), footerText(blocks, clip), new Tab()], font: FONT, size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }),
        ],
      }),
    ],
  });
}

/** The draft as a .docx file. Resolves a Buffer. */
async function minutesToDocx(markdown, { clip = {} } = {}) {
  const blocks = parseMinutes(markdown);
  const doc = new Document({
    creator: "Oro Valley Council Dashboard",
    title: `Minutes DRAFT ${clip.date || ""}`.trim(),
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: TWIP_PAGE, height: 15840 },
            margin: { top: TWIP_MARGIN, bottom: TWIP_MARGIN, left: TWIP_MARGIN, right: TWIP_MARGIN },
          },
        },
        footers: { default: footer(blocks, clip) },
        children: docxBlocks(blocks),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// ---- Plain text -------------------------------------------------------------

function minutesToText(markdown) {
  const blocks = parseMinutes(markdown);
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case "title":
        out.push(b.lines.map((l) => plain(l).toUpperCase()).join("\n"));
        break;
      case "heading":
        out.push(b.level <= 2 ? plain(b.text).toUpperCase() : plain(b.text));
        break;
      case "item":
        out.push(`${b.label} ${plain(b.text)}`);
        break;
      case "bullets":
        out.push(b.items.map((i) => `        ${plain(i)}`).join("\n"));
        break;
      case "roster": {
        const label = plain(b.label);
        const pad = " ".repeat(label.length + 2);
        out.push(b.names.map((n, i) => `${i === 0 ? label + "  " : pad}${plain(n)}`).join("\n"));
        break;
      }
      case "signature":
        out.push("_________________________________________");
        break;
      default:
        out.push(plain(b.text));
    }
  }
  return out.join("\n\n") + "\n";
}

// ---- HTML -------------------------------------------------------------------

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function inlineHtml(text) {
  return inlineRuns(text)
    .map((r) => (r.bold ? `<strong>${escapeHtml(r.text)}</strong>` : escapeHtml(r.text)))
    .join("");
}

/** Simple, safe HTML for the in-app preview. Every piece of text is escaped. */
function minutesToHtml(markdown) {
  const blocks = parseMinutes(markdown);
  const out = ['<article class="minutes">'];
  for (const b of blocks) {
    switch (b.type) {
      case "title":
        out.push(`<header class="minutes-title">${b.lines.map((l) => `<div>${inlineHtml(l)}</div>`).join("")}</header>`);
        break;
      case "heading": {
        const tag = b.level === 1 ? "h1" : b.level === 2 ? "h2" : "h3";
        out.push(`<${tag}>${inlineHtml(b.text)}</${tag}>`);
        break;
      }
      case "item":
        out.push(`<p class="item"><span class="num">${escapeHtml(b.label)}</span> ${inlineHtml(b.text)}</p>`);
        break;
      case "bullets":
        out.push(`<ul>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</ul>`);
        break;
      case "roster":
        out.push(
          `<div class="roster"><span class="label">${inlineHtml(b.label)}</span><ul>${b.names
            .map((n) => `<li>${inlineHtml(n)}</li>`)
            .join("")}</ul></div>`
        );
        break;
      case "signature":
        out.push('<p class="signature">_________________________________________</p>');
        break;
      default:
        out.push(`<p>${inlineHtml(b.text)}</p>`);
    }
  }
  out.push("</article>");
  return out.join("\n");
}

module.exports = { minutesToDocx, minutesToText, minutesToHtml, parseMinutes, escapeHtml, footerText, shortDate };
