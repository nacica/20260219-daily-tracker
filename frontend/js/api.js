/**
 * バックエンド API 通信モジュール
 * 全 API 呼び出しをここに集約する
 */

// バックエンドのベース URL（環境に応じて変更）
const API_BASE = window.API_BASE_URL || "http://localhost:8000/api/v1";

/**
 * 共通 fetch ラッパー
 * エラーハンドリングと JSON パースを行う
 */
async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const defaults = {
    headers: { "Content-Type": "application/json" },
  };
  const config = { ...defaults, ...options };
  if (config.body && typeof config.body === "object") {
    config.body = JSON.stringify(config.body);
  }

  const res = await fetch(url, config);

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      const detail = data.detail;
      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail.map(e => e.msg || JSON.stringify(e)).join("; ");
      } else if (detail) {
        message = JSON.stringify(detail);
      }
    } catch {}
    throw new Error(message);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ---- 行動記録 ----

export const recordsApi = {
  /** 行動記録を作成 */
  create: (date, rawInput, tasksPlanned = [], tasksCompleted = [], tasksBacklog = []) =>
    apiFetch("/records", {
      method: "POST",
      body: { date, raw_input: rawInput, tasks_planned: tasksPlanned, tasks_completed: tasksCompleted, tasks_backlog: tasksBacklog },
    }),

  /** 行動記録一覧を取得 */
  list: (startDate, endDate) => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    return apiFetch(`/records?${params}`);
  },

  /** 指定日の行動記録を取得 */
  get: (date) => apiFetch(`/records/${date}`),

  /** 行動記録を更新 */
  update: (date, data) =>
    apiFetch(`/records/${date}`, { method: "PUT", body: data }),

  /** 行動記録を削除 */
  delete: (date) => apiFetch(`/records/${date}`, { method: "DELETE" }),

  /** おやすみモード切替 */
  toggleRestDay: (date, restDay, restReason = "") =>
    apiFetch(`/records/${date}/rest-day`, {
      method: "PUT",
      body: { rest_day: restDay, rest_reason: restReason },
    }),
};

// ---- AI 分析 ----

export const analysisApi = {
  /** 日次分析を生成（Claude API 呼び出し） */
  generate: (date) =>
    apiFetch(`/analysis/${date}/generate`, { method: "POST" }),

  /** 保存済み分析を取得 */
  get: (date) => apiFetch(`/analysis/${date}`),

  /** 分析一覧を取得 */
  list: (startDate, endDate) => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    return apiFetch(`/analysis?${params}`);
  },
};

// ---- ソクラテス式対話 ----

export const dialogueApi = {
  /** 対話を開始（または再開） */
  start: (date) =>
    apiFetch(`/dialogue/${date}/start`, { method: "POST" }),

  /** ユーザーの返答を送信しAI応答を取得 */
  reply: (date, message) =>
    apiFetch(`/dialogue/${date}/reply`, {
      method: "POST",
      body: { message },
    }),

  /** 対話から分析を生成 */
  synthesize: (date) =>
    apiFetch(`/dialogue/${date}/synthesize`, { method: "POST" }),

  /** 保存済み対話を取得 */
  get: (date) => apiFetch(`/dialogue/${date}`),

  /** 対話を削除 */
  delete: (date) => apiFetch(`/dialogue/${date}`, { method: "DELETE" }),
};

// ---- 朝のタスク整理 ----

export const morningDialogueApi = {
  /** 朝問答を開始（または再開） */
  start: (date) =>
    apiFetch(`/morning/${date}/start`, { method: "POST" }),

  /** ユーザーの返答を送信しAI応答を取得 */
  reply: (date, message) =>
    apiFetch(`/morning/${date}/reply`, {
      method: "POST",
      body: { message },
    }),

  /** 対話から今日のプランを生成 */
  synthesize: (date) =>
    apiFetch(`/morning/${date}/synthesize`, { method: "POST" }),

  /** 保存済み朝問答を取得 */
  get: (date) => apiFetch(`/morning/${date}`),

  /** 朝問答を削除 */
  delete: (date) => apiFetch(`/morning/${date}`, { method: "DELETE" }),
};

// ---- 日記入力対話 ----

export const diaryDialogueApi = {
  /** 日記入力対話を開始（または再開） */
  start: (date) =>
    apiFetch(`/diary-dialogue/${date}/start`, { method: "POST" }),

  /** ユーザーの返答を送信しAI応答を取得 */
  reply: (date, message) =>
    apiFetch(`/diary-dialogue/${date}/reply`, {
      method: "POST",
      body: { message },
    }),

  /** 対話から行動ログを生成しレコード保存 */
  synthesize: (date) =>
    apiFetch(`/diary-dialogue/${date}/synthesize`, { method: "POST" }),

  /** 保存済み日記対話を取得 */
  get: (date) => apiFetch(`/diary-dialogue/${date}`),

  /** 日記対話を削除 */
  delete: (date) => apiFetch(`/diary-dialogue/${date}`, { method: "DELETE" }),
};

// ---- フリージャーナル ----

export const journalApi = {
  /** ジャーナル作成（1日に複数作成可能。entry_number は自動採番） */
  create: (date, content) =>
    apiFetch("/journal", {
      method: "POST",
      body: { date, content },
    }),

  /** ジャーナル一覧（日付範囲） */
  list: (startDate, endDate) => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    return apiFetch(`/journal?${params}`);
  },

  /** 指定日の全エントリ取得（配列で返る） */
  listByDate: (date) => apiFetch(`/journal/by-date/${date}`),

  /** 単一エントリ取得（entry_id: 'YYYY-MM-DD#N'） */
  getEntry: (entryId) => apiFetch(`/journal/entry/${encodeURIComponent(entryId)}`),

  /** エントリ更新 */
  update: (entryId, content) =>
    apiFetch(`/journal/entry/${encodeURIComponent(entryId)}`, { method: "PUT", body: { content } }),

  /** エントリ削除 */
  delete: (entryId) =>
    apiFetch(`/journal/entry/${encodeURIComponent(entryId)}`, { method: "DELETE" }),

  /** AI分析を実行 */
  analyze: (entryId) =>
    apiFetch(`/journal/entry/${encodeURIComponent(entryId)}/analyze`, { method: "POST" }),

  /** マークダウン要約を生成 */
  summarize: (entryId) =>
    apiFetch(`/journal/entry/${encodeURIComponent(entryId)}/summarize`, { method: "POST" }),

  /** 週次ダイジェスト取得 */
  getDigest: (weekId) => apiFetch(`/journal/digest/${weekId}`),

  /** 週次ダイジェスト生成 */
  generateDigest: (weekId) =>
    apiFetch(`/journal/digest/${weekId}/generate`, { method: "POST" }),
};

// ---- ブレインダンプ ----

export const braindumpApi = {
  /** メモ作成（1日に複数作成可能） */
  create: (date, content, labels = null) =>
    apiFetch("/braindump", {
      method: "POST",
      body: labels ? { date, content, labels } : { date, content },
    }),

  /** メモ一覧（日付範囲） */
  list: (startDate, endDate) => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    return apiFetch(`/braindump?${params}`);
  },

  /** 指定日の全メモ取得 */
  listByDate: (date) => apiFetch(`/braindump/by-date/${date}`),

  /** 指定日のメモを並び替え（ordered_ids の順に sort_order を再採番） */
  reorder: (date, orderedIds) =>
    apiFetch(`/braindump/by-date/${date}/reorder`, {
      method: "POST",
      body: { ordered_ids: orderedIds },
    }),

  /** メモが存在する日付一覧 */
  datesWithEntries: (startDate, endDate) => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    return apiFetch(`/braindump/dates-with-entries?${params}`);
  },

  /** 単一メモ取得 */
  getEntry: (entryId) => apiFetch(`/braindump/entry/${encodeURIComponent(entryId)}`),

  /** メモ更新（content / labels いずれかまたは両方を指定可、null は省略扱い） */
  update: (entryId, content, labels = null) => {
    const body = {};
    if (content !== null && content !== undefined) body.content = content;
    if (labels !== null && labels !== undefined) body.labels = labels;
    return apiFetch(`/braindump/entry/${encodeURIComponent(entryId)}`, { method: "PUT", body });
  },

  /** メモ削除 */
  delete: (entryId) =>
    apiFetch(`/braindump/entry/${encodeURIComponent(entryId)}`, { method: "DELETE" }),

  /** AIタイトル生成 */
  generateTitle: (entryId) =>
    apiFetch(`/braindump/entry/${encodeURIComponent(entryId)}/generate-title`, { method: "POST" }),

  /** 画像アップロード（FormData を使うため apiFetch を経由しない） */
  uploadImage: async (file) => {
    const url = `${API_BASE}/braindump/upload-image`;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(url, { method: "POST", body: formData });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { const d = await res.json(); if (d.detail) message = d.detail; } catch {}
      throw new Error(message);
    }
    return res.json();
  },

  /** ラベル一覧（全メモから集計、使用件数付き） */
  listLabels: () => apiFetch("/braindump/labels"),

  /** ラベルをリネーム（影響件数を返す） */
  renameLabel: (oldName, newName) =>
    apiFetch("/braindump/labels/rename", {
      method: "POST",
      body: { old_name: oldName, new_name: newName },
    }),

  /** ラベルを削除（カスケード除去、影響件数を返す） */
  deleteLabel: (name) =>
    apiFetch(`/braindump/labels/${encodeURIComponent(name)}`, { method: "DELETE" }),
};

// ---- Udemy コース制作 Tips ----

export const udemyTipsApi = {
  /** Tip 作成（1日に複数作成可能） */
  create: (date, content, labels = null) =>
    apiFetch("/udemy-tips", {
      method: "POST",
      body: labels ? { date, content, labels } : { date, content },
    }),

  /** Tip 一覧（日付範囲） */
  list: (startDate, endDate) => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    return apiFetch(`/udemy-tips?${params}`);
  },

  /** 指定日の全 Tip 取得 */
  listByDate: (date) => apiFetch(`/udemy-tips/by-date/${date}`),

  /** 指定日の Tip を並び替え */
  reorder: (date, orderedIds) =>
    apiFetch(`/udemy-tips/by-date/${date}/reorder`, {
      method: "POST",
      body: { ordered_ids: orderedIds },
    }),

  /** 単一 Tip 取得 */
  getEntry: (entryId) => apiFetch(`/udemy-tips/entry/${encodeURIComponent(entryId)}`),

  /** Tip 更新（content / labels いずれかまたは両方） */
  update: (entryId, content, labels = null) => {
    const body = {};
    if (content !== null && content !== undefined) body.content = content;
    if (labels !== null && labels !== undefined) body.labels = labels;
    return apiFetch(`/udemy-tips/entry/${encodeURIComponent(entryId)}`, { method: "PUT", body });
  },

  /** Tip 削除 */
  delete: (entryId) =>
    apiFetch(`/udemy-tips/entry/${encodeURIComponent(entryId)}`, { method: "DELETE" }),

  /** タグ一覧 */
  listLabels: () => apiFetch("/udemy-tips/labels"),

  /** タグをリネーム */
  renameLabel: (oldName, newName) =>
    apiFetch("/udemy-tips/labels/rename", {
      method: "POST",
      body: { old_name: oldName, new_name: newName },
    }),

  /** タグを削除 */
  deleteLabel: (name) =>
    apiFetch(`/udemy-tips/labels/${encodeURIComponent(name)}`, { method: "DELETE" }),
};

// ---- 単語帳カード ----

export const flashcardsApi = {
  /** カード作成 */
  create: (front, back) =>
    apiFetch("/flashcards", {
      method: "POST",
      body: { front, back },
    }),

  /** 全カード取得（作成日降順） */
  list: () => apiFetch("/flashcards"),

  /** 単一カード取得 */
  get: (cardId) => apiFetch(`/flashcards/${cardId}`),

  /** カード更新 */
  update: (cardId, data) =>
    apiFetch(`/flashcards/${cardId}`, { method: "PUT", body: data }),

  /** カード削除 */
  delete: (cardId) =>
    apiFetch(`/flashcards/${cardId}`, { method: "DELETE" }),

  /** 覚えた/まだ マーク */
  mark: (cardId, remembered) =>
    apiFetch(`/flashcards/${cardId}/mark`, {
      method: "PUT",
      body: { remembered },
    }),

  /** 画像アップロード（FormData を使うため apiFetch を経由しない） */
  uploadImage: async (file) => {
    const url = `${API_BASE}/flashcards/upload-image`;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(url, { method: "POST", body: formData });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { const d = await res.json(); if (d.detail) message = d.detail; } catch {}
      throw new Error(message);
    }
    return res.json();
  },
};

// ---- カテゴリ ----

export const categoriesApi = {
  /** カテゴリ一覧を取得 */
  get: () => apiFetch("/categories"),

  /** カテゴリ一覧を保存（全件上書き） */
  save: (categories) =>
    apiFetch("/categories", { method: "PUT", body: { categories } }),
};

// ---- リマインダー（今日意識すること） ----

export const remindersApi = {
  /** リマインダー一覧を取得 */
  get: () => apiFetch("/reminders"),

  /** リマインダー一覧を保存（全件上書き） */
  save: (items) =>
    apiFetch("/reminders", { method: "PUT", body: { items } }),
};

// ---- やりたいことリスト ----

export const wishlistApi = {
  /** 項目作成 */
  create: (data) =>
    apiFetch("/wishlist", { method: "POST", body: data }),

  /** 一覧取得(completed=true/false でフィルタ。省略で全件) */
  list: (completed) => {
    const params = new URLSearchParams();
    if (completed !== undefined && completed !== null) {
      params.set("completed", completed ? "true" : "false");
    }
    const qs = params.toString();
    return apiFetch(`/wishlist${qs ? `?${qs}` : ""}`);
  },

  /** 単一取得 */
  get: (itemId) => apiFetch(`/wishlist/${itemId}`),

  /** 更新 */
  update: (itemId, data) =>
    apiFetch(`/wishlist/${itemId}`, { method: "PUT", body: data }),

  /** 削除 */
  delete: (itemId) =>
    apiFetch(`/wishlist/${itemId}`, { method: "DELETE" }),

  /** 達成/未達成 マーク */
  complete: (itemId, completed) =>
    apiFetch(`/wishlist/${itemId}/complete`, {
      method: "PUT",
      body: { completed },
    }),
};

// ---- ありがたいノート ----

export const gratitudeApi = {
  /** エントリ作成 */
  create: (content) =>
    apiFetch("/gratitude", { method: "POST", body: { content } }),

  /** 全件取得（新しい順） */
  list: () => apiFetch("/gratitude"),

  /** 最新 N 件取得（ホーム表示用） */
  recent: (limit = 3) => apiFetch(`/gratitude/recent?limit=${limit}`),

  /** 単一取得 */
  get: (entryId) => apiFetch(`/gratitude/${entryId}`),

  /** 更新 */
  update: (entryId, content) =>
    apiFetch(`/gratitude/${entryId}`, { method: "PUT", body: { content } }),

  /** 削除 */
  delete: (entryId) => apiFetch(`/gratitude/${entryId}`, { method: "DELETE" }),
};

// ---- 月次サマリー ----

export const summariesApi = {
  /** 月次サマリー生成 */
  generate: (yearMonth) =>
    apiFetch(`/summaries/generate/${yearMonth}`, { method: "POST" }),

  /** 月次サマリー取得 */
  get: (yearMonth) => apiFetch(`/summaries/${yearMonth}`),

  /** サマリー一覧 */
  list: () => apiFetch("/summaries"),
};
