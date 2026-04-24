/**
 * 改善提案アーカイブコンポーネント
 * 過去の日次分析から改善提案を集約・フィルタリング表示する
 */

import { analysisApi } from "../api.js?v=20260424e";

/**
 * 改善提案アーカイブをメインエリアに描画する
 */
export async function renderSuggestions() {
  const main = document.querySelector("main");
  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>改善提案を読み込み中...</p></div>`;

  try {
    // 直近3ヶ月の分析データを取得
    const endDate = todayStr();
    const startDate = monthsAgo(3);
    const analyses = await analysisApi.list(startDate, endDate);

    if (!analyses || analyses.length === 0) {
      main.innerHTML = buildEmptyHTML();
      return;
    }

    // 全提案を集約
    const allSuggestions = collectSuggestions(analyses);
    main.innerHTML = buildSuggestionsHTML(allSuggestions, analyses.length);
    attachFilterEvents(allSuggestions);
  } catch (err) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="icon">💡</div>
        <p>データの取得に失敗しました: ${esc(err.message)}</p>
        <button class="btn btn-outline" onclick="window.location.hash='/'">ホームへ戻る</button>
      </div>`;
  }
}

/**
 * 分析リストから改善提案を集約する
 */
function collectSuggestions(analyses) {
  const suggestions = [];

  analyses.forEach((analysis) => {
    const items = analysis.analysis?.improvement_suggestions || [];
    items.forEach((s) => {
      suggestions.push({
        date: analysis.date,
        priority: s.priority || "low",
        category: s.category || "その他",
        suggestion: s.suggestion || "",
        score: analysis.summary?.overall_score ?? null,
      });
    });
  });

  // 日付降順・優先度順でソート
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => {
    const dateDiff = b.date.localeCompare(a.date);
    if (dateDiff !== 0) return dateDiff;
    return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
  });

  return suggestions;
}

function buildSuggestionsHTML(suggestions, analysesDays) {
  // カテゴリ・優先度の選択肢を収集
  const categories = [...new Set(suggestions.map((s) => s.category))].sort();
  const highCount = suggestions.filter((s) => s.priority === "high").length;
  const midCount  = suggestions.filter((s) => s.priority === "medium").length;
  const lowCount  = suggestions.filter((s) => s.priority === "low").length;

  return `
    <h2 style="margin-bottom:4px;">改善提案アーカイブ</h2>
    <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:var(--gap);">
      過去 ${analysesDays} 日の分析から ${suggestions.length} 件の提案
    </p>

    <!-- サマリーバー -->
    <div class="card" style="padding:16px;">
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <div class="suggest-summary-item high">
          <span class="badge badge-high">高</span>
          <span style="font-size:1.2rem; font-weight:700; margin-left:6px;">${highCount}</span>
          <span style="font-size:0.8rem; color:var(--text-muted); margin-left:4px;">件</span>
        </div>
        <div class="suggest-summary-item medium">
          <span class="badge badge-medium">中</span>
          <span style="font-size:1.2rem; font-weight:700; margin-left:6px;">${midCount}</span>
          <span style="font-size:0.8rem; color:var(--text-muted); margin-left:4px;">件</span>
        </div>
        <div class="suggest-summary-item low">
          <span class="badge badge-low">低</span>
          <span style="font-size:1.2rem; font-weight:700; margin-left:6px;">${lowCount}</span>
          <span style="font-size:0.8rem; color:var(--text-muted); margin-left:4px;">件</span>
        </div>
      </div>
    </div>

    <!-- フィルター -->
    <div class="card" style="padding:14px 16px;">
      <div class="card-title" style="margin-bottom:10px;">フィルター</div>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <div>
          <label style="font-size:0.78rem; margin-bottom:4px; display:block;">優先度</label>
          <div id="filter-priority" class="filter-btn-group">
            <button class="filter-btn active" data-priority="all">すべて</button>
            <button class="filter-btn" data-priority="high">高</button>
            <button class="filter-btn" data-priority="medium">中</button>
            <button class="filter-btn" data-priority="low">低</button>
          </div>
        </div>
        <div>
          <label style="font-size:0.78rem; margin-bottom:4px; display:block;">カテゴリ</label>
          <div id="filter-category" class="filter-btn-group">
            <button class="filter-btn active" data-category="all">すべて</button>
            ${categories.map((c) => `<button class="filter-btn" data-category="${esc(c)}">${esc(c)}</button>`).join("")}
          </div>
        </div>
      </div>
    </div>

    <!-- 提案一覧 -->
    <div id="suggestions-list">
      ${buildSuggestionItems(suggestions)}
    </div>`;
}

function buildSuggestionItems(suggestions) {
  if (suggestions.length === 0) {
    return `
      <div class="empty-state" style="padding:32px 16px;">
        <div class="icon">🔍</div>
        <p>条件に一致する提案がありません</p>
      </div>`;
  }

  const priorityLabel = { high: "高", medium: "中", low: "低" };
  const priorityBadge = { high: "badge-high", medium: "badge-medium", low: "badge-low" };

  return suggestions.map((s) => `
    <div class="card suggestion-card ${s.priority}" data-priority="${esc(s.priority)}" data-category="${esc(s.category)}" style="cursor:pointer;" onclick="window.location.hash='/analysis/${s.date}'">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <span class="badge ${priorityBadge[s.priority] || "badge-low"}">優先度：${priorityLabel[s.priority] || s.priority}</span>
          <span class="badge badge-cat">${esc(s.category)}</span>
        </div>
        <span style="font-size:0.75rem; color:var(--text-muted);">${formatDateShort(s.date)}</span>
      </div>
      <p style="font-size:0.92rem; line-height:1.55; color:var(--text-primary);">${esc(s.suggestion)}</p>
      ${s.score !== null ? `<div style="margin-top:6px; font-size:0.75rem; color:var(--text-muted);">その日のスコア: ${s.score}</div>` : ""}
    </div>`).join("");
}

function buildEmptyHTML() {
  return `
    <h2 style="margin-bottom:4px;">改善提案アーカイブ</h2>
    <div class="empty-state">
      <div class="icon">💡</div>
      <p>まだ分析データがありません。<br>行動を記録してAI分析を実行しましょう。</p>
      <button class="btn btn-primary" style="max-width:280px;" onclick="window.location.hash='/input'">
        記録を入力する
      </button>
    </div>`;
}

function attachFilterEvents(allSuggestions) {
  let currentPriority = "all";
  let currentCategory = "all";

  function applyFilter() {
    const filtered = allSuggestions.filter((s) => {
      const matchPriority = currentPriority === "all" || s.priority === currentPriority;
      const matchCategory = currentCategory === "all" || s.category === currentCategory;
      return matchPriority && matchCategory;
    });
    document.getElementById("suggestions-list").innerHTML = buildSuggestionItems(filtered);
  }

  // 優先度フィルター
  const priorityGroup = document.getElementById("filter-priority");
  if (priorityGroup) {
    priorityGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-priority]");
      if (!btn) return;
      priorityGroup.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPriority = btn.dataset.priority;
      applyFilter();
    });
  }

  // カテゴリフィルター
  const categoryGroup = document.getElementById("filter-category");
  if (categoryGroup) {
    categoryGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-category]");
      if (!btn) return;
      categoryGroup.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentCategory = btn.dataset.category;
      applyFilter();
    });
  }
}

// ---- ユーティリティ ----

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toLocaleDateString("sv-SE");
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
}

function esc(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
