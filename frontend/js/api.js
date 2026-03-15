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

// ---- コーチングチャット ----

export const coachApi = {
  /** コーチとチャット */
  chat: (message, conversationHistory = []) =>
    apiFetch("/coach/chat", {
      method: "POST",
      body: { message, conversation_history: conversationHistory },
    }),
};

// ---- ナレッジグラフ ----

export const knowledgeApi = {
  /** エンティティ一覧 */
  listEntities: (entityType, status, limit = 50) => {
    const params = new URLSearchParams();
    if (entityType) params.set("entity_type", entityType);
    if (status) params.set("status", status);
    params.set("limit", limit);
    return apiFetch(`/knowledge/entities?${params}`);
  },

  /** エンティティ詳細 */
  getEntity: (id) => apiFetch(`/knowledge/entities/${id}`),

  /** エンティティ削除 */
  deleteEntity: (id) => apiFetch(`/knowledge/entities/${id}`, { method: "DELETE" }),

  /** リレーション一覧 */
  listRelations: (minStrength, limit = 50) => {
    const params = new URLSearchParams();
    if (minStrength != null) params.set("min_strength", minStrength);
    params.set("limit", limit);
    return apiFetch(`/knowledge/relations?${params}`);
  },

  /** リレーション削除 */
  deleteRelation: (id) => apiFetch(`/knowledge/relations/${id}`, { method: "DELETE" }),

  /** サマリー統計 */
  summary: () => apiFetch("/knowledge/summary"),
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
  getEntry: (entryId) => apiFetch(`/journal/entry/${entryId}`),

  /** エントリ更新 */
  update: (entryId, content) =>
    apiFetch(`/journal/entry/${entryId}`, { method: "PUT", body: { content } }),

  /** エントリ削除 */
  delete: (entryId) =>
    apiFetch(`/journal/entry/${entryId}`, { method: "DELETE" }),

  /** AI分析を実行 */
  analyze: (entryId) =>
    apiFetch(`/journal/entry/${entryId}/analyze`, { method: "POST" }),

  /** マークダウン要約を生成 */
  summarize: (entryId) =>
    apiFetch(`/journal/entry/${entryId}/summarize`, { method: "POST" }),

  /** 週次ダイジェスト取得 */
  getDigest: (weekId) => apiFetch(`/journal/digest/${weekId}`),

  /** 週次ダイジェスト生成 */
  generateDigest: (weekId) =>
    apiFetch(`/journal/digest/${weekId}/generate`, { method: "POST" }),
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
