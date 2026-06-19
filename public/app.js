const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");
const ideaForm = document.querySelector("[data-idea-form]");
const formStatus = document.querySelector("[data-form-status]");
const ideaCount = document.querySelector("[data-idea-count]");
const documentCount = document.querySelector("[data-document-count]");
const newsCount = document.querySelector("[data-news-count]");
const newsList = document.querySelector("[data-news-list]");
const postList = document.querySelector("[data-post-list]");
const meetingList = document.querySelector("[data-meeting-list]");
const documentList = document.querySelector("[data-document-list]");
const memberList = document.querySelector("[data-member-list]");
const approvedIdeasList = document.querySelector("[data-approved-ideas]");
const nextMeetingTitle = document.querySelector("[data-next-meeting-title]");
const nextMeetingMeta = document.querySelector("[data-next-meeting-meta]");
const publicDocumentViewer = document.querySelector("[data-public-document-viewer]");
const publicDocumentTitle = document.querySelector("[data-public-document-title]");
const publicPdfFrame = document.querySelector("[data-public-pdf-frame]");

navToggle?.addEventListener("click", () => {
  const isOpen = nav?.classList.toggle("is-open") ?? false;
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

nav?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) {
    nav.classList.remove("is-open");
    navToggle?.setAttribute("aria-expanded", "false");
  }
});

document.querySelectorAll(".main-nav a").forEach((link) => {
  const currentPath = window.location.pathname === "/" ? "/" : window.location.pathname;
  const linkPath = new URL(link.href).pathname;
  link.classList.toggle("is-active", linkPath === currentPath);
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.14 }
);

function observeReveals(root = document) {
  root.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
}

observeReveals();

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isSafeContentUrl(value, allowedProtocols) {
  const url = String(value || "").trim();
  if (!url || url.startsWith("//")) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  if (allowedProtocols.includes("data") && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(url)) return true;
  try {
    return allowedProtocols.includes(new URL(url).protocol.replace(":", ""));
  } catch {
    return false;
  }
}

function renderRichText(container, value) {
  const html = String(value || "");
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    html.split(/\n{2,}/).filter(Boolean).forEach((paragraph) => {
      container.append(createElement("p", "", paragraph));
    });
    return;
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const allowedTags = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "A", "UL", "OL", "LI", "H2", "H3", "BLOCKQUOTE", "IMG"]);
  const allowedAttrs = new Set(["href", "src", "alt", "target", "rel"]);
  template.content.querySelectorAll("*").forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ""));
      return;
    }
    [...node.attributes].forEach((attribute) => {
      if (!allowedAttrs.has(attribute.name)) node.removeAttribute(attribute.name);
    });
    if (node.tagName === "A") {
      if (!isSafeContentUrl(node.getAttribute("href"), ["https", "mailto"])) node.removeAttribute("href");
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    }
    if (node.tagName === "IMG" && !isSafeContentUrl(node.getAttribute("src"), ["https", "data"])) {
      node.remove();
    }
  });
  container.append(template.content.cloneNode(true));
}

function getLimit(element, fallback) {
  const limit = Number(element?.dataset.limit || 0);
  return limit > 0 ? limit : fallback;
}

async function refreshStats() {
  try {
    const response = await fetch("/api/stats", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const payload = await response.json();
    if (ideaCount && Number.isFinite(payload.ideas)) ideaCount.textContent = String(payload.ideas);
    if (documentCount && Number.isFinite(payload.documents)) documentCount.textContent = String(payload.documents);
    if (newsCount && Number.isFinite(payload.news)) newsCount.textContent = String(payload.news);
  } catch {
    // The static page can still be browsed when the API is unavailable.
  }
}

function setStatus(message, state) {
  if (!formStatus) return;
  formStatus.textContent = message;
  formStatus.dataset.state = state;
}

function renderNews(items) {
  if (!newsList) return;
  newsList.replaceChildren();
  items.slice(0, getLimit(newsList, items.length)).forEach((item) => {
    const article = createElement("article", "news-card reveal");
    article.append(createElement("span", `tag tag-${item.tagStyle || "teal"}`, item.tag || "Info"));
    article.append(createElement("h3", "", item.title));
    article.append(createElement("p", "", item.body));
    const time = createElement("time", "", formatDate(item.date));
    if (item.date) time.dateTime = item.date;
    article.append(time);
    newsList.append(article);
  });
  observeReveals(newsList);
}

function renderPosts(items) {
  if (!postList) return;
  postList.replaceChildren();
  items.slice(0, getLimit(postList, items.length)).forEach((item) => {
    const article = createElement("article", "post-card reveal");
    const meta = createElement("div", "post-meta");
    meta.append(createElement("span", "tag tag-teal", item.category || "Info CSE"));
    if (item.date) {
      const time = createElement("time", "", formatDate(item.date));
      time.dateTime = item.date;
      meta.append(time);
    }
    article.append(meta);
    article.append(createElement("h3", "", item.title));
    if (item.excerpt) article.append(createElement("p", "post-excerpt", item.excerpt));
    const body = createElement("div", "post-body");
    renderRichText(body, item.body);
    article.append(body);
    postList.append(article);
  });
  observeReveals(postList);
}

function renderMeetings(items) {
  if (!meetingList) return;
  meetingList.replaceChildren();
  items.slice(0, getLimit(meetingList, items.length)).forEach((item) => {
    const article = createElement("article");
    const time = createElement("time", "", item.dateLabel || formatDate(item.datetime));
    if (item.datetime) time.dateTime = item.datetime;
    const body = createElement("div");
    body.append(createElement("h3", "", item.title));
    const details = [item.place, item.time].filter(Boolean).join(" · ");
    body.append(createElement("p", "", details ? `${item.body} ${details}` : item.body));
    article.append(time, body);
    meetingList.append(article);
  });

  const next = items[0];
  if (next && nextMeetingTitle && nextMeetingMeta) {
    nextMeetingTitle.textContent = next.dateLabel || formatDate(next.datetime);
    nextMeetingMeta.textContent = [next.place, next.time].filter(Boolean).join(" · ") || next.title;
  }
}

function renderDocuments(items) {
  if (!documentList) return;
  documentList.replaceChildren();
  items.slice(0, getLimit(documentList, items.length)).forEach((item) => {
    const link = createElement("a", "document-row");
    const viewerParams = new URLSearchParams({ document: item.url, title: item.title || "Document CSE" });
    link.href = `/lecteur.html?${viewerParams.toString()}`;
    link.setAttribute("aria-label", `Consulter ${item.title || "le document"}`);
    link.addEventListener("click", (event) => {
      if (!publicDocumentViewer || !publicPdfFrame || !item.url) return;
      event.preventDefault();
      publicDocumentTitle.textContent = item.title || "Document CSE";
      publicPdfFrame.src = item.url;
      publicDocumentViewer.hidden = false;
      publicDocumentViewer.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    link.append(createElement("span", "doc-icon", "PDF"));
    const copy = createElement("span");
    copy.append(createElement("strong", "", item.title));
    copy.append(createElement("small", "", item.description || "Document CSE"));
    link.append(copy, createElement("span", "download", "Consulter"));
    documentList.append(link);
  });
}

document.querySelector("[data-close-public-document-viewer]")?.addEventListener("click", () => {
  if (!publicDocumentViewer || !publicPdfFrame) return;
  publicPdfFrame.removeAttribute("src");
  publicDocumentViewer.hidden = true;
});

function initials(member) {
  return `${member.firstName?.[0] || ""}${member.lastName?.[0] || ""}`.toUpperCase() || "CSE";
}

function renderMembers(items) {
  if (!memberList) return;
  memberList.replaceChildren();
  items.slice(0, getLimit(memberList, items.length)).forEach((member) => {
    const card = createElement("article", "team-card member-card reveal");
    const photo = createElement("div", "member-photo");
    if (member.photo) {
      const img = document.createElement("img");
      img.src = member.photo;
      img.alt = `${member.firstName} ${member.lastName}`;
      photo.append(img);
    } else {
      photo.textContent = initials(member);
    }
    card.append(photo);
    card.append(createElement("span", "member-role", member.role));
    card.append(createElement("h3", "", `${member.firstName} ${member.lastName}`.trim()));
    card.append(createElement("p", "", [member.service, member.site].filter(Boolean).join(" · ")));
    if (member.email) {
      const mail = createElement("a", "", member.email);
      mail.href = `mailto:${member.email}`;
      card.append(mail);
    }
    memberList.append(card);
  });
  observeReveals(memberList);
}

function hasVoted(ideaId) {
  try {
    return localStorage.getItem(`cse-vote-${ideaId}`) === "1";
  } catch {
    return false;
  }
}

function markVoted(ideaId) {
  try {
    localStorage.setItem(`cse-vote-${ideaId}`, "1");
  } catch {
    // Voting still works server-side if local storage is unavailable.
  }
}

async function voteForIdea(ideaId, button) {
  if (hasVoted(ideaId)) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/ideas/${ideaId}/vote`, { method: "POST", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("vote_failed");
    markVoted(ideaId);
    await renderApprovedIdeas();
  } catch {
    button.disabled = false;
  }
}

async function renderApprovedIdeas() {
  if (!approvedIdeasList) return;
  try {
    const response = await fetch("/api/ideas/approved", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("load_failed");
    const payload = await response.json();
    approvedIdeasList.replaceChildren();

    if (!payload.ideas.length) {
      const empty = createElement("article", "empty-state");
      empty.append(createElement("h3", "", "Aucune idée validée pour le moment"));
      empty.append(createElement("p", "", "Les propositions apparaîtront ici après validation par les membres du CSE."));
      approvedIdeasList.append(empty);
      return;
    }

    payload.ideas.slice(0, getLimit(approvedIdeasList, payload.ideas.length)).forEach((idea) => {
      const card = createElement("article", "idea-public-card");
      card.append(createElement("span", "tag tag-teal", idea.category));
      card.append(createElement("p", "idea-public-message", idea.message));
      if (idea.context) card.append(createElement("small", "", idea.context));
      const footer = createElement("div", "idea-public-footer");
      footer.append(createElement("strong", "", `${idea.votes} vote${idea.votes > 1 ? "s" : ""}`));
      const button = createElement("button", "button button-secondary", hasVoted(idea.id) ? "Vote enregistré" : "Voter");
      button.type = "button";
      button.disabled = hasVoted(idea.id);
      button.addEventListener("click", () => voteForIdea(idea.id, button));
      footer.append(button);
      card.append(footer);
      approvedIdeasList.append(card);
    });
  } catch {
    approvedIdeasList.replaceChildren();
  }
}

async function loadContent() {
  try {
    const response = await fetch("/api/content", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const payload = await response.json();
    const content = payload.content;
    renderNews(content.news || []);
    renderPosts(content.posts || []);
    renderMeetings(content.meetings || []);
    renderDocuments(content.documents || []);
    renderMembers(content.members || []);
  } catch {
    // Keep the static fallback HTML.
  }
}

ideaForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = ideaForm.querySelector("button[type='submit']");
  const formData = new FormData(ideaForm);
  const payload = {
    category: formData.get("category"),
    message: formData.get("message"),
    context: formData.get("context")
  };

  submitButton?.setAttribute("disabled", "true");
  setStatus("Envoi en cours...", "");

  try {
    const response = await fetch("/api/ideas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("submission_failed");
    }

    ideaForm.reset();
    setStatus("Idée reçue. Elle sera publiée si le CSE la valide.", "success");
    await refreshStats();
  } catch {
    setStatus("L'envoi n'a pas abouti. Réessayez dans quelques instants.", "error");
  } finally {
    submitButton?.removeAttribute("disabled");
  }
});

loadContent();
refreshStats();
renderApprovedIdeas();
