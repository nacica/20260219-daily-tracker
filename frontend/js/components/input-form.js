/**
 * タスクページ（#/）と行動ログページ（#/log）の共通コンポーネント
 *
 * どちらも「その日の DailyRecord」を扱うが、画面と保存フィールドを分けている:
 *   - タスクページ  : 予定タスク / 完了タスク（tasks_planned / tasks_completed）
 *   - 行動ログページ: タイムライン入力 / 活動可能時間 / おやすみモード（raw_input / available_hours）
 * 保存時は自分のページが担当するフィールドだけを送る（バックエンドは部分更新に対応）ので、
 * 片方のページの操作でもう片方の内容が消えることはない。
 *
 * デスクトップ: タスクページはカードのドラッグ&ドロップ（masonry）レイアウト。
 */

import { recordsApi, categoriesApi, taskMetaApi } from "../api.js?v=20260912f";
import { showToast } from "../app.js?v=20260912f";
import { showTaskCompleteAnimation } from "./task-stats.js?v=20260912f";

/* ── カテゴリ管理 ── */

const CATEGORY_STORAGE_KEY = "task-categories";
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
  } catch (e) {
    console.warn("カテゴリ同期失敗:", e);
  }
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

/* ── タスクページ: カテゴリ別カード ──
 * 予定タスクをカテゴリごとに独立したカードに分け、デスクトップの列切替（1〜4列）と
 * masonry 配置でそのまま並べる。カードの id はカテゴリ名から作るので、列配置の保存
 * （masonry-layout-N）もカテゴリ単位で効く。
 */

/** カテゴリ名 → カード要素 id（日本語名も安全に id 化する） */
function catCardId(name) {
  return "card-cat-" + (name ? encodeURIComponent(name) : "__none__");
}

/**
 * 未完了タスクをカテゴリごとにグループ化する。
 * 順序: 定義済みカテゴリ（カテゴリ管理の並び）→ 定義に無いがタスクに残っているカテゴリ → 未分類。
 * 定義済みカテゴリはタスクが 0 件でもカードを出す（レイアウトが安定し、追加欄として使えるため）。
 */
function groupTasksByCategory(incompleteTasks) {
  const groups = new Map();
  for (const c of getCategories()) groups.set(c.name, []);
  const extra = new Map();
  const none = [];
  for (const t of incompleteTasks) {
    const { category } = parseTaskCategory(t);
    if (!category) none.push(t);
    else if (groups.has(category)) groups.get(category).push(t);
    else {
      if (!extra.has(category)) extra.set(category, []);
      extra.get(category).push(t);
    }
  }
  for (const [k, v] of extra) groups.set(k, v);
  groups.set("", none);
  return groups;
}

function buildCategoryCardHTML(name, tasks) {
  // カテゴリ色は CSS 変数でカードに渡し、見出し文字・左バー・上端ラインの色に使う（未分類は既定の水色）
  const colorStyle = name ? ` style="--cat-color:${getCategoryColor(name)}"` : "";
  return `
      <div class="card draggable-card category-card${tasks.length === 0 ? " is-empty" : ""}" id="${catCardId(name)}" data-category="${escapeHTML(name)}" draggable="false"${colorStyle}>
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <div class="card-title">
          <span class="card-title-text">${name ? escapeHTML(name) : "未分類"}</span>
          <span class="card-count category-task-count">${tasks.length}</span>
        </div>
        <ul class="task-list planned-list" data-category="${escapeHTML(name)}">${tasks.map((t) => buildTaskItem(t, false)).join("")}</ul>
        <div class="task-input-row">
          <input type="text" class="planned-input" placeholder="タスクを追加" />
          <button class="btn btn-outline btn-sm btn-add-task">追加</button>
        </div>
      </div>`;
}

function buildCategoryManageListHTML() {
  return getCategories().map((c) => `
              <li class="category-manage-item">
                <span class="task-category-badge" style="background:${c.color}">${escapeHTML(c.name)}</span>
                <button class="category-remove-btn" data-remove-category="${escapeHTML(c.name)}" title="削除">✕</button>
              </li>`).join("");
}

function buildCategoryMgmtCardHTML() {
  return `
      <div class="card draggable-card category-mgmt-card" id="card-category-mgmt" draggable="false">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <div class="card-title"><span class="card-title-text">カテゴリ管理</span></div>
        <ul class="category-manage-list" id="category-manage-list">${buildCategoryManageListHTML()}</ul>
        <div class="task-input-row">
          <input type="text" id="new-category-input" placeholder="新しいカテゴリ名" />
          <button class="btn btn-outline btn-sm" id="btn-add-category">追加</button>
        </div>
      </div>`;
}

/** カテゴリ名に対応する予定タスクリスト（無ければ未分類リスト） */
function getPlannedListFor(category) {
  const lists = [...document.querySelectorAll(".planned-list")];
  return lists.find((l) => (l.dataset.category || "") === (category || ""))
    || lists.find((l) => (l.dataset.category || "") === "")
    || null;
}

/** 各カテゴリカードの件数バッジと「空」状態を更新 */
function syncCategoryCounts() {
  document.querySelectorAll(".category-card").forEach((card) => {
    const n = card.querySelectorAll(".task-item").length;
    const el = card.querySelector(".category-task-count");
    if (el) el.textContent = n;
    card.classList.toggle("is-empty", n === 0);
  });
}

/**
 * タスク li のカテゴリを付け替える（data-* とバッジを更新）。
 * data-task / data-edit / data-remove は保存時の収集元なので 3 つとも揃える。
 */
function setTaskCategory(li, category) {
  const cb = li.querySelector('input[type="checkbox"]');
  if (!cb) return;
  const { text } = parseTaskCategory(cb.dataset.task);
  const full = formatTaskWithCategory(text, category);
  cb.dataset.task = full;
  const eBtn = li.querySelector(".task-edit");
  if (eBtn) eBtn.dataset.edit = full;
  const rBtn = li.querySelector(".task-remove");
  if (rBtn) rBtn.dataset.remove = full;
  li.querySelector(".task-category-badge")?.remove();
  const textSpan = li.querySelector(".task-text");
  if (textSpan) textSpan.insertAdjacentHTML("beforebegin", buildCategoryBadge(category));
}

/* ── メインレンダリング ── */

/**
 * /input 画面の楽観描画用キャッシュ
 * localStorage に前回描画時のスナップショット（record, tasks, 休養日状態）を保存し、
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
 * セッション内の categories 同期に短い TTL を設けて、
 * 同じセッションでタスクページを複数回開いた時の重複 API 呼び出しを避ける
 */
const SESSION_SYNC_TTL_MS = 5 * 60 * 1000; // 5分
let _lastCategoriesSyncAt = 0;

async function syncCategoriesWithCache() {
  if (Date.now() - _lastCategoriesSyncAt < SESSION_SYNC_TTL_MS) return;
  await syncCategoriesFromServer();
  _lastCategoriesSyncAt = Date.now();
}

/* ── タスクメタ情報（追加日時・完了日時） ──
 * タスク本体は「[カテゴリ] 本文」の文字列で日時を持たないため、カテゴリを除いた本文を
 * キーにサーバー（task_meta）で追加日時・完了日時を別管理する。予定タスクは完了するまで
 * 毎日同じ名前で引き継がれるので、名前キーで日をまたいで追跡できる。
 * 完了タスク欄に「追加日 → 完了日（何日目 / 何時間で達成）」を表示するのに使う。
 */
const _taskMeta = new Map();
let _lastTaskMetaSyncAt = 0;

async function syncTaskMetaWithCache() {
  if (Date.now() - _lastTaskMetaSyncAt < SESSION_SYNC_TTL_MS) return;
  try {
    const res = await taskMetaApi.get();
    for (const it of res?.items || []) if (it?.name) _taskMeta.set(it.name, it);
    _lastTaskMetaSyncAt = Date.now();
  } catch (e) {
    console.warn("タスクメタ取得失敗:", e);
  }
}

/** メタ情報のキー（カテゴリを除いた本文） */
function _taskKey(fullText) {
  return parseTaskCategory(fullText || "").text.trim();
}

function _pushTaskMeta(items) {
  if (items.length === 0) return;
  taskMetaApi.upsert(items).catch((e) => console.warn("タスクメタ保存失敗:", e));
}

/** タスク追加時: 追加日時を記録（既に同名のメタがあれば触らない） */
function recordTaskCreated(fullText) {
  const name = _taskKey(fullText);
  if (!name || _taskMeta.has(name)) return;
  const item = { name, created_at: new Date().toISOString(), completed_at: null, approx: false };
  _taskMeta.set(name, item);
  _pushTaskMeta([item]);
}

/** 完了 / 完了解除時: 完了日時を記録（解除なら null で消す） */
function recordTaskCompleted(fullText, completed) {
  const name = _taskKey(fullText);
  if (!name) return;
  const cur = _taskMeta.get(name) || { name, created_at: new Date().toISOString(), approx: false };
  const item = { ...cur, name, completed_at: completed ? new Date().toISOString() : null };
  _taskMeta.set(name, item);
  _pushTaskMeta([item]);
}

/** 本文の編集時: キーを付け替える */
function renameTaskMeta(oldFull, newFull) {
  const a = _taskKey(oldFull);
  const b = _taskKey(newFull);
  if (!a || !b || a === b) return;
  const cur = _taskMeta.get(a);
  if (!cur) return;
  const item = { ...cur, name: b };
  _taskMeta.set(b, item);
  _taskMeta.delete(a);
  _pushTaskMeta([item]);
  taskMetaApi.remove([a]).catch(() => {});
}

/** タスク削除時 */
function removeTaskMeta(fullText) {
  const name = _taskKey(fullText);
  if (!name || !_taskMeta.has(name)) return;
  _taskMeta.delete(name);
  taskMetaApi.remove([name]).catch(() => {});
}

/**
 * この機能より前に作られたタスクにはメタが無い。手元にある記録（直近7日＋今日）から
 * 「最初に登場した日」を追加日、完了タスクは「今日の記録の日」を完了日として推定して保存する。
 * 推定値は approx:true を付け、表示では時刻を出さず日付だけにする。
 */
function inferLegacyTaskMeta(tasks, existingRecord, prevRecords, date) {
  const records = [...(prevRecords || []), ...(existingRecord ? [{ ...existingRecord, date }] : [])]
    .filter((r) => r?.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const firstSeen = new Map();
  for (const r of records) {
    for (const t of [...(r.tasks?.planned || []), ...(r.tasks?.completed || [])]) {
      const name = _taskKey(_taskName(t));
      if (name && !firstSeen.has(name)) firstSeen.set(name, r.date);
    }
  }
  const completedNames = new Set((tasks.completed || []).map((t) => _taskKey(_taskName(t))));
  const items = [];
  for (const t of [...(tasks.planned || []), ...(tasks.completed || [])]) {
    const name = _taskKey(_taskName(t));
    if (!name) continue;
    const cur = _taskMeta.get(name);
    const needCreated = !cur?.created_at;
    const needCompleted = completedNames.has(name) && !cur?.completed_at;
    if (!needCreated && !needCompleted) continue;
    const item = { ...(cur || {}), name };
    if (needCreated) { item.created_at = `${firstSeen.get(name) || date}T00:00:00`; item.approx = true; }
    if (needCompleted) { item.completed_at = `${date}T00:00:00`; item.approx = true; }
    _taskMeta.set(name, item);
    items.push(item);
  }
  _pushTaskMeta(items);
}

function _fmtMetaDate(d, withTime) {
  const s = `${d.getMonth() + 1}/${d.getDate()}`;
  if (!withTime) return s;
  return `${s} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 完了タスク用の「追加日 → 完了日（達成までの期間）」表示。
 * 24 時間以内なら時刻付きで「◯時間◯分で達成」、それ以上は 24 時間単位で切り上げて「◯日目に達成」。
 * 推定値（approx）は時刻を信用できないので、日付だけ＋カレンダー日数（追加日を 1 日目）で表示する
 * （表示上は通常の値と区別しない）。
 */
function buildTaskMetaHTML(fullText) {
  const m = _taskMeta.get(_taskKey(fullText));
  if (!m?.created_at || !m?.completed_at) return "";
  const c = new Date(m.created_at);
  const d = new Date(m.completed_at);
  if (isNaN(c) || isNaN(d)) return "";
  const H = 3600000;
  const DAY = 24 * H;
  const ms = Math.max(0, d - c);
  let dur;
  let withTime = false;
  if (m.approx) {
    dur = `${Math.round(ms / DAY) + 1}日目に達成`;
  } else if (ms <= DAY) {
    withTime = true;
    const h = Math.floor(ms / H);
    const mi = Math.floor((ms % H) / 60000);
    dur = ms < 60000 ? "1分未満で達成" : `${h > 0 ? `${h}時間` : ""}${mi}分で達成`;
  } else {
    dur = `${Math.ceil(ms / DAY)}日目に達成`;
  }
  return `<span class="task-meta">${_fmtMetaDate(c, withTime)}追加 → ${_fmtMetaDate(d, withTime)}完了（${dur}）</span>`;
}

/** 日付文字列の前日を返す */
function _prevDateStr(date, daysAgo) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString("sv-SE");
}

/** タスクが文字列/オブジェクトどちらでも名前を取り出す */
function _taskName(t) {
  return typeof t === "string" ? t : t?.name || t?.task || "";
}

/** 予定タスク引き継ぎを 1 箇所で適用 */
function _mergeTasks(existingRecord, prevRecords, date) {
  const tasks = existingRecord?.tasks
    ? { planned: [...(existingRecord.tasks.planned || [])], completed: [...(existingRecord.tasks.completed || [])] }
    : { planned: [], completed: [] };

  // 予定タスク自動引き継ぎ: 今日の記録がまだ無い初回表示のときだけ、
  // 直近の記録の未完了タスクを予定リストに載せる（完了 or 削除するまで毎日残る仕様）。
  // 一度保存された後は再引き継ぎしない — 削除したタスクが翌描画で復活しないようにするため。
  if (isToday(date) && !existingRecord?.tasks && Array.isArray(prevRecords) && prevRecords.length > 0) {
    const sorted = prevRecords.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    // タスクを記録した最新の日を引き継ぎ元にする（完了済みだけの日ならそこで止める＝復活させない）
    const src = sorted.find((p) => (p?.tasks?.planned || []).length > 0 || (p?.tasks?.completed || []).length > 0);
    if (src) {
      const completedNames = new Set((src.tasks.completed || []).map(_taskName));
      const existingNames = new Set([...tasks.planned, ...tasks.completed].map(_taskName));
      for (const t of src.tasks.planned || []) {
        const name = _taskName(t);
        if (name && !completedNames.has(name) && !existingNames.has(name)) {
          tasks.planned.push(name);
          existingNames.add(name);
        }
      }
    }
  }

  return tasks;
}

/** フォームを描画してイベントを再アタッチする共通処理 */
function _paintForm(main, date, existingRecord, tasks, isRestDay, restReason, mode) {
  const isEdit = !!existingRecord;
  main.innerHTML = buildFormHTML(date, existingRecord, tasks, isEdit, isRestDay, restReason, mode);
  attachFormEvents(date, isEdit, mode, tasks);
  if (mode === "log") attachRestDayEvents(date, isRestDay);
}

/**
 * 行動ログの最初の入力欄にフォーカスする。
 * Why: アプリ起動時に「すぐ入力できる状態」にするため（オートフォーカス）。
 * 起動後に1度だけ呼ばれ、以降の再描画では呼ばれない（_hasAutofocused フラグで制御）。
 */
function focusFirstActivityInput() {
  const freeform = document.getElementById("freeform-mode");
  const timeline = document.getElementById("timeline-mode");

  if (timeline && timeline.style.display !== "none") {
    const empty = [...document.querySelectorAll("#timeline-rows .timeline-activity")]
      .find((el) => !el.value.trim());
    if (empty) { empty.focus(); return; }
    const first = document.querySelector("#timeline-rows .timeline-activity");
    if (first) first.focus();
    return;
  }

  if (freeform && freeform.style.display !== "none") {
    const ta = document.getElementById("raw-input");
    if (ta) ta.focus();
  }
}

/**
 * ページ描画の共通処理（タスクページ / 行動ログページ）
 * @param {string} date - 対象日 (YYYY-MM-DD)
 * @param {"tasks"|"log"} mode - 描画するページ
 *
 * 高速化戦略:
 *   1. localStorage キャッシュから即描画（スピナー回避）
 *   2. クリティカルパスの API を並列: record / categories（タスクページのみ） / 直近7日の list
 *   3. categories は 5 分 TTL のセッションキャッシュで二重取得を回避
 *
 * 直近7日の list は「予定タスクの引き継ぎ」に使う。行動ログページでも取得しておくのは、
 * その日のレコードを行動ログ側が先に作成した場合でも引き継ぎタスクを一緒に登録し、
 * タスクページ側の初回表示と同じ結果になるようにするため。
 */
async function _renderPage(date, mode) {
  const main = document.querySelector("main");
  const isLog = mode === "log";

  // ── 1. 楽観描画: 前回のキャッシュから即描画 ──
  const cached = loadInputCache(date);
  let didAutofocus = false;
  if (cached) {
    // キャッシュ内容から tasks を合成（prevRecords はキャッシュ済みのものを使う）
    const cachedTasks = cached.tasks || _mergeTasks(cached.existingRecord, cached.prevRecords || [], date);
    _paintForm(main, date, cached.existingRecord || null, cachedTasks,
      !!cached.isRestDay, cached.restReason || "", mode);
    if (isLog && !cached.isRestDay) {
      focusFirstActivityInput();
      didAutofocus = true;
    }
  } else {
    main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;
  }

  // ── 2. クリティカルパスの API を並列実行 ──
  const startStr = _prevDateStr(date, 7);
  const endStr = _prevDateStr(date, 1);

  const [recordResult, , prevResult] = await Promise.allSettled([
    recordsApi.get(date),
    isLog ? Promise.resolve() : Promise.all([syncCategoriesWithCache(), syncTaskMetaWithCache()]),
    recordsApi.list(startStr, endStr),
  ]);

  const existingRecord = recordResult.status === "fulfilled" ? recordResult.value : null;
  const prevRecords = prevResult.status === "fulfilled" ? (prevResult.value || []) : [];

  const tasks = _mergeTasks(existingRecord, prevRecords, date);
  // メタ情報の無い既存タスクは記録履歴から追加日・完了日を推定しておく（描画前に反映）
  if (!isLog) inferLegacyTaskMeta(tasks, existingRecord, prevRecords, date);
  const isRestDay = existingRecord?.rest_day || false;
  const restReason = existingRecord?.rest_reason || "";

  // ── 3. フレッシュデータで再描画 ──
  _paintForm(main, date, existingRecord, tasks, isRestDay, restReason, mode);
  // キャッシュからの初回描画でフォーカス済みなら、再描画ではスキップ（カーソル位置を奪わない）
  if (isLog && !didAutofocus && !isRestDay) {
    focusFirstActivityInput();
  }

  // ── 4. キャッシュを更新（次回の楽観描画用）──
  saveInputCache(date, {
    existingRecord,
    tasks,
    isRestDay,
    restReason,
    prevRecords,
  });
}

/**
 * タスクページ（#/）: 予定タスク・完了タスクを管理する。
 * 日付ナビは持たず、常に今日のレコードを対象にする（追加・完了は即時保存）。
 */
export function renderTasksPage(date) {
  return _renderPage(date, "tasks");
}

/**
 * 行動ログページ（#/log, #/log/:date）: タイムライン入力・活動可能時間・おやすみモード。
 * 日付ナビ（ヘッダーのカレンダー）から過去日の編集もこのページで行う。
 */
export function renderActivityLog(date) {
  return _renderPage(date, "log");
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
        await renderActivityLog(date);
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
        await renderActivityLog(date);
      } catch (err) {
        showToast("解除に失敗しました: " + err.message, "error");
        btnCancelRest.disabled = false;
        btnCancelRest.textContent = "解除する";
      }
    });
  }
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

/** 現在時刻を "HH:MM" で返す */
function nowHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** 対象日が今日かどうか（YYYY-MM-DD 比較。ローカルタイムで判定） */
function isToday(date) {
  return date === new Date().toLocaleDateString("sv-SE");
}

/**
 * 自動入力された欄を一瞬光らせる。
 * Why: 勝手に時刻が入ったことに気づかないまま確定してしまうのを防ぐ。
 *      トーストは行を足すたびに出て邪魔なので、その場のフラッシュで知らせる。
 */
function flashAutofilled(el) {
  if (!el) return;
  el.classList.remove("time-autofilled");
  void el.offsetWidth; // アニメーションを頭から再生させるためのリフロー
  el.classList.add("time-autofilled");
  setTimeout(() => el.classList.remove("time-autofilled"), 1000);
}

/**
 * 内容だけ入力されて開始時刻が空の行に、現在時刻を補う。
 *
 * Why: 「時刻を打たずに内容だけ書いて Enter / 別欄へ移動」を成立させるため。
 *      開始時刻が空の行は collapseTimelineRow() が折りたためず、展開されたまま残っていた。
 * 過去日を編集しているときは「現在時刻」に意味がないので何もしない
 * （行の折りたたみだけは collapseTimelineRow() 側で成立する）。
 *
 * @param {HTMLElement} row .timeline-row
 * @param {string} date 対象日 (YYYY-MM-DD)
 * @returns {boolean} 補完したか
 */
function autofillStartTime(row, date) {
  if (!row || !isToday(date)) return false;
  const startInput = row.querySelector(".timeline-start");
  const activity = row.querySelector(".timeline-activity")?.value.trim() || "";
  if (!startInput || startInput.value || !activity) return false;

  startInput.value = nowHHMM();
  flashAutofilled(startInput);
  // 直後に折りたたまれると input のフラッシュが見えないので、
  // サマリー側でも光らせるようフラグを立てておく（collapseTimelineRow が消費する）。
  row.dataset.timeAutofilled = "1";
  return true;
}

function buildTimelineRowHTML(start = "", end = "", activity = "") {
  const hasEnd = !!end;
  // 時刻なしでも内容さえ入っていれば折りたたむ（過去日の時刻なし行が展開されたまま残らないように）
  const isCompleted = !!activity;
  const summaryText = isCompleted
    ? `${start ? `${start}${end ? " ～ " + end : ""}　` : ""}${escapeHTMLAttr(activity)}`
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
  if (!activity) return; // 内容が空なら折りたたまない（時刻だけの行は編集中とみなす）
  const summary = row.querySelector(".timeline-row-summary");
  summary.textContent = `${start ? `${start}${end ? " ～ " + end : ""}　` : ""}${activity}`;
  summary.style.display = "";
  row.querySelector(".timeline-row-edit").style.display = "none";
  row.classList.add("collapsed");

  // autofillStartTime() が現在時刻を入れた直後なら、折りたたみ後のサマリーも光らせる
  if (row.dataset.timeAutofilled) {
    delete row.dataset.timeAutofilled;
    flashAutofilled(summary);
  }
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

function buildFormHTML(date, record, tasks, isEdit, isRestDay = false, restReason = "", mode = "tasks") {
  const isLog = mode === "log";
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });

  const rawInput = record?.raw_input || "";
  const plannedTasks = tasks.planned || [];
  const completedTasks = tasks.completed || [];
  const hasCompleted = completedTasks.length > 0;
  const incompleteTasks = plannedTasks.filter((t) => !completedTasks.includes(t));

  // 各カードの HTML をマップで管理（ページごとに出すカードが違う）
  const cards = {};

  // ── 行動ログページ: タイムライン入力カード（1 枚だけなのでドラッグ不要） ──
  if (isLog) cards["card-activity-log"] = `
      <div class="card activity-log-card" id="card-activity-log">
        <div class="card-title-row">
          <div class="card-title">行動ログ</div>
          <button class="btn btn-outline btn-sm timeline-add-btn-top" id="btn-add-timeline-row-top" title="行動を追加">
            ＋ 追加
          </button>
        </div>
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
      </div>`;

  // ── タスクページ: カテゴリ別カード（＋未分類） / 完了タスク / カテゴリ管理 ──
  if (!isLog) {
    for (const [name, list] of groupTasksByCategory(incompleteTasks)) {
      cards[catCardId(name)] = buildCategoryCardHTML(name, list);
    }
  }

  if (!isLog) cards["card-completed"] = `
      <div class="card draggable-card completed-tasks-card" id="card-completed" draggable="false"
           style="${hasCompleted ? "" : "display:none"}">
        <div class="card-drag-handle" title="ドラッグで移動">⠿</div>
        <div class="card-title">
          <span class="card-title-text">完了タスク</span>
          <span class="card-count" id="completed-count">${completedTasks.length}</span>
        </div>
        <ul class="task-list" id="completed-list">
          ${completedTasks.map((t) => buildTaskItem(t, true)).join("")}
        </ul>
      </div>`;

  if (!isLog) cards["card-category-mgmt"] = buildCategoryMgmtCardHTML();

  // カードの初期順序は上で組み立てた順（カテゴリ → 未分類 → 完了 → カテゴリ管理）。
  // デスクトップの列配置はユーザーのドラッグ結果を masonry-layout-N に保存して復元する。
  const cardsHTML = Object.values(cards).join("");

  // おやすみモード理由選択肢
  const REST_REASONS = ["残業", "体調不良", "出張", "予定あり", "その他"];
  const reasonOptions = REST_REASONS.map(
    (r) => `<option value="${r}"${r === restReason ? " selected" : ""}>${r}</option>`
  ).join("");

  // ── タスクページ: 見出し + 列切替バー（デスクトップ）だけのシンプルな構成
  //    （日付ナビ・おやすみモードは行動ログページ側にある） ──
  if (!isLog) {
    return `
    <div class="input-page-header">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <h2 style="margin: 0; font-size: 1.2rem;">タスク管理</h2>
      </div>
      <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: var(--gap);">${dateLabel}</p>
    </div>

    <div class="col-toggle-bar" id="col-toggle-bar">
      ${[1, 2, 3, 4].map((n) => `<button class="col-toggle-btn${n === getColumnCount() ? " active" : ""}" data-cols="${n}">${n}列</button>`).join("")}
    </div>

    <div class="input-grid tasks-grid" id="input-grid" data-columns="${getColumnCount()}">
      ${cardsHTML}
    </div>
  `;
  }

  // ── 行動ログページ: おやすみモード付き。カードは 1 枚なので列切替・ドラッグは無し ──
  return `
    <div class="input-page-header">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <h2 style="margin: 0; font-size: 1.2rem;">${isEdit ? "記録を編集" : "行動を記録"}</h2>
        ${isRestDay ? `` : `
        <button class="btn btn-outline btn-sm rest-day-btn" id="btn-rest-day" style="white-space: nowrap;">
          🌙 今日はおやすみ
        </button>`}
      </div>
      <p style="color: var(--text-muted); font-size: 0.85rem; margin-bottom: var(--gap);">${dateLabel}</p>
    </div>

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

    <div class="input-grid log-grid" id="input-grid" data-columns="1">
      ${cardsHTML}
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
      ${buildCategoryBadge(category)}<span class="task-text">${escapeHTML(text)}</span>
      <button class="task-edit" data-edit="${escapeHTML(taskText)}" title="編集">✎</button>
      <button class="task-remove" data-remove="${escapeHTML(taskText)}" title="削除">✕</button>
      ${isCompleted ? buildTaskMetaHTML(taskText) : ""}
    </li>`;
}

/**
 * タスクをインライン編集モードに切り替える。
 * 編集対象はテキスト部分のみ（カテゴリは維持）。Enter / blur で保存、Esc でキャンセル。
 * 保存時は li 内の data-* 属性（data-task / data-remove / data-edit）も
 * 新しいテキストに揃える。これらは saveDataQuietly() がタスク収集に使うため、
 * 1 つでも古いままだと保存値が壊れる。
 * onSave は attachFormEvents 内の saveDataQuietly を呼び出すための注入。
 */
function startTaskEdit(editBtn, onSave) {
  const li = editBtn.closest("li");
  if (!li || li.querySelector(".task-edit-input")) return;

  const oldFullText = editBtn.dataset.edit;
  const { category, text: oldText } = parseTaskCategory(oldFullText);
  const textSpan = li.querySelector(".task-text");
  if (!textSpan) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "task-edit-input";
  input.value = oldText;
  textSpan.replaceWith(input);
  input.focus();
  input.select();

  let done = false;

  function finish(save) {
    if (done) return;
    done = true;
    const newText = save ? input.value.trim() : "";
    const finalText = newText || oldText;
    const newFullText = formatTaskWithCategory(finalText, category);

    const newSpan = document.createElement("span");
    newSpan.className = "task-text";
    newSpan.textContent = finalText;
    input.replaceWith(newSpan);

    // li 内の data-* 属性を新しいテキストに揃える（保存時の収集元）
    const cb = li.querySelector('input[type="checkbox"]');
    if (cb) cb.dataset.task = newFullText;
    const eBtn = li.querySelector(".task-edit");
    if (eBtn) eBtn.dataset.edit = newFullText;
    const rBtn = li.querySelector(".task-remove");
    if (rBtn) rBtn.dataset.remove = newFullText;

    if (newFullText !== oldFullText) {
      renameTaskMeta(oldFullText, newFullText);
      if (typeof onSave === "function") onSave();
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

function syncCompletedCard() {
  const card = document.getElementById("card-completed");
  if (!card) return;
  const count = document.querySelectorAll("#completed-list .task-item").length;
  card.style.display = count > 0 ? "" : "none";
  document.getElementById("completed-count").textContent = count;
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

/**
 * @param {string} date
 * @param {boolean} isEdit - その日のレコードが既に存在するか
 * @param {"tasks"|"log"} mode
 * @param {{planned: string[], completed: string[]}} initialTasks - 描画時点のタスク
 *   （行動ログページがレコードを新規作成するとき、引き継ぎ済みタスクを一緒に登録するために使う）
 */
function attachFormEvents(date, isEdit, mode, initialTasks) {
  const isLog = mode === "log";
  if (!isLog) attachColumnToggleEvents();
  const completedList = document.getElementById("completed-list");

  // バックグラウンド自動保存（排他制御付き）
  let isSaving = false;
  let pendingSave = false;

  async function saveDataQuietly() {
    if (isSaving) {
      pendingSave = true;
      return;
    }

    let rawInput = "";
    let availHoursVal = null;
    let incompleteTasks = [];
    let completedTasks = [];

    if (isLog) {
      // タイムラインモードの場合は textarea を同期
      syncTimelineToTextarea();
      const rawEl = document.getElementById("raw-input");
      if (!rawEl) return; // ページ遷移後にデバウンスタイマーが発火した場合
      rawInput = rawEl.value.trim();
      const availHoursEl = document.getElementById("available-hours");
      availHoursVal = availHoursEl?.value ? parseFloat(availHoursEl.value) : null;
      // 新規作成時に引き継ぎ済みタスクも登録するため（更新時は送らない）
      const planned = initialTasks?.planned || [];
      completedTasks = [...(initialTasks?.completed || [])];
      incompleteTasks = planned.filter((t) => !completedTasks.includes(t));
    } else {
      if (!document.getElementById("completed-list")) return; // ページ遷移後
      // 各カテゴリカードのリストを DOM 順に集める（保存形式は従来どおりフラットな配列）
      incompleteTasks = [...document.querySelectorAll(".planned-list .task-item .task-remove")]
        .map((el) => el.dataset.remove)
        .filter(Boolean);
      completedTasks = [...document.querySelectorAll("#completed-list .task-item .task-remove")]
        .map((el) => el.dataset.remove)
        .filter(Boolean);
    }
    const plannedTasks = [...incompleteTasks, ...completedTasks];

    // 何も入力されていなければレコードを作らない
    if (!isEdit) {
      if (isLog && !rawInput && availHoursVal === null) return;
      if (!isLog && plannedTasks.length === 0) return;
    }

    // 更新時は自分のページが担当するフィールドだけを送る
    // （もう一方のページで編集中の内容を古い値で上書きしないため。バックエンドは部分更新対応）
    const updateData = isLog
      ? { raw_input: rawInput }
      : { tasks_planned: plannedTasks, tasks_completed: completedTasks };
    if (isLog && availHoursVal !== null) updateData.available_hours = availHoursVal;

    isSaving = true;
    try {
      if (isEdit) {
        await recordsApi.update(date, updateData);
      } else {
        try {
          await recordsApi.create(date, rawInput, plannedTasks, completedTasks);
          // create は活動可能時間を受け付けないので、入力済みなら続けて反映する
          if (isLog && availHoursVal !== null) {
            await recordsApi.update(date, { available_hours: availHoursVal });
          }
        } catch (createErr) {
          // 409 (既に存在 = もう一方のページが先に作成済み) の場合は update にフォールバック
          if (createErr.message.includes("409") || createErr.message.includes("すでに存在")) {
            await recordsApi.update(date, updateData);
          } else {
            throw createErr;
          }
        }
        isEdit = true;
      }
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

  // ── ここから行動ログページ専用のイベント（要素が無いタスクページでは何も登録されない） ──

  // 行動ログの入力が止まったら自動保存（デバウンス 1.5 秒）
  let rawInputTimer = null;
  const rawInputEl = document.getElementById("raw-input");
  if (rawInputEl) {
    rawInputEl.addEventListener("input", () => {
      clearTimeout(rawInputTimer);
      rawInputTimer = setTimeout(saveDataQuietly, 1500);
    });
  }

  // ── タイムラインモード イベント ──
  function syncTimelineToTextarea() {
    const timelineMode = document.getElementById("timeline-mode");
    const rawEl = document.getElementById("raw-input");
    if (rawEl && timelineMode && timelineMode.style.display !== "none") {
      rawEl.value = timelineToRawInput();
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
        endInput.value = nowHHMM();
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

    // 行からフォーカスが外れたら、時刻が空なら現在時刻を補ってから折りたたむ
    timelineRows.addEventListener("focusout", (e) => {
      const row = e.target.closest(".timeline-row");
      if (!row || row.classList.contains("collapsed")) return;
      // フォーカスが同じ行内の別要素に移る場合は折りたたまない
      setTimeout(() => {
        if (row.contains(document.activeElement)) return;
        // 値を JS で入れても input イベントは飛ばないので、補完したら明示的に保存を予約する
        if (autofillStartTime(row, date)) debounceTimelineSave();
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

    // Enterキーで次の行を追加（時刻が空なら現在時刻を補ってから確定させる）
    timelineRows.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (!e.target.classList.contains("timeline-activity")) return;
      e.preventDefault();
      const currentRow = e.target.closest(".timeline-row");
      autofillStartTime(currentRow, date);
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

  // 行動追加ボタン（下部 = 末尾に追加）
  const addRowBtn = document.getElementById("btn-add-timeline-row");
  if (addRowBtn) {
    addRowBtn.addEventListener("click", () => {
      const rows = timelineRows.querySelectorAll(".timeline-row");
      const lastRow = rows[rows.length - 1];
      const lastEnd = lastRow?.querySelector(".timeline-end")?.value || "";
      timelineRows.insertAdjacentHTML("beforeend", buildTimelineRowHTML(lastEnd || nowHHMM(), "", ""));
      // 新しい行の活動入力にフォーカス
      const newRow = timelineRows.lastElementChild;
      newRow.querySelector(".timeline-activity").focus();
    });
  }

  // 行動追加ボタン（上部・モバイル限定 = 先頭に追加）
  const addRowBtnTop = document.getElementById("btn-add-timeline-row-top");
  if (addRowBtnTop) {
    addRowBtnTop.addEventListener("click", () => {
      timelineRows.insertAdjacentHTML("afterbegin", buildTimelineRowHTML(nowHHMM(), "", ""));
      const newRow = timelineRows.firstElementChild;
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

  // ── ここからタスクページ専用のイベント ──
  if (isLog) return;

  const grid = document.getElementById("input-grid");
  if (!grid || !completedList) return;

  // タスク追加（各カテゴリカードの入力欄。カテゴリはカードで決まる）
  function addTaskFromCard(card) {
    const input = card?.querySelector(".planned-input");
    const list = card?.querySelector(".planned-list");
    if (!input || !list) return;
    const text = input.value.trim();
    if (!text) return;
    const fullText = formatTaskWithCategory(text, card.dataset.category || "");
    list.insertAdjacentHTML("beforeend", buildTaskItem(fullText, false));
    recordTaskCreated(fullText);
    input.value = "";
    input.focus();
    syncCategoryCounts();
    saveDataQuietly();
  }
  // Enter での自動登録は廃止（追加ボタンクリックでのみ登録）

  // タスク追加 / 削除 / 編集 / チェック切替
  // グリッド全体でイベント委任しておくと、カテゴリ追加で後から差し込んだカードでもそのまま動く
  grid.addEventListener("click", (e) => {
    const addBtn = e.target.closest(".btn-add-task");
    if (addBtn) { addTaskFromCard(addBtn.closest(".category-card")); return; }
    if (!e.target.closest(".task-list")) return;

    if (e.target.dataset.remove !== undefined) {
      removeTaskMeta(e.target.dataset.remove);
      e.target.closest("li").remove();
      syncCompletedCard();
      syncCategoryCounts();
      saveDataQuietly();
      return;
    }
    // 編集ボタン
    if (e.target.dataset.edit !== undefined) {
      startTaskEdit(e.target, saveDataQuietly);
      return;
    }
    // タスク名タップで2行クランプ⇔全文表示を切り替え（スマホ用）
    if (e.target.classList.contains("task-text")) {
      e.target.classList.toggle("expanded");
      return;
    }
    if (e.target.type === "checkbox") {
      if (e.target.dataset.animating) { delete e.target.dataset.animating; return; }
      const li = e.target.closest("li");
      if (e.target.checked) {
        li.classList.add("completed");
        e.target.dataset.animating = "1";
        completedList.appendChild(li);
        // 完了日時を記録し、「追加日 → 完了日（達成までの期間）」を項目に付ける
        recordTaskCompleted(e.target.dataset.task, true);
        li.querySelector(".task-meta")?.remove();
        li.insertAdjacentHTML("beforeend", buildTaskMetaHTML(e.target.dataset.task));
        showTaskCompleteAnimation(e.target);
      } else {
        recordTaskCompleted(e.target.dataset.task, false);
        // 完了 → 予定へ戻す: 元のカテゴリカードへ（受け皿が無ければ未分類へ付け替え）
        const { category } = parseTaskCategory(e.target.dataset.task);
        const target = getPlannedListFor(category);
        if (target) {
          const targetCat = target.dataset.category || "";
          const full = formatTaskWithCategory(parseTaskCategory(e.target.dataset.task).text, targetCat);
          li.remove();
          // 並べ替えハンドル付きの予定タスク行として作り直す
          target.insertAdjacentHTML("beforeend", buildTaskItem(full, false));
        } else {
          li.classList.remove("completed");
        }
      }
      syncCompletedCard();
      syncCategoryCounts();
      saveDataQuietly();
    }
  });

  // ── カテゴリ管理 ──
  function renderCategoryManageList() {
    const list = document.getElementById("category-manage-list");
    if (list) list.innerHTML = buildCategoryManageListHTML();
  }

  /** 新しいカテゴリのカードをグリッドに差し込み、デスクトップでは列配置に組み込む */
  function insertCategoryCard(name) {
    if (document.getElementById(catCardId(name))) return;
    const html = buildCategoryCardHTML(name, []);
    const completedCard = document.getElementById("card-completed");
    if (completedCard && completedCard.parentNode === grid) {
      completedCard.insertAdjacentHTML("beforebegin", html); // モバイル（フラット表示）: 完了タスクの手前
    } else {
      grid.insertAdjacentHTML("beforeend", html); // デスクトップ: distributeMasonry が最短列へ配置する
    }
    const card = document.getElementById(catCardId(name));
    bindTaskSort(card.querySelector(".planned-list"));
    distributeMasonry();
  }

  const categoryManageList = document.getElementById("category-manage-list");
  if (categoryManageList) {
    categoryManageList.addEventListener("click", (e) => {
      if (e.target.dataset.removeCategory !== undefined) {
        const name = e.target.dataset.removeCategory;
        const cats = getCategories().filter((c) => c.name !== name);
        saveCategories(cats);
        renderCategoryManageList();
        // タスクが残っていなければカードも消す（残っていれば次回描画まではそのまま）
        const card = document.getElementById(catCardId(name));
        if (card && card.querySelectorAll(".task-item").length === 0) {
          card.remove();
          distributeMasonry();
        }
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
      insertCategoryCard(name);
      showToast(`カテゴリ「${name}」を追加しました`, "success");
    }
    btnAddCategory.addEventListener("click", addCategory);
    // Enter での自動登録は廃止（追加ボタンクリックでのみ登録）
  }

  // カードのドラッグ&ドロップ（デスクトップのみ）
  attachDragDropEvents();

  // タスク並べ替え（デスクトップ＋モバイル）。デスクトップでは別カテゴリのカードへドラッグするとカテゴリを付け替える
  const bindTaskSort = attachTaskSortEvents(saveDataQuietly);
  document.querySelectorAll(".planned-list").forEach(bindTaskSort);
}

/* ── タスク並べ替え（リスト内 & カード間ドラッグ&ドロップ） ──
 * attachTaskSortEvents(save) は共有状態を持つ bindList(list) を返す。
 * 描画時の全リストに加え、カテゴリ追加で後から差し込んだリストにも同じ関数でバインドする。
 * デスクトップ: 別カードのリストへドロップするとカテゴリを付け替える。
 * モバイル（タッチ）: 同じリスト内の並べ替えのみ。
 */

let _taskSortMouseupBound = false;

function attachTaskSortEvents(saveDataQuietly) {
  let draggedItem = null;
  let touchClone = null;
  let touchList = null;
  let touchScrollInterval = null;

  // mouseup でリセット（document には 1 回だけ登録）
  if (!_taskSortMouseupBound) {
    _taskSortMouseupBound = true;
    document.addEventListener("mouseup", () => {
      document.querySelectorAll(".task-item[draggable='true']").forEach((el) => {
        el.setAttribute("draggable", "false");
      });
    });
  }

  /** ドロップ先リストへ移動。別カードなら data-* とバッジのカテゴリを付け替える */
  function dropInto(list, afterItem) {
    const fromList = draggedItem.closest("ul");
    if (afterItem) list.insertBefore(draggedItem, afterItem);
    else list.appendChild(draggedItem);
    if (fromList !== list) setTaskCategory(draggedItem, list.dataset.category || "");
    syncCategoryCounts();
    saveDataQuietly();
  }

  return function bindList(list) {
    if (!list) return;

    // --- デスクトップ: HTML5 Drag & Drop ---
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
      if (!draggedItem) return;

      const items = [...list.querySelectorAll(".task-item:not(.task-dragging)")];
      const afterItem = getTaskInsertPoint(list, e.clientY, items);

      // 視覚フィードバック
      items.forEach((it) => it.classList.remove("task-drop-above"));
      if (afterItem) afterItem.classList.add("task-drop-above");
      list.classList.add("task-drop-target");
    });

    list.addEventListener("dragleave", () => {
      list.querySelectorAll(".task-drop-above").forEach((el) => el.classList.remove("task-drop-above"));
      list.classList.remove("task-drop-target");
    });

    list.addEventListener("drop", (e) => {
      e.preventDefault();
      list.querySelectorAll(".task-drop-above").forEach((el) => el.classList.remove("task-drop-above"));
      list.classList.remove("task-drop-target");
      if (!draggedItem) return;

      const items = [...list.querySelectorAll(".task-item:not(.task-dragging)")];
      const afterItem = getTaskInsertPoint(list, e.clientY, items);
      dropInto(list, afterItem);
    });

    list.addEventListener("dragend", () => {
      if (draggedItem) {
        draggedItem.classList.remove("task-dragging");
        draggedItem.style.opacity = "";
        draggedItem.setAttribute("draggable", "false");
        draggedItem = null;
      }
      document.querySelectorAll(".task-drop-above").forEach((el) => el.classList.remove("task-drop-above"));
      document.querySelectorAll(".task-drop-target").forEach((el) => el.classList.remove("task-drop-target"));
    });

    // --- モバイル: Touch Events（同じリスト内の並べ替えのみ） ---
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
  };
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
  // グリッドで委任しておくと、カテゴリ追加で後から差し込んだカードもそのままドラッグできる
  grid.addEventListener("mousedown", (e) => {
    const handle = e.target.closest(".card-drag-handle");
    if (!handle) return;
    const card = handle.closest(".draggable-card");
    if (card) card.setAttribute("draggable", "true");
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

/* ── ユーティリティ ── */

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
