/**
 * フリージャーナル コンポーネント
 * 自由記述の日記 + AI自動分析（感情タグ、ブロッカー検出、トレンド）
 */

import { journalApi } from "../api.js?v=20260306a";
import { showToast } from "../app.js?v=20260306a";

// ===== ユーティリティ =====

/** 日付を日本語表記にフォーマット */
function formatDateJP(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

/** 今日の日付 YYYY-MM-DD */
function today() {
  return new Date().toLocaleDateString("sv-SE");
}

/** 前日 */
function prevDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("sv-SE");
}

/** 翌日 */
function nextDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("sv-SE");
}

/** ISO 週番号を取得 (YYYY-Www) */
function getWeekId(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** 感情の正負を判定 */
function emotionValence(tag) {
  const positive = ["充実感", "やる気", "達成感", "感謝", "楽しさ", "安心", "集中"];
  const negative = ["焦り", "不安", "イライラ", "悲しみ", "孤独感"];
  if (positive.includes(tag)) return "positive";
  if (negative.includes(tag)) return "negative";
  return "neutral";
}

/** mood_score のランク */
function moodRank(score) {
  if (score >= 65) return "good";
  if (score >= 40) return "mid";
  return "bad";
}

// ===== メインレンダー =====

/**
 * ジャーナル画面をレンダリング
 * @param {string} date - 対象日 (YYYY-MM-DD)
 */
export async function renderJournal(date) {
  const main = document.querySelector("main");
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>読み込み中...</p>
    </div>`;

  // 並列でデータ取得
  const [journalResult, recentResult] = await Promise.allSettled([
    journalApi.get(date),
    journalApi.list(getMonthStart(date), date),
  ]);

  const journal = journalResult.status === "fulfilled" ? journalResult.value : null;
  const recentEntries = recentResult.status === "fulfilled" ? recentResult.value : [];

  // 月間ブロッカー集計
  const monthlyBlockers = aggregateBlockers(recentEntries);
  // 直近7日のエントリ（トレンド用）
  const last7 = recentEntries.filter((e) => e.is_analyzed).slice(0, 7).reverse();

  main.innerHTML = buildJournalHTML(date, journal, last7, monthlyBlockers, recentEntries);
  attachJournalEvents(date, journal);
}

/** 月初日を返す */
function getMonthStart(dateStr) {
  return dateStr.slice(0, 8) + "01";
}

/** ブロッカー集計 */
function aggregateBlockers(entries) {
  const map = {};
  for (const e of entries) {
    const blockers = e.ai_analysis?.blockers || [];
    for (const b of blockers) {
      const cat = b.category || "その他";
      if (!map[cat]) map[cat] = { blocker: cat, count: 0, severities: [] };
      map[cat].count++;
      map[cat].severities.push(b.severity);
    }
  }
  return Object.values(map)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((b) => ({
      ...b,
      severity_avg: modeSeverity(b.severities),
    }));
}

function modeSeverity(arr) {
  const counts = { high: 0, medium: 0, low: 0 };
  arr.forEach((s) => counts[s]++);
  return counts.high >= counts.medium ? (counts.high >= counts.low ? "high" : "low") : counts.medium >= counts.low ? "medium" : "low";
}

// ===== HTML ビルダー =====

function buildJournalHTML(date, journal, last7, monthlyBlockers, recentEntries) {
  const dateJP = formatDateJP(date);
  const isToday = date === today();
  const isFuture = date > today();
  const content = journal?.content || "";
  const analysis = journal?.ai_analysis;
  const isAnalyzed = journal?.is_analyzed;

  return `
    <div class="journal-page">
      <!-- 日付ナビ -->
      <div class="card" style="padding:12px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <button class="btn btn-ghost btn-sm" id="journal-prev">&#9664;</button>
          <div style="text-align:center">
            <div class="card-title" style="margin:0">フリージャーナル</div>
            <div style="font-size:0.85rem;color:var(--text-secondary)">${dateJP}</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="journal-next" ${isFuture || isToday ? "disabled" : ""}>&#9654;</button>
        </div>
      </div>

      <!-- 書き込みエリア -->
      <div class="card">
        <div class="card-title">今日の気持ち・出来事</div>
        <textarea
          class="journal-textarea"
          id="journal-content"
          placeholder="今日感じたこと、起きたこと、タスクが進まない理由など、自由に書いてください..."
          ${isFuture ? "disabled" : ""}
        >${content}</textarea>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-primary" id="journal-save" ${isFuture ? "disabled" : ""}>
            ${journal ? "更新する" : "保存する"}
          </button>
          ${journal ? `
            <button class="btn btn-secondary" id="journal-analyze" ${!journal.content ? "disabled" : ""}>
              ${isAnalyzed ? "再分析する" : "AI分析する"}
            </button>
            <button class="btn btn-ghost btn-sm" id="journal-delete" style="margin-left:auto;color:var(--neon-red)">削除</button>
          ` : ""}
        </div>
      </div>

      ${isAnalyzed && analysis ? buildAnalysisSection(analysis) : ""}
      ${last7.length >= 2 ? buildTrendSection(last7) : ""}
      ${monthlyBlockers.length > 0 ? buildBlockerSummary(monthlyBlockers) : ""}
      ${buildWeeklyDigestSection(date)}
      ${buildRecentList(recentEntries, date)}
    </div>
  `;
}

function buildAnalysisSection(a) {
  const rank = moodRank(a.mood_score);
  const energyLabel = { high: "高い", medium: "普通", low: "低い" }[a.energy_level] || a.energy_level;

  return `
    <!-- 感情分析 -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">感情分析</div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:0.8rem;color:var(--text-secondary)">エネルギー: ${energyLabel}</span>
          <div class="mood-score ${rank}">${a.mood_score}</div>
        </div>
      </div>
      ${a.emotions.length > 0 ? `
        <div class="emotion-pills">
          ${a.emotions.map((e) => `
            <span class="emotion-pill ${emotionValence(e.tag)}">
              ${e.tag} <span class="emotion-intensity">${e.intensity.toFixed(1)}</span>
            </span>
          `).join("")}
        </div>
      ` : ""}
      ${a.summary ? `<p style="font-size:0.85rem;color:var(--text-secondary);margin:8px 0 0">${a.summary}</p>` : ""}
    </div>

    ${a.blockers.length > 0 ? `
      <!-- ブロッカー -->
      <div class="card">
        <div class="card-title">行動ブロッカー</div>
        ${a.blockers.map((b) => `
          <div class="blocker-item ${b.severity}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <strong style="font-size:0.9rem">${b.blocker}</strong>
              <span class="badge badge-${b.severity}">${b.severity}</span>
              <span style="font-size:0.75rem;color:var(--text-muted)">${b.category}</span>
            </div>
            ${b.affected_tasks.length > 0 ? `<div style="font-size:0.8rem;color:var(--text-secondary)">影響タスク: ${b.affected_tasks.join(", ")}</div>` : ""}
          </div>
        `).join("")}
      </div>
    ` : ""}

    ${a.insights.length > 0 ? `
      <!-- 洞察 -->
      <div class="card">
        <div class="card-title">洞察</div>
        <ul class="analysis-list tip">
          ${a.insights.map((i) => `<li>${i}</li>`).join("")}
        </ul>
      </div>
    ` : ""}

    ${a.key_themes.length > 0 ? `
      <div class="card">
        <div class="card-title">キーテーマ</div>
        <div class="emotion-pills">
          ${a.key_themes.map((t) => `<span class="emotion-pill neutral">${t}</span>`).join("")}
        </div>
      </div>
    ` : ""}

    ${a.gratitude.length > 0 ? `
      <div class="card">
        <div class="card-title">感謝・ポジティブ</div>
        <ul class="analysis-list good">
          ${a.gratitude.map((g) => `<li>${g}</li>`).join("")}
        </ul>
      </div>
    ` : ""}
  `;
}

function buildTrendSection(entries) {
  // 全感情タグを収集
  const allEmotions = new Set();
  entries.forEach((e) => {
    (e.ai_analysis?.emotions || []).forEach((em) => allEmotions.add(em.tag));
  });
  if (allEmotions.size === 0) return "";

  // データ準備（JSON埋め込み）
  const trendData = JSON.stringify(
    entries.map((e) => ({
      date: e.date.slice(5), // MM-DD
      mood: e.ai_analysis?.mood_score || 0,
      emotions: Object.fromEntries(
        (e.ai_analysis?.emotions || []).map((em) => [em.tag, em.intensity]),
      ),
    })),
  );

  return `
    <div class="card">
      <div class="card-title">感情トレンド（直近${entries.length}日間）</div>
      <canvas class="journal-trend-canvas" id="journal-trend-canvas"></canvas>
      <script type="application/json" id="journal-trend-data">${trendData}</script>
    </div>
  `;
}

function buildBlockerSummary(blockers) {
  const maxCount = blockers[0]?.count || 1;
  return `
    <div class="card">
      <div class="card-title">今月のトップブロッカー</div>
      ${blockers.map((b) => `
        <div class="blocker-bar">
          <span class="blocker-bar-label">${b.blocker}</span>
          <div style="flex:1;background:var(--bg-secondary);border-radius:4px;overflow:hidden">
            <div class="blocker-bar-fill" style="width:${(b.count / maxCount) * 100}%"></div>
          </div>
          <span class="blocker-bar-count">${b.count}回</span>
        </div>
      `).join("")}
    </div>
  `;
}

function buildWeeklyDigestSection(date) {
  const weekId = getWeekId(date);
  return `
    <div class="card" id="weekly-digest-section">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">週次ダイジェスト</div>
        <span style="font-size:0.8rem;color:var(--text-muted)">${weekId}</span>
      </div>
      <div id="weekly-digest-content">
        <div style="text-align:center;padding:16px 0">
          <button class="btn btn-secondary" id="digest-load">ダイジェストを読み込む</button>
        </div>
      </div>
    </div>
  `;
}

function buildRecentList(entries, currentDate) {
  const others = entries.filter((e) => e.date !== currentDate).slice(0, 10);
  if (others.length === 0) return "";

  return `
    <div class="card">
      <div class="card-title">過去のジャーナル</div>
      ${others.map((e) => {
        const a = e.ai_analysis;
        const emotions = (a?.emotions || []).slice(0, 3).map((em) => em.tag).join(", ");
        const mood = a?.mood_score;
        const rank = mood != null ? moodRank(mood) : "";
        return `
          <a href="#/journal/${e.date}" class="journal-entry-item">
            <div style="flex:0 0 70px;font-size:0.85rem;color:var(--text-secondary)">${e.date.slice(5)}</div>
            ${mood != null ? `<div class="mood-score ${rank}" style="width:36px;height:36px;font-size:0.85rem;margin-right:12px">${mood}</div>` : ""}
            <div style="flex:1;min-width:0">
              <div style="font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)">
                ${e.content.slice(0, 50)}${e.content.length > 50 ? "..." : ""}
              </div>
              ${emotions ? `<div style="font-size:0.75rem;color:var(--text-muted)">${emotions}</div>` : ""}
            </div>
          </a>
        `;
      }).join("")}
    </div>
  `;
}

// ===== イベント =====

function attachJournalEvents(date, journal) {
  // 日付ナビ
  document.getElementById("journal-prev")?.addEventListener("click", () => {
    window.location.hash = `#/journal/${prevDate(date)}`;
  });
  document.getElementById("journal-next")?.addEventListener("click", () => {
    const next = nextDate(date);
    if (next <= today()) window.location.hash = `#/journal/${next}`;
  });

  // 保存
  document.getElementById("journal-save")?.addEventListener("click", async () => {
    const content = document.getElementById("journal-content")?.value?.trim();
    if (!content) {
      showToast("内容を入力してください", "error");
      return;
    }

    const btn = document.getElementById("journal-save");
    btn.disabled = true;
    btn.textContent = "保存中...";

    try {
      if (journal) {
        await journalApi.update(date, content);
        showToast("更新しました", "success");
      } else {
        await journalApi.create(date, content);
        showToast("保存しました", "success");
      }
      renderJournal(date);
    } catch (err) {
      showToast(err.message, "error");
      btn.disabled = false;
      btn.textContent = journal ? "更新する" : "保存する";
    }
  });

  // AI分析
  document.getElementById("journal-analyze")?.addEventListener("click", async () => {
    const btn = document.getElementById("journal-analyze");
    btn.disabled = true;
    btn.textContent = "分析中...";

    try {
      await journalApi.analyze(date);
      showToast("AI分析が完了しました", "success");
      renderJournal(date);
    } catch (err) {
      showToast(err.message, "error");
      btn.disabled = false;
      btn.textContent = "AI分析する";
    }
  });

  // 削除
  document.getElementById("journal-delete")?.addEventListener("click", async () => {
    if (!confirm("このジャーナルを削除しますか？")) return;
    try {
      await journalApi.delete(date);
      showToast("削除しました", "success");
      renderJournal(date);
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  // 週次ダイジェスト
  document.getElementById("digest-load")?.addEventListener("click", async () => {
    await loadWeeklyDigest(date);
  });

  // 感情トレンドチャート描画
  requestAnimationFrame(() => drawTrendChart());
}

// ===== 週次ダイジェスト =====

async function loadWeeklyDigest(date) {
  const weekId = getWeekId(date);
  const container = document.getElementById("weekly-digest-content");
  if (!container) return;

  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;

  try {
    // まず既存を取得
    let digest;
    try {
      digest = await journalApi.getDigest(weekId);
    } catch {
      // 無い場合は生成
      container.innerHTML = `<div class="loading"><div class="spinner"></div><p>ダイジェストを生成中...</p></div>`;
      digest = await journalApi.generateDigest(weekId);
    }
    container.innerHTML = buildDigestHTML(digest);
  } catch (err) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:12px">
      ${err.message.includes("ジャーナルエントリがありません") ? "この週にジャーナルがまだありません" : err.message}
    </p>`;
  }
}

function buildDigestHTML(d) {
  let html = "";

  // 気分の軌跡
  const mt = d.mood_trajectory;
  if (mt) {
    const trendLabel = { improving: "改善傾向", stable: "安定", declining: "低下傾向" }[mt.trend] || mt.trend;
    const trendColor = mt.trend === "improving" ? "var(--neon-green)" : mt.trend === "declining" ? "var(--neon-red)" : "var(--neon-amber)";
    html += `<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">
      <div style="font-size:0.85rem;color:var(--text-secondary)">週初 <strong style="color:var(--text-primary)">${mt.start_of_week}</strong></div>
      <div style="font-size:1.2rem;color:${trendColor}">→</div>
      <div style="font-size:0.85rem;color:var(--text-secondary)">週末 <strong style="color:var(--text-primary)">${mt.end_of_week}</strong></div>
      <span class="badge" style="background:${trendColor};color:#000">${trendLabel}</span>
    </div>`;
  }

  // 隠れたパターン
  if (d.hidden_patterns?.length) {
    html += `<div style="margin-bottom:16px">
      <div style="font-size:0.8rem;font-weight:600;color:var(--violet);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">隠れたパターン</div>
      <ul class="analysis-list cause">${d.hidden_patterns.map((p) => `<li>${p}</li>`).join("")}</ul>
    </div>`;
  }

  // インサイト
  if (d.weekly_insights?.length) {
    html += `<div style="margin-bottom:16px">
      <div style="font-size:0.8rem;font-weight:600;color:var(--cyan);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">インサイト</div>
      <ul class="analysis-list tip">${d.weekly_insights.map((i) => `<li>${i}</li>`).join("")}</ul>
    </div>`;
  }

  // トップブロッカー
  if (d.top_blockers?.length) {
    html += `<div style="margin-bottom:16px">
      <div style="font-size:0.8rem;font-weight:600;color:var(--neon-red);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">トップブロッカー</div>
      ${d.top_blockers.map((b) => `
        <div class="blocker-item ${b.severity_avg}" style="margin-bottom:8px">
          <strong>${b.blocker}</strong> <span style="font-size:0.8rem;color:var(--text-muted)">(${b.frequency}回)</span>
          ${b.suggestion ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:4px">→ ${b.suggestion}</div>` : ""}
        </div>
      `).join("")}
    </div>`;
  }

  // 行動推奨
  if (d.action_recommendations?.length) {
    html += `<div>
      <div style="font-size:0.8rem;font-weight:600;color:var(--neon-green);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">来週のアクション</div>
      <ul class="analysis-list good">${d.action_recommendations.map((a) => `<li>${a}</li>`).join("")}</ul>
    </div>`;
  }

  return html || `<p style="color:var(--text-muted);text-align:center">データが不足しています</p>`;
}

// ===== トレンドチャート（Canvas） =====

function drawTrendChart() {
  const canvas = document.getElementById("journal-trend-canvas");
  const dataEl = document.getElementById("journal-trend-data");
  if (!canvas || !dataEl) return;

  const data = JSON.parse(dataEl.textContent);
  if (data.length < 2) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const pad = { top: 20, right: 16, bottom: 32, left: 36 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  // 背景
  ctx.clearRect(0, 0, W, H);

  // テーマ検出
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const textColor = isDark ? "rgba(220,232,255,0.5)" : "rgba(17,24,39,0.5)";
  const gridColor = isDark ? "rgba(220,232,255,0.07)" : "rgba(17,24,39,0.08)";

  // グリッド線
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
  }

  // Y軸ラベル
  ctx.fillStyle = textColor;
  ctx.font = "10px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.fillText(String(100 - i * 25), pad.left - 6, y + 3);
  }

  // X軸ラベル
  ctx.textAlign = "center";
  data.forEach((d, i) => {
    const x = pad.left + (chartW / (data.length - 1)) * i;
    ctx.fillText(d.date, x, H - 8);
  });

  // mood_score 線
  ctx.strokeStyle = isDark ? "#00d4ff" : "#0284c7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = pad.left + (chartW / (data.length - 1)) * i;
    const y = pad.top + chartH * (1 - d.mood / 100);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // mood ドット
  data.forEach((d, i) => {
    const x = pad.left + (chartW / (data.length - 1)) * i;
    const y = pad.top + chartH * (1 - d.mood / 100);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "#00d4ff" : "#0284c7";
    ctx.fill();
  });

  // 凡例
  ctx.fillStyle = isDark ? "#00d4ff" : "#0284c7";
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("気分スコア", pad.left, pad.top - 6);
}
