const loginPanel = document.querySelector("[data-login-panel]");
const loginForm = document.querySelector("[data-login-form]");
const loginStatus = document.querySelector("[data-login-status]");
const adminApp = document.querySelector("[data-admin-app]");
const tabButtons = [...document.querySelectorAll("[data-tab-button]")];
const tabPanels = [...document.querySelectorAll("[data-tab]")];
const adminNav = document.querySelector("[data-admin-nav]");
const pendingStat = document.querySelector("[data-admin-pending]");
const approvedStat = document.querySelector("[data-admin-approved]");
const progressStat = document.querySelector("[data-admin-progress]");
const treatedStat = document.querySelector("[data-admin-treated]");
const documentsStat = document.querySelector("[data-admin-documents]");
const ideasContainer = document.querySelector("[data-admin-ideas]");
const ideaSearch = document.querySelector("[data-idea-search]");
const ideaFilter = document.querySelector("[data-idea-filter]");
const exportIdeas = document.querySelector("[data-export-ideas]");
const newsEditor = document.querySelector("[data-news-editor]");
const postsEditor = document.querySelector("[data-posts-editor]");
const meetingsEditor = document.querySelector("[data-meetings-editor]");
const documentsEditor = document.querySelector("[data-documents-editor]");
const membersEditor = document.querySelector("[data-members-editor]");
const contentStatus = document.querySelector("[data-content-status]");
const postStatus = document.querySelector("[data-post-status]");
const documentStatus = document.querySelector("[data-document-status]");
const memberStatus = document.querySelector("[data-member-status]");
const mailStatus = document.querySelector("[data-mail-status]");
const documentForm = document.querySelector("[data-document-form]");
const mailForm = document.querySelector("[data-mail-form]");
const adminAccountForm = document.querySelector("[data-admin-account-form]");
const adminAccountsContainer = document.querySelector("[data-admin-accounts]");
const adminAccountStatus = document.querySelector("[data-admin-account-status]");
const logoutButton = document.querySelector("[data-logout]");

let content = { news: [], posts: [], meetings: [], documents: [], members: [] };
let ideas = [];
let adminAccounts = [];
let currentAdmin = null;

function setMessage(element, message, state = "") {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}

function applyPermissions(admin) {
  currentAdmin = admin;
  const isOwner = admin?.role === "owner";
  document.querySelectorAll("[data-owner-only]").forEach((element) => {
    element.hidden = !isOwner;
  });
}

function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function request(path, options = {}) {
  const hasJsonBody = typeof options.body === "string";
  return fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function field(label, value = "", options = {}) {
  const wrapper = createElement("label", "admin-field");
  wrapper.append(document.createTextNode(label));
  let input;
  if (options.type === "textarea") {
    input = document.createElement("textarea");
    input.rows = options.rows || 3;
  } else if (options.type === "select") {
    input = document.createElement("select");
    options.choices.forEach((choice) => {
      const option = document.createElement("option");
      option.value = choice;
      option.textContent = choice;
      input.append(option);
    });
  } else {
    input = document.createElement("input");
    input.type = options.type || "text";
  }
  input.value = value || "";
  input.dataset.key = options.key;
  if (options.placeholder) input.placeholder = options.placeholder;
  wrapper.append(input);
  return wrapper;
}

function richField(label, value = "", key = "body") {
  const wrapper = createElement("div", "admin-field rich-field");
  const title = createElement("span", "", label);
  const toolbar = createElement("div", "rich-toolbar");
  [
    ["bold", "B"],
    ["italic", "I"],
    ["underline", "U"],
    ["insertUnorderedList", "Liste"],
    ["formatBlock", "Titre"],
    ["createLink", "Lien"],
    ["insertImage", "Image"]
  ].forEach(([command, text]) => {
    const button = createElement("button", "button button-secondary", text);
    button.type = "button";
    button.dataset.command = command;
    toolbar.append(button);
  });

  const editor = createElement("div", "rich-editor");
  editor.contentEditable = "true";
  editor.dataset.key = key;
  editor.innerHTML = value || "";

  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-command]");
    if (!button) return;
    editor.focus();
    const command = button.dataset.command;
    if (command === "createLink") {
      const url = prompt("Adresse du lien");
      if (url) document.execCommand(command, false, url);
      return;
    }
    if (command === "insertImage") {
      const url = prompt("Adresse de l'image");
      if (url) document.execCommand(command, false, url);
      return;
    }
    if (command === "formatBlock") {
      document.execCommand(command, false, "h3");
      return;
    }
    document.execCommand(command, false, null);
  });

  wrapper.append(title, toolbar, editor);
  return wrapper;
}

function getInput(card, key) {
  return card.querySelector(`[data-key="${key}"]`)?.value.trim() || "";
}

function getRichInput(card, key) {
  const editor = card.querySelector(`.rich-editor[data-key="${key}"]`);
  return editor ? editor.innerHTML.trim() : getInput(card, key);
}

function activateTab(name) {
  tabButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.tabButton === name));
  tabPanels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.tab === name));
}

tabButtons.forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.tabButton)));
document.querySelectorAll("[data-shortcut-tab]").forEach((button) => button.addEventListener("click", () => activateTab(button.dataset.shortcutTab)));

function ideaStatusLabel(status) {
  if (status === "approved") return "Validee";
  if (status === "in_progress") return "En cours";
  if (status === "treated") return "Traitee";
  if (status === "rejected") return "Rejetee";
  return "A traiter";
}

async function updateIdea(id, status) {
  const response = await request(`/api/admin/ideas/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
  if (!response.ok) return;
  await loadIdeas();
}

function renderIdeas() {
  ideasContainer.replaceChildren();
  const query = (ideaSearch?.value || "").trim().toLowerCase();
  const selectedStatus = ideaFilter?.value || "all";
  const sorted = [...ideas].sort((a, b) => {
    const rank = { pending: 0, approved: 1, in_progress: 2, treated: 3, rejected: 4 };
    return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(b.createdAt).localeCompare(String(a.createdAt));
  }).filter((idea) => {
    const matchesStatus = selectedStatus === "all" || idea.status === selectedStatus;
    const haystack = `${idea.category} ${idea.message} ${idea.context} ${idea.reviewNote}`.toLowerCase();
    return matchesStatus && (!query || haystack.includes(query));
  });

  if (!sorted.length) {
    const empty = createElement("article", "admin-item");
    empty.append(createElement("p", "", "Aucune idee recue pour le moment."));
    ideasContainer.append(empty);
    return;
  }

  sorted.forEach((idea) => {
    const item = createElement("article", "admin-item");
    const header = createElement("div", "admin-item-header");
    const copy = createElement("div");
    copy.append(createElement("h3", "", idea.category || "Idee"));
    copy.append(createElement("p", "admin-item-meta", `${ideaStatusLabel(idea.status)} · ${idea.votes || 0} vote(s) · ${new Date(idea.createdAt).toLocaleString("fr-FR")}`));
    header.append(copy);

    const actions = createElement("div", "admin-actions");
    const approve = createElement("button", "button button-success", "Valider");
    approve.type = "button";
    approve.disabled = idea.status === "approved";
    approve.addEventListener("click", () => updateIdea(idea.id, "approved"));
    const progress = createElement("button", "button button-secondary", "En cours");
    progress.type = "button";
    progress.disabled = idea.status === "in_progress";
    progress.addEventListener("click", () => updateIdea(idea.id, "in_progress"));
    const treated = createElement("button", "button button-secondary", "Traitee");
    treated.type = "button";
    treated.disabled = idea.status === "treated";
    treated.addEventListener("click", () => updateIdea(idea.id, "treated"));
    const reject = createElement("button", "button button-danger", "Rejeter");
    reject.type = "button";
    reject.disabled = idea.status === "rejected";
    reject.addEventListener("click", () => updateIdea(idea.id, "rejected"));
    const pending = createElement("button", "button button-secondary", "Remettre en attente");
    pending.type = "button";
    pending.disabled = idea.status === "pending";
    pending.addEventListener("click", () => updateIdea(idea.id, "pending"));
    actions.append(approve, progress, treated, reject, pending);
    header.append(actions);

    item.append(header);
    item.append(createElement("p", "", idea.message));
    if (idea.context) item.append(createElement("p", "admin-item-meta", idea.context));
    ideasContainer.append(item);
  });
}

function editorCard(type, item) {
  const card = createElement("article", "editor-card");
  card.dataset.id = item.id || uid(type);
  const actions = createElement("div", "admin-actions");
  const remove = createElement("button", "button button-danger", "Supprimer");
  remove.type = "button";
  remove.addEventListener("click", () => card.remove());
  actions.append(remove);

  if (type === "news") {
    card.append(
      field("Titre", item.title, { key: "title" }),
      field("Etiquette", item.tag, { key: "tag" }),
      field("Couleur", item.tagStyle || "teal", { key: "tagStyle", type: "select", choices: ["teal", "coral", "gold"] }),
      field("Date", item.date, { key: "date", type: "date" }),
      field("Texte court", item.body, { key: "body", type: "textarea" }),
      actions
    );
  }

  if (type === "post") {
    card.append(
      field("Titre", item.title, { key: "title" }),
      field("Categorie", item.category, { key: "category", placeholder: "Comprendre, Avantages, Dossier..." }),
      field("Statut", item.status || "published", { key: "status", type: "select", choices: ["published", "draft"] }),
      field("Mise en avant", item.featured ? "yes" : "no", { key: "featured", type: "select", choices: ["no", "yes"] }),
      field("Date", item.date, { key: "date", type: "date" }),
      field("Resume", item.excerpt, { key: "excerpt", type: "textarea", rows: 3 }),
      richField("Contenu", item.body, "body"),
      actions
    );
  }

  if (type === "meeting") {
    card.append(
      field("Titre", item.title, { key: "title" }),
      field("Libelle date", item.dateLabel, { key: "dateLabel", placeholder: "27 juin" }),
      field("Date technique", item.datetime, { key: "datetime", type: "date" }),
      field("Lieu", item.place, { key: "place" }),
      field("Heure", item.time, { key: "time", placeholder: "10h30" }),
      field("Description", item.body, { key: "body", type: "textarea" }),
      actions
    );
  }

  if (type === "member") {
    const photoInput = document.createElement("input");
    photoInput.type = "file";
    photoInput.accept = "image/png,image/jpeg,image/webp";
    const photoWrapper = createElement("label", "admin-field");
    photoWrapper.append(document.createTextNode("Photo"));
    photoWrapper.append(photoInput);
    const photoValue = document.createElement("input");
    photoValue.type = "hidden";
    photoValue.dataset.key = "photo";
    photoValue.value = item.photo || "";
    card.append(photoValue);

    const preview = createElement("div", "member-preview", item.photo ? "" : "Aucune photo");
    if (item.photo) {
      const img = document.createElement("img");
      img.src = item.photo;
      img.alt = "Photo membre";
      preview.append(img, document.createTextNode("Photo chargee"));
    }

    photoInput.addEventListener("change", async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      if (file.size > 700_000) {
        preview.textContent = "Image trop lourde, vise moins de 700 Ko.";
        return;
      }
      const dataUrl = await readFileAsDataUrl(file);
      photoValue.value = dataUrl;
      preview.replaceChildren();
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "Photo membre";
      preview.append(img, document.createTextNode("Photo chargee"));
    });

    const grid = createElement("div", "member-editor-grid");
    grid.append(
      field("Prenom", item.firstName, { key: "firstName" }),
      field("Nom", item.lastName, { key: "lastName" }),
      field("Role", item.role || "Titulaire", { key: "role", type: "select", choices: ["Titulaire", "Suppleant"] }),
      field("Service", item.service, { key: "service" }),
      field("Site", item.site, { key: "site" }),
      field("Email", item.email, { key: "email", type: "email" })
    );
    card.append(grid, photoWrapper, preview, actions);
  }

  return card;
}

function renderContentEditors() {
  newsEditor.replaceChildren(...content.news.map((item) => editorCard("news", item)));
  postsEditor.replaceChildren(...(content.posts || []).map((item) => editorCard("post", item)));
  meetingsEditor.replaceChildren(...content.meetings.map((item) => editorCard("meeting", item)));
  documentsEditor.replaceChildren(...content.documents.map((item) => {
    const card = createElement("article", "admin-item");
    card.append(createElement("h3", "", item.title));
    card.append(createElement("p", "admin-item-meta", `${item.description || "Document"} · ${item.visibility || "public"} · ${item.url}`));
    const actions = createElement("div", "admin-actions");
    const open = createElement("button", "button button-secondary", "Ouvrir");
    open.type = "button";
    open.addEventListener("click", () => openDocument(item));
    const remove = createElement("button", "button button-danger", "Retirer du site");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      content.documents = content.documents.filter((documentItem) => documentItem.id !== item.id);
      await saveContent(documentStatus);
    });
    actions.append(open, remove);
    card.append(actions);
    return card;
  }));
  membersEditor.replaceChildren(...content.members.map((item) => editorCard("member", item)));
}

function gatherNews() {
  return [...newsEditor.querySelectorAll(".editor-card")].map((card) => ({
    id: card.dataset.id,
    title: getInput(card, "title"),
    tag: getInput(card, "tag"),
    tagStyle: getInput(card, "tagStyle") || "teal",
    date: getInput(card, "date"),
    body: getInput(card, "body")
  })).filter((item) => item.title && item.body);
}

function gatherPosts() {
  return [...postsEditor.querySelectorAll(".editor-card")].map((card) => ({
    id: card.dataset.id,
    title: getInput(card, "title"),
    category: getInput(card, "category"),
    status: getInput(card, "status") || "published",
    featured: getInput(card, "featured") === "yes",
    date: getInput(card, "date"),
    excerpt: getInput(card, "excerpt"),
    body: getRichInput(card, "body")
  })).filter((item) => item.title && item.body);
}

function gatherMeetings() {
  return [...meetingsEditor.querySelectorAll(".editor-card")].map((card) => ({
    id: card.dataset.id,
    title: getInput(card, "title"),
    dateLabel: getInput(card, "dateLabel"),
    datetime: getInput(card, "datetime"),
    place: getInput(card, "place"),
    time: getInput(card, "time"),
    body: getInput(card, "body")
  })).filter((item) => item.title);
}

function gatherMembers() {
  return [...membersEditor.querySelectorAll(".editor-card")].map((card) => ({
    id: card.dataset.id,
    firstName: getInput(card, "firstName"),
    lastName: getInput(card, "lastName"),
    role: getInput(card, "role") || "Titulaire",
    service: getInput(card, "service"),
    site: getInput(card, "site"),
    email: getInput(card, "email"),
    photo: getInput(card, "photo")
  })).filter((item) => item.firstName || item.lastName);
}

async function saveContent(statusElement) {
  content.news = gatherNews();
  content.posts = gatherPosts();
  content.meetings = gatherMeetings();
  content.members = gatherMembers();
  const response = await request("/api/admin/content", {
    method: "PUT",
    body: JSON.stringify({ content })
  });
  if (!response.ok) {
    setMessage(statusElement, "Sauvegarde impossible.", "error");
    return;
  }
  const payload = await response.json();
  content = payload.content;
  renderContentEditors();
  setMessage(statusElement, "Modifications sauvegardees.", "success");
  await loadStats();
}

async function openDocument(item) {
  const params = new URLSearchParams({ document: item.url, title: item.title || "Document CSE" });
  window.open(`/lecteur.html?${params.toString()}`, "_blank", "noopener");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadDocument(event) {
  event.preventDefault();
  const formData = new FormData(documentForm);
  const file = formData.get("file");
  if (!(file instanceof File) || !file.name) return;
  if (file.size > 8_000_000) {
    setMessage(documentStatus, "PDF trop lourd, limite 8 Mo.", "error");
    return;
  }

  setMessage(documentStatus, "Upload en cours...", "");
  const response = await request("/api/admin/documents", {
    method: "POST",
    body: JSON.stringify({
      title: formData.get("title"),
      description: formData.get("description"),
      visibility: formData.get("visibility"),
      fileName: file.name,
      dataBase64: await readFileAsBase64(file)
    })
  });

  if (!response.ok) {
    setMessage(documentStatus, "Ajout du PDF impossible.", "error");
    return;
  }

  const payload = await response.json();
  content = payload.content;
  documentForm.reset();
  renderContentEditors();
  setMessage(documentStatus, "PDF ajoute au site.", "success");
  await loadStats();
}

async function loadStats() {
  const response = await fetch("/api/stats", { headers: { Accept: "application/json" } });
  if (!response.ok) return;
  const payload = await response.json();
  pendingStat.textContent = String(payload.pendingIdeas || 0);
  approvedStat.textContent = String(payload.approvedIdeas || 0);
  progressStat.textContent = String(payload.inProgressIdeas || 0);
  treatedStat.textContent = String(payload.treatedIdeas || 0);
  documentsStat.textContent = String(payload.totalDocuments || payload.documents || 0);
}

async function downloadIdeasCsv(event) {
  event.preventDefault();
  const response = await request("/api/admin/ideas.csv", { headers: { Accept: "text/csv" } });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `idees-cse-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadContent() {
  const response = await request("/api/admin/content");
  if (!response.ok) throw new Error("content_failed");
  const payload = await response.json();
  content = payload.content;
  content.posts ||= [];
  renderContentEditors();
}

async function loadIdeas() {
  const response = await request("/api/admin/ideas");
  if (!response.ok) throw new Error("ideas_failed");
  const payload = await response.json();
  ideas = payload.ideas;
  renderIdeas();
  await loadStats();
}

function showAdmin() {
  loginPanel.hidden = true;
  adminApp.hidden = false;
  adminNav.hidden = false;
  logoutButton.hidden = false;
}

function showLogin() {
  loginPanel.hidden = false;
  adminApp.hidden = true;
  adminNav.hidden = true;
  logoutButton.hidden = true;
}

async function loadMailSettings() {
  if (!mailForm) return;
  const response = await request("/api/admin/mail-settings");
  if (!response.ok) return;
  const payload = await response.json();
  const settings = payload.settings || {};
  mailForm.elements.host.value = settings.host || "";
  mailForm.elements.port.value = settings.port || 587;
  mailForm.elements.secure.value = String(Boolean(settings.secure));
  mailForm.elements.username.value = settings.username || "";
  mailForm.elements.password.value = "";
  mailForm.elements.fromEmail.value = settings.fromEmail || "";
  mailForm.elements.fromName.value = settings.fromName || "";
}

async function saveMailSettings() {
  const formData = new FormData(mailForm);
  const response = await request("/api/admin/mail-settings", {
    method: "PUT",
    body: JSON.stringify({
      host: formData.get("host"),
      port: Number(formData.get("port") || 587),
      secure: formData.get("secure") === "true",
      username: formData.get("username"),
      password: formData.get("password"),
      fromEmail: formData.get("fromEmail"),
      fromName: formData.get("fromName")
    })
  });
  if (!response.ok) {
    setMessage(mailStatus, "Configuration SMTP impossible a sauvegarder.", "error");
    return;
  }
  mailForm.elements.password.value = "";
  setMessage(mailStatus, "Configuration SMTP sauvegardee.", "success");
}

async function testMail() {
  const recipient = new FormData(mailForm).get("testRecipient");
  setMessage(mailStatus, "Envoi du test en cours...", "");
  const response = await request("/api/admin/mail-test", {
    method: "POST",
    body: JSON.stringify({ recipient })
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    setMessage(mailStatus, payload.message ? `Test impossible: ${payload.message}` : "Test email impossible.", "error");
    return;
  }
  setMessage(mailStatus, "Email de test envoye.", "success");
}

function renderAdminAccounts() {
  if (!adminAccountsContainer) return;
  adminAccountsContainer.replaceChildren(...adminAccounts.map((admin) => {
    const card = createElement("article", "admin-item");
    const header = createElement("div", "admin-item-header");
    const copy = createElement("div");
    copy.append(createElement("h3", "", admin.displayName || admin.email));
    const role = admin.role === "owner" ? "Proprietaire" : "Editeur";
    copy.append(createElement("p", "admin-item-meta", `${admin.email} - ${role} - ${admin.active ? "Actif" : "Desactive"} - ${admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString("fr-FR") : "Jamais connecte"}`));
    header.append(copy);
    const actions = createElement("div", "admin-actions");
    const toggle = createElement("button", admin.active ? "button button-danger" : "button button-success", admin.active ? "Desactiver" : "Reactiver");
    toggle.type = "button";
    toggle.addEventListener("click", () => updateAdminAccount(admin.id, { displayName: admin.displayName, active: !admin.active }));
    const password = createElement("button", "button button-secondary", "Changer mot de passe");
    password.type = "button";
    password.addEventListener("click", () => {
      const nextPassword = prompt("Nouveau mot de passe admin (12 caracteres minimum)");
      if (nextPassword) updateAdminAccount(admin.id, { displayName: admin.displayName, active: admin.active, password: nextPassword });
    });
    actions.append(toggle, password);
    header.append(actions);
    card.append(header);
    return card;
  }));
}

async function loadAdminAccounts() {
  const response = await request("/api/admin/admins");
  if (!response.ok) return;
  const payload = await response.json();
  adminAccounts = payload.admins || [];
  renderAdminAccounts();
}

async function createAdminAccount(event) {
  event.preventDefault();
  const formData = new FormData(adminAccountForm);
  const response = await request("/api/admin/admins", {
    method: "POST",
    body: JSON.stringify({
      displayName: formData.get("displayName"),
      email: formData.get("email"),
      password: formData.get("password"),
      role: formData.get("role")
    })
  });
  if (!response.ok) {
    setMessage(adminAccountStatus, "Creation impossible. Verifie l'email et le mot de passe.", "error");
    return;
  }
  adminAccountForm.reset();
  setMessage(adminAccountStatus, "Compte admin cree.", "success");
  await loadAdminAccounts();
}

async function updateAdminAccount(id, payload) {
  const response = await request(`/api/admin/admins/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    setMessage(adminAccountStatus, "Modification du compte impossible.", "error");
    return;
  }
  setMessage(adminAccountStatus, "Compte admin mis a jour.", "success");
  await loadAdminAccounts();
}

async function bootAdmin() {
  const response = await request("/api/admin/session");
  if (!response.ok) {
    showLogin();
    return;
  }
  const payload = await response.json();
  applyPermissions(payload.admin);
  showAdmin();
  activateTab("dashboard");
  const loaders = [loadContent(), loadIdeas(), loadStats()];
  if (payload.admin.role === "owner") loaders.push(loadMailSettings(), loadAdminAccounts());
  await Promise.all(loaders);
}

async function loginAdmin(email, password) {
  const response = await request("/api/admin/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    setMessage(loginStatus, response.status === 503 ? "Aucun compte admin initialise sur le serveur." : "Email ou mot de passe incorrect.", "error");
    return;
  }
  await bootAdmin();
}

loginForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  loginAdmin(String(formData.get("email") || ""), String(formData.get("password") || ""));
});

document.querySelector("[data-refresh]")?.addEventListener("click", () => loadIdeas());
ideaSearch?.addEventListener("input", renderIdeas);
ideaFilter?.addEventListener("change", renderIdeas);
exportIdeas?.addEventListener("click", downloadIdeasCsv);
document.querySelector("[data-add-news]")?.addEventListener("click", () => newsEditor.prepend(editorCard("news", { id: uid("news"), tagStyle: "teal" })));
document.querySelector("[data-add-post]")?.addEventListener("click", () => postsEditor.prepend(editorCard("post", { id: uid("post"), category: "Info CSE" })));
document.querySelector("[data-add-meeting]")?.addEventListener("click", () => meetingsEditor.prepend(editorCard("meeting", { id: uid("meeting") })));
document.querySelector("[data-add-member]")?.addEventListener("click", () => membersEditor.prepend(editorCard("member", { id: uid("member"), role: "Titulaire" })));
document.querySelector("[data-save-content]")?.addEventListener("click", () => saveContent(contentStatus));
document.querySelector("[data-save-posts]")?.addEventListener("click", () => saveContent(postStatus));
document.querySelector("[data-save-members]")?.addEventListener("click", () => saveContent(memberStatus));
document.querySelector("[data-save-mail]")?.addEventListener("click", saveMailSettings);
document.querySelector("[data-test-mail]")?.addEventListener("click", testMail);
document.querySelector("[data-refresh-admins]")?.addEventListener("click", loadAdminAccounts);
documentForm?.addEventListener("submit", uploadDocument);
adminAccountForm?.addEventListener("submit", createAdminAccount);
logoutButton?.addEventListener("click", async () => {
  await request("/api/admin/logout", { method: "POST" });
  showLogin();
});

bootAdmin().catch(showLogin);
