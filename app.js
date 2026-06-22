const DATA_API_URL = "/api/data";
const AUTH_API_URL = "/api/auth";
const MAX_HEIGHT_CM = 230;
const COMPARE_AREA_HEIGHT = 450;

let categories = [];
let entries = [];
let users = [];
let currentUser = null;
let editingId = null;
let editingUserId = null;
let detailTargetId = null;

const $ = id => document.getElementById(id);

const statusPanel = $("statusPanel");
const loginStatus = $("loginStatus");
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
const colorInput = $("colorInput");
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
  return sessionStorage.getItem("fv_auth_token") || "";
}

function setToken(token) {
  if (token) sessionStorage.setItem("fv_auth_token", token);
  else sessionStorage.removeItem("fv_auth_token");
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

async function loadData() {
  try {
    setStatus("サーバーから読み込み中...");
    const data = await apiRequest(DATA_API_URL, "list", {}, "GET");
    categories = data.categories || [];
    entries = data.entries || [];
    setStatus("サーバー同期済み", "ok");
    renderCategoryCheckboxes([]);
    render();
  } catch (error) {
    console.error(error);
    setStatus(`読み込み失敗：${error.message}`, "error");
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
    formPermissionText.textContent = "追加・編集にはログインが必要です。";
  }

  renderList();
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
  colorInput.value = "#4b6fa9";
  imageInput.value = "";
  renderCategoryCheckboxes([]);

  formTitle.textContent = "キャラクター追加";
  submitButton.textContent = "キャラクター追加";
  cancelEditButton.classList.add("hidden");
  imageHelpText.textContent = "画像は詳細画面に表示されます。未選択の場合は色つきシルエットになります。";
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
    color: colorInput.value,
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
  colorInput.value = entry.color || "#4b6fa9";
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
    noImage.style.setProperty("--char-color", entry.color || "#888888");
    detailImageArea.appendChild(noImage);
  }

  detailName.textContent = entry.name;
  detailHeight.textContent = `${entry.height}cm`;
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

function getFilteredEntries() {
  const keyword = searchInput.value.trim().toLowerCase();
  const selectedCategory = filterCategory.value;

  return entries
    .filter(entry => {
      const matchName = entry.name.toLowerCase().includes(keyword);
      const matchCategory = selectedCategory === "all" || (entry.categories || []).includes(selectedCategory);
      return matchName && matchCategory && entry.visible;
    })
    .sort((a, b) => b.height - a.height);
}

function renderScale() {
  scale.innerHTML = "";

  for (let cm = 0; cm <= MAX_HEIGHT_CM; cm += 10) {
    const line = document.createElement("div");
    line.className = "scale-line";
    line.style.bottom = `${getVisualHeight(cm)}px`;
    line.textContent = `${cm} cm`;
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

function renderCharacters() {
  characters.innerHTML = "";

  const filtered = getFilteredEntries();

  if (filtered.length === 0) {
    characters.innerHTML = `<div class="meta">表示するキャラクターがいません。</div>`;
    return;
  }

  filtered.forEach(entry => {
    const wrapper = document.createElement("div");
    wrapper.className = "character";
    wrapper.onclick = () => openDetail(entry.id);

    const visual = document.createElement("div");
    visual.className = "character-visual";

    const figure = document.createElement("div");
    figure.className = "figure";
    figure.style.height = `${getVisualHeight(entry.height)}px`;
    figure.style.setProperty("--char-color", entry.color || "#888888");

    visual.appendChild(figure);

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = entry.name;

    const heightText = document.createElement("div");
    heightText.className = "height-text";
    heightText.textContent = `${entry.height}cm`;

    const categoryText = document.createElement("div");
    categoryText.className = "meta";
    categoryText.textContent = (entry.categories || []).join("、");

    wrapper.appendChild(visual);
    wrapper.appendChild(name);
    wrapper.appendChild(heightText);
    wrapper.appendChild(categoryText);

    characters.appendChild(wrapper);
  });
}

function renderList() {
  list.innerHTML = "";

  if (entries.length === 0) {
    list.innerHTML = `<p class="meta">まだキャラクターが登録されていません。</p>`;
    return;
  }

  entries.forEach(entry => {
    const item = document.createElement("div");
    item.className = "list-item";

    const info = document.createElement("div");
    info.className = "list-main";
    info.innerHTML = `
      <strong>${escapeHtml(entry.name)}</strong>
      <div class="meta">${entry.height}cm / ${(entry.categories || []).map(escapeHtml).join("、")}</div>
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
loadMe();
loadData();
