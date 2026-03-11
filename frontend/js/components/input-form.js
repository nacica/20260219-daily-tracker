/**
 * 行動記録入力フォームコンポーネント
 * 新規作成・既存レコードの編集に対応
 * デスクトップ: 2列ドラッグ&ドロップレイアウト
 * 朝のタスク整理（ソクラテス式問答）統合
 */

import { recordsApi, analysisApi, morningDialogueApi } from "../api.js?v=20260311i";
import { showToast } from "../app.js?v=20260311i";
import { showTaskCompleteAnimation, buildTaskStatsCards } from "./task-stats.js?v=20260311i";

/* ── カテゴリ管理 ── */

const CATEGORY_STORAGE_KEY = "task-categories";
const LAST_CATEGORY_KEY = "task-last-category";
const DEFAULT_COLORS = ["#00d4ff", "#00e676", "#ffa726", "#e040fb", "#ff5252", "#40c4ff", "#69f0ae", "#ffab40"];

function getCategories() {
  try {
    const saved = localStorage.getItem(CATEGORY_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveCategories(categories) {
  localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
}

function getLastCategory() {
  return localStorage.getItem(LAST_CATEGORY_KEY) || "";
}

function setLastCategory(name) {
  localStorage.setItem(LAST_CATEGORY_KEY, name);
}

function parseTaskCategory(taskStr) {
  const m = taskStr.match(/^\[(.+?)\]\s*/);
  if (m) return { category: m[1], text: taskStr.slice(m[0].length) };
  return { category: "", text: taskStr };
}

function formatTaskWithCategory(text, category) {
  if (!category) return text;
  return `[${category}] ${text}`;
}

function getCategoryColor(categoryName) {
  const cats = getCategories();
  const found = cats.find((c) => c.name === categoryName);
  if (found) return found.color;
  return DEFAULT_COLORS[0];
}

function buildCategoryOptions(selectedValue) {
  const cats = getCategories();
  let html = `<option value="">カテゴリなし</option>`;
  for (const c of cats) {
    const sel = c.name === selectedValue ? " selected" : "";
    html += `<option value="${escapeHTML(c.name)}"${sel}>${escapeHTML(c.name)}</option>`;
  }
  html += `<option value="__new__">＋ 新規作成</option>`;
  return html;
}

function refreshCategoryDropdowns() {
  const last = getLastCategory();
  for (const sel of document.querySelectorAll(".category-select")) {
    const current = sel.value;
    sel.innerHTML = buildCategoryOptions(current || last);
  }
}

/* ── レイアウト永続化 ── */

const DEFAULT_LAYOUT = {
  "card-activity-log": { column: 0, order: 0 },
  "card-task-mgmt":    { column: 1, order: 0 },
  "card-backlog":      { column: 1, order: 1 },
  "card-actions":      { column: 1, order: 2 },
  "card-completed":    { column: 1, order: 3 },
};

const CARD_IDS = Object.keys(DEFAULT_LAYOUT);

function getLayoutPreference() {
  try {
    const saved = localStorage.getItem("input-form-layout");
    if (saved) {
      const parsed = JSON.parse(saved);
      // すべてのカードIDが存在するか検証
      for (const id of CARD_IDS) {
        if (!parsed[id] || typeof parsed[id].column !== "number") return DEFAULT_LAYOUT;
      }
      return parsed;
    }
  } catch {}
  return DEFAULT_LAYOUT;
}

function saveLayoutPreference(layout) {
  localStorage.setItem("input-form-layout", JSON.stringify(layout));
}

/* ── メインレンダリング ── */

/**
 * 入力フォームをメインエリアにレンダリングする
 * @param {string} date - 対象日 (YYYY-MM-DD)
 */
export async function renderInputForm(date) {
  const main = document.querySelector("main");
  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;

  // 既存レコードと朝問答を並行取得
  let existingRecord = null;
  let morningDialogue = null;

  const [recordResult, morningResult] = await Promise.allSettled([
    recordsApi.get(date),
    morningDialogueApi.get(date),
  ]);

  if (recordResult.status === "fulfilled") existingRecord = recordResult.value;
  if (morningResult.status === "fulfilled") morningDialogue = morningResult.value;

  const isEdit = !!existingRecord;
  const tasks = existingRecord?.tasks || { planned: [], completed: [], backlog: [] };

  // 近日中タスクが空の場合、直近7日から自動引き継ぎ
  if (tasks.backlog.length === 0) {
    try {
      const base = new Date(date + "T00:00:00");
      for (let i = 1; i <= 7; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        const prevDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const prev = await recordsApi.get(prevDate).catch(() => null);
        const prevBacklog = prev?.tasks?.backlog || [];
        if (prevBacklog.length > 0) {
          tasks.backlog = [...prevBacklog];
          break;
        }
      }
    } catch { /* ignore */ }
  }

  const isRestDay = existingRecord?.rest_day || false;
  const restReason = existingRecord?.rest_reason || "";

  // タスク完了サマリーカードを非同期で取得
  const taskStatsHTML = await buildTaskStatsCards();

  main.innerHTML = taskStatsHTML + buildFormHTML(date, existingRecord, tasks, isEdit, morningDialogue, isRestDay, restReason);
  attachFormEvents(date, isEdit);
  attachMorningDialogueEvents(date, morningDialogue);
  attachReminderEvents();
  attachRestDayEvents(date, isRestDay);
}

/* ── 付箋リマインダー ── */

const REMINDER_STORAGE_KEY = "daily-reminders";

function getReminders() {
  try {
    const saved = localStorage.getItem(REMINDER_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveReminders(list) {
  localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(list));
}


function buildReminderBoardHTML() {
  const reminders = getReminders();
  const notesHTML = reminders.map((r) => {
    return `<div class="sticky-note" data-id="${escapeHTML(r.id)}">
      <span class="sticky-text">${escapeHTML(r.text)}</span>
      <button class="sticky-delete" title="削除">&times;</button>
    </div>`;
  }).join("");

  return `
    <div class="card reminder-board-card" id="card-reminder-board">
      <div class="card-title">今日意識すること</div>
      <div class="sticky-notes" id="sticky-notes">
        ${notesHTML || '<p class="sticky-empty">まだメモがありません。<br>下から追加してみましょう。</p>'}
      </div>
      <div class="sticky-add-area">
        <div class="sticky-add-row">
          <input type="text" id="sticky-input" class="sticky-input" placeholder="意識することを追加..." maxlength="100" />
          <button class="btn btn-primary btn-sm" id="btn-add-sticky">追加</button>
        </div>
      </div>
    </div>`;
}

function attachReminderEvents() {
  const addBtn = document.getElementById("btn-add-sticky");
  const input = document.getElementById("sticky-input");
  if (!addBtn || !input) return;

  // 追加
  function addSticky() {
    const text = input.value.trim();
    if (!text) return;
    const reminders = getReminders();
    reminders.push({ id: Date.now().toString(36), text });
    saveReminders(reminders);
    refreshStickyNotes();
    input.value = "";
    input.focus();
  }

  addBtn.addEventListener("click", addSticky);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addSticky(); }
  });

  // 削除（イベント委譲）
  const container = document.getElementById("sticky-notes");
  if (container) {
    container.addEventListener("click", (e) => {
      const delBtn = e.target.closest(".sticky-delete");
      if (!delBtn) return;
      const note = delBtn.closest(".sticky-note");
      if (!note) return;
      const id = note.dataset.id;
      const reminders = getReminders().filter((r) => r.id !== id);
      saveReminders(reminders);
      refreshStickyNotes();
    });
  }
}

function refreshStickyNotes() {
  const container = document.getElementById("sticky-notes");
  if (!container) return;
  const reminders = getReminders();
  if (reminders.length === 0) {
    container.innerHTML = '<p class="sticky-empty">まだメモがありません。<br>下から追加してみましょう。</p>';
    return;
  }
  container.innerHTML = reminders.map((r) => {
    return `<div class="sticky-note" data-id="${escapeHTML(r.id)}">
      <span class="sticky-text">${escapeHTML(r.text)}</span>
      <button class="sticky-delete" title="削除">&times;</button>
    </div>`;
  }).join("");
}

/* ── おやすみモード ── */

function attachRestDayEvents(date, isRestDay) {
  // おやすみボタン → モーダル表示
  const btnRest = document.getElementById("btn-rest-day");
  if (btnRest) {
    btnRest.addEventListener("click", () => {
      const modal = document.getElementById("rest-day-modal");
      if (modal) modal.style.display = "flex";
    });
  }

  // モーダル確定
  const btnConfirm = document.getElementById("btn-confirm-rest");
  if (btnConfirm) {
    btnConfirm.addEventListener("click", async () => {
      const reason = document.getElementById("rest-day-reason")?.value || "";
      btnConfirm.disabled = true;
      btnConfirm.textContent = "設定中...";
      try {
        await recordsApi.toggleRestDay(date, true, reason);
        showToast("おやすみモードに設定しました", "success");
        await renderInputForm(date);
      } catch (err) {
        showToast("設定に失敗しました: " + err.message, "error");
        btnConfirm.disabled = false;
        btnConfirm.textContent = "おやすみにする";
      }
    });
  }

  // モーダルキャンセル
  const btnCancelModal = document.getElementById("btn-cancel-rest-modal");
  if (btnCancelModal) {
    btnCancelModal.addEventListener("click", () => {
      const modal = document.getElementById("rest-day-modal");
      if (modal) modal.style.display = "none";
    });
  }

  // おやすみ解除
  const btnCancelRest = document.getElementById("btn-cancel-rest");
  if (btnCancelRest) {
    btnCancelRest.addEventListener("click", async () => {
      btnCancelRest.disabled = true;
      btnCancelRest.textContent = "解除中...";
      try {
        await recordsApi.toggleRestDay(date, false, "");
        showToast("おやすみモードを解除しました", "success");
        await renderInputForm(date);
      } catch (err) {
        showToast("解除に失敗しました: " + err.message, "error");
        btnCancelRest.disabled = false;
        btnCancelRest.textContent = "解除する";
      }
    });
  }
}

/* ── 朝問答 HTML 生成 ── */

function buildMorningDialogueHTML(morningDialogue) {
  // 完了済み: 結果サマリーを表示
  if (morningDialogue && morningDialogue.status === "completed") {
    const plan = morningDialogue.plan || {};
    const focusMessage = plan.focus_message || "";
    const contextSummary = plan.context_summary || "";
    const messages = morningDialogue.messages || [];

    return `
      <div class="card morning-dialogue-card morning-completed" id="card-morning-dialogue">
        <div class="card-title">朝のタスク整理</div>
        <div class="morning-result" id="morning-result">
          ${focusMessage ? `<div class="morning-focus-message">${escapeHTML(focusMessage)}</div>` : ""}
          ${contextSummary ? `<div class="morning-context">${escapeHTML(contextSummary)}</div>` : ""}
          <button class="btn btn-outline btn-sm" id="btn-morning-toggle" style="margin-top: 8px;">
            対話を見る
          </button>
          <div class="morning-dialogue-history" id="morning-dialogue-history" style="display:none; margin-top: 12px;">
            ${messages.map((m) => `
              <div class="dialogue-bubble ${m.role === "ai" ? "dialogue-bubble-ai" : "dialogue-bubble-user"}">
                <div class="dialogue-bubble-label">${m.role === "ai" ? "AI" : "あなた"}</div>
                <div class="dialogue-bubble-content">${escapeHTML(m.content)}</div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>`;
  }

  // 進行中: 対話UIを表示
  if (morningDialogue && morningDialogue.status === "in_progress") {
    const messages = morningDialogue.messages || [];
    const turnCount = morningDialogue.turn_count || 0;
    const maxTurns = morningDialogue.max_turns || 5;
    const isMaxed = turnCount >= maxTurns;

    return `
      <div class="card morning-dialogue-card" id="card-morning-dialogue">
        <div class="card-title">朝のタスク整理</div>
        <div id="morning-dialogue">
          <div class="dialogue-header">
            <span>ターン ${turnCount}/${maxTurns}</span>
            <div class="dialogue-progress">
              <div class="dialogue-progress-bar" style="width: ${(turnCount / maxTurns) * 100}%"></div>
            </div>
          </div>
          <div class="dialogue-messages" id="morning-messages">
            ${messages.map((m) => `
              <div class="dialogue-bubble ${m.role === "ai" ? "dialogue-bubble-ai" : "dialogue-bubble-user"}">
                <div class="dialogue-bubble-label">${m.role === "ai" ? "AI" : "あなた"}</div>
                <div class="dialogue-bubble-content">${escapeHTML(m.content)}</div>
              </div>
            `).join("")}
          </div>
          ${!isMaxed ? `
          <div class="dialogue-input-area">
            <textarea id="morning-input" rows="2" placeholder="回答を入力..."></textarea>
            <button class="btn btn-primary btn-sm" id="btn-morning-send">送信</button>
          </div>` : `
          <div class="dialogue-maxed-notice">
            <p>ターン上限に達しました。プランをまとめましょう。</p>
          </div>`}
          <div class="dialogue-actions" style="margin-top: 8px;">
            ${turnCount >= 1 ? `
            <button class="btn btn-primary btn-sm" id="btn-morning-synthesize">
              プランをまとめる
            </button>` : ""}
            <button class="btn btn-outline btn-sm btn-danger" id="btn-morning-cancel">
              キャンセル
            </button>
          </div>
        </div>
      </div>`;
  }

  // 未開始: 開始ボタンを表示
  return `
    <div class="card morning-dialogue-card" id="card-morning-dialogue">
      <div class="card-title">朝のタスク整理</div>
      <div id="morning-start">
        <p class="morning-description">
          昨日の記録をもとに、ソクラテス式問答で今日やるべきことを整理しましょう。
        </p>
        <button class="btn btn-primary" id="btn-start-morning" style="width: 100%;">
          昨日の続きから始める
        </button>
      </div>
    </div>`;
}

/* ── HTML 生成 ── */

function buildFormHTML(date, record, tasks, isEdit, morningDialogue, isRestDay = false, restReason = "") {
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });

  const rawInput = record?.raw_input || "";
  const plannedTasks = tasks.planned || [];
  const completedTasks = tasks.completed || [];
  const backlogTasks = tasks.backlog || [];
  const hasCompleted = completedTasks.length > 0;
  const incompleteTasks = plannedTasks.filter((t) => !completedTasks.includes(t));

  // 各カードの HTML をマップで管理
  const cards = {
    "card-activity-log": `
      <div class="card draggable-card" id="card-activity-log" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <div class="card-title">行動ログ</div>
        <div class="form-group">
          <label for="raw-input">今日の行動を自由に入力してください</label>
          <textarea
            id="raw-input"
            placeholder=""
          >${rawInput}</textarea>
        </div>
        <div class="available-hours-row">
          <label for="available-hours">活動可能時間</label>
          <div class="available-hours-input-group">
            <div class="available-hours-presets" id="available-hours-presets">
              ${[2, 4, 6, 8].map((h) => `<button class="preset-btn${record?.available_hours === h ? " active" : ""}" data-hours="${h}">${h}h</button>`).join("")}
            </div>
            <input type="number" id="available-hours" min="0" max="24" step="0.5"
              value="${record?.available_hours != null ? record.available_hours : ""}"
              placeholder="--" />
            <span class="available-hours-unit">時間</span>
          </div>
          <p class="available-hours-hint">帰宅後の自由時間を入力。AI分析がこの時間を前提に評価します。</p>
        </div>
      </div>`,

    "card-task-mgmt": `
      <div class="card draggable-card" id="card-task-mgmt" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <div class="card-title">タスク管理</div>
        <label>予定タスク</label>
        <button class="btn btn-outline btn-sm" id="btn-carry-over" style="margin-bottom: 8px; width: 100%;">
          昨日の未完了タスクを引き継ぐ
        </button>
        <ul class="task-list" id="planned-list">
          ${incompleteTasks.map((t) => buildTaskItem(t, false)).join("")}
        </ul>
        <div class="task-input-row">
          <select id="planned-category" class="category-select">${buildCategoryOptions(getLastCategory())}</select>
          <input type="text" id="planned-input" placeholder="タスクを追加..." />
          <button class="btn btn-outline btn-sm" id="btn-add-task">追加</button>
        </div>
        <details class="category-manager">
          <summary>カテゴリ管理</summary>
          <ul class="category-manage-list" id="category-manage-list">
            ${getCategories().map((c) => `
              <li class="category-manage-item">
                <span class="task-category-badge" style="background:${c.color}">${escapeHTML(c.name)}</span>
                <button class="category-remove-btn" data-remove-category="${escapeHTML(c.name)}" title="削除">✕</button>
              </li>`).join("")}
          </ul>
          <div class="task-input-row">
            <input type="text" id="new-category-input" placeholder="新しいカテゴリ名..." />
            <button class="btn btn-outline btn-sm" id="btn-add-category">追加</button>
          </div>
        </details>
      </div>`,

    "card-backlog": `
      <div class="card draggable-card backlog-card" id="card-backlog" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <div class="card-title">近日中 <span class="backlog-count" id="backlog-count">${backlogTasks.length}</span></div>
        <p class="backlog-description">今日やらなくてもいいけど、近いうちにやりたいタスク</p>
        <ul class="task-list backlog-list" id="backlog-list">
          ${backlogTasks.map((t) => buildBacklogItem(t)).join("")}
        </ul>
        <div class="task-input-row">
          <select id="backlog-category" class="category-select">${buildCategoryOptions(getLastCategory())}</select>
          <input type="text" id="backlog-input" placeholder="近日中タスクを追加..." />
          <button class="btn btn-outline btn-sm" id="btn-add-backlog">追加</button>
        </div>
      </div>`,

    "card-actions": `
      <div class="card draggable-card" id="card-actions" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <button class="btn btn-primary" id="btn-submit">
          ${isEdit ? "記録を更新する" : "記録を保存する"}
        </button>
        ${isEdit ? `
        <div style="margin-top: 10px; display: flex; gap: 10px;">
          <button class="btn btn-outline btn-sm" id="btn-analyze" style="flex: 1;">
            AI で分析する
          </button>
          <button class="btn btn-outline btn-sm" id="btn-view-analysis" style="flex: 1;"
            onclick="window.location.hash='/analysis/${record?.date || ''}'">
            分析を見る
          </button>
        </div>` : ""}
      </div>`,

    "card-completed": `
      <div class="card draggable-card completed-tasks-card" id="card-completed" draggable="false"
           style="${hasCompleted ? "" : "display:none"}">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <div class="card-title">完了タスク <span class="completed-count" id="completed-count">${completedTasks.length}</span></div>
        <ul class="task-list" id="completed-list">
          ${completedTasks.map((t) => buildTaskItem(t, true)).join("")}
        </ul>
      </div>`,
  };

  // localStorage のレイアウトに従ってカードを列に振り分け
  const layout = getLayoutPreference();
  const columns = [[], []];

  for (const [cardId, cardHTML] of Object.entries(cards)) {
    const col = layout[cardId]?.column ?? DEFAULT_LAYOUT[cardId].column;
    const order = layout[cardId]?.order ?? DEFAULT_LAYOUT[cardId].order;
    columns[col].push({ cardId, cardHTML, order });
  }

  columns.forEach((col) => col.sort((a, b) => a.order - b.order));

  // 朝問答 + 付箋リマインダーを各列の先頭に組み込み
  const morningHTML = buildMorningDialogueHTML(morningDialogue);
  const reminderHTML = buildReminderBoardHTML();

  // おやすみモード理由選択肢
  const REST_REASONS = ["残業", "体調不良", "出張", "予定あり", "その他"];
  const reasonOptions = REST_REASONS.map(
    (r) => `<option value="${r}"${r === restReason ? " selected" : ""}>${r}</option>`
  ).join("");

  return `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
      <h2 style="margin: 0; font-size: 1.2rem;">${isEdit ? "記録を編集" : "行動を記録"}</h2>
      ${isRestDay ? `` : `
      <button class="btn btn-outline btn-sm rest-day-btn" id="btn-rest-day" style="white-space: nowrap;">
        🌙 今日はおやすみ
      </button>`}
    </div>
    <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: var(--gap);">${dateLabel}</p>

    ${isRestDay ? `
    <div class="card rest-day-banner" id="rest-day-banner">
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <span style="font-size: 1.3rem;">🌙</span>
        <div style="flex: 1;">
          <div style="font-weight: 600; color: var(--text-primary);">おやすみモード</div>
          <div style="font-size: 0.82rem; color: var(--text-secondary);">
            この日は分析対象外です${restReason ? `（${escapeHTML(restReason)}）` : ""}
          </div>
        </div>
        <button class="btn btn-outline btn-sm" id="btn-cancel-rest">解除する</button>
      </div>
    </div>` : ``}

    <div id="rest-day-modal" class="rest-day-modal" style="display:none;">
      <div class="rest-day-modal-content card">
        <div class="card-title">おやすみモード</div>
        <p style="color: var(--text-secondary); font-size: 0.88rem; margin-bottom: 12px;">
          この日を分析対象外にします。理由を選んでください（任意）。
        </p>
        <select id="rest-day-reason" style="width:100%; margin-bottom: 12px; padding: 8px; border-radius: 8px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border);">
          <option value="">理由なし</option>
          ${reasonOptions}
        </select>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" id="btn-confirm-rest" style="flex:1;">おやすみにする</button>
          <button class="btn btn-outline btn-sm" id="btn-cancel-rest-modal" style="flex:1;">キャンセル</button>
        </div>
      </div>
    </div>

    <div class="input-grid" id="input-grid">
      <div class="input-column" id="input-column-0" data-column="0">
        <div class="morning-col">${morningHTML}</div>
        ${columns[0].map((c) => c.cardHTML).join("")}
      </div>
      <div class="input-column" id="input-column-1" data-column="1">
        <div class="reminder-col">${reminderHTML}</div>
        ${columns[1].map((c) => c.cardHTML).join("")}
      </div>
    </div>
  `;
}

function buildCategoryBadge(category) {
  if (!category) return "";
  const color = getCategoryColor(category);
  return `<span class="task-category-badge" style="background:${color}">${escapeHTML(category)}</span>`;
}

function buildTaskItem(taskText, isCompleted) {
  const { category, text } = parseTaskCategory(taskText);
  return `
    <li class="task-item${isCompleted ? " completed" : ""}">
      ${!isCompleted ? `<span class="task-drag-handle" title="ドラッグで並べ替え">⠿</span>` : ""}
      <input type="checkbox" ${isCompleted ? "checked" : ""} data-task="${escapeHTML(taskText)}" />
      ${buildCategoryBadge(category)}<span>${escapeHTML(text)}</span>
      ${!isCompleted ? `<button class="task-move-backlog" data-to-backlog="${escapeHTML(taskText)}" title="近日中へ移動">▼</button>` : ""}
      <button class="task-remove" data-remove="${escapeHTML(taskText)}" title="削除">✕</button>
    </li>`;
}

function buildBacklogItem(taskText) {
  const { category, text } = parseTaskCategory(taskText);
  return `
    <li class="task-item backlog-item">
      <span class="task-drag-handle" title="ドラッグで並べ替え">⠿</span>
      ${buildCategoryBadge(category)}<span>${escapeHTML(text)}</span>
      <button class="task-move-today" data-to-today="${escapeHTML(taskText)}" title="今日やるへ昇格">▲</button>
      <button class="task-remove" data-remove="${escapeHTML(taskText)}" title="削除">✕</button>
    </li>`;
}

function syncCompletedCard() {
  const card = document.getElementById("card-completed");
  if (!card) return;
  const count = document.querySelectorAll("#completed-list .task-item").length;
  card.style.display = count > 0 ? "" : "none";
  document.getElementById("completed-count").textContent = count;
}

function syncBacklogCount() {
  const countEl = document.getElementById("backlog-count");
  if (!countEl) return;
  const count = document.querySelectorAll("#backlog-list .task-item").length;
  countEl.textContent = count;
}

/* ── 朝問答イベント ── */

function attachMorningDialogueEvents(date, morningDialogue) {
  // 開始ボタン
  const btnStart = document.getElementById("btn-start-morning");
  if (btnStart) {
    btnStart.addEventListener("click", async () => {
      btnStart.disabled = true;
      btnStart.textContent = "準備中...";
      try {
        const dialogue = await morningDialogueApi.start(date);
        // ページ再レンダリング
        await renderInputForm(date);
      } catch (err) {
        showToast("朝問答の開始に失敗しました: " + err.message, "error");
        btnStart.disabled = false;
        btnStart.textContent = "昨日の続きから始める";
      }
    });
  }

  // 送信ボタン
  const btnSend = document.getElementById("btn-morning-send");
  if (btnSend) {
    const input = document.getElementById("morning-input");

    async function sendReply() {
      const message = input.value.trim();
      if (!message) return;

      btnSend.disabled = true;
      btnSend.textContent = "...";
      input.disabled = true;

      try {
        await morningDialogueApi.reply(date, message);
        await renderInputForm(date);
      } catch (err) {
        showToast("送信に失敗しました: " + err.message, "error");
        btnSend.disabled = false;
        btnSend.textContent = "送信";
        input.disabled = false;
      }
    }

    btnSend.addEventListener("click", sendReply);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendReply();
      }
    });

    // 対話メッセージを最下部にスクロール
    const messagesEl = document.getElementById("morning-messages");
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // inputにフォーカス
    input.focus();
  }

  // プランをまとめるボタン
  const btnSynthesize = document.getElementById("btn-morning-synthesize");
  if (btnSynthesize) {
    btnSynthesize.addEventListener("click", async () => {
      btnSynthesize.disabled = true;
      btnSynthesize.textContent = "まとめ中...";
      try {
        const result = await morningDialogueApi.synthesize(date);
        const plan = result.plan || {};

        // タスクをフォームに反映
        applyMorningPlanToForm(plan);

        showToast("今日のプランができました！", "success");
        // ページ再レンダリング
        await renderInputForm(date);
      } catch (err) {
        showToast("プランの生成に失敗しました: " + err.message, "error");
        btnSynthesize.disabled = false;
        btnSynthesize.textContent = "プランをまとめる";
      }
    });
  }

  // キャンセルボタン
  const btnCancel = document.getElementById("btn-morning-cancel");
  if (btnCancel) {
    btnCancel.addEventListener("click", async () => {
      btnCancel.disabled = true;
      try {
        await morningDialogueApi.delete(date);
        showToast("朝問答をキャンセルしました", "info");
        await renderInputForm(date);
      } catch (err) {
        showToast("キャンセルに失敗しました: " + err.message, "error");
        btnCancel.disabled = false;
      }
    });
  }

  // 対話履歴トグルボタン（完了済み）
  const btnToggle = document.getElementById("btn-morning-toggle");
  if (btnToggle) {
    btnToggle.addEventListener("click", () => {
      const history = document.getElementById("morning-dialogue-history");
      if (history) {
        const isHidden = history.style.display === "none";
        history.style.display = isHidden ? "" : "none";
        btnToggle.textContent = isHidden ? "対話を閉じる" : "対話を見る";
      }
    });
  }
}

/**
 * 朝問答のプラン結果を予定タスクリストに反映する
 */
function applyMorningPlanToForm(plan) {
  const plannedList = document.getElementById("planned-list");
  if (!plannedList) return;

  // 既存タスクのセット（近日中タスクも含む）
  const existing = new Set(
    [...document.querySelectorAll("#planned-list .task-item span, #completed-list .task-item span, #backlog-list .task-item span")]
      .map((el) => el.textContent.trim())
  );

  // tasks_today を追加
  const tasksToday = plan.tasks_today || [];
  for (const item of tasksToday) {
    const taskName = item.task || "";
    if (taskName && !existing.has(taskName)) {
      plannedList.insertAdjacentHTML("beforeend", buildTaskItem(taskName, false));
      existing.add(taskName);
    }
  }

  // carried_over を追加
  const carriedOver = plan.carried_over || [];
  for (const task of carriedOver) {
    if (task && !existing.has(task)) {
      plannedList.insertAdjacentHTML("beforeend", buildTaskItem(task, false));
      existing.add(task);
    }
  }
}

/* ── イベント登録 ── */

function attachFormEvents(date, isEdit) {
  const plannedList = document.getElementById("planned-list");
  const plannedInput = document.getElementById("planned-input");
  const completedList = document.getElementById("completed-list");
  const backlogList = document.getElementById("backlog-list");
  const backlogInput = document.getElementById("backlog-input");

  // バックグラウンド自動保存（排他制御付き）
  let isSaving = false;
  let pendingSave = false;

  async function saveDataQuietly() {
    if (isSaving) {
      pendingSave = true;
      return;
    }

    const rawInput = document.getElementById("raw-input").value.trim();
    const incompleteTasks = [...document.querySelectorAll("#planned-list .task-item .task-remove")]
      .map((el) => el.dataset.remove)
      .filter(Boolean);
    const completedTasks = [...document.querySelectorAll("#completed-list .task-item .task-remove")]
      .map((el) => el.dataset.remove)
      .filter(Boolean);
    const backlogTasks = [...document.querySelectorAll("#backlog-list .task-item .task-remove")]
      .map((el) => el.dataset.remove)
      .filter(Boolean);
    const plannedTasks = [...incompleteTasks, ...completedTasks];

    // 何も入力されていなければ保存しない
    if (!isEdit && !rawInput && plannedTasks.length === 0 && backlogTasks.length === 0) return;

    const availHoursEl = document.getElementById("available-hours");
    const availHoursVal = availHoursEl?.value ? parseFloat(availHoursEl.value) : null;

    isSaving = true;
    try {
      if (isEdit) {
        const updateData = {
          raw_input: rawInput,
          tasks_planned: plannedTasks,
          tasks_completed: completedTasks,
          tasks_backlog: backlogTasks,
        };
        if (availHoursVal !== null) updateData.available_hours = availHoursVal;
        await recordsApi.update(date, updateData);
      } else {
        try {
          await recordsApi.create(date, rawInput, plannedTasks, completedTasks, backlogTasks);
        } catch (createErr) {
          // 409 (既に存在) の場合は update にフォールバック
          if (createErr.message.includes("409") || createErr.message.includes("すでに存在")) {
            const updateData = {
              raw_input: rawInput,
              tasks_planned: plannedTasks,
              tasks_completed: completedTasks,
              tasks_backlog: backlogTasks,
            };
            if (availHoursVal !== null) updateData.available_hours = availHoursVal;
            await recordsApi.update(date, updateData);
          } else {
            throw createErr;
          }
        }
        isEdit = true;
        const btnSubmit = document.getElementById("btn-submit");
        if (btnSubmit) btnSubmit.textContent = "記録を更新する";
      }
      showToast("自動保存しました", "success");
    } catch (err) {
      showToast("自動保存に失敗しました: " + err.message, "error");
    } finally {
      isSaving = false;
      if (pendingSave) {
        pendingSave = false;
        saveDataQuietly();
      }
    }
  }

  // 行動ログの入力が止まったら自動保存（デバウンス 1.5 秒）
  let rawInputTimer = null;
  document.getElementById("raw-input").addEventListener("input", () => {
    clearTimeout(rawInputTimer);
    rawInputTimer = setTimeout(saveDataQuietly, 1500);
  });

  // 活動可能時間: プリセットボタン & 入力
  const availHoursInput = document.getElementById("available-hours");
  const presetsContainer = document.getElementById("available-hours-presets");
  if (presetsContainer && availHoursInput) {
    presetsContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".preset-btn");
      if (!btn) return;
      const hours = parseFloat(btn.dataset.hours);
      availHoursInput.value = hours;
      presetsContainer.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      saveDataQuietly();
    });
    availHoursInput.addEventListener("change", () => {
      const val = parseFloat(availHoursInput.value);
      presetsContainer.querySelectorAll(".preset-btn").forEach((b) => {
        b.classList.toggle("active", parseFloat(b.dataset.hours) === val);
      });
      saveDataQuietly();
    });
  }

  // 昨日の未完了タスク引き継ぎ
  document.getElementById("btn-carry-over").addEventListener("click", async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = "読み込み中...";

    const base = new Date(date + "T00:00:00");
    let found = null;
    let searchedDate = null;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      searchedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      try {
        found = await recordsApi.get(searchedDate);
        const planned = found?.tasks?.planned || [];
        const completed = found?.tasks?.completed || [];
        const backlog = found?.tasks?.backlog || [];
        const hasIncomplete = planned.filter((t) => !completed.includes(t)).length > 0;
        const hasBacklog = backlog.length > 0;
        if (hasIncomplete || hasBacklog) break;
        found = null;
      } catch {
        found = null;
      }
    }

    try {
      if (!found) {
        showToast("直近7日間に引き継ぐタスクが見つかりません", "info");
        return;
      }
      const planned = found.tasks?.planned || [];
      const completed = found.tasks?.completed || [];
      const incomplete = planned.filter((t) => !completed.includes(t));

      const existing = new Set(
        [...document.querySelectorAll("#planned-list .task-remove, #completed-list .task-remove, #backlog-list .task-remove")]
          .map((el) => el.dataset.remove)
      );
      let added = 0;
      for (const task of incomplete) {
        if (!existing.has(task)) {
          plannedList.insertAdjacentHTML("beforeend", buildTaskItem(task, false));
          added++;
        }
      }
      // 近日中タスクも引き継ぐ
      const prevBacklog = found.tasks?.backlog || [];
      for (const task of prevBacklog) {
        if (!existing.has(task)) {
          backlogList.insertAdjacentHTML("beforeend", buildBacklogItem(task));
          added++;
          existing.add(task);
        }
      }
      syncBacklogCount();
      if (added > 0) {
        showToast(`${found.date} から ${added}件のタスクを引き継ぎました`, "success");
        saveDataQuietly();
      } else {
        showToast("すべて既に追加済みです", "info");
      }
    } catch (err) {
      showToast("タスク引き継ぎに失敗: " + err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "昨日の未完了タスクを引き継ぐ";
    }
  });

  // カテゴリ選択時の新規作成ハンドリング
  function handleCategorySelect(selectEl) {
    if (selectEl.value === "__new__") {
      const name = prompt("新しいカテゴリ名を入力してください:");
      if (name && name.trim()) {
        const cats = getCategories();
        const trimmed = name.trim();
        if (!cats.find((c) => c.name === trimmed)) {
          const color = DEFAULT_COLORS[cats.length % DEFAULT_COLORS.length];
          cats.push({ name: trimmed, color });
          saveCategories(cats);
          renderCategoryManageList();
        }
        refreshCategoryDropdowns();
        selectEl.value = trimmed;
        setLastCategory(trimmed);
      } else {
        selectEl.value = getLastCategory();
      }
    } else {
      setLastCategory(selectEl.value);
    }
  }

  const plannedCategorySel = document.getElementById("planned-category");
  const backlogCategorySel = document.getElementById("backlog-category");
  plannedCategorySel.addEventListener("change", () => handleCategorySelect(plannedCategorySel));
  backlogCategorySel.addEventListener("change", () => handleCategorySelect(backlogCategorySel));

  // タスク追加
  function addTask() {
    const text = plannedInput.value.trim();
    if (!text) return;
    const category = plannedCategorySel.value;
    const fullText = formatTaskWithCategory(text, category);
    plannedList.insertAdjacentHTML("beforeend", buildTaskItem(fullText, false));
    plannedInput.value = "";
    plannedInput.focus();
    saveDataQuietly();
  }

  document.getElementById("btn-add-task").addEventListener("click", addTask);
  plannedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addTask(); }
  });

  // 近日中タスク追加
  function addBacklogTask() {
    const text = backlogInput.value.trim();
    if (!text) return;
    const category = backlogCategorySel.value;
    const fullText = formatTaskWithCategory(text, category);
    backlogList.insertAdjacentHTML("beforeend", buildBacklogItem(fullText));
    backlogInput.value = "";
    backlogInput.focus();
    syncBacklogCount();
    saveDataQuietly();
  }

  document.getElementById("btn-add-backlog").addEventListener("click", addBacklogTask);
  backlogInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addBacklogTask(); }
  });

  // タスク削除 & チェックボックス切り替え & レーン移動（イベント委任）
  function handleTaskClick(e) {
    if (e.target.dataset.remove !== undefined) {
      e.target.closest("li").remove();
      syncCompletedCard();
      syncBacklogCount();
      saveDataQuietly();
      return;
    }
    // 「近日中へ移動」ボタン
    if (e.target.dataset.toBacklog !== undefined) {
      const li = e.target.closest("li");
      const taskText = e.target.dataset.toBacklog;
      li.remove();
      backlogList.insertAdjacentHTML("beforeend", buildBacklogItem(taskText));
      syncBacklogCount();
      saveDataQuietly();
      return;
    }
    // 「今日やるへ昇格」ボタン
    if (e.target.dataset.toToday !== undefined) {
      const li = e.target.closest("li");
      const taskText = e.target.dataset.toToday;
      li.remove();
      plannedList.insertAdjacentHTML("beforeend", buildTaskItem(taskText, false));
      syncBacklogCount();
      saveDataQuietly();
      return;
    }
    if (e.target.type === "checkbox") {
      const li = e.target.closest("li");
      if (e.target.checked) {
        li.classList.add("completed");
        completedList.appendChild(li);
        showTaskCompleteAnimation(e.target);
      } else {
        li.classList.remove("completed");
        plannedList.appendChild(li);
      }
      syncCompletedCard();
      saveDataQuietly();
    }
  }

  plannedList.addEventListener("click", handleTaskClick);
  completedList.addEventListener("click", handleTaskClick);
  backlogList.addEventListener("click", handleTaskClick);

  // カテゴリ管理
  function renderCategoryManageList() {
    const list = document.getElementById("category-manage-list");
    if (!list) return;
    const cats = getCategories();
    list.innerHTML = cats.map((c) => `
      <li class="category-manage-item">
        <span class="task-category-badge" style="background:${c.color}">${escapeHTML(c.name)}</span>
        <button class="category-remove-btn" data-remove-category="${escapeHTML(c.name)}" title="削除">✕</button>
      </li>`).join("");
  }

  const categoryManageList = document.getElementById("category-manage-list");
  if (categoryManageList) {
    categoryManageList.addEventListener("click", (e) => {
      if (e.target.dataset.removeCategory !== undefined) {
        const name = e.target.dataset.removeCategory;
        const cats = getCategories().filter((c) => c.name !== name);
        saveCategories(cats);
        renderCategoryManageList();
        refreshCategoryDropdowns();
      }
    });
  }

  const btnAddCategory = document.getElementById("btn-add-category");
  const newCategoryInput = document.getElementById("new-category-input");
  if (btnAddCategory && newCategoryInput) {
    function addCategory() {
      const name = newCategoryInput.value.trim();
      if (!name) return;
      const cats = getCategories();
      if (cats.find((c) => c.name === name)) {
        showToast("同じ名前のカテゴリが既にあります", "error");
        return;
      }
      const color = DEFAULT_COLORS[cats.length % DEFAULT_COLORS.length];
      cats.push({ name, color });
      saveCategories(cats);
      newCategoryInput.value = "";
      renderCategoryManageList();
      refreshCategoryDropdowns();
      showToast(`カテゴリ「${name}」を追加しました`, "success");
    }
    btnAddCategory.addEventListener("click", addCategory);
    newCategoryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addCategory(); }
    });
  }

  // フォーム送信
  document.getElementById("btn-submit").addEventListener("click", async (e) => {
    await submitForm(date, isEdit, e.target);
  });

  // AI 分析ボタン（編集時のみ）
  const btnAnalyze = document.getElementById("btn-analyze");
  if (btnAnalyze) {
    btnAnalyze.addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "分析中...";
      try {
        await analysisApi.generate(date);
        showToast("分析が完了しました！", "success");
        window.location.hash = `/analysis/${date}`;
      } catch (err) {
        showToast(`分析に失敗しました: ${err.message}`, "error");
        e.target.disabled = false;
        e.target.textContent = "AI で分析する";
      }
    });
  }

  // ドラッグ&ドロップ（デスクトップのみ）
  attachDragDropEvents();

  // タスク並べ替え（デスクトップ＋モバイル）
  attachTaskSortEvents(saveDataQuietly);
}

/* ── タスク並べ替え（リスト内ドラッグ&ドロップ） ── */

function attachTaskSortEvents(saveDataQuietly) {
  const lists = [
    document.getElementById("planned-list"),
    document.getElementById("backlog-list"),
  ];

  let draggedItem = null;
  let touchClone = null;
  let touchList = null;
  let touchScrollInterval = null;

  // --- デスクトップ: HTML5 Drag & Drop ---
  for (const list of lists) {
    if (!list) continue;

    // ハンドル mousedown で draggable 有効化
    list.addEventListener("mousedown", (e) => {
      const handle = e.target.closest(".task-drag-handle");
      if (!handle) return;
      const li = handle.closest(".task-item");
      if (li) li.setAttribute("draggable", "true");
    });

    list.addEventListener("dragstart", (e) => {
      const li = e.target.closest(".task-item");
      if (!li || !li.getAttribute("draggable")) { e.preventDefault(); return; }
      draggedItem = li;
      li.classList.add("task-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
      requestAnimationFrame(() => { li.style.opacity = "0.35"; });
    });

    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!draggedItem || draggedItem.closest("ul") !== list) return;

      const items = [...list.querySelectorAll(".task-item:not(.task-dragging)")];
      const afterItem = getTaskInsertPoint(list, e.clientY, items);

      // 視覚フィードバック
      items.forEach((it) => it.classList.remove("task-drop-above"));
      if (afterItem) afterItem.classList.add("task-drop-above");
    });

    list.addEventListener("dragleave", () => {
      list.querySelectorAll(".task-drop-above").forEach((el) => el.classList.remove("task-drop-above"));
    });

    list.addEventListener("drop", (e) => {
      e.preventDefault();
      list.querySelectorAll(".task-drop-above").forEach((el) => el.classList.remove("task-drop-above"));
      if (!draggedItem || draggedItem.closest("ul") !== list) return;

      const items = [...list.querySelectorAll(".task-item:not(.task-dragging)")];
      const afterItem = getTaskInsertPoint(list, e.clientY, items);

      if (afterItem) {
        list.insertBefore(draggedItem, afterItem);
      } else {
        list.appendChild(draggedItem);
      }
      saveDataQuietly();
    });

    list.addEventListener("dragend", () => {
      if (draggedItem) {
        draggedItem.classList.remove("task-dragging");
        draggedItem.style.opacity = "";
        draggedItem.setAttribute("draggable", "false");
        draggedItem = null;
      }
      list.querySelectorAll(".task-drop-above").forEach((el) => el.classList.remove("task-drop-above"));
    });

    // --- モバイル: Touch Events ---
    list.addEventListener("touchstart", (e) => {
      const handle = e.target.closest(".task-drag-handle");
      if (!handle) return;
      const li = handle.closest(".task-item");
      if (!li) return;

      e.preventDefault();
      draggedItem = li;
      touchList = list;

      // クローン作成（指に追従するゴースト）
      const rect = li.getBoundingClientRect();
      touchClone = li.cloneNode(true);
      touchClone.classList.add("task-touch-clone");
      touchClone.style.width = rect.width + "px";
      touchClone.style.left = rect.left + "px";
      touchClone.style.top = rect.top + "px";
      document.body.appendChild(touchClone);

      li.classList.add("task-dragging");
      li.style.opacity = "0.35";
    }, { passive: false });

    list.addEventListener("touchmove", (e) => {
      if (!draggedItem || !touchClone || touchList !== list) return;
      e.preventDefault();

      const touchY = e.touches[0].clientY;
      touchClone.style.top = touchY - 20 + "px";

      // 画面端でオートスクロール
      clearInterval(touchScrollInterval);
      if (touchY < 80) {
        touchScrollInterval = setInterval(() => window.scrollBy(0, -8), 16);
      } else if (touchY > window.innerHeight - 80) {
        touchScrollInterval = setInterval(() => window.scrollBy(0, 8), 16);
      }

      // ドロップ位置フィードバック
      const items = [...list.querySelectorAll(".task-item:not(.task-dragging)")];
      items.forEach((it) => it.classList.remove("task-drop-above"));
      const afterItem = getTaskInsertPoint(list, touchY, items);
      if (afterItem) afterItem.classList.add("task-drop-above");
    }, { passive: false });

    list.addEventListener("touchend", () => {
      clearInterval(touchScrollInterval);
      touchScrollInterval = null;

      if (!draggedItem || touchList !== list) return;

      // クローン削除
      if (touchClone) {
        touchClone.remove();
        touchClone = null;
      }

      // ドロップ位置に移動
      const items = [...list.querySelectorAll(".task-item:not(.task-dragging)")];
      // 最後に task-drop-above を持つ要素を探す
      const dropTarget = list.querySelector(".task-item.task-drop-above");
      if (dropTarget) {
        list.insertBefore(draggedItem, dropTarget);
      }
      // else: 元の位置のまま（一番下に来たケースも含む）

      items.forEach((it) => it.classList.remove("task-drop-above"));
      draggedItem.classList.remove("task-dragging");
      draggedItem.style.opacity = "";
      draggedItem = null;
      touchList = null;

      saveDataQuietly();
    });

    list.addEventListener("touchcancel", () => {
      clearInterval(touchScrollInterval);
      touchScrollInterval = null;
      if (touchClone) { touchClone.remove(); touchClone = null; }
      if (draggedItem) {
        draggedItem.classList.remove("task-dragging");
        draggedItem.style.opacity = "";
        draggedItem = null;
      }
      touchList = null;
      list.querySelectorAll(".task-drop-above").forEach((el) => el.classList.remove("task-drop-above"));
    });
  }

  // mouseup でリセット
  document.addEventListener("mouseup", () => {
    document.querySelectorAll(".task-item[draggable='true']").forEach((el) => {
      el.setAttribute("draggable", "false");
    });
  });
}

function getTaskInsertPoint(list, mouseY, items) {
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (mouseY < midY) return item;
  }
  return null;
}

/* ── ドラッグ&ドロップ ── */

function attachDragDropEvents() {
  const mql = window.matchMedia("(min-width: 1024px)");
  if (!mql.matches) return;

  const grid = document.getElementById("input-grid");
  if (!grid) return;

  const columns = grid.querySelectorAll(".input-column");
  let draggedCard = null;

  // ハンドルの mousedown で一時的に draggable を有効化（textarea の選択と干渉しない）
  grid.querySelectorAll(".card-drag-handle").forEach((handle) => {
    handle.addEventListener("mousedown", () => {
      const card = handle.closest(".draggable-card");
      if (card) card.setAttribute("draggable", "true");
    });
  });

  document.addEventListener("mouseup", () => {
    grid.querySelectorAll(".draggable-card").forEach((card) => {
      card.setAttribute("draggable", "false");
    });
  });

  // dragstart
  grid.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".draggable-card");
    if (!card) { e.preventDefault(); return; }

    draggedCard = card;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", card.id);

    requestAnimationFrame(() => {
      card.style.opacity = "0.35";
    });
  });

  // dragend
  grid.addEventListener("dragend", (e) => {
    const card = e.target.closest(".draggable-card");
    if (card) {
      card.classList.remove("dragging");
      card.style.opacity = "";
      card.setAttribute("draggable", "false");
    }
    draggedCard = null;
    columns.forEach((col) => col.classList.remove("drag-over"));
    grid.querySelectorAll(".drop-indicator").forEach((el) => el.remove());
  });

  // 各カラムにドロップゾーンを設定
  columns.forEach((column) => {
    column.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!draggedCard) return;

      column.classList.add("drag-over");

      const visibleCards = [...column.querySelectorAll(".draggable-card:not(.dragging)")].filter(
        (c) => c.style.display !== "none"
      );
      const afterCard = getInsertAfterCard(column, e.clientY, visibleCards);

      grid.querySelectorAll(".drop-indicator").forEach((el) => el.remove());
      const indicator = document.createElement("div");
      indicator.className = "drop-indicator";

      if (afterCard) {
        column.insertBefore(indicator, afterCard);
      } else {
        column.appendChild(indicator);
      }
    });

    column.addEventListener("dragleave", (e) => {
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove("drag-over");
        column.querySelectorAll(".drop-indicator").forEach((el) => el.remove());
      }
    });

    column.addEventListener("drop", (e) => {
      e.preventDefault();
      column.classList.remove("drag-over");
      grid.querySelectorAll(".drop-indicator").forEach((el) => el.remove());

      if (!draggedCard) return;

      const visibleCards = [...column.querySelectorAll(".draggable-card:not(.dragging)")].filter(
        (c) => c.style.display !== "none"
      );
      const afterCard = getInsertAfterCard(column, e.clientY, visibleCards);

      if (afterCard) {
        column.insertBefore(draggedCard, afterCard);
      } else {
        column.appendChild(draggedCard);
      }

      persistCurrentLayout(columns);
    });
  });

  // ビューポート変更への対応
  mql.addEventListener("change", (e) => {
    grid.querySelectorAll(".draggable-card").forEach((card) => {
      card.setAttribute("draggable", "false");
    });
  });
}

function getInsertAfterCard(column, mouseY, cards) {
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (mouseY < midY) return card;
  }
  return null;
}

function persistCurrentLayout(columns) {
  const layout = {};
  columns.forEach((column, colIndex) => {
    const cards = column.querySelectorAll(".draggable-card");
    cards.forEach((card, orderIndex) => {
      layout[card.id] = { column: colIndex, order: orderIndex };
    });
  });
  saveLayoutPreference(layout);
}

/* ── フォーム送信 ── */

async function submitForm(date, isEdit, btn) {
  const rawInput = document.getElementById("raw-input").value.trim();
  if (!rawInput) {
    showToast("行動ログを入力してください", "error");
    return;
  }

  const incompleteTasks = [...document.querySelectorAll("#planned-list .task-item .task-remove")]
    .map((el) => el.dataset.remove)
    .filter(Boolean);

  const completedTasks = [...document.querySelectorAll("#completed-list .task-item .task-remove")]
    .map((el) => el.dataset.remove)
    .filter(Boolean);

  const backlogTasks = [...document.querySelectorAll("#backlog-list .task-item .task-remove")]
    .map((el) => el.dataset.remove)
    .filter(Boolean);

  const plannedTasks = [...incompleteTasks, ...completedTasks];
  const availHoursEl = document.getElementById("available-hours");
  const availHoursVal = availHoursEl?.value ? parseFloat(availHoursEl.value) : null;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "保存中...";

  try {
    if (isEdit) {
      const updateData = {
        raw_input: rawInput,
        tasks_planned: plannedTasks,
        tasks_completed: completedTasks,
        tasks_backlog: backlogTasks,
      };
      if (availHoursVal !== null) updateData.available_hours = availHoursVal;
      await recordsApi.update(date, updateData);
      showToast("記録を更新しました！", "success");
    } else {
      try {
        await recordsApi.create(date, rawInput, plannedTasks, completedTasks, backlogTasks);
      } catch (createErr) {
        if (createErr.message.includes("409") || createErr.message.includes("すでに存在")) {
          const updateData = {
            raw_input: rawInput,
            tasks_planned: plannedTasks,
            tasks_completed: completedTasks,
            tasks_backlog: backlogTasks,
          };
          if (availHoursVal !== null) updateData.available_hours = availHoursVal;
          await recordsApi.update(date, updateData);
        } else {
          throw createErr;
        }
      }
      showToast("記録を保存しました！", "success");
    }
    window.location.hash = "/";
  } catch (err) {
    showToast(`保存に失敗しました: ${err.message}`, "error");
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* ── ユーティリティ ── */

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
