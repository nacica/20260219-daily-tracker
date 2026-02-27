/**
 * 行動記録入力フォームコンポーネント
 * 新規作成・既存レコードの編集に対応
 * デスクトップ: 2列ドラッグ&ドロップレイアウト
 */

import { recordsApi, analysisApi } from "../api.js?v=20260227e";
import { showToast } from "../app.js?v=20260227e";

/* ── レイアウト永続化 ── */

const DEFAULT_LAYOUT = {
  "card-activity-log": { column: 0, order: 0 },
  "card-task-mgmt":    { column: 1, order: 0 },
  "card-actions":      { column: 1, order: 1 },
  "card-completed":    { column: 1, order: 2 },
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

  // 既存レコードの取得（編集時）
  let existingRecord = null;
  try {
    existingRecord = await recordsApi.get(date);
  } catch {}

  const isEdit = !!existingRecord;
  const tasks = existingRecord?.tasks || { planned: [], completed: [] };

  main.innerHTML = buildFormHTML(date, existingRecord, tasks, isEdit);
  attachFormEvents(date, isEdit);
}

/* ── HTML 生成 ── */

function buildFormHTML(date, record, tasks, isEdit) {
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });

  const rawInput = record?.raw_input || "";
  const plannedTasks = tasks.planned || [];
  const completedTasks = tasks.completed || [];
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
            placeholder="8:00 起床&#10;8:30 朝食&#10;9:00-12:00 仕事（企画書作成）&#10;12:00 昼食&#10;13:00-14:30 YouTube視聴&#10;15:00-18:00 コードレビュー&#10;19:00 夕食&#10;20:00-22:00 読書&#10;23:00 就寝"
          >${rawInput}</textarea>
        </div>
      </div>`,

    "card-task-mgmt": `
      <div class="card draggable-card" id="card-task-mgmt" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <div class="card-title">タスク管理</div>
        <label>予定タスク</label>
        <button class="btn btn-outline btn-sm" id="btn-carry-over" style="margin-bottom: 8px; width: 100%;">
          📋 昨日の未完了タスクを引き継ぐ
        </button>
        <ul class="task-list" id="planned-list">
          ${incompleteTasks.map((t) => buildTaskItem(t, false)).join("")}
        </ul>
        <div class="task-input-row">
          <input type="text" id="planned-input" placeholder="タスクを追加..." />
          <button class="btn btn-outline btn-sm" id="btn-add-task">追加</button>
        </div>
      </div>`,

    "card-actions": `
      <div class="card draggable-card" id="card-actions" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <button class="btn btn-primary" id="btn-submit">
          ${isEdit ? "✏️ 記録を更新する" : "💾 記録を保存する"}
        </button>
        ${isEdit ? `
        <div style="margin-top: 10px; display: flex; gap: 10px;">
          <button class="btn btn-outline btn-sm" id="btn-analyze" style="flex: 1;">
            🤖 AI で分析する
          </button>
          <button class="btn btn-outline btn-sm" id="btn-view-analysis" style="flex: 1;"
            onclick="window.location.hash='/analysis/${record?.date || ''}'">
            📊 分析を見る
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

  return `
    <h2 style="margin-bottom: 4px; font-size: 1.2rem;">${isEdit ? "記録を編集" : "行動を記録"}</h2>
    <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: var(--gap);">${dateLabel}</p>

    <div class="input-grid" id="input-grid">
      <div class="input-column" id="input-column-0" data-column="0">
        ${columns[0].map((c) => c.cardHTML).join("")}
      </div>
      <div class="input-column" id="input-column-1" data-column="1">
        ${columns[1].map((c) => c.cardHTML).join("")}
      </div>
    </div>
  `;
}

function buildTaskItem(taskText, isCompleted) {
  return `
    <li class="task-item${isCompleted ? " completed" : ""}">
      <input type="checkbox" ${isCompleted ? "checked" : ""} data-task="${escapeHTML(taskText)}" />
      <span>${escapeHTML(taskText)}</span>
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

/* ── イベント登録 ── */

function attachFormEvents(date, isEdit) {
  const plannedList = document.getElementById("planned-list");
  const plannedInput = document.getElementById("planned-input");
  const completedList = document.getElementById("completed-list");

  // バックグラウンド自動保存（排他制御付き）
  let isSaving = false;
  let pendingSave = false;

  async function saveDataQuietly() {
    if (isSaving) {
      pendingSave = true;
      return;
    }

    const rawInput = document.getElementById("raw-input").value.trim();
    if (!isEdit && !rawInput) return;

    const incompleteTasks = [...document.querySelectorAll("#planned-list .task-item span")]
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    const completedTasks = [...document.querySelectorAll("#completed-list .task-item span")]
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    const plannedTasks = [...incompleteTasks, ...completedTasks];

    isSaving = true;
    try {
      if (isEdit) {
        await recordsApi.update(date, {
          raw_input: rawInput,
          tasks_planned: plannedTasks,
          tasks_completed: completedTasks,
        });
      } else {
        await recordsApi.create(date, rawInput, plannedTasks);
        isEdit = true;
        const btnSubmit = document.getElementById("btn-submit");
        if (btnSubmit) btnSubmit.textContent = "✏️ 記録を更新する";
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
        if (planned.filter((t) => !completed.includes(t)).length > 0) break;
        found = null;
      } catch {
        found = null;
      }
    }

    try {
      if (!found) {
        showToast("直近7日間に未完了タスクが見つかりません", "info");
        return;
      }
      const planned = found.tasks?.planned || [];
      const completed = found.tasks?.completed || [];
      const incomplete = planned.filter((t) => !completed.includes(t));

      const existing = new Set(
        [...document.querySelectorAll("#planned-list .task-item span, #completed-list .task-item span")]
          .map((el) => el.textContent.trim())
      );
      let added = 0;
      for (const task of incomplete) {
        if (!existing.has(task)) {
          plannedList.insertAdjacentHTML("beforeend", buildTaskItem(task, false));
          added++;
        }
      }
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
      btn.textContent = "📋 昨日の未完了タスクを引き継ぐ";
    }
  });

  // タスク追加
  function addTask() {
    const text = plannedInput.value.trim();
    if (!text) return;
    plannedList.insertAdjacentHTML("beforeend", buildTaskItem(text, false));
    plannedInput.value = "";
    plannedInput.focus();
    saveDataQuietly();
  }

  document.getElementById("btn-add-task").addEventListener("click", addTask);
  plannedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addTask(); }
  });

  // タスク削除 & チェックボックス切り替え（イベント委任）
  function handleTaskClick(e) {
    if (e.target.dataset.remove !== undefined) {
      e.target.closest("li").remove();
      syncCompletedCard();
      saveDataQuietly();
      return;
    }
    if (e.target.type === "checkbox") {
      const li = e.target.closest("li");
      if (e.target.checked) {
        li.classList.add("completed");
        completedList.appendChild(li);
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
        e.target.textContent = "🤖 AI で分析する";
      }
    });
  }

  // ドラッグ&ドロップ（デスクトップのみ）
  attachDragDropEvents();
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

  const incompleteTasks = [...document.querySelectorAll("#planned-list .task-item span")]
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  const completedTasks = [...document.querySelectorAll("#completed-list .task-item span")]
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  const plannedTasks = [...incompleteTasks, ...completedTasks];

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "保存中...";

  try {
    if (isEdit) {
      await recordsApi.update(date, {
        raw_input: rawInput,
        tasks_planned: plannedTasks,
        tasks_completed: completedTasks,
      });
      showToast("記録を更新しました！", "success");
    } else {
      await recordsApi.create(date, rawInput, plannedTasks);
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
