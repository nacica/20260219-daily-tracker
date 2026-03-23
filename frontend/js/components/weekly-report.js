/**
 * 週次レポートコンポーネント
 * 週次分析結果の表示・生成
 */

const API_BASE = window.API_BASE_URL || "http://localhost:8000/api/v1";

/**
 * 週次レポートをメインエリアに描画する
 * @param {string} weekId - 週 ID (YYYY-Www)
 */
export async function renderWeeklyReport(weekId) {
  const main = document.querySelector("main");

  // weekId が未指定の場合は今週を使う
  if (!weekId) weekId = getCurrentWeekId();

  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>週次レポートを読み込み中...</p></div>`;

  try {
    const res = await fetch(`${API_BASE}/weekly/${weekId}`);
    if (!res.ok) throw new Error("not_found");
    const data = await res.json();
    main.innerHTML = buildWeeklyHTML(data, weekId);
    attachWeeklyEvents(weekId);
  } catch (err) {
    main.innerHTML = buildNoWeeklyHTML(weekId);
    attachWeeklyEvents(weekId);
  }
}

function buildWeeklyHTML(data, weekId) {
  const { week_start, week_end, weekly_summary: s, deep_analysis: d } = data;
  const score = s?.avg_overall_score ?? 0;
  const scoreClass = score >= 70 ? "good" : score >= 40 ? "mid" : "bad";
  const trendIcon = { improving: "📈", declining: "📉", stable: "➡️" }[s?.score_trend] ?? "➡️";
  const trendLabel = { improving: "改善中", declining: "悪化中", stable: "横ばい" }[s?.score_trend] ?? "-";

  return `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
      <h2 style="font-size:1.1rem;">週次レポート</h2>
      <button class="btn btn-outline btn-sm" id="btn-regenerate-weekly">🔄 再分析</button>
    </div>
    <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:var(--gap);">
      ${formatWeekLabel(weekId)}
    </p>

    <!-- 週ナビゲーション -->
    <div class="card">
      <div style="display:flex; gap:10px;">
        <button class="btn btn-outline btn-sm" id="btn-prev-week" style="flex:1;">← 先週</button>
        <button class="btn btn-outline btn-sm" id="btn-next-week" style="flex:1;">今週 →</button>
      </div>
    </div>

    <!-- サマリー -->
    <div class="card">
      <div class="card-title">週間サマリー</div>
      <div class="score-circle ${scoreClass}" style="margin-bottom:12px;">
        <span class="score-value">${score}</span>
        <span class="score-label">週平均スコア</span>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${(s?.avg_productive_hours ?? 0).toFixed(1)}<small style="font-size:0.7rem">h</small></div>
          <div class="stat-label">平均生産</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${(s?.avg_wasted_hours ?? 0).toFixed(1)}<small style="font-size:0.7rem">h</small></div>
          <div class="stat-label">平均無駄</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${(s?.total_youtube_hours ?? 0).toFixed(1)}<small style="font-size:0.7rem">h</small></div>
          <div class="stat-label">YouTube合計</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${Math.round((s?.avg_task_completion_rate ?? 0) * 100)}<small style="font-size:0.7rem">%</small></div>
          <div class="stat-label">タスク完了率</div>
        </div>
      </div>
      <div style="text-align:center; font-size:0.9rem; color:var(--text-muted); margin-top:4px;">
        ${trendIcon} ${trendLabel}
      </div>
    </div>

    <!-- 週パターン -->
    ${d?.weekly_pattern ? `
    <div class="card">
      <div class="card-title">週全体のパターン</div>
      <p style="font-size:0.92rem; line-height:1.6;">${esc(d.weekly_pattern)}</p>
    </div>` : ""}

    <!-- 最大の時間泥棒 -->
    ${buildTimewastersSection(d?.biggest_time_wasters)}

    <!-- 認知パターン -->
    ${buildListCard("🧠 認知パターン分析", d?.cognitive_patterns, "cause")}

    <!-- 改善プラン -->
    ${buildImprovementPlanSection(d?.improvement_plan)}

    <!-- 前週比較 -->
    ${buildProgressSection(d?.progress_vs_last_week)}

  `;
}

function buildTimewastersSection(timewasters) {
  if (!timewasters || timewasters.length === 0) return "";
  return `
    <div class="card">
      <div class="card-title">⏰ 最大の時間泥棒</div>
      ${timewasters.map((t) => `
        <div class="suggestion-card high" style="margin-bottom:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
            <span style="font-weight:700;">${esc(t.activity)}</span>
            <span class="badge badge-high">${t.total_hours?.toFixed(1) ?? "?"}h</span>
          </div>
          <p style="font-size:0.85rem; color:var(--text-muted);">トリガー: ${esc(t.trigger)}</p>
        </div>`).join("")}
    </div>`;
}

function buildImprovementPlanSection(plan) {
  if (!plan) return "";
  return `
    <div class="card">
      <div class="card-title">📋 来週の改善プラン</div>
      ${plan.next_week_goals?.length ? `
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px; font-weight:600;">目標</p>
        <ul class="analysis-list tip" style="margin-bottom:16px;">
          ${plan.next_week_goals.map((g) => `<li>${esc(g)}</li>`).join("")}
        </ul>` : ""}
      ${plan.concrete_actions?.length ? `
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px; font-weight:600;">具体的なアクション</p>
        <ul class="analysis-list tip" style="margin-bottom:16px;">
          ${plan.concrete_actions.map((a) => `<li>${esc(a)}</li>`).join("")}
        </ul>` : ""}
      ${plan.habit_building?.length ? `
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px; font-weight:600;">習慣形成</p>
        <ul class="analysis-list good">
          ${plan.habit_building.map((h) => `<li>${esc(h)}</li>`).join("")}
        </ul>` : ""}
    </div>`;
}

function buildProgressSection(progress) {
  if (!progress) return "";
  const hasImproved = progress.improved?.length > 0;
  const hasDeclined = progress.declined?.length > 0;
  const hasUnchanged = progress.unchanged?.length > 0;
  if (!hasImproved && !hasDeclined && !hasUnchanged) return "";

  return `
    <div class="card">
      <div class="card-title">📊 前週比較</div>
      ${hasImproved ? `
        <p style="font-size:0.8rem; color:var(--score-good); margin-bottom:6px; font-weight:600;">✅ 改善した点</p>
        <ul class="analysis-list good" style="margin-bottom:12px;">
          ${progress.improved.map((i) => `<li>${esc(i)}</li>`).join("")}
        </ul>` : ""}
      ${hasDeclined ? `
        <p style="font-size:0.8rem; color:var(--score-bad); margin-bottom:6px; font-weight:600;">❌ 悪化した点</p>
        <ul class="analysis-list bad" style="margin-bottom:12px;">
          ${progress.declined.map((i) => `<li>${esc(i)}</li>`).join("")}
        </ul>` : ""}
      ${hasUnchanged ? `
        <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:6px; font-weight:600;">➡️ 変化なし</p>
        <ul class="analysis-list" style="margin-bottom:0;">
          ${progress.unchanged.map((i) => `<li>${esc(i)}</li>`).join("")}
        </ul>` : ""}
    </div>`;
}

function buildListCard(title, items, cssClass) {
  if (!items || items.length === 0) return "";
  return `
    <div class="card">
      <div class="analysis-section">
        <h3>${title}</h3>
        <ul class="analysis-list ${cssClass}">
          ${items.map((item) => `<li>${esc(item)}</li>`).join("")}
        </ul>
      </div>
    </div>`;
}

function buildNoWeeklyHTML(weekId) {
  return `
    <h2 style="margin-bottom:4px;">週次レポート</h2>
    <p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:var(--gap);">${formatWeekLabel(weekId)}</p>
    <div class="empty-state">
      <div class="icon">📊</div>
      <p>この週の分析はまだ生成されていません。<br>日次記録が揃ったら分析を実行してください。</p>
      <button class="btn btn-primary" id="btn-generate-weekly" style="max-width:320px;">
        🤖 週次分析を生成する
      </button>
    </div>`;
}

function attachWeeklyEvents(weekId) {
  // 生成ボタン
  ["btn-generate-weekly", "btn-regenerate-weekly"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener("click", async (e) => {
      e.target.disabled = true;
      const orig = e.target.textContent;
      e.target.textContent = "分析中...";
      try {
        const res = await fetch(`${API_BASE}/weekly/${weekId}/generate`, { method: "POST" });
        if (!res.ok) throw new Error((await res.json()).detail || `HTTP ${res.status}`);
        import("../app.js").then(({ showToast }) => showToast("週次分析が完了しました！", "success"));
        await renderWeeklyReport(weekId);
      } catch (err) {
        import("../app.js").then(({ showToast }) => showToast(`分析に失敗: ${err.message}`, "error"));
        e.target.disabled = false;
        e.target.textContent = orig;
      }
    });
  });

  // 週ナビゲーション
  const prevBtn = document.getElementById("btn-prev-week");
  const nextBtn = document.getElementById("btn-next-week");
  if (prevBtn) prevBtn.addEventListener("click", () => {
    window.location.hash = `/weekly/${prevWeekId(weekId)}`;
  });
  if (nextBtn) nextBtn.addEventListener("click", () => {
    window.location.hash = `/weekly/${getCurrentWeekId()}`;
  });
}

// ---- ユーティリティ ----

function getCurrentWeekId() {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const startOfWeek = new Date(jan4);
  startOfWeek.setDate(jan4.getDate() - jan4.getDay() + 1);
  const diff = now - startOfWeek;
  const weekNum = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;

  // ISO week year
  const d = new Date(now);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round(((d - yearStart) / 86400000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function prevWeekId(weekId) {
  const [year, week] = weekId.split("-W").map(Number);
  if (week > 1) return `${year}-W${String(week - 1).padStart(2, "0")}`;
  return `${year - 1}-W52`;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function weekIdToMonday(weekId) {
  const [year, week] = weekId.split("-W").map(Number);
  const jan4 = new Date(year, 0, 4);
  const mondayW1 = new Date(jan4);
  mondayW1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const monday = new Date(mondayW1);
  monday.setDate(mondayW1.getDate() + (week - 1) * 7);
  return monday;
}

function formatWeekLabel(weekId) {
  const monday = weekIdToMonday(weekId);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const month = monday.getMonth() + 1;
  const weekOfMonth = Math.ceil(monday.getDate() / 7);
  return `${month}月 第${weekOfMonth}週（${monday.getMonth() + 1}/${monday.getDate()}〜${sunday.getMonth() + 1}/${sunday.getDate()}）`;
}

function esc(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
