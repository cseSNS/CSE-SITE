const title = document.querySelector("[data-document-title]");
const frame = document.querySelector("[data-pdf-frame]");
const viewer = document.querySelector("[data-pdf-viewer]");
const status = document.querySelector("[data-viewer-status]");
const params = new URLSearchParams(window.location.search);
const documentPath = params.get("document") || "";
const documentTitle = params.get("title") || "Document CSE";

function isSafePdfPath(value) {
  return /^\/(?:documents|uploads)\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.pdf$/i.test(value) && !value.includes("..") && !value.includes("//");
}

if (!isSafePdfPath(documentPath)) {
  viewer.hidden = true;
  status.textContent = "Ce document ne peut pas etre affiche.";
} else {
  title.textContent = documentTitle.slice(0, 160);
  frame.src = documentPath;
}
