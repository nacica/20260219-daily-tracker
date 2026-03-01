/**
 * アプリのメインロジック
 * ルーティングの設定とホーム画面の表示を担当する
 */

import { addRoute, navigate, updateNavActive } from "./router.js?v=20260301d";
import { renderInputForm } from "./components/input-form.js?v=20260301d";
import { renderAnalysisView } from "./components/analysis-view.js?v=20260301d";
import { renderHistoryList } from "./components/history-list.js?v=20260301d";
import { renderWeeklyReport } from "./components/weekly-report.js?v=20260301d";
import { renderSuggestions } from "./components/suggestions.js?v=20260301d";
import { renderCoachingChat } from "./components/coaching-chat.js?v=20260301d";
import { renderKnowledgeGraph } from "./components/knowledge-graph.js?v=20260301d";
import { renderMonthlyReport } from "./components/monthly-report.js?v=20260301d";
import { recordsApi, analysisApi } from "./api.js?v=20260301d";
import { initSwipeNav } from "./swipe-nav.js?v=20260301d";

// ===== ユーティリティ =====

/** 今日の日付を YYYY-MM-DD 形式で返す */
function today() {
  return new Date().toLocaleDateString("sv-SE"); // "2026-02-19"
}

/** 日付を日本語表記にフォーマット */
function formatDateJP(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

/** メインコンテンツエリアを返す */
function getMain() {
  return document.querySelector("main");
}

// ===== デスクトップヘッダー更新 =====

/** ルート名マッピング */
const ROUTE_TITLES = {
  "/": { title: "ダッシュボード", breadcrumb: "ホーム" },
  "/input": { title: "行動記録", breadcrumb: "記録入力" },
  "/history": { title: "履歴一覧", breadcrumb: "履歴" },
  "/weekly": { title: "週次レポート", breadcrumb: "週次分析" },
  "/suggestions": { title: "改善提案", breadcrumb: "提案アーカイブ" },
  "/coach": { title: "コーチング", breadcrumb: "パーソナルコーチ" },
  "/knowledge": { title: "ナレッジグラフ", breadcrumb: "行動パターン" },
  "/monthly": { title: "月次レポート", breadcrumb: "月次サマリー" },
};

/** デスクトップヘッダーのタイトルと日付を更新 */
function updateDesktopHeader() {
  const titleEl = document.getElementById("desktop-page-title");
  const breadcrumbEl = document.getElementById("desktop-breadcrumb");
  const dateEl = document.getElementById("desktop-date");
  if (!titleEl) return;

  const hash = window.location.hash.slice(1) || "/";
  // ルートの先頭部分でマッチ（/input/:date → /input）
  const baseRoute = "/" + (hash.split("/")[1] || "");
  const route = ROUTE_TITLES[baseRoute] || ROUTE_TITLES["/"];

  titleEl.textContent = route.title;
  breadcrumbEl.textContent = route.breadcrumb;

  // 日付表示
  const now = new Date();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${weekdays[now.getDay()]}）`;
}

/** ローディング表示 */
function showLoading(message = "読み込み中...") {
  getMain().innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>`;
}

/** トースト通知を表示 */
export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icon = type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";

  if (type === "error") {
    toast.innerHTML = `<span>${icon}</span><span class="toast-msg">${message}</span><button class="toast-copy" title="コピー">📋</button>`;
    const copyBtn = toast.querySelector(".toast-copy");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(message).then(() => {
        copyBtn.textContent = "✅";
        setTimeout(() => { copyBtn.textContent = "📋"; }, 1500);
      });
    });
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
  } else {
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

// ===== ホーム画面 =====

async function renderHome() {
  const todayStr = today();
  showLoading("今日のデータを確認中...");

  try {
    // 今日の記録と分析を並行取得
    const [record, analysis] = await Promise.allSettled([
      recordsApi.get(todayStr),
      analysisApi.get(todayStr),
    ]);

    const hasRecord = record.status === "fulfilled";
    const hasAnalysis = analysis.status === "fulfilled";

    getMain().innerHTML = `
      <div class="home-date">${formatDateJP(todayStr)}</div>
      <h1 class="home-title">今日の行動分析</h1>
      ${hasAnalysis ? buildHomeSummary(analysis.value) : ""}
      ${buildHomeActions(hasRecord, hasAnalysis, todayStr)}
    `;
  } catch (e) {
    getMain().innerHTML = `
      <div class="empty-state">
        <div class="icon">📝</div>
        <p>今日の記録はまだありません。<br>行動記録を入力して分析を始めましょう。</p>
        <button class="btn btn-primary" onclick="window.location.hash='/input'">記録を入力する</button>
      </div>`;
  }
}

function buildHomeSummary(analysis) {
  const score = analysis.summary.overall_score;
  const scoreClass = score >= 70 ? "good" : score >= 40 ? "mid" : "bad";
  const scoreLabel = score >= 70 ? "良い一日" : score >= 40 ? "まあまあ" : "要改善";

  return `
    <div class="card">
      <div class="card-title">今日のスコア</div>
      <div class="score-circle ${scoreClass}">
        <span class="score-value">${score}</span>
        <span class="score-label">${scoreLabel}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${analysis.summary.productive_hours.toFixed(1)}</div>
          <div class="stat-label">生産的（h）</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${analysis.summary.wasted_hours.toFixed(1)}</div>
          <div class="stat-label">無駄（h）</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${Math.round(analysis.summary.task_completion_rate * 100)}%</div>
          <div class="stat-label">タスク完了率</div>
        </div>
      </div>
      <button class="btn btn-outline btn-sm" onclick="window.location.hash='/analysis/${analysis.date}'">
        詳細を見る →
      </button>
    </div>`;
}

function buildHomeActions(hasRecord, hasAnalysis, date) {
  if (!hasRecord) {
    return `
      <div class="card">
        <div class="card-title">今日の記録</div>
        <div class="empty-state" style="padding: 24px 0;">
          <div class="icon">✏️</div>
          <p>まだ今日の記録がありません</p>
        </div>
        <button class="btn btn-primary" onclick="window.location.hash='/input'">
          行動を記録する
        </button>
      </div>`;
  }

  if (!hasAnalysis) {
    return `
      <div class="card">
        <div class="card-title">AI 分析</div>
        <p style="color: var(--text-muted); margin-bottom: 16px; font-size: 0.9rem;">
          記録済みです。AIによる分析を実行しましょう。
        </p>
        <button class="btn btn-primary" id="btn-generate-analysis">
          🤖 AI で分析する
        </button>
      </div>`;
  }

  return `
    <div class="card">
      <div class="card-title">アクション</div>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash='/input'">記録を編集</button>
        <button class="btn btn-outline btn-sm" id="btn-regenerate">分析を再実行</button>
      </div>
    </div>`;
}

// ===== イベント委任（動的ボタン用）=====

document.addEventListener("click", async (e) => {
  if (e.target.id === "btn-generate-analysis" || e.target.id === "btn-regenerate") {
    const todayStr = today();
    e.target.disabled = true;
    e.target.textContent = "分析中...";
    try {
      await analysisApi.generate(todayStr);
      showToast("分析が完了しました！", "success");
      window.location.hash = `/analysis/${todayStr}`;
    } catch (err) {
      showToast(`分析に失敗しました: ${err.message}`, "error");
      e.target.disabled = false;
      e.target.textContent = "🤖 AI で分析する";
    }
  }
});

// ===== ルーティング設定 =====

addRoute("/", () => renderHome());
addRoute("/input", () => renderInputForm(today()));
addRoute("/input/:date", ({ date }) => renderInputForm(date));
addRoute("/analysis/:date", ({ date }) => renderAnalysisView(date));
addRoute("/history", () => renderHistoryList());
addRoute("/weekly", () => renderWeeklyReport(null));
addRoute("/weekly/:weekId", ({ weekId }) => renderWeeklyReport(weekId));
addRoute("/suggestions", () => renderSuggestions());
addRoute("/coach", () => renderCoachingChat());
addRoute("/knowledge", () => renderKnowledgeGraph());
addRoute("/monthly", () => renderMonthlyReport(null));
addRoute("/monthly/:yearMonth", ({ yearMonth }) => renderMonthlyReport(yearMonth));

// ===== 初期化 =====

document.addEventListener("DOMContentLoaded", () => {
  // Service Worker 登録
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // 初回ナビゲーション
  navigate();
  updateNavActive();
  updateDesktopHeader();

  // モバイルスワイプナビゲーション
  initSwipeNav();
});

// ハッシュ変更時にデスクトップヘッダーも更新
window.addEventListener("hashchange", updateDesktopHeader);
