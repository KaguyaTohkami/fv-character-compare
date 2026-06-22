const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const DEFAULT_CATEGORIES = [
  "白市民",
  "黒市民",
  "警察",
  "救急",
  "メカニック",
  "飲食店",
  "ギャング",
  "半グレ",
  "企業",
  "不明",
  "その他"
];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const BUCKET = process.env.SUPABASE_BUCKET || "character-images";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function supabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase環境変数が設定されていません");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function getOptionalUser(db, req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return null;
  if (!JWT_SECRET) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    const { data } = await db
      .from("fv_users")
      .select("id,username,display_name,role,active")
      .eq("id", payload.sub)
      .limit(1);

    const user = data && data[0];

    if (!user || !user.active) return null;

    return user;
  } catch {
    return null;
  }
}

function requireUser(user) {
  if (!user) {
    const error = new Error("ログインが必要です");
    error.statusCode = 401;
    throw error;
  }
}

function canManageCharacter(user, character) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "moderator") return true;
  return user.role === "editor" && character.owner_user_id === user.id;
}

function canManageCategory(user) {
  return Boolean(user && (user.role === "admin" || user.role === "moderator"));
}

async function ensureDefaultCategories(db) {
  const rows = DEFAULT_CATEGORIES.map((name, index) => ({
    name,
    sort_order: index
  }));

  await db.from("fv_categories").upsert(rows, { onConflict: "name" });
}

function parseDataUrl(dataUrl) {
  if (!dataUrl) return null;

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) throw new Error("画像データの形式が不正です");

  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function uploadImage(db, characterId, dataUrl) {
  const parsed = parseDataUrl(dataUrl);

  if (!parsed) return { image_url: null, image_path: null };

  const ext = parsed.contentType.includes("png") ? "png" : "jpg";
  const imagePath = `characters/${characterId}-${Date.now()}.${ext}`;

  const { error } = await db.storage
    .from(BUCKET)
    .upload(imagePath, parsed.buffer, {
      contentType: parsed.contentType,
      upsert: true
    });

  if (error) throw new Error(error.message);

  const { data } = db.storage.from(BUCKET).getPublicUrl(imagePath);

  return {
    image_url: data.publicUrl,
    image_path: imagePath
  };
}

async function listData(db) {
  await ensureDefaultCategories(db);

  const { data: categoryRows, error: categoryError } = await db
    .from("fv_categories")
    .select("name")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (categoryError) throw new Error(categoryError.message);

  const { data: characterRows, error: characterError } = await db
    .from("fv_characters")
    .select("id,name,height,color,gender,categories,image_url,visible,owner_user_id,created_at")
    .order("height", { ascending: false });

  if (characterError) throw new Error(characterError.message);

  const ownerIds = [...new Set((characterRows || []).map(row => row.owner_user_id).filter(Boolean))];
  let userMap = new Map();

  if (ownerIds.length > 0) {
    const { data: userRows } = await db
      .from("fv_users")
      .select("id,username,display_name")
      .in("id", ownerIds);

    userMap = new Map((userRows || []).map(user => [user.id, user]));
  }

  return {
    categories: (categoryRows || []).map(row => row.name),
    entries: (characterRows || []).map(row => {
      const owner = userMap.get(row.owner_user_id);

      return {
        id: row.id,
        name: row.name,
        height: row.height,
        color: row.color,
        gender: row.gender || "male",
        categories: row.categories || [],
        image: row.image_url || "",
        visible: row.visible !== false,
        owner_user_id: row.owner_user_id,
        owner_display_name: owner ? (owner.display_name || owner.username) : "不明"
      };
    })
  };
}

module.exports = async function handler(req, res) {
  try {
    const db = supabase();
    const action = req.query.action || "list";
    const user = await getOptionalUser(db, req);

    if (req.method === "GET" && action === "list") {
      const data = await listData(db);
      return json(res, 200, data);
    }

    if (req.method !== "POST") return json(res, 405, { error: "Method Not Allowed" });

    requireUser(user);
    const body = await readBody(req);

    if (action === "addCategory") {
      const name = String(body.name || "").trim();
      if (!name) return json(res, 400, { error: "カテゴリー名が空です" });

      const { error } = await db
        .from("fv_categories")
        .upsert({ name }, { onConflict: "name" });

      if (error) throw new Error(error.message);

      return json(res, 200, { ok: true });
    }

    if (action === "renameCategory") {
      if (!canManageCategory(user)) return json(res, 403, { error: "カテゴリー編集権限がありません" });

      const oldName = String(body.oldName || "").trim();
      const newName = String(body.newName || "").trim();

      if (!oldName || !newName) return json(res, 400, { error: "カテゴリー名が空です" });
      if (oldName === newName) return json(res, 200, { ok: true });

      const { data: existingRows, error: existingError } = await db
        .from("fv_categories")
        .select("name")
        .eq("name", newName)
        .limit(1);

      if (existingError) throw new Error(existingError.message);
      if (existingRows && existingRows.length > 0) {
        return json(res, 409, { error: "同じ名前のカテゴリーがすでに存在します" });
      }

      const { error: categoryError } = await db
        .from("fv_categories")
        .update({ name: newName })
        .eq("name", oldName);

      if (categoryError) throw new Error(categoryError.message);

      const { data: characterRows, error: fetchError } = await db
        .from("fv_characters")
        .select("id,categories");

      if (fetchError) throw new Error(fetchError.message);

      for (const character of characterRows || []) {
        const currentCategories = Array.isArray(character.categories) ? character.categories : [];
        if (!currentCategories.includes(oldName)) continue;

        const nextCategories = [...new Set(currentCategories.map(category => category === oldName ? newName : category))];

        const { error: updateError } = await db
          .from("fv_characters")
          .update({
            categories: nextCategories,
            updated_at: new Date().toISOString()
          })
          .eq("id", character.id);

        if (updateError) throw new Error(updateError.message);
      }

      return json(res, 200, { ok: true });
    }

    if (action === "deleteCategory") {
      if (!canManageCategory(user)) return json(res, 403, { error: "カテゴリー削除権限がありません" });

      const name = String(body.name || "").trim();
      if (!name) return json(res, 400, { error: "カテゴリー名が空です" });

      const { error: categoryError } = await db
        .from("fv_categories")
        .delete()
        .eq("name", name);

      if (categoryError) throw new Error(categoryError.message);

      const { data: characterRows, error: fetchError } = await db
        .from("fv_characters")
        .select("id,categories");

      if (fetchError) throw new Error(fetchError.message);

      for (const character of characterRows || []) {
        const currentCategories = Array.isArray(character.categories) ? character.categories : [];
        if (!currentCategories.includes(name)) continue;

        const nextCategories = currentCategories.filter(category => category !== name);

        const { error: updateError } = await db
          .from("fv_characters")
          .update({
            categories: nextCategories,
            updated_at: new Date().toISOString()
          })
          .eq("id", character.id);

        if (updateError) throw new Error(updateError.message);
      }

      return json(res, 200, { ok: true });
    }

    if (action === "addCharacter") {
      const id = crypto.randomUUID();
      const name = String(body.name || "").trim();
      const height = Number(body.height);
      const gender = body.gender === "female" ? "female" : "male";
      const categories = Array.isArray(body.categories) ? body.categories : [];
      const color = String(body.color || "#4b6fa9");

      if (!name || !height || categories.length === 0) {
        return json(res, 400, { error: "入力内容が不足しています" });
      }

      const image = await uploadImage(db, id, body.imageDataUrl || "");

      const { error } = await db.from("fv_characters").insert({
        id,
        name,
        height,
        gender,
        categories,
        color,
        image_url: image.image_url,
        image_path: image.image_path,
        visible: true,
        owner_user_id: user.id
      });

      if (error) throw new Error(error.message);

      return json(res, 200, { ok: true, id });
    }

    if (["updateCharacter", "deleteCharacter", "setVisible"].includes(action)) {
      const id = String(body.id || "");
      if (!id) return json(res, 400, { error: "IDがありません" });

      const { data: rows, error: fetchError } = await db
        .from("fv_characters")
        .select("*")
        .eq("id", id)
        .limit(1);

      if (fetchError) throw new Error(fetchError.message);

      const current = rows && rows[0];
      if (!current) return json(res, 404, { error: "対象が見つかりません" });

      if (!canManageCharacter(user, current)) {
        return json(res, 403, { error: "権限がありません" });
      }

      if (action === "deleteCharacter") {
        const { error } = await db.from("fv_characters").delete().eq("id", id);
        if (error) throw new Error(error.message);

        if (current.image_path) {
          await db.storage.from(BUCKET).remove([current.image_path]);
        }

        return json(res, 200, { ok: true });
      }

      if (action === "setVisible") {
        const { error } = await db
          .from("fv_characters")
          .update({
            visible: Boolean(body.visible),
            updated_at: new Date().toISOString()
          })
          .eq("id", id);

        if (error) throw new Error(error.message);

        return json(res, 200, { ok: true });
      }

      const name = String(body.name || "").trim();
      const height = Number(body.height);
      const gender = body.gender === "female" ? "female" : "male";
      const categories = Array.isArray(body.categories) ? body.categories : [];
      const color = String(body.color || "#4b6fa9");

      if (!name || !height || categories.length === 0) {
        return json(res, 400, { error: "入力内容が不足しています" });
      }

      const updateData = {
        name,
        height,
        gender,
        categories,
        color,
        updated_at: new Date().toISOString()
      };

      if (body.imageDataUrl) {
        const image = await uploadImage(db, id, body.imageDataUrl);
        updateData.image_url = image.image_url;
        updateData.image_path = image.image_path;

        if (current.image_path) {
          await db.storage.from(BUCKET).remove([current.image_path]);
        }
      }

      const { error } = await db
        .from("fv_characters")
        .update(updateData)
        .eq("id", id);

      if (error) throw new Error(error.message);

      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "Unknown action" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Server Error" });
  }
};
