/**
 * 分析結果表示コンポーネント
 * 日次分析データを視覚的に表示する
 */

import { analysisApi } from "../api.js";
import { showToast } from "../app.js";

/**
 * 分析結果をメインエリアにレンダリングする
 * @param {string} date - 対象日 (YYYY-MM-DD)
 */
export async function renderAnalysisView(date) {
  const main = document.querySelector("main");
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>分析結果を読み込み中...</p>
    </div>`;

  try {
    const analysis = await analysisApi.get(date);
    main.innerHTML = buildAnalysisHTML(analysis);
    attachAnalysisEvents(date);
  } catch (err) {
    main.innerHTML = buildNoAnalysisHTML(date, err.message);
  }
}

function buildAnalysisHTML(analysis) {
  const { date, summary, analysis: detail } = analysis;
  const score = summary.overall_score;
  const scoreClass = score >= 70 ? "good" : score >= 40 ? "mid" : "bad";
  const scoreLabel = score >= 70 ? "良い一日" : score >= 40 ? "まあまあ" : "要改善";

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });

  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
      <h2 style="font-size: 1.1rem;">分析結果</h2>
      <button class="btn btn-outline btn-sm" onclick="window.location.hash='/input/${date}'">記録を編集</button>
    </div>
    <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: var(--gap);">${dateLabel}</p>

    <!-- スコア -->
    <div class="card">
      <div class="card-title">総合スコア</div>
      <div class="score-circle ${scoreClass}">
        <span class="score-value">${score}</span>
        <span class="score-label">${scoreLabel}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${summary.productive_hours.toFixed(1)}<small style="font-size:0.7rem">h</small></div>
          <div class="stat-label">生産的</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${summary.wasted_hours.toFixed(1)}<small style="font-size:0.7rem">h</small></div>
          <div class="stat-label">無駄時間</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${summary.youtube_hours.toFixed(1)}<small style="font-size:0.7rem">h</small></div>
          <div class="stat-label">YouTube</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${Math.round(summary.task_completion_rate * 100)}<small style="font-size:0.7rem">%</small></div>
          <div class="stat-label">タスク完了</div>
        </div>
      </div>
    </div>

    <!-- 良かった点 -->
    ${buildListSection("✅ 良かった点", detail.good_points, "good")}

    <!-- 悪かった点 -->
    ${buildListSection("❌ 改善が必要な点", detail.bad_points, "bad")}

    <!-- 根本原因 -->
    ${buildListSection("🔍 根本原因の分析", detail.root_causes, "cause")}

    <!-- 思考の弱み -->
    ${detail.thinking_weaknesses.length > 0 ? buildListSection("🧠 思考パターンの弱み", detail.thinking_weaknesses, "cause") : ""}

    <!-- 行動の弱み -->
    ${detail.behavior_weaknesses.length > 0 ? buildListSection("🔄 行動パターンの弱み", detail.behavior_weaknesses, "cause") : ""}

    <!-- 改善提案 -->
    ${buildSuggestionsSection(detail.improvement_suggestions)}

    <!-- 過去との比較 -->
    ${buildComparisonSection(detail.comparison_with_past)}

    <!-- 再分析ボタン -->
    <div class="card">
      <button class="btn btn-outline btn-sm" id="btn-regenerate" style="width: 100%;">
        🔄 分析を再実行する
      </button>
    </div>
  `;
}

function buildListSection(title, items, cssClass) {
  if (!items || items.length === 0) return "";
  return `
    <div class="card">
      <div class="analysis-section">
        <h3>${title}</h3>
        <ul class="analysis-list ${cssClass}">
          ${items.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}
        </ul>
      </div>
    </div>`;
}

function buildSuggestionsSection(suggestions) {
  if (!suggestions || suggestions.length === 0) return "";

  const priorityLabel = { high: "高", medium: "中", low: "低" };
  const priorityBadge = { high: "badge-high", medium: "badge-medium", low: "badge-low" };

  return `
    <div class="card">
      <div class="analysis-section">
        <h3>💡 改善提案</h3>
        ${suggestions.map((s) => `
          <div class="suggestion-card ${s.priority}">
            <div class="suggestion-meta">
              <span class="badge ${priorityBadge[s.priority] || "badge-low"}">
                優先度：${priorityLabel[s.priority] || s.priority}
              </span>
              <span class="badge badge-cat">${escapeHTML(s.category)}</span>
            </div>
            <p class="suggestion-text">${escapeHTML(s.suggestion)}</p>
          </div>
        `).join("")}
      </div>
    </div>`;
}

function buildComparisonSection(comparison) {
  if (!comparison) return "";
  const hasPatterns = comparison.recurring_patterns?.length > 0;
  const hasImprovements = comparison.improvements_from_last_week?.length > 0;
  if (!hasPatterns && !hasImprovements) return "";

  return `
    <div class="card">
      <div class="analysis-section">
        <h3>📈 過去との比較</h3>
        ${hasPatterns ? `
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">繰り返しパターン</p>
          <ul class="analysis-list bad" style="margin-bottom: 16px;">
            ${comparison.recurring_patterns.map((p) => `<li>${escapeHTML(p)}</li>`).join("")}
          </ul>` : ""}
        ${hasImprovements ? `
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px;">先週からの改善</p>
          <ul class="analysis-list good">
            ${comparison.improvements_from_last_week.map((p) => `<li>${escapeHTML(p)}</li>`).join("")}
          </ul>` : ""}
      </div>
    </div>`;
}

function buildNoAnalysisHTML(date, errorMsg) {
  const is404 = errorMsg.includes("404") || errorMsg.includes("見つかりません");
  return `
    <div class="empty-state">
      <div class="icon">${is404 ? "📊" : "⚠️"}</div>
      <p>${is404 ? "この日の分析はまだ生成されていません。" : `エラーが発生しました: ${errorMsg}`}</p>
      ${is404 ? `
        <button class="btn btn-primary" id="btn-generate-now" style="max-width: 320px;">
          🤖 今すぐ分析する
        </button>
        <button class="btn btn-outline" style="margin-top: 10px; max-width: 320px;"
          onclick="window.location.hash='/input/${date}'">
          記録を入力する
        </button>` : `
        <button class="btn btn-outline" onclick="window.location.hash='/'">ホームへ戻る</button>`}
    </div>`;
}

function attachAnalysisEvents(date) {
  const btnRegenerate = document.getElementById("btn-regenerate");
  if (btnRegenerate) {
    btnRegenerate.addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "分析中...";
      try {
        await analysisApi.generate(date);
        showToast("分析を再実行しました！", "success");
        await renderAnalysisView(date);
      } catch (err) {
        showToast(`分析に失敗しました: ${err.message}`, "error");
        e.target.disabled = false;
        e.target.textContent = "🔄 分析を再実行する";
      }
    });
  }

  // 「今すぐ分析する」ボタン（記録なし画面）
  const btnGenerateNow = document.getElementById("btn-generate-now");
  if (btnGenerateNow) {
    btnGenerateNow.addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "分析中...";
      try {
        await analysisApi.generate(date);
        showToast("分析が完了しました！", "success");
        await renderAnalysisView(date);
      } catch (err) {
        showToast(`分析に失敗しました: ${err.message}`, "error");
        e.target.disabled = false;
        e.target.textContent = "🤖 今すぐ分析する";
      }
    });
  }
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
