/**
 * 分析結果表示コンポーネント
 * 日次分析データを視覚的に表示する
 * ソクラテス式対話UIにも対応
 */

import { analysisApi, dialogueApi, recordsApi } from "../api.js?v=20260323j";
import { showToast } from "../app.js?v=20260323j";

/** 日付を日本語表記にフォーマット */
function formatDateJP(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

/**
 * 分析結果をメインエリアにレンダリングする
 * 4状態: 分析済み / 対話中 / 記録あり未分析 / 記録なし
 * @param {string} date - 対象日 (YYYY-MM-DD)
 */
export async function renderAnalysisView(date) {
  const main = document.querySelector("main");
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>読み込み中...</p>
    </div>`;

  // 並列で分析・対話・記録を取得
  const [analysisResult, dialogueResult, recordResult] = await Promise.allSettled([
    analysisApi.get(date),
    dialogueApi.get(date),
    recordsApi.get(date),
  ]);

  const hasAnalysis = analysisResult.status === "fulfilled" && analysisResult.value != null;
  const hasDialogue = dialogueResult.status === "fulfilled" && dialogueResult.value != null;
  const hasRecord = recordResult.status === "fulfilled" && recordResult.value != null;

  if (hasAnalysis) {
    // 状態1: 分析済み → 既存表示 + 対話履歴トグル
    const dialogueData = hasDialogue ? dialogueResult.value : null;
    main.innerHTML = buildAnalysisHTML(analysisResult.value, dialogueData);
    attachAnalysisEvents(date);
    attachDialogueHistoryEvents();
  } else if (hasDialogue && dialogueResult.value.status === "in_progress") {
    // 状態2: 対話中 → 対話UI
    main.innerHTML = buildDialogueUI(date, dialogueResult.value);
    attachDialogueEvents(date);
  } else if (hasRecord) {
    // 状態3: 記録あり・未分析 → 記録表示 + 選択画面
    main.innerHTML = buildChoiceHTML(date, recordResult.value);
    attachChoiceEvents(date);
  } else {
    // 状態4: 記録なし
    main.innerHTML = buildNoAnalysisHTML(date, "404");
    attachAnalysisEvents(date);
  }
}

// ===== 状態3: 選択画面 =====

function buildChoiceHTML(date, record) {
  const dateLabel = formatDateJP(date);

  // 記録内容の表示
  const rawInput = record?.raw_input || "";
  const tasks = record?.tasks || {};
  const plannedTasks = tasks.planned || [];
  const completedTasks = tasks.completed || [];
  const backlogTasks = tasks.backlog || [];

  let recordHTML = "";
  if (rawInput) {
    recordHTML += `
      <div class="card">
        <div class="card-title">行動ログ</div>
        <div style="white-space: pre-wrap; font-size: 0.9rem; line-height: 1.6; color: var(--text-primary);">${escapeHTML(rawInput)}</div>
      </div>`;
  }

  if (plannedTasks.length > 0 || completedTasks.length > 0) {
    const completedSet = new Set(completedTasks);
    const allTasks = [...new Set([...plannedTasks, ...completedTasks])];
    const taskListHTML = allTasks.map((t) => {
      const done = completedSet.has(t);
      return `<li style="margin-bottom: 4px; color: ${done ? "var(--text-primary)" : "var(--text-muted)"};">
        ${done ? "✅" : "⬜"} ${escapeHTML(t)}
      </li>`;
    }).join("");

    const completionRate = plannedTasks.length > 0
      ? Math.round((completedTasks.length / plannedTasks.length) * 100)
      : 0;

    recordHTML += `
      <div class="card">
        <div class="card-title">タスク ${completedTasks.length}/${plannedTasks.length} 完了（${completionRate}%）</div>
        <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.9rem;">${taskListHTML}</ul>
      </div>`;
  }

  if (backlogTasks.length > 0) {
    recordHTML += `
      <div class="card">
        <div class="card-title">持ち越しタスク</div>
        <ul style="list-style: none; padding: 0; margin: 0; font-size: 0.9rem;">
          ${backlogTasks.map((t) => `<li style="margin-bottom: 4px;">📋 ${escapeHTML(t)}</li>`).join("")}
        </ul>
      </div>`;
  }

  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
      <h2 style="font-size: 1.1rem;">${dateLabel}の記録</h2>
      <button class="btn btn-outline btn-sm" onclick="window.location.hash='/input/${date}'">記録を編集</button>
    </div>
    <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: var(--gap);">未分析</p>

    ${recordHTML}

    <div class="card">
      <div class="card-title">分析する</div>
      <p class="dialogue-choice-desc">
        AIと対話しながら振り返り、より深い分析を生成できます。
      </p>
      <button class="btn btn-primary" id="btn-start-dialogue" style="width: 100%; margin-bottom: 10px;">
        振り返り対話を始める
      </button>
      <button class="btn btn-outline btn-sm" id="btn-quick-analysis" style="width: 100%;">
        通常の分析を生成
      </button>
    </div>`;
}

function attachChoiceEvents(date) {
  document.getElementById("btn-start-dialogue")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "対話を準備中...";
    try {
      const dialogue = await dialogueApi.start(date);
      const main = document.querySelector("main");
      main.innerHTML = buildDialogueUI(date, dialogue);
      attachDialogueEvents(date);
    } catch (err) {
      showToast(`対話の開始に失敗しました: ${err.message}`, "error");
      e.target.disabled = false;
      e.target.textContent = "振り返り対話を始める";
    }
  });

  document.getElementById("btn-quick-analysis")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "分析中...";
    try {
      await analysisApi.generate(date);
      showToast("分析が完了しました！", "success");
      await renderAnalysisView(date);
    } catch (err) {
      showToast(`分析に失敗しました: ${err.message}`, "error");
      e.target.disabled = false;
      e.target.textContent = "通常の分析を生成";
    }
  });
}

// ===== 状態2: 対話UI =====

function buildDialogueUI(date, dialogue) {
  const dateLabel = formatDateJP(date);
  const canSynthesize = dialogue.turn_count >= 1;
  const isMaxed = dialogue.turn_count >= dialogue.max_turns;
  const progress = (dialogue.turn_count / dialogue.max_turns) * 100;

  return `
    <div class="dialogue-header">
      <h2 style="font-size: 1.1rem; margin-bottom: 4px;">振り返り対話</h2>
      <p style="color: var(--text-muted); font-size: 0.85rem;">${dateLabel}</p>
      <div class="dialogue-progress">
        <span class="dialogue-turn-count">${dialogue.turn_count} / ${dialogue.max_turns} ターン</span>
        <div class="dialogue-progress-bar">
          <div class="dialogue-progress-fill" style="width: ${progress}%"></div>
        </div>
      </div>
    </div>

    <div class="dialogue-messages" id="dialogue-messages">
      ${dialogue.messages.map((m) => buildMessageBubble(m)).join("")}
    </div>

    ${isMaxed ? `
      <div class="dialogue-maxed-notice">
        <p>対話の上限に達しました。分析をまとめましょう。</p>
      </div>
    ` : `
      <div class="dialogue-input-area">
        <textarea id="dialogue-input"
          placeholder=""
          rows="3"></textarea>
        <button class="btn btn-primary" id="btn-send-reply" style="width: 100%;">
          送信
        </button>
      </div>
    `}

    <div class="dialogue-actions">
      ${canSynthesize ? `
        <button class="btn btn-primary" id="btn-synthesize">
          分析をまとめる
        </button>
      ` : ""}
      <button class="btn btn-outline btn-sm" id="btn-abandon-dialogue">
        対話を中止
      </button>
    </div>`;
}

function buildMessageBubble(message) {
  const isAI = message.role === "ai";
  const bubbleClass = isAI ? "dialogue-bubble-ai" : "dialogue-bubble-user";
  const label = isAI ? "AI" : "あなた";

  return `
    <div class="dialogue-bubble ${bubbleClass}">
      <div class="dialogue-bubble-label">${label}</div>
      <div class="dialogue-bubble-content">${escapeHTML(message.content)}</div>
    </div>`;
}

function attachDialogueEvents(date) {
  const sendBtn = document.getElementById("btn-send-reply");
  const input = document.getElementById("dialogue-input");

  if (sendBtn && input) {
    const sendReply = async () => {
      const text = input.value.trim();
      if (!text) return;

      sendBtn.disabled = true;
      sendBtn.textContent = "送信中...";
      input.disabled = true;

      try {
        const updated = await dialogueApi.reply(date, text);
        const main = document.querySelector("main");
        main.innerHTML = buildDialogueUI(date, updated);
        attachDialogueEvents(date);
        // スクロールを最下部へ
        const msgArea = document.getElementById("dialogue-messages");
        if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
      } catch (err) {
        showToast(`送信に失敗しました: ${err.message}`, "error");
        sendBtn.disabled = false;
        sendBtn.textContent = "送信";
        input.disabled = false;
      }
    };

    sendBtn.addEventListener("click", sendReply);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
    });
  }

  document.getElementById("btn-synthesize")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "分析を生成中...";
    try {
      await dialogueApi.synthesize(date);
      showToast("対話から分析を生成しました！", "success");
      await renderAnalysisView(date);
    } catch (err) {
      showToast(`分析生成に失敗しました: ${err.message}`, "error");
      e.target.disabled = false;
      e.target.textContent = "分析をまとめる";
    }
  });

  document.getElementById("btn-abandon-dialogue")?.addEventListener("click", async () => {
    if (!confirm("対話を中止しますか？入力した内容は失われます。")) return;
    try {
      await dialogueApi.delete(date);
      showToast("対話を中止しました", "info");
      await renderAnalysisView(date);
    } catch (err) {
      showToast(`中止に失敗しました: ${err.message}`, "error");
    }
  });

  // 初期表示時にスクロールを最下部へ
  requestAnimationFrame(() => {
    const msgArea = document.getElementById("dialogue-messages");
    if (msgArea) msgArea.scrollTop = msgArea.scrollHeight;
  });
}

// ===== 状態1: 分析結果表示（既存） =====

function buildAnalysisHTML(analysis, dialogueData) {
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
          <div class="stat-value">${summary.tasks_completed_count ?? Math.round(summary.task_completion_rate * 100)}<small style="font-size:0.7rem">${summary.tasks_completed_count != null ? '個' : '%'}</small></div>
          <div class="stat-label">完了タスク</div>
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
    ${detail.thinking_weaknesses?.length > 0 ? buildListSection("🧠 思考パターンの弱み", detail.thinking_weaknesses, "cause") : ""}

    <!-- 行動の弱み -->
    ${detail.behavior_weaknesses?.length > 0 ? buildListSection("🔄 行動パターンの弱み", detail.behavior_weaknesses, "cause") : ""}

    <!-- 改善提案 -->
    ${buildSuggestionsSection(detail.improvement_suggestions)}

    <!-- 過去との比較 -->
    ${buildComparisonSection(detail.comparison_with_past)}

    <!-- 対話履歴 -->
    ${buildDialogueHistorySection(dialogueData)}

    <!-- アクションボタン -->
    <div class="card">
      <button class="btn btn-primary" id="btn-start-dialogue-from-analysis" style="width: 100%; margin-bottom: 10px;">
        振り返り対話を始める
      </button>
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

// ===== 対話履歴（分析結果ページ内） =====

function buildDialogueHistorySection(dialogue) {
  if (!dialogue || !dialogue.messages || dialogue.messages.length === 0) return "";
  return `
    <div class="card">
      <div class="dialogue-history-toggle" id="dialogue-history-toggle">
        <span class="card-title" style="margin-bottom: 0; cursor: pointer;">
          💬 対話履歴を見る
        </span>
        <span class="dialogue-toggle-icon">▼</span>
      </div>
      <div class="dialogue-history-content" id="dialogue-history-content" style="display: none; margin-top: 14px;">
        ${dialogue.messages.map((m) => buildMessageBubble(m)).join("")}
      </div>
    </div>`;
}

function attachDialogueHistoryEvents() {
  document.getElementById("dialogue-history-toggle")?.addEventListener("click", () => {
    const content = document.getElementById("dialogue-history-content");
    const icon = document.querySelector(".dialogue-toggle-icon");
    if (!content || !icon) return;
    if (content.style.display === "none") {
      content.style.display = "block";
      icon.textContent = "▲";
    } else {
      content.style.display = "none";
      icon.textContent = "▼";
    }
  });
}

// ===== 状態4: 記録なし / エラー =====

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

// ===== 共通イベント =====

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

  // 分析結果ページから対話を開始
  const btnStartDialogueFromAnalysis = document.getElementById("btn-start-dialogue-from-analysis");
  if (btnStartDialogueFromAnalysis) {
    btnStartDialogueFromAnalysis.addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "対話を準備中...";
      try {
        const dialogue = await dialogueApi.start(date);
        const main = document.querySelector("main");
        main.innerHTML = buildDialogueUI(date, dialogue);
        attachDialogueEvents(date);
      } catch (err) {
        showToast(`対話の開始に失敗しました: ${err.message}`, "error");
        e.target.disabled = false;
        e.target.textContent = "振り返り対話を始める";
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
