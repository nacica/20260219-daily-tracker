/**
 * 月次レポート画面 (/monthly/:yearMonth)
 * coaching_summaries の内容を表示する
 */

import { summariesApi } from "../api.js?v=20260424g";
import { showToast } from "../app.js?v=20260424g";

/** メインコンテンツエリアを返す */
function getMain() {
  return document.querySelector("main");
}

/** 今月の YYYY-MM を返す */
function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** 前月の YYYY-MM を返す */
function prevYearMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** トレンドアイコン */
function trendIcon(trend) {
  if (trend === "improving") return '<span class="trend-up">↑ 改善中</span>';
  if (trend === "worsening") return '<span class="trend-down">↓ 悪化中</span>';
  return '<span class="trend-stable">→ 横ばい</span>';
}

/**
 * 月次レポート画面をレンダリング
 */
export async function renderMonthlyReport(yearMonth) {
  const main = getMain();
  const targetMonth = yearMonth || prevYearMonth(currentYearMonth());

  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>${targetMonth} のレポートを読み込み中...</p>
    </div>`;

  try {
    const summary = await summariesApi.get(targetMonth);
    _renderSummary(main, summary, targetMonth);
  } catch (err) {
    // サマリーがない場合は生成を提案
    main.innerHTML = `
      <div class="monthly-container">
        <div class="monthly-header">
          <h2 class="monthly-title">${targetMonth} 月次レポート</h2>
          <div class="monthly-nav">
            <button class="btn btn-outline btn-sm" onclick="window.location.hash='/monthly/${prevYearMonth(targetMonth)}'">前月</button>
          </div>
        </div>
        <div class="empty-state">
          <div class="icon">📊</div>
          <h3>${targetMonth} のレポートはまだありません</h3>
          <p>日次分析データから月次レポートを自動生成できます。</p>
          <button class="btn btn-primary" id="btn-generate-monthly">
            レポートを生成する
          </button>
        </div>
      </div>
    `;
    document.getElementById("btn-generate-monthly")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "生成中...";
      try {
        const result = await summariesApi.generate(targetMonth);
        showToast("月次レポートを生成しました！", "success");
        _renderSummary(main, result, targetMonth);
      } catch (genErr) {
        showToast(`生成エラー: ${genErr.message}`, "error");
        e.target.disabled = false;
        e.target.textContent = "レポートを生成する";
      }
    });
  }
}

function _renderSummary(main, summary, targetMonth) {
  const emo = summary.emotional_summary || {};
  const effectiveness = summary.coaching_effectiveness || {};

  main.innerHTML = `
    <div class="monthly-container">
      <div class="monthly-header">
        <h2 class="monthly-title">${summary.period || targetMonth} 月次レポート</h2>
        <div class="monthly-nav">
          <button class="btn btn-outline btn-sm" onclick="window.location.hash='/monthly/${prevYearMonth(targetMonth)}'">前月</button>
          <button class="btn btn-outline btn-sm" onclick="window.location.hash='/coach'">コーチに相談</button>
        </div>
      </div>

      <!-- 感情サマリー -->
      <div class="card">
        <div class="card-title">感情・コンディション</div>
        <div class="monthly-emotion">
          <div class="monthly-score-circle ${_scoreClass(emo.average_score)}">
            <span class="score-value">${(emo.average_score || 0).toFixed(1)}</span>
            <span class="score-label">平均スコア</span>
          </div>
          <div class="monthly-emotion-details">
            ${emo.best_day_pattern ? `<div class="monthly-detail-item"><span class="trend-up">Best:</span> ${_esc(emo.best_day_pattern)}</div>` : ""}
            ${emo.worst_day_pattern ? `<div class="monthly-detail-item"><span class="trend-down">Worst:</span> ${_esc(emo.worst_day_pattern)}</div>` : ""}
          </div>
        </div>
      </div>

      <!-- パターン -->
      ${(summary.top_patterns || []).length > 0 ? `
        <div class="card">
          <div class="card-title">主なパターン</div>
          <div class="monthly-patterns">
            ${(summary.top_patterns || []).map(p => `
              <div class="monthly-pattern-item">
                <div class="monthly-pattern-name">${_esc(p.pattern)}</div>
                <div class="monthly-pattern-meta">
                  頻度 ${p.frequency}回 ${trendIcon(p.trend)}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- 目標進捗 -->
      ${(summary.goals_progress || []).length > 0 ? `
        <div class="card">
          <div class="card-title">目標進捗</div>
          ${(summary.goals_progress || []).map(g => `
            <div class="monthly-goal">
              <div class="monthly-goal-header">
                <span class="monthly-goal-name">${_esc(g.goal)}</span>
                <span class="monthly-goal-pct">${g.progress_percentage}%</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${_progressClass(g.progress_percentage)}" style="width:${g.progress_percentage}%"></div>
              </div>
              ${g.achievements?.length ? `<div class="monthly-goal-achievements">達成: ${g.achievements.map(a => _esc(a)).join(", ")}</div>` : ""}
              ${g.blockers?.length ? `<div class="monthly-goal-blockers">阻害: ${g.blockers.map(b => _esc(b)).join(", ")}</div>` : ""}
            </div>
          `).join("")}
        </div>
      ` : ""}

      <!-- 重要な気づき -->
      ${(summary.key_insights || []).length > 0 ? `
        <div class="card">
          <div class="card-title">重要な気づき</div>
          <ul class="monthly-insights">
            ${(summary.key_insights || []).map(i => `<li>${_esc(i)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}

      <!-- コーチング効果 -->
      ${effectiveness.most_effective_advice ? `
        <div class="card">
          <div class="card-title">コーチング効果</div>
          <div class="monthly-effectiveness">
            <div class="monthly-detail-item">
              <span class="monthly-detail-label">アドバイス実行率:</span>
              <span>${((effectiveness.advice_followed_rate || 0) * 100).toFixed(0)}%</span>
            </div>
            ${effectiveness.most_effective_advice ? `
              <div class="monthly-detail-item">
                <span class="trend-up">最も効果的:</span> ${_esc(effectiveness.most_effective_advice)}
              </div>
            ` : ""}
            ${effectiveness.least_effective_advice ? `
              <div class="monthly-detail-item">
                <span class="trend-down">効果が薄い:</span> ${_esc(effectiveness.least_effective_advice)}
              </div>
            ` : ""}
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function _scoreClass(score) {
  if (score >= 70) return "good";
  if (score >= 40) return "mid";
  return "bad";
}

function _progressClass(pct) {
  if (pct >= 70) return "progress-good";
  if (pct >= 40) return "progress-mid";
  return "progress-low";
}

function _esc(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
