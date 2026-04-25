/**
 * 行動記録入力フォームコンポーネント
 * 新規作成・既存レコードの編集に対応
 * デスクトップ: 2列ドラッグ&ドロップレイアウト
 * 朝のタスク整理（ソクラテス式問答）統合
 */

import { recordsApi, analysisApi, morningDialogueApi, remindersApi, categoriesApi } from "../api.js?v=20260425i";
import { showToast } from "../app.js?v=20260425i";
import { showTaskCompleteAnimation, buildTaskStatsCards } from "./task-stats.js?v=20260425i";

/* ── カテゴリ管理 ── */

const CATEGORY_STORAGE_KEY = "task-categories";
const LAST_CATEGORY_KEY = "task-last-category";
const DEFAULT_COLORS = ["#0088aa", "#00894d", "#c47800", "#9c27b0", "#c62828", "#0277bd", "#2e7d32", "#e65100"];

function getCategories() {
  try {
    const saved = localStorage.getItem(CATEGORY_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveCategories(categories) {
  localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
  // バックエンドにも同期（awaitしないがエラーログは出す）
  categoriesApi.save(categories).catch((e) => console.warn("カテゴリ同期失敗:", e));
}

/** バックエンドからカテゴリを取得してlocalStorageとドロップダウンを同期 */
async function syncCategoriesFromServer() {
  try {
    const res = await categoriesApi.get();
    const remote = res.categories || [];
    const local = getCategories();

    if (remote.length > 0) {
      // サーバー側にデータがある場合: ローカルとマージ（サーバー優先）
      const merged = [...remote];
      for (const lc of local) {
        if (!merged.some((rc) => rc.name === lc.name)) {
          merged.push(lc);
        }
      }
      localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(merged));
      if (merged.length !== remote.length) {
        await categoriesApi.save(merged);
      }
    } else if (local.length > 0) {
      // サーバーが空でローカルにデータがある場合: ローカルをサーバーに送信
      await categoriesApi.save(local);
    }
    refreshCategoryDropdowns();
  } catch (e) {
    console.warn("カテゴリ同期失敗:", e);
  }
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

/* ── カラム数永続化 ── */

const COLUMN_COUNT_KEY = "input-form-column-count";

function getColumnCount() {
  const saved = localStorage.getItem(COLUMN_COUNT_KEY);
  return saved ? parseInt(saved, 10) : 3;
}

function saveColumnCount(count) {
  localStorage.setItem(COLUMN_COUNT_KEY, String(count));
}

function applyColumnCount(count) {
  const grid = document.getElementById("input-grid");
  if (!grid) return;
  grid.setAttribute("data-columns", count);
  // ボタンのアクティブ状態を更新
  document.querySelectorAll(".col-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", parseInt(btn.dataset.cols, 10) === count);
  });
  distributeMasonry();
}

/* ── Masonry列配置の永続化 ── */

function getMasonryLayoutKey(colCount) {
  return "masonry-layout-" + colCount;
}

function getSavedMasonryLayout(colCount) {
  try {
    return JSON.parse(localStorage.getItem(getMasonryLayoutKey(colCount))) || null;
  } catch { return null; }
}

function saveMasonryLayout(grid) {
  const colCount = getColumnCount();
  const cols = grid.querySelectorAll(".masonry-col");
  const layout = {};
  cols.forEach((col, ci) => {
    col.querySelectorAll(".draggable-card").forEach((card, pos) => {
      layout[card.id] = { col: ci, pos };
    });
  });
  localStorage.setItem(getMasonryLayoutKey(colCount), JSON.stringify(layout));
}

/**
 * JS Masonry: カードをN本のflex列に振り分ける。
 * 保存済みの列配置があればそれを復元し、なければラウンドロビンで初期配置する。
 */
function distributeMasonry() {
  const grid = document.getElementById("input-grid");
  if (!grid) return;

  const isDesktop = window.matchMedia("(min-width: 1024px)").matches;

  // モバイルではフラット表示に戻す
  if (!isDesktop) {
    flattenMasonry(grid);
    return;
  }

  const colCount = getColumnCount();

  // 全カードを収集（.masonry-col内にいても直下にいても取得）
  const cards = [...grid.querySelectorAll(":scope > .draggable-card, .masonry-col > .draggable-card")];

  // 既存の列ラッパーを削除
  grid.querySelectorAll(".masonry-col").forEach((col) => col.remove());
  cards.forEach((card) => card.remove());

  // N本の列ラッパーを作成
  const columns = [];
  for (let i = 0; i < colCount; i++) {
    const col = document.createElement("div");
    col.className = "masonry-col";
    grid.appendChild(col);
    columns.push(col);
  }

  // 保存済み配置を復元、なければラウンドロビン
  const saved = getSavedMasonryLayout(colCount);

  if (saved) {
    const assigned = [];
    const unassigned = [];

    cards.forEach((card) => {
      const info = saved[card.id];
      if (info && info.col < colCount) {
        assigned.push({ card, col: info.col, pos: info.pos });
      } else {
        unassigned.push(card);
      }
    });

    // 列・位置順でソートして配置
    assigned.sort((a, b) => a.col - b.col || a.pos - b.pos);
    assigned.forEach(({ card, col }) => columns[col].appendChild(card));

    // 未割当カードは最も少ない列へ
    unassigned.forEach((card) => {
      const shortest = columns.reduce((a, b) =>
        a.children.length <= b.children.length ? a : b
      );
      shortest.appendChild(card);
    });
  } else {
    // 初回: ラウンドロビン
    cards.forEach((card, i) => {
      columns[i % colCount].appendChild(card);
    });
  }

  saveMasonryLayout(grid);
}

/**
 * masonry列ラッパーを解除してカードをフラットに戻す
 */
function flattenMasonry(grid) {
  const cols = grid.querySelectorAll(".masonry-col");
  if (cols.length === 0) return;

  const cards = [...grid.querySelectorAll(".masonry-col > .draggable-card")];
  cols.forEach((col) => col.remove());
  cards.forEach((card) => grid.appendChild(card));
}

/* ── レイアウト永続化 ── */

const DEFAULT_LAYOUT = {
  "card-morning-dialogue": { order: 0 },
  "card-reminder-board":   { order: 1 },
  "card-activity-log":     { order: 2 },
  "card-task-mgmt":        { order: 3 },
  "card-backlog":          { order: 4 },
  "card-actions":          { order: 5 },
  "card-completed":        { order: 6 },
};

const CARD_IDS = Object.keys(DEFAULT_LAYOUT);

function getLayoutPreference() {
  try {
    const saved = localStorage.getItem("input-form-layout");
    if (saved) {
      const parsed = JSON.parse(saved);
      // すべてのカードIDが存在するか検証
      for (const id of CARD_IDS) {
        if (!parsed[id] || typeof parsed[id].order !== "number") return DEFAULT_LAYOUT;
      }
      // 旧フォーマット（column付き）を順序ベースに変換
      const hasColumn = Object.values(parsed).some((v) => "column" in v);
      if (hasColumn) {
        const sorted = CARD_IDS.slice().sort((a, b) => {
          const pa = parsed[a], pb = parsed[b];
          if (pa.column !== pb.column) return (pa.column || 0) - (pb.column || 0);
          return (pa.order || 0) - (pb.order || 0);
        });
        const migrated = {};
        sorted.forEach((id, i) => { migrated[id] = { order: i }; });
        saveLayoutPreference(migrated);
        return migrated;
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
 * /input 画面の楽観描画用キャッシュ
 * localStorage に前回描画時のスナップショット（record, morningDialogue, tasks, 休養日状態）を保存し、
 * 次回起動時に API 応答を待たずに即描画する。app.js のホーム画面からも書き込み可能
 * （ホームで取得済みの record を事前ウォームアップするため）。
 */
const INPUT_CACHE_KEY_PREFIX = "input_cache_v1_";

function loadInputCache(date) {
  try {
    const raw = localStorage.getItem(INPUT_CACHE_KEY_PREFIX + date);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.date !== date) return null;
    return data;
  } catch { return null; }
}

function saveInputCache(date, snapshot) {
  try {
    const existing = loadInputCache(date) || {};
    const merged = { ...existing, ...snapshot, date, ts: Date.now() };
    localStorage.setItem(INPUT_CACHE_KEY_PREFIX + date, JSON.stringify(merged));
  } catch {}
}

/**
 * セッション内の categories / reminders 同期に短い TTL を設けて、
 * 同じセッションで /input を複数回開いた時の重複 API 呼び出しを避ける
 */
const SESSION_SYNC_TTL_MS = 5 * 60 * 1000; // 5分
let _lastRemindersSyncAt = 0;
let _lastCategoriesSyncAt = 0;

async function syncRemindersWithCache() {
  if (Date.now() - _lastRemindersSyncAt < SESSION_SYNC_TTL_MS && _remindersCache.length > 0) return;
  await syncRemindersFromServer();
  _lastRemindersSyncAt = Date.now();
}

async function syncCategoriesWithCache() {
  if (Date.now() - _lastCategoriesSyncAt < SESSION_SYNC_TTL_MS) return;
  await syncCategoriesFromServer();
  _lastCategoriesSyncAt = Date.now();
}

/** 日付文字列の前日を返す */
function _prevDateStr(date, daysAgo) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString("sv-SE");
}

/** 朝問答 plan + 瞑想タスク + backlog 引き継ぎを 1 箇所で適用 */
function _mergeTasks(existingRecord, morningDialogue, prevRecords) {
  const tasks = existingRecord?.tasks
    ? { planned: [...(existingRecord.tasks.planned || [])], completed: [...(existingRecord.tasks.completed || [])], backlog: [...(existingRecord.tasks.backlog || [])] }
    : { planned: [], completed: [], backlog: [] };

  // 近日中タスク引き継ぎ: 直近7日を1回の list で取得済み → 新しい日から非空 backlog を採用
  if (tasks.backlog.length === 0 && Array.isArray(prevRecords) && prevRecords.length > 0) {
    const sorted = prevRecords.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const p of sorted) {
      const bk = p?.tasks?.backlog || [];
      if (bk.length > 0) { tasks.backlog = [...bk]; break; }
    }
  }

  // 朝問答 plan からタスクマージ（completed のみ）
  if (morningDialogue?.status === "completed" && morningDialogue.plan) {
    const plan = morningDialogue.plan;
    const existingNames = new Set([
      ...tasks.planned.map((t) => (typeof t === "string" ? t : t.name || t.task || "")),
      ...tasks.completed.map((t) => (typeof t === "string" ? t : t.name || t.task || "")),
      ...tasks.backlog.map((t) => (typeof t === "string" ? t : t.name || t.task || "")),
    ]);
    for (const item of plan.tasks_today || []) {
      const name = item.task || "";
      if (name && !existingNames.has(name)) { tasks.planned.push(name); existingNames.add(name); }
    }
    for (const task of plan.carried_over || []) {
      if (task && !existingNames.has(task)) { tasks.planned.push(task); existingNames.add(task); }
    }
  }

  // デフォルトタスク「トラタカ瞑想」を自動注入（未登録かつ未完了の場合）
  const MEDITATION_TASK = "トラタカ瞑想";
  const allTaskNames = new Set([
    ...tasks.planned.map((t) => (typeof t === "string" ? t : t.name || t.task || "")),
    ...tasks.completed.map((t) => (typeof t === "string" ? t : t.name || t.task || "")),
  ]);
  if (!allTaskNames.has(MEDITATION_TASK)) {
    tasks.planned.unshift(MEDITATION_TASK);
  }

  return tasks;
}

/** フォームを描画してイベントを再アタッチする共通処理 */
function _paintForm(main, date, existingRecord, morningDialogue, tasks, isRestDay, restReason) {
  const isEdit = !!existingRecord;
  // タスク統計カードは後から差し込むためのプレースホルダ（スロット）を先頭に用意
  main.innerHTML = `<div id="task-stats-slot"></div>` +
    buildFormHTML(date, existingRecord, tasks, isEdit, morningDialogue, isRestDay, restReason);
  attachFormEvents(date, isEdit);
  attachMorningDialogueEvents(date, morningDialogue);
  attachReminderEvents();
  attachRestDayEvents(date, isRestDay);
}

/**
 * 入力フォームをメインエリアにレンダリングする
 * @param {string} date - 対象日 (YYYY-MM-DD)
 *
 * 高速化戦略:
 *   1. localStorage キャッシュから即描画（スピナー回避）
 *   2. タスク統計カードは並行取得 → 準備でき次第スロットに差し込む（クリティカルパス外）
 *   3. クリティカルパスの API 5 本を並列: record / morning / reminders / categories / 直近7日の list
 *   4. reminders / categories は 5 分 TTL のセッションキャッシュで二重取得を回避
 */
export async function renderInputForm(date) {
  const main = document.querySelector("main");

  // ── 1. 楽観描画: 前回のキャッシュから即描画 ──
  const cached = loadInputCache(date);
  if (cached) {
    if (Array.isArray(cached.reminders)) _remindersCache = cached.reminders;
    // キャッシュ内容から tasks を合成（prevRecords はキャッシュ済みのものを使う）
    const cachedTasks = cached.tasks || _mergeTasks(cached.existingRecord, cached.morningDialogue, cached.prevRecords || []);
    _paintForm(main, date, cached.existingRecord || null, cached.morningDialogue || null, cachedTasks,
      !!cached.isRestDay, cached.restReason || "");
  } else {
    main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;
  }

  // ── 2. タスク統計カードは並列で取得 → 準備でき次第スロットへ差し込む ──
  const statsPromise = buildTaskStatsCards().catch(() => "");
  statsPromise.then((html) => {
    if (!html) return;
    const slot = document.getElementById("task-stats-slot");
    if (slot) slot.innerHTML = html;
  });

  // ── 3. クリティカルパスの API を 5 本並列実行 ──
  const startStr = _prevDateStr(date, 7);
  const endStr = _prevDateStr(date, 1);

  const [recordResult, morningResult, , , prevResult] = await Promise.allSettled([
    recordsApi.get(date),
    morningDialogueApi.get(date),
    syncRemindersWithCache(),
    syncCategoriesWithCache(),
    recordsApi.list(startStr, endStr),
  ]);

  const existingRecord = recordResult.status === "fulfilled" ? recordResult.value : null;
  const morningDialogue = morningResult.status === "fulfilled" ? morningResult.value : null;
  const prevRecords = prevResult.status === "fulfilled" ? (prevResult.value || []) : [];

  const tasks = _mergeTasks(existingRecord, morningDialogue, prevRecords);
  const isRestDay = existingRecord?.rest_day || false;
  const restReason = existingRecord?.rest_reason || "";

  // ── 4. フレッシュデータで再描画 ──
  _paintForm(main, date, existingRecord, morningDialogue, tasks, isRestDay, restReason);

  // ── 5. キャッシュを更新（次回の楽観描画用）──
  saveInputCache(date, {
    existingRecord,
    morningDialogue,
    tasks,
    isRestDay,
    restReason,
    prevRecords,
    reminders: _remindersCache,
  });

  // ── 6. 再描画でスロットが空になったため、ready な統計 HTML を差し込む ──
  const html = await statsPromise;
  const slot = document.getElementById("task-stats-slot");
  if (slot && html) slot.innerHTML = html;
}

/* ── 付箋リマインダー ── */

// メモリキャッシュ（サーバーが唯一のデータソース）
let _remindersCache = [];

function getReminders() {
  return _remindersCache;
}

async function saveReminders(list) {
  _remindersCache = list;
  await remindersApi.save(list).catch(() => {});
}

/** サーバーからリマインダーを取得 */
async function syncRemindersFromServer() {
  try {
    const res = await remindersApi.get();
    _remindersCache = res.items || [];
  } catch {
    // オフライン時はキャッシュのまま
  }
}


function formatReminderDate(timestamp) {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = weekdays[d.getDay()];
  const h = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${m}/${day}(${w}) ${h}:${min}`;
}

function buildStickyNoteHTML(r, activeClass = "") {
  const dateStr = formatReminderDate(r.createdAt);
  return `<div class="sticky-note${activeClass}" data-id="${escapeHTML(r.id)}">
    <div class="sticky-note-body">
      ${dateStr ? `<div class="sticky-note-date">${dateStr}</div>` : ""}
      <span class="sticky-text">${escapeHTML(r.text)}</span>
    </div>
    <div class="sticky-actions">
      <button class="sticky-delete" title="削除">&times;</button>
      <button class="sticky-edit" title="編集">&#9998;</button>
    </div>
  </div>`;
}

let stickyCurrentIndex = 0;
let stickyRandomMode = false;

function buildReminderBoardHTML() {
  const reminders = getReminders();
  // インデックスを範囲内に補正
  if (stickyCurrentIndex >= reminders.length) stickyCurrentIndex = Math.max(0, reminders.length - 1);

  const notesHTML = reminders.map((r, i) => {
    const activeClass = i === stickyCurrentIndex ? " active" : "";
    return buildStickyNoteHTML(r, activeClass);
  }).join("");

  const randomActiveClass = stickyRandomMode ? " active" : "";
  const navHTML = reminders.length > 1
    ? `<div class="sticky-nav">
        <button class="sticky-nav-btn" id="sticky-prev">&#9664;</button>
        <span class="sticky-counter" id="sticky-counter">${stickyCurrentIndex + 1} / ${reminders.length}</span>
        <button class="sticky-nav-btn" id="sticky-next">&#9654;</button>
        <button class="sticky-nav-btn sticky-random-btn${randomActiveClass}" id="sticky-random" title="ランダム">&#x1f500;</button>
      </div>`
    : "";

  return `
    <div class="card draggable-card reminder-board-card" id="card-reminder-board" draggable="false">
      <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
      <div class="card-title">今日意識すること</div>
      ${navHTML}
      <div class="sticky-notes" id="sticky-notes">
        ${notesHTML || '<p class="sticky-empty">まだメモがありません。<br>下から追加してみましょう。</p>'}
      </div>
      <div class="sticky-add-area">
        <div class="sticky-add-row">
          <textarea id="sticky-input" class="sticky-input" placeholder="" rows="1"></textarea>
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
    reminders.push({ id: Date.now().toString(36), text, createdAt: Date.now() });
    saveReminders(reminders);
    stickyCurrentIndex = reminders.length - 1; // 新規追加は最後に移動
    refreshStickyNotes();
    input.value = "";
    input.focus();
  }

  addBtn.addEventListener("click", addSticky);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addSticky(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = input.scrollHeight + "px";
  });

  // 削除・編集（イベント委譲）
  const container = document.getElementById("sticky-notes");
  if (container) {
    container.addEventListener("click", (e) => {
      // 削除
      const delBtn = e.target.closest(".sticky-delete");
      if (delBtn) {
        const note = delBtn.closest(".sticky-note");
        if (!note) return;
        const id = note.dataset.id;
        const reminders = getReminders().filter((r) => r.id !== id);
        saveReminders(reminders);
        if (stickyCurrentIndex >= reminders.length) stickyCurrentIndex = Math.max(0, reminders.length - 1);
        refreshStickyNotes();
        return;
      }

      // 編集
      const editBtn = e.target.closest(".sticky-edit");
      if (editBtn) {
        const note = editBtn.closest(".sticky-note");
        if (!note) return;
        const id = note.dataset.id;
        const reminders = getReminders();
        const target = reminders.find((r) => r.id === id);
        if (!target) return;
        const body = note.querySelector(".sticky-note-body");
        const textEl = note.querySelector(".sticky-text");
        if (!body || !textEl) return;

        // テキストを編集用 textarea に差し替え
        const textarea = document.createElement("textarea");
        textarea.className = "sticky-edit-area";
        textarea.value = target.text;
        textEl.replaceWith(textarea);
        textarea.focus();

        // 編集ボタンを「保存」に変更
        editBtn.innerHTML = "&#10003;";
        editBtn.title = "保存";
        editBtn.classList.add("sticky-save");

        // 保存処理
        function save() {
          const newText = textarea.value.trim();
          if (newText) {
            target.text = newText;
            saveReminders(reminders);
          }
          refreshStickyNotes();
        }

        editBtn.removeEventListener("click", save);
        editBtn.addEventListener("click", (ev) => { ev.stopPropagation(); save(); }, { once: true });
        textarea.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); save(); }
        });
        return;
      }

      // カード本体クリックで次のカードへ（削除・編集ボタン以外）
      // 編集中（textarea がある場合）はめくらない
      const note = e.target.closest(".sticky-note");
      if (note && getReminders().length > 1 && !note.querySelector(".sticky-edit-area")) {
        navigateSticky(1);
        return;
      }
    });
  }

  // ◀ ▶ ボタン
  attachStickyNavEvents();

  // スワイプ対応
  attachStickySwipeEvents();
}

function attachStickyNavEvents() {
  const prevBtn = document.getElementById("sticky-prev");
  const nextBtn = document.getElementById("sticky-next");
  const randomBtn = document.getElementById("sticky-random");
  if (prevBtn) prevBtn.addEventListener("click", () => { navigateSticky(-1); });
  if (nextBtn) nextBtn.addEventListener("click", () => { navigateSticky(1); });
  if (randomBtn) randomBtn.addEventListener("click", () => {
    stickyRandomMode = !stickyRandomMode;
    randomBtn.classList.toggle("active", stickyRandomMode);
  });
}

function navigateSticky(delta) {
  const reminders = getReminders();
  const len = reminders.length;
  if (stickyRandomMode && len > 1) {
    let next;
    do { next = Math.floor(Math.random() * len); } while (next === stickyCurrentIndex);
    stickyCurrentIndex = next;
  } else {
    stickyCurrentIndex = (stickyCurrentIndex + delta + len) % len;
  }
  showStickyAtIndex();
}

function showStickyAtIndex() {
  const container = document.getElementById("sticky-notes");
  if (!container) return;
  const notes = container.querySelectorAll(".sticky-note");
  notes.forEach((note, i) => {
    note.classList.toggle("active", i === stickyCurrentIndex);
  });

  // カウンター更新
  const counterEl = document.getElementById("sticky-counter");
  if (counterEl) counterEl.textContent = `${stickyCurrentIndex + 1} / ${notes.length}`;

  // ボタンの disabled 更新
  const prevBtn = document.getElementById("sticky-prev");
  const nextBtn = document.getElementById("sticky-next");
  if (prevBtn) prevBtn.disabled = false;
  if (nextBtn) nextBtn.disabled = false;
}

function refreshStickyNotes() {
  const board = document.getElementById("card-reminder-board");
  if (!board) return;
  const reminders = getReminders();

  // インデックス補正
  if (stickyCurrentIndex >= reminders.length) stickyCurrentIndex = Math.max(0, reminders.length - 1);

  // ナビゲーション更新
  const existingNav = board.querySelector(".sticky-nav");
  if (reminders.length > 1) {
    const randomActiveClass = stickyRandomMode ? " active" : "";
    const navHTML = `<div class="sticky-nav">
      <button class="sticky-nav-btn" id="sticky-prev">&#9664;</button>
      <span class="sticky-counter" id="sticky-counter">${stickyCurrentIndex + 1} / ${reminders.length}</span>
      <button class="sticky-nav-btn" id="sticky-next">&#9654;</button>
      <button class="sticky-nav-btn sticky-random-btn${randomActiveClass}" id="sticky-random" title="ランダム">&#x1f500;</button>
    </div>`;
    if (existingNav) {
      existingNav.outerHTML = navHTML;
    } else {
      const title = board.querySelector(".card-title");
      if (title) title.insertAdjacentHTML("afterend", navHTML);
    }
    attachStickyNavEvents();
  } else if (existingNav) {
    existingNav.remove();
  }

  // カード描画
  const container = document.getElementById("sticky-notes");
  if (!container) return;
  if (reminders.length === 0) {
    container.innerHTML = '<p class="sticky-empty">まだメモがありません。<br>下から追加してみましょう。</p>';
    return;
  }
  container.innerHTML = reminders.map((r, i) => {
    const activeClass = i === stickyCurrentIndex ? " active" : "";
    return buildStickyNoteHTML(r, activeClass);
  }).join("");

  attachStickySwipeEvents();
}

function attachStickySwipeEvents() {
  const container = document.getElementById("sticky-notes");
  if (!container || container._swipeAttached) return;
  container._swipeAttached = true;

  let startX = 0, startY = 0;
  container.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return; // 横スワイプのみ
    navigateSticky(dx < 0 ? 1 : -1);
  }, { passive: true });
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
      <div class="card draggable-card morning-dialogue-card morning-completed" id="card-morning-dialogue" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
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
      <div class="card draggable-card morning-dialogue-card" id="card-morning-dialogue" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
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
            <textarea id="morning-input" rows="2" placeholder=""></textarea>
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
    <div class="card draggable-card morning-dialogue-card" id="card-morning-dialogue" draggable="false">
      <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
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

/* ── タイムライン入力 ── */

/**
 * raw_input テキストをタイムライン行にパース
 * 対応形式: "HH:MM-HH:MM 内容", "HH:MM 内容", "HH:MM～HH:MM 内容"
 */
function parseRawInputToTimeline(rawInput) {
  if (!rawInput || !rawInput.trim()) return [];
  const lines = rawInput.split("\n").filter((l) => l.trim());
  const rows = [];
  for (const line of lines) {
    const m = line.match(/^(\d{1,2}:\d{2})\s*[-~～ー]\s*(\d{1,2}:\d{2})\s+(.+)$/);
    if (m) {
      rows.push({ start: padTime(m[1]), end: padTime(m[2]), activity: m[3].trim() });
      continue;
    }
    const m2 = line.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
    if (m2) {
      rows.push({ start: padTime(m2[1]), end: "", activity: m2[2].trim() });
      continue;
    }
    // パースできない行はそのまま活動名に
    rows.push({ start: "", end: "", activity: line.trim() });
  }
  return rows;
}

function padTime(t) {
  const [h, m] = t.split(":");
  return `${h.padStart(2, "0")}:${m}`;
}

function buildTimelineRowHTML(start = "", end = "", activity = "") {
  const hasEnd = !!end;
  const isCompleted = !!(start && activity);
  const summaryText = isCompleted
    ? `${start}${end ? " ～ " + end : ""}　${escapeHTMLAttr(activity)}`
    : "";
  return `
    <div class="timeline-row${hasEnd ? " has-end" : ""}${isCompleted ? " collapsed" : ""}">
      <div class="timeline-row-summary"${isCompleted ? "" : ' style="display:none"'}>${summaryText}</div>
      <div class="timeline-row-edit"${isCompleted ? ' style="display:none"' : ""}>
        <input type="time" class="timeline-start" value="${start}" />
        <span class="timeline-end-group"${hasEnd ? "" : ' style="display:none"'}>
          <span class="timeline-separator">～</span>
          <input type="time" class="timeline-end" value="${end}" />
        </span>
        <button class="timeline-toggle-end"${hasEnd ? ' style="display:none"' : ""}>${hasEnd ? "" : "+終了"}</button>
        <input type="text" class="timeline-activity" value="${escapeHTMLAttr(activity)}" placeholder="" />
      </div>
      <div class="timeline-row-reorder">
        <button class="timeline-row-up" title="上に移動">▲</button>
        <button class="timeline-row-down" title="下に移動">▼</button>
      </div>
      <button class="timeline-row-remove" title="削除">✕</button>
    </div>`;
}

/**
 * タイムライン行を折りたたみ表示にする
 */
function collapseTimelineRow(row) {
  const start = row.querySelector(".timeline-start").value;
  const end = row.querySelector(".timeline-end").value;
  const activity = row.querySelector(".timeline-activity").value.trim();
  if (!start || !activity) return; // 未入力なら折りたたまない
  const summary = row.querySelector(".timeline-row-summary");
  summary.textContent = `${start}${end ? " ～ " + end : ""}　${activity}`;
  summary.style.display = "";
  row.querySelector(".timeline-row-edit").style.display = "none";
  row.classList.add("collapsed");
}

/**
 * 折りたたみ行を展開して編集可能にする
 */
function expandTimelineRow(row) {
  row.querySelector(".timeline-row-summary").style.display = "none";
  row.querySelector(".timeline-row-edit").style.display = "";
  row.classList.remove("collapsed");
  row.querySelector(".timeline-activity").focus();
}

function buildTimelineRowsFromRawInput(rawInput) {
  const rows = parseRawInputToTimeline(rawInput);
  if (rows.length === 0) {
    // デフォルトで空の行を1つ表示
    return buildTimelineRowHTML();
  }
  return rows.map((r) => buildTimelineRowHTML(r.start, r.end, r.activity)).join("");
}

/**
 * タイムライン行のデータを raw_input テキストに変換
 */
function timelineToRawInput() {
  const rows = document.querySelectorAll("#timeline-rows .timeline-row");
  const lines = [];
  for (const row of rows) {
    const start = row.querySelector(".timeline-start").value;
    const end = row.querySelector(".timeline-end").value;
    const activity = row.querySelector(".timeline-activity").value.trim();
    if (!activity && !start && !end) continue;
    if (start && end) {
      lines.push(`${start}-${end} ${activity}`);
    } else if (start) {
      lines.push(`${start} ${activity}`);
    } else {
      lines.push(activity);
    }
  }
  return lines.join("\n");
}

function escapeHTMLAttr(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
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
          <div class="activity-log-mode-toggle">
            <button class="mode-toggle-btn active" id="btn-mode-timeline" data-mode="timeline">タイムライン</button>
            <button class="mode-toggle-btn" id="btn-mode-freeform" data-mode="freeform">自由入力</button>
          </div>
          <div id="timeline-mode">
            <div class="timeline-rows" id="timeline-rows">
              ${buildTimelineRowsFromRawInput(rawInput)}
            </div>
            <div class="timeline-bottom-actions">
              <button class="btn btn-outline btn-sm timeline-add-btn" id="btn-add-timeline-row">
                ＋ 行動を追加
              </button>
              <button class="btn btn-outline btn-sm timeline-sort-btn" id="btn-sort-timeline" title="時刻順に並べ替え">
                ↕ 時刻順
              </button>
            </div>
          </div>
          <div id="freeform-mode" style="display: none;">
            <label for="raw-input">今日の行動を自由に入力してください</label>
            <textarea
              id="raw-input"
              placeholder=""
            >${rawInput}</textarea>
          </div>
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
          <input type="text" id="planned-input" placeholder="" />
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
            <input type="text" id="new-category-input" placeholder="" />
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
          <input type="text" id="backlog-input" placeholder="" />
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

  // 朝問答 + 付箋リマインダーもカードマップに統合
  cards["card-morning-dialogue"] = buildMorningDialogueHTML(morningDialogue);
  cards["card-reminder-board"] = buildReminderBoardHTML();

  // localStorage のレイアウトに従ってカードを順序でソート
  const layout = getLayoutPreference();
  const sortedCards = Object.entries(cards)
    .map(([cardId, cardHTML]) => ({
      cardId,
      cardHTML,
      order: layout[cardId]?.order ?? DEFAULT_LAYOUT[cardId]?.order ?? 99,
    }))
    .sort((a, b) => a.order - b.order);

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

    <div class="col-toggle-bar" id="col-toggle-bar">
      ${[2, 3, 4].map((n) => `<button class="col-toggle-btn${n === getColumnCount() ? " active" : ""}" data-cols="${n}">${n}列</button>`).join("")}
    </div>

    <div class="input-grid" id="input-grid" data-columns="${getColumnCount()}">
      ${sortedCards.map((c) => c.cardHTML).join("")}
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
        await morningDialogueApi.synthesize(date);

        showToast("今日のプランができました！", "success");
        // ページ再レンダリング（renderInputForm内でプランのタスクを自動マージ）
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

function attachColumnToggleEvents() {
  const bar = document.getElementById("col-toggle-bar");
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".col-toggle-btn");
    if (!btn) return;
    const cols = parseInt(btn.dataset.cols, 10);
    saveColumnCount(cols);
    applyColumnCount(cols);
  });
  // 初回レンダリング時にmasonry適用
  distributeMasonry();
}

function attachFormEvents(date, isEdit) {
  attachColumnToggleEvents();
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

    // タイムラインモードの場合は textarea を同期
    syncTimelineToTextarea();
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

  // ── タイムラインモード イベント ──
  function syncTimelineToTextarea() {
    const timelineMode = document.getElementById("timeline-mode");
    if (timelineMode && timelineMode.style.display !== "none") {
      document.getElementById("raw-input").value = timelineToRawInput();
    }
  }

  function debounceTimelineSave() {
    clearTimeout(rawInputTimer);
    rawInputTimer = setTimeout(saveDataQuietly, 1500);
  }

  // タイムライン行の入力変更（イベント委任）
  const timelineRows = document.getElementById("timeline-rows");
  if (timelineRows) {
    timelineRows.addEventListener("input", debounceTimelineSave);

    // 時間入力のスクロールで値が飛びすぎるのを防止
    timelineRows.addEventListener("wheel", (e) => {
      if (e.target.matches('input[type="time"]')) {
        e.preventDefault();
      }
    }, { passive: false });

    // 折りたたみサマリーをクリックで展開
    timelineRows.addEventListener("click", (e) => {
      const summary = e.target.closest(".timeline-row-summary");
      if (summary) {
        expandTimelineRow(summary.closest(".timeline-row"));
        return;
      }

      // +終了トグル
      const toggleEnd = e.target.closest(".timeline-toggle-end");
      if (toggleEnd) {
        const row = toggleEnd.closest(".timeline-row");
        const endGroup = row.querySelector(".timeline-end-group");
        endGroup.style.display = "";
        toggleEnd.style.display = "none";
        row.classList.add("has-end");
        const endInput = row.querySelector(".timeline-end");
        const now = new Date();
        endInput.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        endInput.focus();
        return;
      }

      // ▲ 上に移動
      const upBtn = e.target.closest(".timeline-row-up");
      if (upBtn) {
        const row = upBtn.closest(".timeline-row");
        const prev = row.previousElementSibling;
        if (prev) {
          row.parentNode.insertBefore(row, prev);
          debounceTimelineSave();
        }
        return;
      }

      // ▼ 下に移動
      const downBtn = e.target.closest(".timeline-row-down");
      if (downBtn) {
        const row = downBtn.closest(".timeline-row");
        const next = row.nextElementSibling;
        if (next) {
          row.parentNode.insertBefore(next, row);
          debounceTimelineSave();
        }
        return;
      }

      const removeBtn = e.target.closest(".timeline-row-remove");
      if (!removeBtn) return;
      const row = removeBtn.closest(".timeline-row");
      const allRows = timelineRows.querySelectorAll(".timeline-row");
      if (allRows.length <= 1) {
        // 最後の1行は消さずにクリア
        row.querySelector(".timeline-start").value = "";
        row.querySelector(".timeline-end").value = "";
        row.querySelector(".timeline-activity").value = "";
        // 終了時刻を再び非表示に
        row.querySelector(".timeline-end-group").style.display = "none";
        row.querySelector(".timeline-toggle-end").style.display = "";
        row.querySelector(".timeline-toggle-end").textContent = "+終了";
        row.classList.remove("has-end");
        row.classList.remove("collapsed");
        row.querySelector(".timeline-row-summary").style.display = "none";
        row.querySelector(".timeline-row-edit").style.display = "";
      } else {
        row.remove();
      }
      debounceTimelineSave();
    });

    // 行からフォーカスが外れたら折りたたむ
    timelineRows.addEventListener("focusout", (e) => {
      const row = e.target.closest(".timeline-row");
      if (!row || row.classList.contains("collapsed")) return;
      // フォーカスが同じ行内の別要素に移る場合は折りたたまない
      setTimeout(() => {
        if (row.contains(document.activeElement)) return;
        collapseTimelineRow(row);
      }, 100);
    });

    // 終了時刻の自動補完: 次の行の開始時刻にコピー
    timelineRows.addEventListener("change", (e) => {
      if (!e.target.classList.contains("timeline-end")) return;
      const currentRow = e.target.closest(".timeline-row");
      const nextRow = currentRow?.nextElementSibling;
      if (nextRow && !nextRow.querySelector(".timeline-start").value) {
        nextRow.querySelector(".timeline-start").value = e.target.value;
      }
    });

    // Enterキーで次の行を追加
    timelineRows.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (!e.target.classList.contains("timeline-activity")) return;
      e.preventDefault();
      const currentRow = e.target.closest(".timeline-row");
      const currentEnd = currentRow?.querySelector(".timeline-end")?.value || "";
      timelineRows.insertAdjacentHTML(
        "beforeend",
        buildTimelineRowHTML(currentEnd, "", "")
      );
      const newRow = timelineRows.lastElementChild;
      newRow.querySelector(".timeline-activity").focus();
      debounceTimelineSave();
    });
  }

  // 行動追加ボタン
  const addRowBtn = document.getElementById("btn-add-timeline-row");
  if (addRowBtn) {
    addRowBtn.addEventListener("click", () => {
      const rows = timelineRows.querySelectorAll(".timeline-row");
      const lastRow = rows[rows.length - 1];
      const lastEnd = lastRow?.querySelector(".timeline-end")?.value || "";
      const now = new Date();
      const nowStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      timelineRows.insertAdjacentHTML("beforeend", buildTimelineRowHTML(lastEnd || nowStr, "", ""));
      // 新しい行の活動入力にフォーカス
      const newRow = timelineRows.lastElementChild;
      newRow.querySelector(".timeline-activity").focus();
    });
  }

  // 時刻順ソートボタン
  const sortBtn = document.getElementById("btn-sort-timeline");
  if (sortBtn) {
    sortBtn.addEventListener("click", () => {
      const rows = [...timelineRows.querySelectorAll(".timeline-row")];
      if (rows.length <= 1) return;
      rows.sort((a, b) => {
        const ta = a.querySelector(".timeline-start").value || "99:99";
        const tb = b.querySelector(".timeline-start").value || "99:99";
        return ta.localeCompare(tb);
      });
      for (const row of rows) timelineRows.appendChild(row);
      debounceTimelineSave();
    });
  }

  // モード切替
  const btnTimeline = document.getElementById("btn-mode-timeline");
  const btnFreeform = document.getElementById("btn-mode-freeform");
  const timelineMode = document.getElementById("timeline-mode");
  const freeformMode = document.getElementById("freeform-mode");

  if (btnTimeline && btnFreeform) {
    btnTimeline.addEventListener("click", () => {
      btnTimeline.classList.add("active");
      btnFreeform.classList.remove("active");
      // 自由入力の内容をタイムラインに反映
      const textarea = document.getElementById("raw-input");
      const parsed = parseRawInputToTimeline(textarea.value);
      timelineRows.innerHTML = parsed.length > 0
        ? parsed.map((r) => buildTimelineRowHTML(r.start, r.end, r.activity)).join("")
        : buildTimelineRowHTML();
      timelineMode.style.display = "";
      freeformMode.style.display = "none";
    });

    btnFreeform.addEventListener("click", () => {
      btnFreeform.classList.add("active");
      btnTimeline.classList.remove("active");
      // タイムラインの内容をテキストに反映
      syncTimelineToTextarea();
      freeformMode.style.display = "";
      timelineMode.style.display = "none";
    });
  }

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
      if (e.target.dataset.animating) { delete e.target.dataset.animating; return; }
      const li = e.target.closest("li");
      if (e.target.checked) {
        li.classList.add("completed");
        e.target.dataset.animating = "1";
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

  // dragstart — DOM構造を変更しない（変更するとブラウザがドラッグを中断する）
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

  // dragend — 必ずクリーンアップしてmasonry再構成
  grid.addEventListener("dragend", (e) => {
    const card = e.target.closest(".draggable-card");
    if (card) {
      card.classList.remove("dragging");
      card.style.opacity = "";
      card.setAttribute("draggable", "false");
    }
    draggedCard = null;
    grid.querySelectorAll(".drop-indicator").forEach((el) => el.remove());
  });

  // dragover — マウス位置からターゲット列と挿入位置を判定
  grid.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!draggedCard) return;

    const targetCol = findTargetColumn(grid, e.clientX);
    if (!targetCol) return;

    const colCards = [...targetCol.querySelectorAll(".draggable-card:not(.dragging)")].filter(
      (c) => c.style.display !== "none"
    );
    const afterCard = getInsertAfterCard(targetCol, e.clientY, colCards);

    grid.querySelectorAll(".drop-indicator").forEach((el) => el.remove());
    const indicator = document.createElement("div");
    indicator.className = "drop-indicator";

    if (afterCard) {
      targetCol.insertBefore(indicator, afterCard);
    } else {
      targetCol.appendChild(indicator);
    }
  });

  grid.addEventListener("dragleave", (e) => {
    if (!grid.contains(e.relatedTarget)) {
      grid.querySelectorAll(".drop-indicator").forEach((el) => el.remove());
    }
  });

  // drop — 対象カードだけをターゲット列に移動（他のカードは動かさない）
  grid.addEventListener("drop", (e) => {
    e.preventDefault();
    grid.querySelectorAll(".drop-indicator").forEach((el) => el.remove());

    if (!draggedCard) return;

    const targetCol = findTargetColumn(grid, e.clientX);
    if (!targetCol) return;

    const colCards = [...targetCol.querySelectorAll(".draggable-card:not(.dragging)")].filter(
      (c) => c.style.display !== "none"
    );
    const afterCard = getInsertAfterCard(targetCol, e.clientY, colCards);

    if (afterCard) {
      targetCol.insertBefore(draggedCard, afterCard);
    } else {
      targetCol.appendChild(draggedCard);
    }

    saveMasonryLayout(grid);
  });

  // ビューポート変更への対応
  mql.addEventListener("change", () => {
    grid.querySelectorAll(".draggable-card").forEach((card) => {
      card.setAttribute("draggable", "false");
    });
  });
}

function findTargetColumn(grid, clientX) {
  const cols = [...grid.querySelectorAll(".masonry-col")];
  return cols.find((col) => {
    const rect = col.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right;
  }) || cols[cols.length - 1] || null;
}

function getInsertAfterCard(container, mouseY, cards) {
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (mouseY < midY) return card;
  }
  return null;
}

function persistCurrentLayout(grid) {
  const layout = {};
  const cards = grid.querySelectorAll(".draggable-card");
  cards.forEach((card, orderIndex) => {
    layout[card.id] = { order: orderIndex };
  });
  saveLayoutPreference(layout);
}

/* ── フォーム送信 ── */

async function submitForm(date, isEdit, btn) {
  // タイムラインモードの場合は textarea を同期
  const timelineModeEl = document.getElementById("timeline-mode");
  if (timelineModeEl && timelineModeEl.style.display !== "none") {
    document.getElementById("raw-input").value = timelineToRawInput();
  }
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
