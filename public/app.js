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
const ideaTrackingForm = document.querySelector("[data-idea-tracking-form]");
const ideaTrackingStatus = document.querySelector("[data-idea-tracking-status]");
const meetingSiteFilter = document.querySelector("[data-meeting-site-filter]");
const agendaCalendar = document.querySelector("[data-agenda-calendar]");
const documentSearch = document.querySelector("[data-document-search]");
const documentKindFilter = document.querySelector("[data-document-kind-filter]");
const memberSiteFilter = document.querySelector("[data-member-site-filter]");
const memberServiceFilter = document.querySelector("[data-member-service-filter]");
const featuredList = document.querySelector("[data-featured-list]");
const featuredMeeting = document.querySelector("[data-featured-meeting]");
const globalSearchInput = document.querySelector("[data-global-search-input]");
const globalSearchResults = document.querySelector("[data-global-search-results]");

let publicContent = { news: [], posts: [], meetings: [], documents: [], members: [] };

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

function fillSelect(select, values) {
  if (!select) return;
  const current = select.value || "all";
  [...select.querySelectorAll("option:not([value='all'])")].forEach((option) => option.remove());
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")).forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = [...select.options].some((option) => option.value === current) ? current : "all";
}

function calendarLink(meeting) {
  const link = createElement("a", "calendar-link", "Ajouter au calendrier");
  link.href = `/api/meetings/${encodeURIComponent(meeting.id)}.ics`;
  return link;
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
  fillSelect(meetingSiteFilter, items.map((item) => item.site));
  const selectedSite = meetingSiteFilter?.value || "all";
  const visibleMeetings = items.filter((item) => selectedSite === "all" || item.site === selectedSite);
  meetingList.replaceChildren();
  visibleMeetings.slice(0, getLimit(meetingList, visibleMeetings.length)).forEach((item) => {
    const article = createElement("article");
    const time = createElement("time", "", item.dateLabel || formatDate(item.datetime));
    if (item.datetime) time.dateTime = item.datetime;
    const body = createElement("div");
    body.append(createElement("h3", "", item.title));
    const details = [item.place, item.site, item.time].filter(Boolean).join(" · ");
    body.append(createElement("p", "", details ? `${item.body} ${details}` : item.body));
    if (item.datetime) body.append(calendarLink(item));
    article.append(time, body);
    meetingList.append(article);
  });

  renderAgendaCalendar(visibleMeetings);
  const next = visibleMeetings[0];
  if (next && nextMeetingTitle && nextMeetingMeta) {
    nextMeetingTitle.textContent = next.dateLabel || formatDate(next.datetime);
    nextMeetingMeta.textContent = [next.place, next.site, next.time].filter(Boolean).join(" · ") || next.title;
  }
}

function renderAgendaCalendar(items) {
  if (!agendaCalendar) return;
  agendaCalendar.replaceChildren();
  const dated = items.filter((item) => item.datetime).sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
  if (!dated.length) return;
  const reference = new Date(`${dated[0].datetime}T12:00:00`);
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const firstDay = new Date(year, month, 1).getDay() || 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const heading = createElement("h2", "calendar-month", new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(reference));
  const grid = createElement("div", "calendar-grid");
  ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].forEach((day) => grid.append(createElement("span", "calendar-day-label", day)));
  for (let index = 1; index < firstDay; index += 1) grid.append(createElement("span", "calendar-day calendar-day-empty", ""));
  for (let day = 1; day <= daysInMonth; day += 1) {
    const cell = createElement("div", "calendar-day");
    cell.append(createElement("strong", "", String(day)));
    dated.filter((item) => {
      const date = new Date(`${item.datetime}T12:00:00`);
      return date.getDate() === day && date.getMonth() === month;
    }).forEach((item) => {
      const link = createElement("a", "calendar-event", item.title);
      link.href = `/api/meetings/${encodeURIComponent(item.id)}.ics`;
      cell.append(link);
    });
    grid.append(cell);
  }
  agendaCalendar.append(heading, grid);
}

function renderDocuments(items) {
  if (!documentList) return;
  const query = (documentSearch?.value || "").trim().toLowerCase();
  const kind = documentKindFilter?.value || "all";
  const visibleDocuments = items.filter((item) => {
    const matchesQuery = !query || `${item.title} ${item.description} ${item.kind}`.toLowerCase().includes(query);
    return matchesQuery && (kind === "all" || item.kind === kind);
  });
  documentList.replaceChildren();
  visibleDocuments.slice(0, getLimit(documentList, visibleDocuments.length)).forEach((item) => {
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
    const metadata = [item.description || "Document CSE", item.publishedAt ? formatDate(item.publishedAt) : ""].filter(Boolean).join(" · ");
    copy.append(createElement("small", "", metadata));
    if (item.pinned) copy.append(createElement("small", "document-pinned", "Document epingle"));
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
  fillSelect(memberSiteFilter, items.map((member) => member.site));
  fillSelect(memberServiceFilter, items.map((member) => member.service));
  const selectedSite = memberSiteFilter?.value || "all";
  const selectedService = memberServiceFilter?.value || "all";
  const visibleMembers = items.filter((member) => (selectedSite === "all" || member.site === selectedSite) && (selectedService === "all" || member.service === selectedService));
  memberList.replaceChildren();
  visibleMembers.slice(0, getLimit(memberList, visibleMembers.length)).forEach((member) => {
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
      const mail = createElement("a", "member-contact", "Contacter");
      mail.href = `mailto:${member.email}`;
      card.append(mail);
    }
    memberList.append(card);
  });
  observeReveals(memberList);
}

async function voteForIdea(ideaId, button) {
  if (button.dataset.voted === "true") return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/ideas/${ideaId}/vote`, { method: "POST", headers: { Accept: "application/json" } });
    if (response.status === 409) {
      button.dataset.voted = "true";
      button.textContent = "Vote enregistre";
      return;
    }
    if (!response.ok) throw new Error("vote_failed");
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
      card.append(createElement("span", `idea-lifecycle lifecycle-${idea.status}`, idea.status === "in_progress" ? "En cours d'etude" : "Retenue par le CSE"));
      card.append(createElement("p", "idea-public-message", idea.message));
      if (idea.context) card.append(createElement("small", "", idea.context));
      const footer = createElement("div", "idea-public-footer");
      footer.append(createElement("strong", "", `${idea.votes} vote${idea.votes > 1 ? "s" : ""}`));
      const button = createElement("button", "button button-secondary", idea.voted ? "Vote enregistre" : "Voter");
      button.type = "button";
      button.dataset.voted = String(Boolean(idea.voted));
      button.disabled = Boolean(idea.voted);
      button.addEventListener("click", () => voteForIdea(idea.id, button));
      footer.append(button);
      card.append(footer);
      approvedIdeasList.append(card);
    });
  } catch {
    approvedIdeasList.replaceChildren();
  }
}

function renderFeatured(content) {
  if (!featuredList || !featuredMeeting) return;
  featuredList.replaceChildren();
  const items = [
    ...content.posts.map((item) => ({ ...item, type: "Article", href: "/infos.html", summary: item.excerpt })),
    ...content.news.map((item) => ({ ...item, type: "Actualite", href: "/actualites.html", summary: item.body }))
  ].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || String(b.date).localeCompare(String(a.date))).slice(0, 3);
  items.forEach((item) => {
    const card = createElement("article", "featured-card");
    card.append(createElement("span", "tag tag-teal", item.type));
    card.append(createElement("h2", "", item.title));
    card.append(createElement("p", "", item.summary || "Information CSE"));
    const link = createElement("a", "featured-link", "Lire l'information");
    link.href = item.href;
    card.append(link);
    featuredList.append(card);
  });

  const meeting = [...content.meetings].sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)))[0];
  featuredMeeting.replaceChildren();
  featuredMeeting.append(createElement("p", "eyebrow", "Prochaine reunion"));
  if (!meeting) {
    featuredMeeting.append(createElement("h2", "", "Aucun rendez-vous programme"));
    return;
  }
  featuredMeeting.append(createElement("h2", "", meeting.title));
  featuredMeeting.append(createElement("p", "", [formatDate(meeting.datetime), meeting.place, meeting.site, meeting.time].filter(Boolean).join(" · ")));
  if (meeting.datetime) featuredMeeting.append(calendarLink(meeting));
}

function renderGlobalSearch(content) {
  if (!globalSearchResults) return;
  const query = (globalSearchInput?.value || "").trim().toLowerCase();
  globalSearchResults.replaceChildren();
  if (query.length < 2) {
    globalSearchResults.append(createElement("p", "search-placeholder", "Saisis au moins deux caracteres pour rechercher."));
    return;
  }
  const sources = [
    ...content.news.map((item) => ({ type: "Actualite", title: item.title, text: `${item.tag} ${item.body}`, href: "/actualites.html" })),
    ...content.posts.map((item) => ({ type: "Article", title: item.title, text: `${item.category} ${item.excerpt}`, href: "/infos.html" })),
    ...content.meetings.map((item) => ({ type: "Reunion", title: item.title, text: `${item.body} ${item.place} ${item.site}`, href: "/agenda.html" })),
    ...content.documents.map((item) => ({ type: "Document", title: item.title, text: `${item.description} ${item.kind}`, href: "/documents.html" })),
    ...content.members.map((item) => ({ type: "Membre", title: `${item.firstName} ${item.lastName}`, text: `${item.service} ${item.site} ${item.role}`, href: "/membres.html" }))
  ].filter((item) => `${item.title} ${item.text}`.toLowerCase().includes(query)).slice(0, 30);
  if (!sources.length) {
    globalSearchResults.append(createElement("p", "search-placeholder", "Aucun resultat."));
    return;
  }
  sources.forEach((item) => {
    const link = createElement("a", "search-result");
    link.href = item.href;
    link.append(createElement("span", "tag tag-teal", item.type));
    link.append(createElement("strong", "", item.title));
    link.append(createElement("span", "", item.text.slice(0, 180)));
    globalSearchResults.append(link);
  });
}

async function loadContent() {
  try {
    const response = await fetch("/api/content", { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    const payload = await response.json();
    publicContent = payload.content;
    renderNews(publicContent.news || []);
    renderPosts(publicContent.posts || []);
    renderMeetings(publicContent.meetings || []);
    renderDocuments(publicContent.documents || []);
    renderMembers(publicContent.members || []);
    renderFeatured(publicContent);
    renderGlobalSearch(publicContent);
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

    const responsePayload = await response.json();
    ideaForm.reset();
    setStatus(`Idee recue. Ton code de suivi anonyme est ${responsePayload.trackingCode}. Conserve-le pour suivre son traitement.`, "success");
    await refreshStats();
  } catch {
    setStatus("L'envoi n'a pas abouti. Réessayez dans quelques instants.", "error");
  } finally {
    submitButton?.removeAttribute("disabled");
  }
});

ideaTrackingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = String(new FormData(ideaTrackingForm).get("trackingCode") || "").trim();
  ideaTrackingStatus.textContent = "Recherche en cours...";
  try {
    const response = await fetch(`/api/ideas/track/${encodeURIComponent(code)}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("not_found");
    const payload = await response.json();
    const labels = { pending: "recue", approved: "retenue", in_progress: "en cours d'etude", treated: "traitee", rejected: "non retenue" };
    ideaTrackingStatus.textContent = `Ta proposition est ${labels[payload.idea.status] || "mise a jour"}. ${payload.idea.reviewNote || ""}`.trim();
    ideaTrackingStatus.dataset.state = "success";
  } catch {
    ideaTrackingStatus.textContent = "Code de suivi introuvable.";
    ideaTrackingStatus.dataset.state = "error";
  }
});

meetingSiteFilter?.addEventListener("change", () => renderMeetings(publicContent.meetings || []));
documentSearch?.addEventListener("input", () => renderDocuments(publicContent.documents || []));
documentKindFilter?.addEventListener("change", () => renderDocuments(publicContent.documents || []));
memberSiteFilter?.addEventListener("change", () => renderMembers(publicContent.members || []));
memberServiceFilter?.addEventListener("change", () => renderMembers(publicContent.members || []));
globalSearchInput?.addEventListener("input", () => renderGlobalSearch(publicContent));

loadContent();
refreshStats();
renderApprovedIdeas();
