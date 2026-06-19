import sanitizeHtml from "sanitize-html";

export function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function cleanLongText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

export function cleanDate(value) {
  const cleaned = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(cleaned) ? cleaned : "";
}

export function normalizeDocumentKind(value, title = "") {
  if (["pv", "odj", "avantages", "guide", "other"].includes(value)) return value;
  const searchable = cleanText(title, 160).toLowerCase();
  if (searchable.includes("ordre du jour") || searchable.includes("odj")) return "odj";
  if (searchable.includes("pv") || searchable.includes("proces-verbal") || searchable.includes("procès-verbal")) return "pv";
  if (searchable.includes("avantage")) return "avantages";
  if (searchable.includes("guide")) return "guide";
  return "other";
}

export function sanitizeRichText(value, maxLength) {
  const source = String(value || "").slice(0, maxLength * 4);
  return sanitizeHtml(source, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li", "h2", "h3", "blockquote", "img"],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt"] },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: { img: ["https", "data"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attributes) => ({
        tagName,
        attribs: { href: attributes.href || "", target: "_blank", rel: "noopener noreferrer" }
      })
    }
  }).trim().slice(0, maxLength);
}
