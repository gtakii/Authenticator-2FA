import { createVault, unlockVault, saveVault, hasVault } from "../scripts/storage.js";
import { encryptWithPassword, decryptWithPassword } from "../scripts/crypto.js";
import { generateTOTP, normalizeSecret } from "../scripts/totp.js";
import { createQrSvg } from "../scripts/qr-encoder.js";
import { parseOtpAuthUri, parseManualOtpAuthConfig, buildOtpAuthUri } from "../scripts/otpauth.js";
import { decodeQrFromImage } from "../scripts/qr-image.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["setup-view", "unlock-view", "vault-view"];
let autoLockMs = 120_000;
let accountSort = "favorite";
let vault = null;
let encryptionKey = null;
let ticker = null;
let lastTimeStep = -1;
let refreshing = false;
let editingId = null;
let favoritesOnly = false;
let lastActivity = Date.now();
let cameraStream = null;
let cameraFrame = 0;
let cameraDetector = null;
let cameraBusy = false;
let codesVisible = false;
let editorTotpOptions = { algorithm: "SHA1", digits: 6, period: 30 };
const selectedIds = new Set();
const DEFAULT_CATEGORIES = ["Pessoal", "Trabalho", "Desenvolvimento", "Financeiro", "Outros"];
let ALLOWED_CATEGORIES = [...DEFAULT_CATEGORIES];

function refreshCategoryOptions() {
  for (const id of ["account-category", "category-filter"]) {
    const select = $(id); if (!select) continue;
    const previous = select.value;
    const first = id === "category-filter" ? '<option value="">Todas as categorias</option>' : "";
    select.innerHTML = first + ALLOWED_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    if (ALLOWED_CATEGORIES.includes(previous)) select.value = previous;
    else if (id === "account-category") select.value = "Outros";
  }
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function showView(id) { for (const view of VIEWS) $(view).classList.toggle("hidden", view !== id); }
function message(text, isError = false) {
  const el = $("message"); el.textContent = text; el.classList.remove("hidden", "error");
  if (isError) el.classList.add("error");
}
function clearMessage() { $("message").classList.add("hidden"); }
let pendingConfirmation = null;
function confirmAction(title, description, actionLabel = "Confirmar") {
  if (pendingConfirmation) pendingConfirmation(false);
  $("confirm-title").textContent = title;
  $("confirm-description").textContent = description;
  $("confirm-accept").textContent = actionLabel;
  $("confirm-view").classList.remove("hidden");
  $("confirm-cancel").focus();
  return new Promise((resolve) => { pendingConfirmation = resolve; });
}
function finishConfirmation(accepted) {
  if (!pendingConfirmation) return;
  const resolve = pendingConfirmation; pendingConfirmation = null;
  $("confirm-view").classList.add("hidden");
  resolve(accepted);
}
$("confirm-cancel")?.addEventListener("click", () => finishConfirmation(false));
$("confirm-accept")?.addEventListener("click", () => finishConfirmation(true));
$("confirm-view")?.addEventListener("click", (event) => { if (event.target === $("confirm-view")) finishConfirmation(false); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && pendingConfirmation) finishConfirmation(false); });
function markActivity() { lastActivity = Date.now(); }
function setBusy(form, busy) { for (const control of form.querySelectorAll("button, input")) control.disabled = busy; }

async function initialize() {
  const exists = await hasVault();
  const settings = await chrome.storage.local.get(["uiPreferences", "autoLockMs", "customCategories"]);
  if (Array.isArray(settings.customCategories)) ALLOWED_CATEGORIES = [...new Set([...DEFAULT_CATEGORIES, ...settings.customCategories.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim().slice(0, 32))])].slice(0, 30);
  refreshCategoryOptions();
  autoLockMs = [30000, 60000, 120000, 300000].includes(settings.autoLockMs) ? settings.autoLockMs : 120000;
  const prefs = settings.uiPreferences || {};
  accountSort = ["favorite", "name", "category", "recent"].includes(prefs.sort) ? prefs.sort : "favorite";
  if ($("auto-lock-select")) $("auto-lock-select").value = String(autoLockMs);
  if ($("sort-accounts")) $("sort-accounts").value = accountSort;
  if ($("density-select")) $("density-select").value = prefs.density === "compact" ? "compact" : "comfortable";
  if ($("columns-select")) $("columns-select").value = ["1", "2", "3"].includes(String(prefs.columns)) ? String(prefs.columns) : "3";
  if ($("width-select")) $("width-select").value = String([1100, 1300, 1500, 1700, 1900].includes(Number(prefs.width)) ? Number(prefs.width) : 1500);
  applyUiPreferences(prefs);
  if ($("category-filter")) $("category-filter").value = "";
  showView(exists ? "unlock-view" : "setup-view");
  startTicker();
}
function startTicker() { if (ticker) clearInterval(ticker); ticker = setInterval(tick, 500); tick(); }
async function tick() {
  if (!vault) return;
  if (Date.now() - lastActivity >= autoLockMs) { lock("Cofre bloqueado automaticamente por inatividade."); return; }
  const now = Date.now();
  const timeStep = vault.map((item) => Math.floor(now / ((item.period || 30) * 1000))).join(":");
  const nearestExpiry = vault.length ? Math.min(...vault.map((item) => ((Math.floor(now / ((item.period || 30) * 1000)) + 1) * (item.period || 30) * 1000) - now)) : 30_000;
  $("refresh-countdown").textContent = `${Math.ceil(nearestExpiry / 1000)}s`;
  for (const card of [...$("accounts-list").children]) {
    const item = vault.find((entry) => entry.id === card.dataset.accountId); if (!item) continue;
    const duration = (item.period || 30) * 1000;
    const remaining = duration - (now % duration);
    const percent = Math.max(0, Math.min(100, remaining / duration * 100));
    const fill = card.querySelector(".code-progress-fill");
    const bar = card.querySelector(".code-progress");
    const label = card.querySelector(".code-time-label");
    if (fill) fill.style.width = `${percent}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(percent)));
    if (label) label.textContent = `${Math.ceil(remaining / 1000)}s`;
  }
  if (timeStep !== lastTimeStep && !refreshing) {
    lastTimeStep = timeStep; refreshing = true;
    try { await refreshCodes(now); } finally { refreshing = false; }
  }
}

// Controles de navegação e acessibilidade da nova interface.
$("search-shortcut")?.addEventListener("input", (event) => {
  $("search-input").value = event.target.value;
  renderAccounts();
});
$("search-input")?.addEventListener("input", (event) => {
  if ($("search-shortcut")) $("search-shortcut").value = event.target.value;
});
$("add-account-shortcut")?.addEventListener("click", () => {
  $("add-form").scrollIntoView({ behavior: "smooth", block: "start" });
  $("issuer").focus({ preventScroll: true });
});
document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => {
  const section = button.dataset.nav;
  document.querySelectorAll("[data-nav]").forEach((item) => item.classList.toggle("active", item === button));
  const labels = { all: "Todas as contas", favorites: "Favoritos", categories: "Categorias", security: "Segurança", settings: "Configurações" };
  if ($("current-section-label")) $("current-section-label").textContent = labels[section] || labels.all;
  if (section === "all") {
    favoritesOnly = false; $("favorites-filter").setAttribute("aria-pressed", "false");
    $("category-filter").value = ""; renderAccounts();
    $("accounts-list").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (section === "favorites") {
    favoritesOnly = true; $("favorites-filter").setAttribute("aria-pressed", "true");
    renderAccounts(); $("accounts-list").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (section === "categories") {
    $("category-filter").focus(); $("category-filter").scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    $("security-content").classList.remove("hidden");
    $("security-toggle").setAttribute("aria-expanded", "true"); $("security-chevron").textContent = "−";
    document.querySelector(".security-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}));
document.querySelectorAll("[data-password-target]").forEach((button) => button.addEventListener("click", () => {
  const input = $(button.dataset.passwordTarget);
  if (!input) return;
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  button.textContent = visible ? "Ocultar" : "Mostrar";
  button.setAttribute("aria-label", visible ? "Ocultar senha" : "Mostrar senha");
  button.setAttribute("aria-pressed", String(visible));
}));
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    event.preventDefault(); ($("search-shortcut") || $("search-input")).focus();
  }
});

$("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault(); clearMessage();
  const form = event.currentTarget, password = $("setup-password").value;
  if (password.length < 10) return message("Use uma senha com pelo menos 10 caracteres.", true);
  if (password !== $("setup-confirm").value) return message("As senhas não são iguais.", true);
  setBusy(form, true);
  try {
    encryptionKey = await createVault(password, []); vault = []; lastTimeStep = -1; markActivity();
    form.reset(); showView("vault-view"); renderAccounts(); message("Cofre criado e protegido com criptografia local.");
  } catch (error) { message("Não foi possível criar o cofre: " + error.message, true); }
  finally { setBusy(form, false); }
});

$("unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault(); clearMessage(); const form = event.currentTarget;
  setBusy(form, true);
  try {
    const result = await unlockVault($("unlock-password").value);
    vault = result.accounts.map(normalizeStoredAccount); encryptionKey = result.key; lastTimeStep = -1; markActivity();
    form.reset(); showView("vault-view"); renderAccounts(); message("Cofre desbloqueado.");
  } catch (error) { message(error.message || "Senha incorreta ou cofre danificado.", true); }
  finally { setBusy(form, false); $("unlock-password").focus(); }
});

async function persistVault() {
  if (!encryptionKey || !Array.isArray(vault)) throw new Error("Cofre bloqueado.");
  await saveVault(encryptionKey, vault);
}

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault(); clearMessage(); markActivity();
  const issuer = $("issuer").value.trim(), account = $("account").value.trim();
  const uriText = $("otpauth-uri").value.trim();
  const category = ALLOWED_CATEGORIES.includes($("account-category").value) ? $("account-category").value : "Outros";
  const manualSecret = $("manual-secret").value.trim();
  if (!issuer && !uriText && !editingId) return message("Informe o serviço e importe uma URI/QR Code ou abra a configuração manual.", true);
  let secret, finalIssuer = issuer, finalAccount = account, totpOptions = { ...editorTotpOptions };
  try {
    if (uriText && manualSecret) throw new Error("Escolha apenas um método: URI ou configuração manual.");
    if (uriText) {
      const parsed = parseOtpAuthUri(uriText); secret = parsed.secret; totpOptions = parsed.options;
      finalIssuer = issuer || parsed.issuer; finalAccount = account || parsed.account;
      if (issuer && parsed.issuer && issuer.trim().toLowerCase() !== parsed.issuer.trim().toLowerCase()) throw new Error("O serviço informado não corresponde ao emissor da configuração otpauth.");
      if (account && parsed.account && account.trim().toLowerCase() !== parsed.account.trim().toLowerCase()) throw new Error("A conta informada não corresponde à identificação da configuração otpauth.");
    } else if (manualSecret) {
      const parsed = parseManualOtpAuthConfig({ issuer, account, secret: manualSecret, algorithm: $("manual-algorithm").value, digits: $("manual-digits").value, period: $("manual-period").value });
      secret = parsed.secret; finalIssuer = parsed.issuer; finalAccount = parsed.account; totpOptions = parsed.options;
    } else if (editingId) secret = vault.find((item) => item.id === editingId)?.secret;
    else throw new Error("Importe um QR Code, cole a URI otpauth:// ou informe a chave secreta fornecida pelo serviço na configuração manual.");
    if (!secret) throw new Error("A chave secreta não foi encontrada.");
    await generateTOTP(secret, Date.now(), totpOptions);
  } catch (error) { return message(error.message, true); }

  const duplicate = vault.find((item) => item.secret === secret && item.id !== editingId);
  if (duplicate) return message("Essa chave já está cadastrada.", true);
  const previous = vault.map((item) => ({ ...item }));
  try {
    if (editingId) {
      vault = vault.map((item) => item.id === editingId ? { ...item, issuer: finalIssuer, account: finalAccount, secret, category, ...totpOptions } : item);
    } else {
      vault.push({ id: crypto.randomUUID(), issuer: finalIssuer, account: finalAccount, secret, category, ...totpOptions, favorite: false, createdAt: Date.now() });
    }
    const wasEditing = Boolean(editingId);
    await persistVault(); await logActivity(wasEditing ? "Conta editada" : "Conta adicionada");
    resetEditor(); lastTimeStep = -1; renderAccounts(); updateBackupStatus();
    message(wasEditing ? "Conta atualizada." : "Conta adicionada e armazenada criptografada.");
  } catch (error) { vault = previous; renderAccounts(); message("Não foi possível salvar: " + error.message, true); }
});

function resetEditor() {
  editingId = null; editorTotpOptions = { algorithm: "SHA1", digits: 6, period: 30 }; $("add-form").reset(); $("form-title").textContent = "Adicionar conta";
  $("save-account-button").textContent = "Adicionar conta"; $("cancel-edit").classList.add("hidden");

}
function beginEdit(item) {
  editingId = item.id; editorTotpOptions = { algorithm: item.algorithm || "SHA1", digits: item.digits || 6, period: item.period || 30 }; $("issuer").value = item.issuer; $("account").value = item.account || ""; $("account-category").value = ALLOWED_CATEGORIES.includes(item.category) ? item.category : "Outros";
  $("otpauth-uri").value = ""; $("manual-secret").value = "";
  $("form-title").textContent = "Editar conta"; $("save-account-button").textContent = "Salvar alterações";
  $("cancel-edit").classList.remove("hidden"); $("issuer").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("cancel-edit").addEventListener("click", resetEditor);

function renderAccounts() {
  const list = $("accounts-list"); list.replaceChildren();
  const query = $("search-input").value.trim().toLocaleLowerCase("pt-BR");
  const filtered = vault.filter((item) => {
    const matches = `${item.issuer} ${item.account || ""} ${item.category || "Outros"}`.toLocaleLowerCase("pt-BR").includes(query);
    const categoryMatches = !$("category-filter").value || (item.category || "Outros") === $("category-filter").value;
    return matches && categoryMatches && (!favoritesOnly || item.favorite);
  }).sort((a, b) => {
    if (accountSort === "recent") return (b.createdAt || 0) - (a.createdAt || 0);
    if (accountSort === "name") return a.issuer.localeCompare(b.issuer, "pt-BR") || (a.account || "").localeCompare(b.account || "", "pt-BR");
    if (accountSort === "category") return (a.category || "Outros").localeCompare(b.category || "Outros", "pt-BR") || a.issuer.localeCompare(b.issuer, "pt-BR");
    return Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || a.issuer.localeCompare(b.issuer, "pt-BR");
  });
  $("account-count").textContent = `${vault.length} ${vault.length === 1 ? "conta cadastrada" : "contas cadastradas"}`;
  if ($("nav-account-count")) $("nav-account-count").textContent = String(vault.length);
  $("empty-state").classList.toggle("hidden", vault.length !== 0);
  $("no-results").classList.toggle("hidden", vault.length === 0 || filtered.length !== 0);

  for (const item of filtered) {
    const card = document.createElement("article"); card.className = "account-card"; card.dataset.accountId = item.id;
    const top = document.createElement("div"); top.className = "account-top";
    const identity = document.createElement("div"), name = document.createElement("div"), user = document.createElement("div"), category = document.createElement("div");
    const avatar = document.createElement("span"); avatar.className = "account-avatar";
    avatar.textContent = (item.issuer || "?").trim().slice(0, 1).toUpperCase();
    name.className = "account-name"; name.textContent = item.issuer;
    user.className = "account-user"; user.textContent = item.account || "Conta sem identificação";
    category.className = "account-category"; category.textContent = item.category || "Outros";
    const technical = document.createElement("div"); technical.className = "account-technical"; technical.textContent = `${item.algorithm || "SHA1"} · ${item.digits || 6} dígitos · ${item.period || 30}s`;
    const select = document.createElement("input"); select.type = "checkbox"; select.className = "account-select"; select.checked = selectedIds.has(item.id); select.setAttribute("aria-label", `Selecionar conta ${item.issuer}`);
    select.addEventListener("change", () => { select.checked ? selectedIds.add(item.id) : selectedIds.delete(item.id); updateBulkToolbar(); });
    const identityText = document.createElement("div"); identityText.className = "account-identity-text";
    identityText.append(name, user, category, technical);
    identity.append(select, avatar, identityText);
    const actions = document.createElement("div"); actions.className = "account-actions";
    const favorite = makeButton(item.favorite ? "Favorita" : "Favoritar", "favorite-button", item.favorite ? "Remover dos favoritos" : "Favoritar conta", async () => {
      item.favorite = !item.favorite; await persistVault(); await logActivity(item.favorite ? "Conta favoritada" : "Favorito removido"); renderAccounts(); updateBackupStatus();
    });
    const edit = makeButton("Editar", "qr-button", "Editar conta", () => beginEdit(item));
    const showQr = makeButton("Mostrar QR", "qr-button", "Exibir QR Code confidencial", () => showAccountQr(item));
    const remove = makeButton("Excluir", "delete-button", "Excluir conta", async () => {
      if (!await confirmAction("Excluir conta?", `A conta ${item.issuer} será removida permanentemente do cofre.`, "Excluir conta")) return;
      const previous = vault; vault = vault.filter((entry) => entry.id !== item.id);
      try { await persistVault(); await logActivity("Conta excluída"); if (editingId === item.id) resetEditor(); renderAccounts(); updateBackupStatus(); message("Conta excluída."); }
      catch (error) { vault = previous; message("Falha ao excluir: " + error.message, true); }
    });
    actions.append(favorite, edit, showQr, remove); top.append(identity, actions);
    const row = document.createElement("div"); row.className = "code-row";
    const code = document.createElement("div"); code.className = "code"; code.textContent = codesVisible ? "------" : maskCode(item.digits || 6);
    const codeMeta = document.createElement("div"); codeMeta.className = "code-meta";
    const progress = document.createElement("div"); progress.className = "code-progress"; progress.setAttribute("role", "progressbar"); progress.setAttribute("aria-label", "Tempo restante do código"); progress.setAttribute("aria-valuemin", "0"); progress.setAttribute("aria-valuemax", "100");
    const progressFill = document.createElement("span"); progressFill.className = "code-progress-fill"; progress.append(progressFill);
    const timeLabel = document.createElement("small"); timeLabel.className = "code-time-label"; timeLabel.textContent = `${item.period || 30}s`;
    codeMeta.append(progress, timeLabel);
    const copy = makeButton("Copiar código", "copy-button", "Copiar código TOTP", async () => {
      try { const value = await generateTOTP(item.secret, Date.now(), item); await navigator.clipboard.writeText(value); message("Código copiado. Ele expira ao fim da janela atual."); }
      catch { message("Não foi possível copiar o código. Verifique a permissão da área de transferência.", true); }
    });
    row.append(code, copy); card.append(top, row, codeMeta); list.append(card);
  }
  updateBulkToolbar();
  tick();
}
function formatCode(value) { const split = Math.ceil(value.length / 2); return `${value.slice(0, split)} ${value.slice(split)}`; }
function maskCode(digits) { const split = Math.ceil(digits / 2); return `${"•".repeat(split)} ${"•".repeat(digits - split)}`; }
function makeButton(label, className, title, callback) {
  const button = document.createElement("button"); button.type = "button"; button.className = className;
  button.textContent = label; button.title = title; button.setAttribute("aria-label", title);
  button.addEventListener("click", async () => { markActivity(); try { await callback(); } catch (error) { message(error.message || "Ocorreu um erro.", true); } });
  return button;
}

async function refreshCodes(timestamp = Date.now()) {
  if (!vault) return;
  for (const card of [...$("accounts-list").children]) {
    const item = vault.find((entry) => entry.id === card.dataset.accountId); if (!item) continue;
    try { const value = await generateTOTP(item.secret, timestamp, item); const el = card.querySelector(".code"); if (el) el.textContent = codesVisible ? formatCode(value) : maskCode(value.length); }
    catch { const el = card.querySelector(".code"); if (el) el.textContent = "ERRO"; }
    const periodMs = (item.period || 30) * 1000;
    const remaining = periodMs - (timestamp % periodMs);
    const percent = Math.max(0, Math.min(100, remaining / periodMs * 100));
    const fill = card.querySelector(".code-progress-fill");
    const bar = card.querySelector(".code-progress");
    const label = card.querySelector(".code-time-label");
    if (fill) fill.style.width = `${percent}%`;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(percent)));
    if (label) label.textContent = `${Math.ceil(remaining / 1000)}s`;
  }
}

function lock(reason = "Cofre bloqueado.") {
  vault = null; encryptionKey = null; lastTimeStep = -1; editingId = null; codesVisible = false; selectedIds.clear();
  $("accounts-list").replaceChildren(); $("qr-output").replaceChildren(); $("qr-view").classList.add("hidden");
  $("add-form").reset(); $("search-input").value = ""; if ($("search-shortcut")) $("search-shortcut").value = ""; $("security-content").classList.add("hidden");
  if ($("toggle-codes")) { $("toggle-codes").textContent = "Exibir códigos"; $("toggle-codes").setAttribute("aria-pressed", "false"); }
  if ($("category-filter")) $("category-filter").value = "";
  $("security-toggle").setAttribute("aria-expanded", "false"); $("security-chevron").textContent = "+";
  stopCamera();
  showView("unlock-view"); clearMessage(); message(reason);
}
$("lock-button").addEventListener("click", () => lock());
$("lock-text-button").addEventListener("click", () => lock());

function showAccountQr(item) {
  const uri = buildOtpAuthUri(item); $("qr-output").replaceChildren();
  const wrapper = document.createElement("div"); wrapper.innerHTML = createQrSvg(uri, 240);
  const svg = wrapper.firstElementChild;
  if (!svg || svg.namespaceURI !== "http://www.w3.org/2000/svg" || svg.tagName.toLowerCase() !== "svg") throw new Error("Não foi possível gerar o QR Code.");
  $("qr-output").append(svg); $("qr-title").textContent = `QR Code — ${item.issuer}`;
  $("qr-view").classList.remove("hidden"); $("close-qr").focus();
}

$("scan-qr-button").addEventListener("click", () => { markActivity(); openCamera(); });
$("import-qr-button").addEventListener("click", () => { markActivity(); $("qr-file").click(); });
$("qr-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  if (file.size > 10 * 1024 * 1024) return message("A imagem excede o limite de 10 MB.", true);
  try {
    const raw = await decodeQrFromImage(file, window);
    const parsed = parseOtpAuthUri(raw);
    $("issuer").value = parsed.issuer; $("account").value = parsed.account;
    editorTotpOptions = parsed.options; $("otpauth-uri").value = raw;
    message("QR Code lido localmente. Confira o serviço e a conta antes de salvar.");
  } catch (error) { message(error.message || "Não foi possível ler o QR Code.", true); }
});
$("paste-uri-button").addEventListener("click", () => { markActivity(); $("otpauth-uri").focus(); message("Cole a URI otpauth no campo indicado e confira os dados antes de adicionar."); });

async function openCamera() {
  $("camera-view").classList.remove("hidden");
  $("camera-status").textContent = "Solicitando acesso à câmera...";
  await startCamera();
}
async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    $("camera-status").textContent = "A câmera não está disponível neste contexto. Use Importar imagem ou cole uma URI otpauth.";
    return;
  }
  const hasNative = "BarcodeDetector" in window;
  const hasLocalDecoder = typeof window.jsQR === "function";
  if (!hasNative && !hasLocalDecoder) {
    $("camera-status").textContent = "Decoder local indisponível neste pacote. Use a URI otpauth:// ou a chave secreta fornecida pelo serviço.";
    return;
  }
  try {
    cameraDetector = hasNative ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
    cameraStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const video = $("camera-video");
    video.srcObject = cameraStream;
    await video.play();
    $("camera-status").textContent = "Câmera ativa. Aponte para um QR Code otpauth.";
    cameraBusy = false;
    scanCameraFrame();
  } catch (error) {
    stopCamera();
    const reason = error?.name === "NotAllowedError" ? "Permissão da câmera negada. Autorize o acesso nas configurações do navegador." : error?.name === "NotFoundError" ? "Nenhuma câmera foi encontrada neste dispositivo." : "Não foi possível iniciar a câmera. Verifique a permissão e tente novamente.";
    $("camera-status").textContent = reason;
  }
}
async function scanCameraFrame() {
  if (!cameraStream || (!cameraDetector && typeof window.jsQR !== "function")) return;
  const video = $("camera-video");
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !cameraBusy) {
    cameraBusy = true;
    try {
      let raw = "";
      if (cameraDetector) {
        const codes = await cameraDetector.detect(video);
        raw = codes[0]?.rawValue || "";
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        raw = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" })?.data || "";
      }
      if (raw) {
        const parsed = parseOtpAuthUri(raw);
        $("issuer").value = parsed.issuer;
        $("account").value = parsed.account;
        editorTotpOptions = parsed.options;
        $("otpauth-uri").value = raw;
        stopCamera();
        $("camera-view").classList.add("hidden");
        message("QR Code lido pela câmera. Confira os dados e adicione a conta.");
        $("issuer").focus();
        return;
      }
    } catch (error) {
      $("camera-status").textContent = error.message || "QR Code inválido. Tente novamente.";
    } finally { cameraBusy = false; }
  }
  if (cameraStream) cameraFrame = requestAnimationFrame(scanCameraFrame);
}
function stopCamera() {
  if (cameraFrame) cancelAnimationFrame(cameraFrame);
  cameraFrame = 0;
  if (cameraStream) for (const track of cameraStream.getTracks()) track.stop();
  cameraStream = null;
  const video = $("camera-video");
  if (video) video.srcObject = null;
  cameraDetector = null;
  cameraBusy = false;
}
function closeCamera() { stopCamera(); $("camera-view").classList.add("hidden"); }
$("close-camera").addEventListener("click", closeCamera);
$("camera-retry").addEventListener("click", startCamera);
$("camera-view").addEventListener("click", (event) => { if (event.target === $("camera-view")) closeCamera(); });
function closeQr() { $("qr-view").classList.add("hidden"); $("qr-output").replaceChildren(); }
$("close-qr").addEventListener("click", closeQr); $("close-qr-bottom").addEventListener("click", closeQr);
$("qr-view").addEventListener("click", (event) => { if (event.target === $("qr-view")) closeQr(); });
function applyUiPreferences(prefs = {}) {
  document.body.dataset.density = prefs.density === "compact" ? "compact" : "comfortable";
  document.body.dataset.columns = ["1", "2", "3"].includes(String(prefs.columns)) ? String(prefs.columns) : "3";
  const width = [1100, 1300, 1500, 1700, 1900].includes(Number(prefs.width)) ? Number(prefs.width) : 1500;
  document.body.style.setProperty("--dashboard-width", `${width}px`);
}
async function saveUiPreferences() {
  const uiPreferences = {
    sort: $("sort-accounts")?.value || "favorite",
    density: $("density-select")?.value || "comfortable",
    columns: $("columns-select")?.value || "3",
    width: Number($("width-select")?.value || 1500)
  };
  accountSort = uiPreferences.sort;
  applyUiPreferences(uiPreferences);
  await chrome.storage.local.set({ uiPreferences });
  if (vault) renderAccounts();
}
$("open-wide")?.addEventListener("click", () => {
  const url = chrome.runtime.getURL("popup/dashboard.html");
  chrome.tabs.create({ url });
});
$("sort-accounts")?.addEventListener("change", () => saveUiPreferences().catch((error) => message(error.message, true)));
$("density-select")?.addEventListener("change", () => saveUiPreferences().catch((error) => message(error.message, true)));
$("columns-select")?.addEventListener("change", () => saveUiPreferences().catch((error) => message(error.message, true)));
$("width-select")?.addEventListener("change", () => saveUiPreferences().catch((error) => message(error.message, true)));
$("auto-lock-select")?.addEventListener("change", async () => {
  const selected = Number($("auto-lock-select").value);
  if (![30000, 60000, 120000, 300000].includes(selected)) return message("Tempo de bloqueio inválido.", true);
  autoLockMs = selected;
  await chrome.storage.local.set({ autoLockMs });
  markActivity();
  message("Preferência de bloqueio automático atualizada.");
});

$("category-filter").addEventListener("change", () => { markActivity(); renderAccounts(); });
$("toggle-codes").addEventListener("click", () => {
  codesVisible = !codesVisible;
  $("toggle-codes").textContent = codesVisible ? "Ocultar códigos" : "Exibir códigos";
  $("toggle-codes").setAttribute("aria-pressed", String(codesVisible));
  refreshCodes();
});
$("select-all-visible").addEventListener("change", () => {
  for (const card of $("accounts-list").children) {
    const id = card.dataset.accountId;
    if ($("select-all-visible").checked) selectedIds.add(id); else selectedIds.delete(id);
  }
  renderAccounts();
});
$("bulk-favorite").addEventListener("click", async () => {
  if (!selectedIds.size) return;
  const previous = vault.map((item) => ({ ...item }));
  try {
    vault = vault.map((item) => selectedIds.has(item.id) ? { ...item, favorite: true } : item);
    await persistVault(); await logActivity("Favoritos atualizados", selectedIds.size);
    selectedIds.clear(); renderAccounts(); updateBackupStatus(); message("Contas selecionadas adicionadas aos favoritos.");
  } catch (error) { vault = previous; renderAccounts(); message("Não foi possível atualizar favoritos: " + error.message, true); }
});
$("bulk-delete").addEventListener("click", async () => {
  if (!selectedIds.size) return;
  const count = selectedIds.size;
  if (!await confirmAction("Excluir contas selecionadas?", `${count} conta(s) serão removidas permanentemente do cofre.`, "Excluir contas")) return;
  const previous = vault.map((item) => ({ ...item }));
  try {
    vault = vault.filter((item) => !selectedIds.has(item.id));
    await persistVault(); await logActivity("Contas excluídas", count);
    selectedIds.clear(); if (editingId && !vault.some((item) => item.id === editingId)) resetEditor();
    renderAccounts(); updateBackupStatus(); message(`${count} conta(s) excluída(s).`);
  } catch (error) { vault = previous; renderAccounts(); message("Não foi possível excluir: " + error.message, true); }
});
$("clear-activity").addEventListener("click", async () => {
  if (!await confirmAction("Limpar histórico?", "O histórico local será apagado. Suas contas e códigos não serão alterados.", "Limpar histórico")) return;
  await chrome.storage.local.remove("auditLog"); await renderActivity(); message("Histórico de atividades limpo.");
});

$("search-input").addEventListener("input", () => { markActivity(); renderAccounts(); });
$("favorites-filter").addEventListener("click", () => { favoritesOnly = !favoritesOnly; $("favorites-filter").classList.toggle("active", favoritesOnly); $("favorites-filter").setAttribute("aria-pressed", String(favoritesOnly)); renderAccounts(); });
$("security-toggle").addEventListener("click", () => {
  const open = $("security-content").classList.toggle("hidden") === false;
  $("security-toggle").setAttribute("aria-expanded", String(open)); $("security-chevron").textContent = open ? "-" : "+";
});


$("manage-categories")?.addEventListener("click", async () => {
  const current = ALLOWED_CATEGORIES.filter((category) => !DEFAULT_CATEGORIES.includes(category));
  const entered = prompt("Categorias personalizadas, separadas por vírgula:", current.join(", "));
  if (entered === null) return;
  const custom = [...new Set(entered.split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 25);
  if (custom.some((value) => value.length > 32)) return message("Cada categoria pode ter no máximo 32 caracteres.", true);
  await chrome.storage.local.set({ customCategories: custom });
  ALLOWED_CATEGORIES = [...DEFAULT_CATEGORIES, ...custom]; refreshCategoryOptions();
  if (vault) { vault = vault.map((item) => ALLOWED_CATEGORIES.includes(item.category) ? item : { ...item, category: "Outros" }); await persistVault(); renderAccounts(); }
  message("Categorias personalizadas atualizadas.");
});

$("export-backup").addEventListener("click", async () => {
  markActivity();
  const password = prompt("Crie uma senha exclusiva para criptografar o backup (mínimo de 10 caracteres):");
  if (password === null) return;
  if (password.length < 10) return message("A senha do backup deve ter pelo menos 10 caracteres.", true);
  const confirmation = prompt("Digite novamente a senha do backup:");
  if (password !== confirmation) return message("As senhas do backup não conferem.", true);
  try {
    const payload = await encryptWithPassword(password, { exportedAt: new Date().toISOString(), accounts: vault });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), anchor = document.createElement("a");
    anchor.href = url; anchor.download = `authenticator-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    await chrome.storage.local.set({ lastBackupAt: Date.now() }); await logActivity("Backup exportado", vault.length); updateBackupStatus();
    message("Backup criptografado exportado. Guarde o arquivo e a senha separadamente.");
  } catch (error) { message("Falha ao exportar backup: " + error.message, true); }
});
$("import-backup").addEventListener("click", () => { markActivity(); $("backup-file").click(); });
$("backup-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  if (file.size > 5 * 1024 * 1024) return message("O arquivo de backup excede 5 MB.", true);
  try {
    const parsedFile = JSON.parse(await file.text());
    const password = prompt("Digite a senha usada para criptografar este backup:"); if (password === null) return;
    const data = await decryptWithPassword(password, parsedFile, "backup");
    if (!Array.isArray(data.accounts) || data.accounts.length > 500) throw new Error("A estrutura do backup é inválida.");
    const imported = data.accounts.map(validateImportedAccount);
    const choice = prompt("Como deseja importar? Digite M para mesclar ou S para substituir todas as contas. Cancele para não importar.");
    if (choice === null) return;
    const merge = choice.trim().toUpperCase() === "M";
    if (!merge && choice.trim().toUpperCase() !== "S") throw new Error("Opção inválida. Digite M ou S.");
    const merged = merge ? vault.map((item) => ({ ...item })) : [];
    for (const item of imported) {
      const existing = merged.find((entry) => entry.secret === item.secret);
      if (existing) { if (merge) Object.assign(existing, { issuer: item.issuer, account: item.account, category: item.category, algorithm: item.algorithm, digits: item.digits, period: item.period, favorite: item.favorite }); }
      else merged.push(item);
    }
    const previous = vault.map((item) => ({ ...item })); vault = merged;
    try { await persistVault(); } catch (error) { vault = previous; throw error; }
    await logActivity("Backup importado", imported.length); resetEditor(); lastTimeStep = -1; renderAccounts(); updateBackupStatus(); message(`${imported.length} conta(s) processada(s) do backup.`);
  } catch (error) { message("Não foi possível importar: " + (error.message || "arquivo inválido"), true); }
});
function validateImportedAccount(item) {
  if (!item || typeof item.issuer !== "string" || typeof item.account !== "string" || typeof item.secret !== "string") throw new Error("O backup contém uma conta inválida.");
  const secret = normalizeSecret(item.secret);
  const issuer = item.issuer.trim().slice(0, 60);
  if (!issuer) throw new Error("O backup contém uma conta sem nome de serviço.");
  return { id: crypto.randomUUID(), issuer, account: item.account.slice(0, 120), secret, category: ALLOWED_CATEGORIES.includes(item.category) ? item.category : "Outros", algorithm: ["SHA1", "SHA256", "SHA512"].includes(item.algorithm) ? item.algorithm : "SHA1", digits: [6, 7, 8].includes(item.digits) ? item.digits : 6, period: Number.isInteger(item.period) && item.period >= 1 && item.period <= 300 ? item.period : 30, favorite: Boolean(item.favorite), createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now() };
}

for (const eventName of ["pointerdown", "keydown", "input", "touchstart"]) document.addEventListener(eventName, markActivity, { passive: true });
let hiddenAt = null;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    if (cameraStream) { stopCamera(); $("camera-status").textContent = "Leitor pausado porque a extensão ficou oculta. Clique em Tentar novamente para reativar."; }
  } else if (hiddenAt !== null) {
    const elapsed = Date.now() - hiddenAt; hiddenAt = null;
    if (vault && elapsed >= autoLockMs) lock("Cofre bloqueado automaticamente após ficar inativo.");
    else markActivity();
  }
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  if (event.key === "/" && !typing && vault) { event.preventDefault(); $("search-input").focus(); }
  if (event.key === "Escape") {
    if (!$("camera-view").classList.contains("hidden")) closeCamera();
    if (!$("qr-view").classList.contains("hidden")) closeQr();
  }
});

function normalizeStoredAccount(item) {
  if (!item || typeof item !== "object") throw new Error("O cofre contém uma conta inválida.");
  return {
    ...item,
    category: ALLOWED_CATEGORIES.includes(item.category) ? item.category : "Outros",
    algorithm: ["SHA1", "SHA256", "SHA512"].includes(item.algorithm) ? item.algorithm : "SHA1",
    digits: [6, 7, 8].includes(item.digits) ? item.digits : 6,
    period: Number.isInteger(item.period) && item.period >= 1 && item.period <= 300 ? item.period : 30,
    favorite: Boolean(item.favorite),
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
  };
}

function updateBulkToolbar() {
  const count = selectedIds.size;
  $("bulk-toolbar").classList.toggle("visible", count > 0);
  $("selection-count").textContent = `${count} ${count === 1 ? "selecionada" : "selecionadas"}`;
  const visibleIds = [...$("accounts-list").children].map((card) => card.dataset.accountId);
  $("select-all-visible").checked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  $("select-all-visible").indeterminate = visibleIds.some((id) => selectedIds.has(id)) && !visibleIds.every((id) => selectedIds.has(id));
}

async function logActivity(action, count = 1) {
  try {
    const { auditLog = [] } = await chrome.storage.local.get("auditLog");
    auditLog.push({ at: Date.now(), action: String(action).slice(0, 48), count: Math.max(1, Math.min(500, Number(count) || 1)) });
    await chrome.storage.local.set({ auditLog: auditLog.slice(-50) });
    await renderActivity();
  } catch { /* O histórico é auxiliar e nunca deve impedir uma operação do cofre. */ }
}

async function renderActivity() {
  const list = $("activity-list");
  if (!list) return;
  list.replaceChildren();
  const { auditLog = [] } = await chrome.storage.local.get("auditLog");
  if (!auditLog.length) {
    const li = document.createElement("li"); li.textContent = "Nenhuma atividade registrada."; list.append(li); return;
  }
  for (const entry of [...auditLog].reverse()) {
    const li = document.createElement("li");
    const action = document.createElement("span");
    action.textContent = entry.count > 1 ? `${entry.action} (${entry.count})` : entry.action;
    const time = document.createElement("time");
    time.dateTime = new Date(entry.at).toISOString();
    time.textContent = new Date(entry.at).toLocaleString("pt-BR");
    li.append(action, time); list.append(li);
  }
}

async function updateBackupStatus() {
  const el = $("backup-status");
  if (!el) return;
  const { lastBackupAt = 0, lastVaultChangeAt = 0 } = await chrome.storage.local.get(["lastBackupAt", "lastVaultChangeAt"]);
  if (!lastBackupAt) {
    el.textContent = "Nenhum backup registrado neste navegador. Considere exportar um backup criptografado.";
    return;
  }
  if (lastVaultChangeAt > lastBackupAt) {
    el.textContent = `Backup desatualizado. Último backup: ${new Date(lastBackupAt).toLocaleString("pt-BR")}.`;
    return;
  }
  el.textContent = `Backup registrado em ${new Date(lastBackupAt).toLocaleString("pt-BR")}. Lembre-se de manter o arquivo protegido.`;
}


initialize().then(() => { renderActivity(); updateBackupStatus(); }).catch((error) => message("Erro ao iniciar: " + error.message, true));
