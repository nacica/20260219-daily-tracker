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
      message = data.detail || message;
    } catch {}
    throw new Error(message);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ---- 行動記録 ----

export const recordsApi = {
  /** 行動記録を作成 */
  create: (date, rawInput, tasksPlanned = []) =>
    apiFetch("/records", {
      method: "POST",
      body: { date, raw_input: rawInput, tasks_planned: tasksPlanned },
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
