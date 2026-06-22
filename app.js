const DATA_API_URL = "/api/data";
const AUTH_API_URL = "/api/auth";
const MAX_HEIGHT_CM = 230;
const COMPARE_AREA_HEIGHT = 450;

const CACHE_VERSION = "fv-cache-v4";
const DATA_CACHE_KEY = "fv_character_compare_data_cache_v4";
const TOKEN_STORAGE_KEY = "fv_auth_token";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const DISPLAY_SELECTION_KEY = "fv_compare_display_selection_v1";
const OVERLAP_MODE_KEY = "fv_compare_overlap_mode_v1";
const DEFAULT_DISPLAY_COUNT = 5;

let categories = [];
let entries = [];
let users = [];
let currentUser = null;
let editingId = null;
let editingUserId = null;
let detailTargetId = null;
let isLoginPanelOpen = false;
let selectedDisplayIds = [];
let selectedDisplaySlotId = null;
let overlapMode = localStorage.getItem(OVERLAP_MODE_KEY) || "none";

const $ = id => document.getElementById(id);

const statusPanel = $("statusPanel");
const loginStatus = $("loginStatus");
const loginPanel = $("loginPanel");
const accountToggleButton = $("accountToggleButton");
const headerLoginBadge = $("headerLoginBadge");
const refreshDataButton = $("refreshDataButton");
const clearCacheButton = $("clearCacheButton");
const loginForm = $("loginForm");
const loggedInActions = $("loggedInActions");
const loginUsernameInput = $("loginUsernameInput");
const loginPasswordInput = $("loginPasswordInput");
const loginButton = $("loginButton");
const logoutButton = $("logoutButton");

const adminPanel = $("adminPanel");
const userUsernameInput = $("userUsernameInput");
const userDisplayNameInput = $("userDisplayNameInput");
const userRoleInput = $("userRoleInput");
const userPasswordInput = $("userPasswordInput");
const createUserButton = $("createUserButton");
const updateUserButton = $("updateUserButton");
const cancelUserEditButton = $("cancelUserEditButton");
const refreshUsersButton = $("refreshUsersButton");
const userList = $("userList");

const nameInput = $("nameInput");
const heightInput = $("heightInput");
const imageInput = $("imageInput");
const submitButton = $("submitButton");
const cancelEditButton = $("cancelEditButton");
const formTitle = $("formTitle");
const formPermissionText = $("formPermissionText");
const imageHelpText = $("imageHelpText");
const scrollToFormButton = $("scrollToFormButton");
const formPanel = $("formPanel");

const newCategoryInput = $("newCategoryInput");
const addCategoryButton = $("addCategoryButton");
const categoryCheckboxes = $("categoryCheckboxes");

const searchInput = $("searchInput");
const filterCategory = $("filterCategory");
const compareCandidateSelect = $("compareCandidateSelect");
const replaceDisplayButton = $("replaceDisplayButton");
const displayResetButton = $("displayResetButton");
const overlapModeSelect = $("overlapModeSelect");

const characters = $("characters");
const list = $("list");
const scale = $("scale");
const heightRuler = $("heightRuler");

const detailModal = $("detailModal");
const modalBackdrop = $("modalBackdrop");
const closeModalButton = $("closeModalButton");
const detailImageArea = $("detailImageArea");
const detailName = $("detailName");
const detailHeight = $("detailHeight");
const detailCategories = $("detailCategories");
const detailOwner = $("detailOwner");
const detailEditButton = $("detailEditButton");
const detailDeleteButton = $("detailDeleteButton");

function setStatus(message, type = "") {
  statusPanel.textContent = message;
  statusPanel.className = `status-panel ${type}`.trim();
}

function getToken() {
  const localToken = localStorage.getItem(TOKEN_STORAGE_KEY);

  if (localToken) return localToken;

  const sessionToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (sessionToken) {
    localStorage.setItem(TOKEN_STORAGE_KEY, sessionToken);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return sessionToken;
  }

  return "";
}

function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function apiRequest(baseUrl, action, body = {}, method = "POST") {
  const options = {
    method,
    headers: { "Content-Type": "application/json" }
  };

  const token = getToken();
  if (token) options.headers.Authorization = `Bearer ${token}`;

  if (method !== "GET") options.body = JSON.stringify(body);

  const response = await fetch(`${baseUrl}?action=${encodeURIComponent(action)}`, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data.error || "通信に失敗しました");
  return data;
}

function saveDataCache() {
  try {
    const payload = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      categories,
      entries
    };

    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("キャッシュ保存に失敗しました", error);
  }
}

function loadDataCache() {
  try {
    const raw = localStorage.getItem(DATA_CACHE_KEY);
    if (!raw) return false;

    const cached = JSON.parse(raw);
    if (!cached || cached.version !== CACHE_VERSION) return false;

    categories = Array.isArray(cached.categories) ? cached.categories : [];
    entries = Array.isArray(cached.entries) ? cached.entries : [];

    const savedAt = cached.savedAt || 0;
    const ageMs = Date.now() - savedAt;
    const minutes = Math.max(1, Math.round(ageMs / 60000));

    ensureDisplaySelection();
    renderCategoryCheckboxes([]);
    render();
    setStatus(`キャッシュ表示中：${minutes}分前のデータを表示しています。同期中...`, "cached");
    return true;
  } catch (error) {
    console.warn("キャッシュ読み込みに失敗しました", error);
    return false;
  }
}

async function refreshData() {
  await loadData({ force: true });
}

async function clearLocalCache() {
  const ok = confirm("端末内のキャッシュを削除して、サーバーから再読み込みしますか？ ログイン状態は維持されます。");
  if (!ok) return;

  localStorage.removeItem(DATA_CACHE_KEY);

  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
  }

  categories = [];
  entries = [];
  renderCategoryCheckboxes([]);
  render();
  await loadData({ force: true });
}

async function loadData(options = {}) {
  const hadCache = !options.force && loadDataCache();

  try {
    setStatus(hadCache ? "サーバーと同期中..." : "サーバーから読み込み中...");
    const data = await apiRequest(DATA_API_URL, "list", {}, "GET");
    categories = data.categories || [];
    entries = data.entries || [];
    saveDataCache();
    ensureDisplaySelection();
    setStatus("サーバー同期済み", "ok");
    renderCategoryCheckboxes([]);
    render();
  } catch (error) {
    console.error(error);

    if (hadCache) {
      setStatus(`サーバー同期失敗：端末キャッシュを表示中（${error.message}）`, "cached");
    } else if (loadDataCache()) {
      setStatus(`読み込み失敗：端末キャッシュを表示中（${error.message}）`, "cached");
    } else {
      setStatus(`読み込み失敗：${error.message}`, "error");
    }
  }
}

async function loadMe() {
  const token = getToken();

  if (!token) {
    currentUser = null;
    renderAuthState();
    return;
  }

  try {
    const data = await apiRequest(AUTH_API_URL, "me", {}, "GET");
    currentUser = data.user || null;
  } catch {
    currentUser = null;
    setToken("");
  }

  renderAuthState();

  if (currentUser && currentUser.role === "admin") {
    await loadUsers();
  }
}

function getRoleLabel(role) {
  if (role === "admin") return "管理者";
  if (role === "moderator") return "モデレーター";
  return "編集者";
}

function renderAuthState() {
  const loggedIn = Boolean(currentUser);

  loginForm.classList.toggle("hidden", loggedIn);
  loggedInActions.classList.toggle("hidden", !loggedIn);
  adminPanel.classList.toggle("hidden", !(currentUser && currentUser.role === "admin"));

  if (loggedIn) {
    loginStatus.textContent = `${getRoleLabel(currentUser.role)}: ${currentUser.displayName || currentUser.username}`;
    loginStatus.classList.add("logged-in");
    headerLoginBadge.textContent = `${getRoleLabel(currentUser.role)} ログイン中`;
    headerLoginBadge.classList.add("logged-in");
    accountToggleButton.textContent = "アカウント";

    if (currentUser.role === "admin") {
      formPermissionText.textContent = "管理者としてログイン中。全キャラクターとユーザーを管理できます。";
    } else if (currentUser.role === "moderator") {
      formPermissionText.textContent = "モデレーターとしてログイン中。全キャラクターを編集できます。";
    } else {
      formPermissionText.textContent = "編集者としてログイン中。自分が追加したキャラクターを編集できます。";
    }
  } else {
    loginStatus.textContent = "未ログイン";
    loginStatus.classList.remove("logged-in");
    headerLoginBadge.textContent = "未ログイン";
    headerLoginBadge.classList.remove("logged-in");
    accountToggleButton.textContent = "ログイン";
    formPermissionText.textContent = "追加・編集にはログインが必要です。";
  }

  syncLoginPanelVisibility();
  renderList();
}

function syncLoginPanelVisibility() {
  loginPanel.classList.toggle("hidden", !isLoginPanelOpen);
}

function toggleLoginPanel() {
  if (currentUser) {
    isLoginPanelOpen = !isLoginPanelOpen;
  } else {
    isLoginPanelOpen = !isLoginPanelOpen;
  }

  syncLoginPanelVisibility();

  if (!loginPanel.classList.contains("hidden")) {
    loginPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}


async function login() {
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value;

  if (!username || !password) {
    alert("ユーザーIDとパスワードを入力してください");
    return;
  }

  try {
    loginButton.disabled = true;
    const data = await apiRequest(AUTH_API_URL, "login", { username, password });
    setToken(data.token);
    currentUser = data.user;
    loginPasswordInput.value = "";
    isLoginPanelOpen = false;
    renderAuthState();

    if (currentUser.role === "admin") {
      await loadUsers();
    }

    alert("ログインしました");
  } catch (error) {
    alert(error.message);
  } finally {
    loginButton.disabled = false;
  }
}

function logout() {
  setToken("");
  currentUser = null;
  users = [];
  clearForm();
  clearUserForm();
  isLoginPanelOpen = false;
  renderAuthState();
}

function canEditEntry(entry) {
  if (!currentUser) return false;
  if (currentUser.role === "admin" || currentUser.role === "moderator") return true;
  return currentUser.role === "editor" && entry.owner_user_id === currentUser.id;
}

async function loadUsers() {
  if (!currentUser || currentUser.role !== "admin") return;

  try {
    const data = await apiRequest(AUTH_API_URL, "listUsers", {}, "GET");
    users = data.users || [];
    renderUsers();
  } catch (error) {
    alert(error.message);
  }
}

function renderUsers() {
  userList.innerHTML = "";

  if (users.length === 0) {
    userList.innerHTML = `<p class="meta">ユーザーがまだ登録されていません。</p>`;
    return;
  }

  users.forEach(user => {
    const item = document.createElement("div");
    item.className = "list-item";

    const info = document.createElement("div");
    info.className = "list-main";
    info.innerHTML = `
      <strong>${escapeHtml(user.display_name || user.username)}</strong>
      <div class="meta">ID: ${escapeHtml(user.username)}</div>
      <div class="meta"><span class="role-badge ${escapeHtml(user.role)}">${getRoleLabel(user.role)}</span> ${user.active ? "有効" : "停止中"}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "list-actions";

    const editButton = document.createElement("button");
    editButton.className = "small-button";
    editButton.textContent = "編集";
    editButton.onclick = () => startUserEdit(user);

    const toggleButton = document.createElement("button");
    toggleButton.className = "small-button";
    toggleButton.textContent = user.active ? "停止" : "有効化";
    toggleButton.onclick = () => updateUser(user.id, {
      username: user.username,
      displayName: user.display_name || user.username,
      role: user.role,
      active: !user.active
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "small-button danger-button";
    deleteButton.textContent = "削除";
    deleteButton.onclick = () => deleteUser(user.id, user.username);

    actions.appendChild(editButton);
    actions.appendChild(toggleButton);
    actions.appendChild(deleteButton);

    item.appendChild(info);
    item.appendChild(actions);
    userList.appendChild(item);
  });
}

function startUserEdit(user) {
  editingUserId = user.id;
  userUsernameInput.value = user.username;
  userDisplayNameInput.value = user.display_name || "";
  userRoleInput.value = user.role;
  userPasswordInput.value = "";

  createUserButton.classList.add("hidden");
  updateUserButton.classList.remove("hidden");
  cancelUserEditButton.classList.remove("hidden");
}

function clearUserForm() {
  editingUserId = null;
  userUsernameInput.value = "";
  userDisplayNameInput.value = "";
  userRoleInput.value = "editor";
  userPasswordInput.value = "";

  createUserButton.classList.remove("hidden");
  updateUserButton.classList.add("hidden");
  cancelUserEditButton.classList.add("hidden");
}

async function createUser() {
  const username = userUsernameInput.value.trim();
  const displayName = userDisplayNameInput.value.trim();
  const role = userRoleInput.value;
  const password = userPasswordInput.value;

  if (!username || !password) {
    alert("ユーザーIDとパスワードを入力してください");
    return;
  }

  try {
    await apiRequest(AUTH_API_URL, "createUser", { username, displayName, role, password });
    clearUserForm();
    await loadUsers();
    alert("ユーザーを作成しました");
  } catch (error) {
    alert(error.message);
  }
}

async function updateUser(id = editingUserId, payload = null) {
  if (!id) return;

  const data = payload || {
    username: userUsernameInput.value.trim(),
    displayName: userDisplayNameInput.value.trim(),
    role: userRoleInput.value,
    password: userPasswordInput.value || undefined,
    active: true
  };

  if (!data.username) {
    alert("ユーザーIDを入力してください");
    return;
  }

  try {
    await apiRequest(AUTH_API_URL, "updateUser", { id, ...data });
    clearUserForm();
    await loadUsers();
    alert("ユーザーを更新しました");
  } catch (error) {
    alert(error.message);
  }
}

async function deleteUser(id, username) {
  const ok = confirm(`${username} を削除しますか？ このユーザーが作ったキャラは残ります。`);
  if (!ok) return;

  try {
    await apiRequest(AUTH_API_URL, "deleteUser", { id });
    await loadUsers();
  } catch (error) {
    alert(error.message);
  }
}

function formatHeight(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return String(value);

  return Number.isInteger(number)
    ? String(number)
    : String(Math.round(number * 10) / 10);
}

function getVisualHeight(cm) {
  const safeHeight = Math.max(0, Math.min(Number(cm) || 0, MAX_HEIGHT_CM));
  return (safeHeight / MAX_HEIGHT_CM) * COMPARE_AREA_HEIGHT;
}

function resizeImageFile(file, maxSize = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");

    const reader = new FileReader();

    reader.onload = event => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", quality));
      };

      img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      img.src = event.target.result;
    };

    reader.onerror = () => reject(new Error("画像ファイルを読み込めませんでした"));
    reader.readAsDataURL(file);
  });
}

function renderCategoryCheckboxes(selectedCategories = getSelectedCategories()) {
  categoryCheckboxes.innerHTML = "";

  categories.forEach(category => {
    const label = document.createElement("label");
    label.className = "category-chip";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = category;
    checkbox.name = "categories";
    checkbox.checked = selectedCategories.includes(category);

    const text = document.createElement("span");
    text.textContent = category;

    label.appendChild(checkbox);
    label.appendChild(text);
    categoryCheckboxes.appendChild(label);
  });
}

function renderFilterCategoryOptions() {
  const current = filterCategory.value;
  filterCategory.innerHTML = `<option value="all">すべて</option>`;

  categories.forEach(category => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    filterCategory.appendChild(option);
  });

  if (current === "all" || categories.includes(current)) {
    filterCategory.value = current;
  }
}

function getSelectedCategories() {
  return [...document.querySelectorAll('input[name="categories"]:checked')].map(input => input.value);
}

function clearForm() {
  editingId = null;
  nameInput.value = "";
  heightInput.value = "";
  imageInput.value = "";
  renderCategoryCheckboxes([]);

  formTitle.textContent = "キャラクター追加";
  submitButton.textContent = "キャラクター追加";
  cancelEditButton.classList.add("hidden");
  imageHelpText.textContent = "画像は詳細画面に表示されます。未選択の場合は自動識別色のシルエットになります。色は登録せず、表示時に自動で割り当てます。";
}

async function addCategory() {
  if (!currentUser) {
    alert("カテゴリー追加にはログインが必要です");
    return;
  }

  const newCategory = newCategoryInput.value.trim();
  const selected = getSelectedCategories();

  if (!newCategory) {
    alert("カテゴリー名を入力してください");
    return;
  }

  if (categories.includes(newCategory)) {
    alert("すでに存在するカテゴリーです");
    return;
  }

  try {
    setStatus("カテゴリー追加中...");
    await apiRequest(DATA_API_URL, "addCategory", { name: newCategory });
    newCategoryInput.value = "";
    await loadData();
    renderCategoryCheckboxes([...selected, newCategory]);
  } catch (error) {
    alert(error.message);
    setStatus(`カテゴリー追加失敗：${error.message}`, "error");
  }
}

async function submitEntry() {
  if (!currentUser) {
    alert("キャラクター追加・編集にはログインが必要です");
    return;
  }

  const name = nameInput.value.trim();
  const height = Number(heightInput.value);
  const selectedCategories = getSelectedCategories();

  if (!name) return alert("キャラクター名を入力してください");
  if (!height || height <= 0) return alert("身長を正しく入力してください");
  if (selectedCategories.length === 0) return alert("カテゴリーを1つ以上選択してください");

  let imageDataUrl = "";

  try {
    imageDataUrl = await resizeImageFile(imageInput.files[0]);
  } catch {
    alert("画像の処理に失敗しました");
    return;
  }

  const payload = {
    id: editingId,
    name,
    height,
    categories: selectedCategories,
    imageDataUrl
  };

  try {
    submitButton.disabled = true;
    setStatus(editingId ? "キャラクター更新中..." : "キャラクター追加中...");
    await apiRequest(DATA_API_URL, editingId ? "updateCharacter" : "addCharacter", payload);
    clearForm();
    await loadData();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    alert(error.message);
    setStatus(`保存失敗：${error.message}`, "error");
  } finally {
    submitButton.disabled = false;
  }
}

function startEdit(id) {
  const entry = entries.find(entry => entry.id === id);
  if (!entry) return;

  if (!canEditEntry(entry)) {
    alert("このキャラクターを編集する権限がありません");
    return;
  }

  editingId = id;

  nameInput.value = entry.name;
  heightInput.value = entry.height;
  imageInput.value = "";

  renderCategoryCheckboxes(entry.categories || []);

  formTitle.textContent = "キャラクター編集";
  submitButton.textContent = "編集内容を保存";
  cancelEditButton.classList.remove("hidden");
  imageHelpText.textContent = "画像を選び直すと差し替えます。未選択なら現在の画像を維持します。";

  closeDetail();
  formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteEntry(id) {
  const entry = entries.find(entry => entry.id === id);
  if (!entry) return;

  if (!canEditEntry(entry)) {
    alert("このキャラクターを削除する権限がありません");
    return;
  }

  const ok = confirm(`${entry.name}を削除しますか？`);
  if (!ok) return;

  try {
    setStatus("削除中...");
    await apiRequest(DATA_API_URL, "deleteCharacter", { id });
    if (editingId === id) clearForm();
    if (detailTargetId === id) closeDetail();
    await loadData();
  } catch (error) {
    alert(error.message);
    setStatus(`削除失敗：${error.message}`, "error");
  }
}

async function toggleVisible(id) {
  const entry = entries.find(entry => entry.id === id);
  if (!entry) return;

  if (!canEditEntry(entry)) {
    alert("このキャラクターの表示状態を変更する権限がありません");
    return;
  }

  try {
    setStatus("表示状態を更新中...");
    await apiRequest(DATA_API_URL, "setVisible", { id, visible: !entry.visible });
    await loadData();
  } catch (error) {
    alert(error.message);
    setStatus(`表示状態の更新失敗：${error.message}`, "error");
  }
}

function openDetail(id) {
  const entry = entries.find(entry => entry.id === id);
  if (!entry) return;

  detailTargetId = id;
  detailImageArea.innerHTML = "";

  if (entry.image) {
    const img = document.createElement("img");
    img.className = "detail-image";
    img.src = entry.image;
    img.alt = entry.name;
    detailImageArea.appendChild(img);
  } else {
    const noImage = document.createElement("div");
    noImage.className = "detail-no-image";
    const detailDisplayColor = buildDisplayColorMap(getFilteredEntries()).get(entry.id) || AUTO_COLOR_PALETTE[0];
    noImage.style.setProperty("--char-color", detailDisplayColor);
    detailImageArea.appendChild(noImage);
  }

  detailName.textContent = entry.name;
  detailHeight.textContent = `${formatHeight(entry.height)}cm`;
  detailCategories.textContent = (entry.categories || []).join("、");
  detailOwner.textContent = entry.owner_display_name || "不明";

  const canEdit = canEditEntry(entry);
  detailEditButton.disabled = !canEdit;
  detailDeleteButton.disabled = !canEdit;

  detailModal.classList.remove("hidden");
}

function closeDetail() {
  detailModal.classList.add("hidden");
  detailTargetId = null;
}

function getEntryDateValue(entry) {
  const value = entry.updated_at || entry.created_at || entry.createdAt || "";
  const time = Date.parse(value);

  return Number.isFinite(time) ? time : 0;
}

function getLatestEntries(limit = DEFAULT_DISPLAY_COUNT) {
  return [...entries]
    .filter(entry => entry.visible)
    .sort((a, b) => getEntryDateValue(b) - getEntryDateValue(a))
    .slice(0, limit);
}

function readSavedDisplayIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(DISPLAY_SELECTION_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveDisplayIds() {
  localStorage.setItem(DISPLAY_SELECTION_KEY, JSON.stringify(selectedDisplayIds));
}

function ensureDisplaySelection(forceLatest = false) {
  const visibleIds = new Set(entries.filter(entry => entry.visible).map(entry => entry.id));
  let ids = forceLatest ? [] : readSavedDisplayIds();

  ids = ids.filter(id => visibleIds.has(id));

  if (ids.length === 0) {
    ids = getLatestEntries(DEFAULT_DISPLAY_COUNT).map(entry => entry.id);
  }

  selectedDisplayIds = [...new Set(ids)];

  if (!selectedDisplayIds.includes(selectedDisplaySlotId)) {
    selectedDisplaySlotId = selectedDisplayIds[0] || null;
  }

  saveDisplayIds();
}

function getSearchFilteredEntries() {
  const keyword = searchInput.value.trim().toLowerCase();
  const selectedCategory = filterCategory.value;

  return entries
    .filter(entry => {
      const matchName = entry.name.toLowerCase().includes(keyword);
      const matchCategory = selectedCategory === "all" || (entry.categories || []).includes(selectedCategory);
      return matchName && matchCategory && entry.visible;
    })
    .sort((a, b) => {
      const dateDiff = getEntryDateValue(b) - getEntryDateValue(a);
      if (dateDiff !== 0) return dateDiff;
      return a.name.localeCompare(b.name, "ja");
    });
}

function renderCandidateSelect() {
  const current = compareCandidateSelect.value;
  const candidates = getSearchFilteredEntries();

  compareCandidateSelect.innerHTML = `<option value="">人物を選択</option>`;

  candidates.forEach(entry => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.name} / ${formatHeight(entry.height)}cm`;
    compareCandidateSelect.appendChild(option);
  });

  if (candidates.some(entry => entry.id === current)) {
    compareCandidateSelect.value = current;
  }
}

function replaceDisplayCharacter() {
  const candidateId = compareCandidateSelect.value;

  if (!candidateId) {
    alert("表示する人物を選択してください");
    return;
  }

  if (!entries.some(entry => entry.id === candidateId && entry.visible)) {
    alert("選択した人物が見つかりません");
    return;
  }

  const existingIndex = selectedDisplayIds.indexOf(candidateId);

  if (existingIndex !== -1) {
    selectedDisplaySlotId = candidateId;
    render();
    return;
  }

  const targetIndex = selectedDisplaySlotId
    ? selectedDisplayIds.indexOf(selectedDisplaySlotId)
    : -1;

  if (targetIndex !== -1) {
    selectedDisplayIds[targetIndex] = candidateId;
  } else if (selectedDisplayIds.length < DEFAULT_DISPLAY_COUNT) {
    selectedDisplayIds.push(candidateId);
  } else if (selectedDisplayIds.length > 0) {
    selectedDisplayIds[0] = candidateId;
  } else {
    selectedDisplayIds = [candidateId];
  }

  selectedDisplayIds = [...new Set(selectedDisplayIds)];
  selectedDisplaySlotId = candidateId;
  saveDisplayIds();
  render();
}

function removeFromDisplay(id) {
  selectedDisplayIds = selectedDisplayIds.filter(displayId => displayId !== id);

  if (selectedDisplaySlotId === id) {
    selectedDisplaySlotId = selectedDisplayIds[0] || null;
  }

  saveDisplayIds();
  render();
}

function selectDisplaySlot(id) {
  selectedDisplaySlotId = id;
  render();
}

function resetDisplaySelection() {
  selectedDisplayIds = getLatestEntries(DEFAULT_DISPLAY_COUNT).map(entry => entry.id);
  selectedDisplaySlotId = selectedDisplayIds[0] || null;
  saveDisplayIds();
  render();
}

function setOverlapMode(value) {
  overlapMode = value === "half" ? "half" : "none";
  localStorage.setItem(OVERLAP_MODE_KEY, overlapMode);
  renderCharacters();
}

function getDisplayEntries() {
  return selectedDisplayIds
    .map(id => entries.find(entry => entry.id === id && entry.visible))
    .filter(Boolean);
}

function getFilteredEntries() {
  return getDisplayEntries();
}

function renderScale() {
  scale.innerHTML = "";

  for (let cm = 0; cm <= MAX_HEIGHT_CM; cm += 10) {
    const line = document.createElement("div");
    line.className = "scale-line";
    line.style.bottom = `${getVisualHeight(cm)}px`;
    line.textContent = cm % 50 === 0 || cm === MAX_HEIGHT_CM ? `${cm} cm` : "";
    scale.appendChild(line);
  }
}

function renderHeightRuler() {
  heightRuler.innerHTML = "";

  for (let cm = 0; cm <= MAX_HEIGHT_CM; cm += 10) {
    const tick = document.createElement("div");
    const isMajor = cm % 50 === 0;
    tick.className = isMajor ? "ruler-tick major" : "ruler-tick";
    tick.style.bottom = `${getVisualHeight(cm)}px`;
    heightRuler.appendChild(tick);

    if (isMajor || cm === MAX_HEIGHT_CM) {
      const label = document.createElement("div");
      label.className = "ruler-label";
      label.style.bottom = `${getVisualHeight(cm)}px`;
      label.textContent = `${cm}`;
      heightRuler.appendChild(label);
    }
  }
}


const AUTO_COLOR_PALETTE = [
  "#d8c28d",
  "#91a9ff",
  "#98d8a3",
  "#df6262",
  "#c99cff",
  "#7ed7d1",
  "#f29b72",
  "#b8df62",
  "#ff8fb8",
  "#7fb2ff",
  "#e7d56b",
  "#a6a6ff"
];

function normalizeHexColor(value) {
  const color = String(value || "").trim();

  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();

  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return "#" + color.slice(1).split("").map(char => char + char).join("").toLowerCase();
  }

  return "";
}

function hexToRgb(hex) {
  const color = normalizeHexColor(hex);
  if (!color) return null;

  return {
    r: parseInt(color.slice(1, 3), 16),
    g: parseInt(color.slice(3, 5), 16),
    b: parseInt(color.slice(5, 7), 16)
  };
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b]
    .map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0"))
    .join("");
}

function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;

    h /= 6;
  }

  return { h: h * 360, s, l };
}

function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  h /= 360;

  if (s === 0) {
    const value = l * 255;
    return { r: value, g: value, b: value };
  }

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255
  };
}

function shiftHexHue(hex, degrees) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const hsl = rgbToHsl(rgb);
  hsl.h += degrees;
  hsl.s = Math.max(0.42, hsl.s);
  hsl.l = Math.max(0.46, Math.min(0.68, hsl.l));

  const shiftedRgb = hslToRgb(hsl);
  return rgbToHex(shiftedRgb.r, shiftedRgb.g, shiftedRgb.b);
}

function colorDistance(colorA, colorB) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);

  if (!a || !b) return 999;

  return Math.sqrt(
    Math.pow(a.r - b.r, 2) +
    Math.pow(a.g - b.g, 2) +
    Math.pow(a.b - b.b, 2)
  );
}

function buildDisplayColorMap(items) {
  const result = new Map();
  const usedColors = [];
  const minimumDistance = 78;

  items.forEach((entry, index) => {
    const baseColor = AUTO_COLOR_PALETTE[index % AUTO_COLOR_PALETTE.length];
    let displayColor = baseColor;
    let attempt = 0;

    while (
      attempt < 24 &&
      usedColors.some(usedColor => colorDistance(displayColor, usedColor) < minimumDistance)
    ) {
      const direction = attempt % 2 === 0 ? 1 : -1;
      const step = Math.ceil((attempt + 1) / 2);
      displayColor = shiftHexHue(baseColor, direction * step * 24);
      attempt += 1;
    }

    usedColors.push(displayColor);
    result.set(entry.id, displayColor);
  });

  return result;
}

function getColorLabel() {
  return "自動識別色";
}


function renderCharacters() {
  characters.innerHTML = "";

  characters.classList.toggle("overlap-half", overlapMode === "half");
  characters.classList.toggle("overlap-none", overlapMode !== "half");

  const filtered = getFilteredEntries();
  const displayColorMap = buildDisplayColorMap(filtered);

  if (overlapModeSelect) {
    overlapModeSelect.value = overlapMode;
  }

  if (filtered.length === 0) {
    characters.innerHTML = `
      <div class="display-empty">
        表示するキャラクターがいません。<br>
        右上の検索から人物を選び、左上のプルダウンで表示に追加してください。
      </div>
    `;
    return;
  }

  filtered.forEach((entry, index) => {
    const displayColor = displayColorMap.get(entry.id) || AUTO_COLOR_PALETTE[0];

    const wrapper = document.createElement("div");
    wrapper.className = "character";
    wrapper.style.zIndex = String(index + 1);

    if (entry.id === selectedDisplaySlotId) {
      wrapper.classList.add("selected-display-slot");
    }

    wrapper.onclick = () => openDetail(entry.id);

    const visual = document.createElement("div");
    visual.className = "character-visual";

    const figure = document.createElement("div");
    figure.className = "figure";
    figure.style.height = `${getVisualHeight(entry.height)}px`;
    figure.style.setProperty("--char-color", displayColor);
    figure.title = getColorLabel();

    visual.appendChild(figure);

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = entry.name;

    const heightText = document.createElement("div");
    heightText.className = "height-text";
    heightText.textContent = `${formatHeight(entry.height)}cm`;

    const colorText = document.createElement("div");
    colorText.className = "color-note";
    colorText.innerHTML = `<span class="color-dot" style="--dot-color: ${escapeHtml(displayColor)}"></span>${escapeHtml(getColorLabel())}`;

    const categoryText = document.createElement("div");
    categoryText.className = "meta";
    categoryText.textContent = (entry.categories || []).join("、");

    const actions = document.createElement("div");
    actions.className = "display-actions";

    const slotButton = document.createElement("button");
    slotButton.className = "small-button";
    slotButton.type = "button";
    slotButton.textContent = entry.id === selectedDisplaySlotId ? "入替対象中" : "入替対象";
    slotButton.onclick = event => {
      event.stopPropagation();
      selectDisplaySlot(entry.id);
    };

    const removeButton = document.createElement("button");
    removeButton.className = "small-button remove-display-button";
    removeButton.type = "button";
    removeButton.textContent = "表示から外す";
    removeButton.onclick = event => {
      event.stopPropagation();
      removeFromDisplay(entry.id);
    };

    actions.appendChild(slotButton);
    actions.appendChild(removeButton);

    wrapper.appendChild(visual);
    wrapper.appendChild(name);
    wrapper.appendChild(heightText);
    wrapper.appendChild(colorText);
    wrapper.appendChild(categoryText);
    wrapper.appendChild(actions);

    characters.appendChild(wrapper);
  });
}
function renderList() {
  list.innerHTML = "";
  const displayColorMap = buildDisplayColorMap(entries);

  const filteredList = getSearchFilteredEntries();

  if (entries.length === 0) {
    list.innerHTML = `<p class="meta">まだキャラクターが登録されていません。</p>`;
    return;
  }

  if (filteredList.length === 0) {
    list.innerHTML = `<p class="meta">検索条件に一致するキャラクターがいません。</p>`;
    return;
  }

  filteredList.forEach(entry => {
    const item = document.createElement("div");
    item.className = "list-item";

    const info = document.createElement("div");
    info.className = "list-main";
    const displayColor = displayColorMap.get(entry.id) || AUTO_COLOR_PALETTE[0];

    info.innerHTML = `
      <strong>${escapeHtml(entry.name)}</strong>
      <div class="meta list-color-line"><span class="color-dot" style="--dot-color: ${escapeHtml(displayColor)}"></span>${escapeHtml(getColorLabel())} / ${formatHeight(entry.height)}cm / ${(entry.categories || []).map(escapeHtml).join("、")}</div>
      <div class="meta">登録者: ${escapeHtml(entry.owner_display_name || "不明")} / ${entry.visible ? "表示中" : "非表示中"}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "list-actions";

    const detailButton = document.createElement("button");
    detailButton.className = "small-button";
    detailButton.textContent = "詳細";
    detailButton.onclick = () => openDetail(entry.id);

    const editButton = document.createElement("button");
    editButton.className = "small-button";
    editButton.textContent = "編集";
    editButton.disabled = !canEditEntry(entry);
    editButton.onclick = () => startEdit(entry.id);

    const visibleButton = document.createElement("button");
    visibleButton.className = "small-button";
    visibleButton.textContent = entry.visible ? "非表示" : "表示";
    visibleButton.disabled = !canEditEntry(entry);
    visibleButton.onclick = () => toggleVisible(entry.id);

    const deleteButton = document.createElement("button");
    deleteButton.className = "small-button danger-button";
    deleteButton.textContent = "削除";
    deleteButton.disabled = !canEditEntry(entry);
    deleteButton.onclick = () => deleteEntry(entry.id);

    actions.appendChild(detailButton);
    actions.appendChild(editButton);
    actions.appendChild(visibleButton);
    actions.appendChild(deleteButton);

    item.appendChild(info);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

function render() {
  renderFilterCategoryOptions();
  renderCandidateSelect();
  renderScale();
  renderHeightRuler();
  renderCharacters();
  renderList();
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

refreshDataButton.addEventListener("click", refreshData);
clearCacheButton.addEventListener("click", clearLocalCache);
accountToggleButton.addEventListener("click", toggleLoginPanel);
loginButton.addEventListener("click", login);
logoutButton.addEventListener("click", logout);

createUserButton.addEventListener("click", createUser);
updateUserButton.addEventListener("click", () => updateUser());
cancelUserEditButton.addEventListener("click", clearUserForm);
refreshUsersButton.addEventListener("click", loadUsers);

submitButton.addEventListener("click", submitEntry);
cancelEditButton.addEventListener("click", () => {
  clearForm();
  render();
});

addCategoryButton.addEventListener("click", addCategory);
searchInput.addEventListener("input", render);
filterCategory.addEventListener("change", render);
compareCandidateSelect.addEventListener("change", () => {
  if (compareCandidateSelect.value) selectedDisplaySlotId = selectedDisplaySlotId || selectedDisplayIds[0] || null;
});
replaceDisplayButton.addEventListener("click", replaceDisplayCharacter);
displayResetButton.addEventListener("click", resetDisplaySelection);
overlapModeSelect.addEventListener("change", event => setOverlapMode(event.target.value));

closeModalButton.addEventListener("click", closeDetail);
modalBackdrop.addEventListener("click", closeDetail);

detailEditButton.addEventListener("click", () => {
  if (detailTargetId) startEdit(detailTargetId);
});

detailDeleteButton.addEventListener("click", () => {
  if (detailTargetId) deleteEntry(detailTargetId);
});

scrollToFormButton.addEventListener("click", () => {
  clearForm();
  formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
});

renderCategoryCheckboxes([]);
if (overlapModeSelect) overlapModeSelect.value = overlapMode;
loadMe();
loadData();
