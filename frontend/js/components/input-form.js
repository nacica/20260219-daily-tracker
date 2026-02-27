/**
 * 行動記録入力フォームコンポーネント
 * 新規作成・既存レコードの編集に対応
 */

import { recordsApi, analysisApi } from "../api.js?v=20260227a";
import { showToast } from "../app.js?v=20260227a";

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
  const hasCompleted = completedTasks.length > 0;

  // 未完了タスク → 仕切り → 完了タスク の順で 1 つの <ul> に入れる
  const incompleteTasks = plannedTasks.filter((t) => !completedTasks.includes(t));

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

    <div class="card">
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

    <div class="card completed-tasks-card" id="completed-tasks-card" style="${hasCompleted ? "" : "display:none"}">
      <div class="card-title">完了タスク <span class="completed-count" id="completed-count">${completedTasks.length}</span></div>
      <ul class="task-list" id="completed-list">
        ${completedTasks.map((t) => buildTaskItem(t, true)).join("")}
      </ul>
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
  const card = document.getElementById("completed-tasks-card");
  if (!card) return;
  const count = document.querySelectorAll("#completed-list .task-item").length;
  card.style.display = count > 0 ? "" : "none";
  document.getElementById("completed-count").textContent = count;
}

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
    if (!isEdit && !rawInput) return; // 新規作成時は行動ログが必要

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

    // 直近 7 日間を遡って未完了タスクを持つ日を探す
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
        found = null; // 未完了タスクがないので次の日へ
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

      // 今日の既存タスクを取得して重複排除
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
    // 削除ボタン
    if (e.target.dataset.remove !== undefined) {
      e.target.closest("li").remove();
      syncCompletedCard();
      saveDataQuietly();
      return;
    }
    // チェックボックス — リスト間で移動
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
}

async function submitForm(date, isEdit, btn) {
  const rawInput = document.getElementById("raw-input").value.trim();
  if (!rawInput) {
    showToast("行動ログを入力してください", "error");
    return;
  }

  // 2 つのリストからタスクを収集
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
