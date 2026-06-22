const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const INITIAL_ADMIN_USERNAME = process.env.INITIAL_ADMIN_USERNAME || "admin";
const INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function supabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase環境変数が設定されていません");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function requireJwtSecret() {
  if (!JWT_SECRET) throw new Error("JWT_SECRET が設定されていません");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role
  };
}

async function ensureInitialAdmin(db) {
  if (!INITIAL_ADMIN_PASSWORD) return;

  const { data: rows, error } = await db
    .from("fv_users")
    .select("id")
    .eq("username", INITIAL_ADMIN_USERNAME)
    .limit(1);

  if (error) throw new Error(error.message);

  if (rows && rows.length > 0) return;

  const password_hash = await bcrypt.hash(INITIAL_ADMIN_PASSWORD, 12);

  const { error: insertError } = await db.from("fv_users").insert({
    username: INITIAL_ADMIN_USERNAME,
    display_name: "管理者",
    role: "admin",
    password_hash,
    active: true
  });

  if (insertError) throw new Error(insertError.message);
}

async function getUserFromRequest(db, req) {
  requireJwtSecret();

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    const error = new Error("ログインが必要です");
    error.statusCode = 401;
    throw error;
  }

  let payload;

  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    const error = new Error("ログイン情報が無効です");
    error.statusCode = 401;
    throw error;
  }

  const { data, error } = await db
    .from("fv_users")
    .select("id,username,display_name,role,active")
    .eq("id", payload.sub)
    .limit(1);

  if (error) throw new Error(error.message);

  const user = data && data[0];

  if (!user || !user.active) {
    const authError = new Error("ユーザーが無効です");
    authError.statusCode = 401;
    throw authError;
  }

  return user;
}

function requireAdmin(user) {
  if (!user || user.role !== "admin") {
    const error = new Error("管理者権限が必要です");
    error.statusCode = 403;
    throw error;
  }
}

module.exports = async function handler(req, res) {
  try {
    const db = supabase();
    await ensureInitialAdmin(db);

    const action = req.query.action || "me";

    if (action === "login" && req.method === "POST") {
      requireJwtSecret();

      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      if (!username || !password) return json(res, 400, { error: "IDとパスワードを入力してください" });

      const { data, error } = await db
        .from("fv_users")
        .select("id,username,display_name,role,password_hash,active")
        .eq("username", username)
        .limit(1);

      if (error) throw new Error(error.message);

      const user = data && data[0];

      if (!user || !user.active) return json(res, 401, { error: "ログインできません" });

      const ok = await bcrypt.compare(password, user.password_hash);

      if (!ok) return json(res, 401, { error: "ログインできません" });

      const token = jwt.sign(
        { sub: user.id, role: user.role },
        JWT_SECRET,
        { expiresIn: "30d" }
      );

      return json(res, 200, { token, user: publicUser(user) });
    }

    const user = await getUserFromRequest(db, req);

    if (action === "me" && req.method === "GET") {
      return json(res, 200, { user: publicUser(user) });
    }

    requireAdmin(user);

    if (action === "listUsers" && req.method === "GET") {
      const { data, error } = await db
        .from("fv_users")
        .select("id,username,display_name,role,active,created_at")
        .order("role", { ascending: true })
        .order("username", { ascending: true });

      if (error) throw new Error(error.message);

      return json(res, 200, { users: data || [] });
    }

    const body = await readBody(req);

    if (action === "createUser" && req.method === "POST") {
      const username = String(body.username || "").trim();
      const display_name = String(body.displayName || username).trim();
      const role = String(body.role || "editor");
      const password = String(body.password || "");

      if (!username || !password) return json(res, 400, { error: "IDとパスワードが必要です" });
      if (!["admin", "moderator", "editor"].includes(role)) return json(res, 400, { error: "権限が不正です" });

      const password_hash = await bcrypt.hash(password, 12);

      const { error } = await db.from("fv_users").insert({
        username,
        display_name,
        role,
        password_hash,
        active: true
      });

      if (error) throw new Error(error.message);

      return json(res, 200, { ok: true });
    }

    if (action === "updateUser" && req.method === "POST") {
      const id = String(body.id || "");
      const username = String(body.username || "").trim();
      const display_name = String(body.displayName || username).trim();
      const role = String(body.role || "editor");
      const active = body.active !== false;

      if (!id || !username) return json(res, 400, { error: "入力内容が不足しています" });
      if (!["admin", "moderator", "editor"].includes(role)) return json(res, 400, { error: "権限が不正です" });

      const updateData = {
        username,
        display_name,
        role,
        active,
        updated_at: new Date().toISOString()
      };

      if (body.password) {
        updateData.password_hash = await bcrypt.hash(String(body.password), 12);
      }

      const { error } = await db
        .from("fv_users")
        .update(updateData)
        .eq("id", id);

      if (error) throw new Error(error.message);

      return json(res, 200, { ok: true });
    }

    if (action === "deleteUser" && req.method === "POST") {
      const id = String(body.id || "");

      if (!id) return json(res, 400, { error: "IDがありません" });
      if (id === user.id) return json(res, 400, { error: "自分自身は削除できません" });

      const { error } = await db
        .from("fv_users")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw new Error(error.message);

      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "Unknown action" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Server Error" });
  }
};
