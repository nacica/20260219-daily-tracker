/**
 * 行動記録入力フォームコンポーネント
 * 新規作成・既存レコードの編集に対応
 */

import { recordsApi, analysisApi } from "../api.js";
import { showToast } from "../app.js";

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

function buildFormHTML(date, record, tasks, isEdit) {
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });

  const rawInput = record?.raw_input || "";
  const plannedTasks = tasks.planned || [];
  const completedTasks = tasks.completed || [];

  return `
    <h2 style="margin-bottom: 4px; font-size: 1.2rem;">${isEdit ? "記録を編集" : "行動を記録"}</h2>
    <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: var(--gap);">${dateLabel}</p>

    <div class="card">
      <div class="card-title">行動ログ</div>
      <div class="form-group">
        <label for="raw-input">今日の行動を自由に入力してください</label>
        <textarea
          id="raw-input"
          placeholder="8:00 起床&#10;8:30 朝食&#10;9:00-12:00 仕事（企画書作成）&#10;12:00 昼食&#10;13:00-14:30 YouTube視聴&#10;15:00-18:00 コードレビュー&#10;19:00 夕食&#10;20:00-22:00 読書&#10;23:00 就寝"
        >${rawInput}</textarea>
      </div>
    </div>

    <div class="card" id="task-card">
      <div class="card-title">タスク管理</div>

      <label>予定タスク</label>
      <ul class="task-list" id="planned-list">
        ${plannedTasks.filter((t) => !completedTasks.includes(t)).map((t) => buildTaskItem(t, false)).join("")}
      </ul>
      <div class="task-input-row">
        <input type="text" id="planned-input" placeholder="タスクを追加..." />
        <button class="btn btn-outline btn-sm" id="btn-add-task">追加</button>
      </div>

      <div class="completed-section" id="completed-section" style="${completedTasks.length ? "" : "display:none"}">
        <label class="completed-section-label">完了タスク<span class="completed-count" id="completed-count">${completedTasks.length}</span></label>
        <ul class="task-list" id="completed-list">
          ${completedTasks.map((t) => buildTaskItem(t, true)).join("")}
        </ul>
      </div>
    </div>

    <div class="card" style="margin-bottom: 0;">
      <button class="btn btn-primary" id="btn-submit" ${!rawInput && !isEdit ? "" : ""}>
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

function updateCompletedSection() {
  const section = document.getElementById("completed-section");
  const completedList = document.getElementById("completed-list");
  const count = completedList.querySelectorAll(".task-item").length;
  document.getElementById("completed-count").textContent = count;
  section.style.display = count ? "" : "none";
}

function attachFormEvents(date, isEdit) {
  const plannedList = document.getElementById("planned-list");
  const completedList = document.getElementById("completed-list");
  const plannedInput = document.getElementById("planned-input");

  // タスク追加
  function addTask() {
    const text = plannedInput.value.trim();
    if (!text) return;
    plannedList.insertAdjacentHTML("beforeend", buildTaskItem(text, false));
    plannedInput.value = "";
    plannedInput.focus();
  }

  document.getElementById("btn-add-task").addEventListener("click", addTask);
  plannedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addTask(); }
  });

  const taskCard = document.getElementById("task-card");

  // タスク削除（イベント委任 — click）
  taskCard.addEventListener("click", (e) => {
    if (e.target.dataset.remove === undefined) return;
    const li = e.target.closest("li");
    const wasCompleted = li.classList.contains("completed");
    li.remove();
    if (wasCompleted) updateCompletedSection();
  });

  // チェックボックス切り替え（change イベントで確実に状態取得）
  taskCard.addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    const li = e.target.closest("li");
    if (e.target.checked) {
      li.classList.add("completed");
      completedList.appendChild(li);
    } else {
      li.classList.remove("completed");
      plannedList.appendChild(li);
    }
    updateCompletedSection();
  });

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
}

async function submitForm(date, isEdit, btn) {
  const rawInput = document.getElementById("raw-input").value.trim();
  if (!rawInput) {
    showToast("行動ログを入力してください", "error");
    return;
  }

  // タスクリストを収集（予定リスト + 完了リスト両方から）
  const pendingTasks = [...document.querySelectorAll("#planned-list .task-item span")]
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  const completedTasks = [...document.querySelectorAll("#completed-list .task-item span")]
    .map((el) => el.textContent.trim())
    .filter(Boolean);

  const plannedTasks = [...pendingTasks, ...completedTasks];

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
    // ホームへ戻る
    window.location.hash = "/";
  } catch (err) {
    showToast(`保存に失敗しました: ${err.message}`, "error");
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
