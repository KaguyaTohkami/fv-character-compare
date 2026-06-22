# FVキャラクター比較 権限分離版

## 権限

- 閲覧者: ログインなしで閲覧可能
- 編集者: 自分が追加したキャラクターのみ編集・削除可能
- モデレーター: 全キャラクターを編集・削除可能
- 管理者: 全キャラクター管理 + ユーザー管理可能

## Vercel環境変数

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_BUCKET
- JWT_SECRET
- INITIAL_ADMIN_USERNAME
- INITIAL_ADMIN_PASSWORD

例:
- SUPABASE_BUCKET = character-images
- INITIAL_ADMIN_USERNAME = admin
- INITIAL_ADMIN_PASSWORD = 任意の初期管理者パスワード
- JWT_SECRET = 長いランダム文字列

## Supabase

1. Project作成
2. SQL Editorで setup.sql を実行
3. Storageで character-images バケットを作成
4. Public bucket をON

## 初回ログイン

Vercel環境変数に設定した INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD でログインします。
初回アクセス時に管理者が自動作成されます。
