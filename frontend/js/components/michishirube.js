/**
 * 道しるべ（今日意識すること）ページコンポーネント
 * 付箋リマインダーの全件一覧＋詳細モーダル。
 *
 * input-form.js（トップページ）のカードから移設した機能。データ層（サーバー同期・
 * メモリキャッシュ）と Markdown 描画はこのモジュールが唯一の持ち主で、
 * トップページのコンパクトカードは export されたヘルパ経由で参照する。
 */

import { remindersApi } from "../api.js?v=20260725b";
import { showToast } from "../app.js?v=20260725b";
import {
  attachFloatingToolbar,
  appendMarkdownToEditor,
  serializeEditorMarkdown,
} from "../floating-toolbar.js?v=20260725b";

/** contenteditable div / textarea いずれでも markdown を読み書きするヘルパ */
function readEditableMarkdown(el) {
  if (!el) return "";
  if (el.tagName === "TEXTAREA") return (el.value || "").trim();
  return serializeEditorMarkdown(el).trim();
}
function writeEditableMarkdown(el, text) {
  if (!el) return;
  if (el.tagName === "TEXTAREA") { el.value = text || ""; return; }
  appendMarkdownToEditor(el, text || "");
}

function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== 付箋の Markdown レンダリング =====
// Claude などからコピペした表/箇条書き/見出し/太字を整形表示する。
// 保存値はプレーンテキスト(Markdown)のままで、表示時のみ HTML に変換する。

let _markedLoadPromise = null;
let _purifyLoadPromise = null;
let _mdLibsRefreshPending = false;

function loadMarked() {
  if (window.marked) return Promise.resolve(window.marked);
  if (_markedLoadPromise) return _markedLoadPromise;
  _markedLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
    s.async = true;
    s.onload = () => {
      try {
        const m = window.marked;
        if (m && typeof m.setOptions === "function") {
          // breaks:true → 単一改行も <br> に。プレーンメモが従来通り改行表示される。
          m.setOptions({ breaks: true, gfm: true });
        }
      } catch {}
      resolve(window.marked);
    };
    s.onerror = () => { _markedLoadPromise = null; reject(new Error("marked.js の読込に失敗")); };
    document.head.appendChild(s);
  });
  return _markedLoadPromise;
}

function loadDomPurify() {
  if (window.DOMPurify) return Promise.resolve(window.DOMPurify);
  if (_purifyLoadPromise) return _purifyLoadPromise;
  _purifyLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js";
    s.async = true;
    s.onload = () => resolve(window.DOMPurify);
    s.onerror = () => { _purifyLoadPromise = null; reject(new Error("DOMPurify の読込に失敗")); };
    document.head.appendChild(s);
  });
  return _purifyLoadPromise;
}

function mdParseToHtml(m, text) {
  if (typeof m.parse === "function") return m.parse(text);
  if (m.marked && typeof m.marked.parse === "function") return m.marked.parse(text);
  if (typeof m === "function") return m(text);
  return "";
}

// Markdown は連続する空行を 1 つの段落区切りに丸めるため、ユーザーが Enter を
// 複数回押して入れた空行が 1 行分しか反映されない。余分な改行を NBSP のみの
// 空段落に置換し、入力どおりの空行数を見た目に保持する。
// フェンスコードブロック (``` ... ```) 内は対象外。
function preserveBlankLines(text) {
  const parts = text.split(/(^```[\s\S]*?^```)/m);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(/\n{3,}/g, (run) => {
      const extra = run.length - 2;
      return "\n\n" + " \n\n".repeat(extra);
    });
  }).join("");
}

// 行頭の半角スペース／タブを NBSP(U+00A0) に変換し、Markdown の
// "indented code block"(行頭 4 スペース以上で <pre><code> 化) を抑止する。
// タブは 4 NBSP 相当に展開。フェンスコードブロック内は対象外。
function escapeLeadingIndent(text) {
  const NBSP = " ";
  const parts = text.split(/(^```[\s\S]*?^```)/m);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part.replace(/^[ \t]+/gm, (ws) => {
      let out = "";
      for (const c of ws) out += (c === "\t") ? NBSP + NBSP + NBSP + NBSP : NBSP;
      return out;
    });
  }).join("");
}

/** Markdown を sanitize 済み HTML へ変換。未ロード時はエスケープ + 改行のみで応急描画。 */
export function renderStickyMd(text) {
  if (!text) return "";
  const m = window.marked;
  const p = window.DOMPurify;
  const safeText = escapeLeadingIndent(text);
  if (m && p) {
    try {
      const raw = mdParseToHtml(m, preserveBlankLines(safeText));
      return p.sanitize(raw, { USE_PROFILES: { html: true } });
    } catch {
      return escapeHTML(safeText).replace(/\n/g, "<br>");
    }
  }
  ensureMdLibsForRefresh();
  return escapeHTML(safeText).replace(/\n/g, "<br>");
}

/** ライブラリロード完了後に応急描画を差し替えるためのフック（トップページのカード等） */
const _mdRefreshHooks = new Set();
export function addMdRefreshHook(fn) {
  _mdRefreshHooks.add(fn);
}

/** ライブラリ未ロード時にバックグラウンドでロードし、完了後に描画を差し替える。 */
function ensureMdLibsForRefresh() {
  if (_mdLibsRefreshPending) return;
  _mdLibsRefreshPending = true;
  Promise.all([loadMarked(), loadDomPurify()]).then(() => {
    if (document.getElementById("mich-grid")) refreshMichGrid();
    if (document.getElementById("reminder-modal-body")) renderReminderModalContent();
    _mdRefreshHooks.forEach((fn) => { try { fn(); } catch {} });
  }).catch(() => {
    _mdLibsRefreshPending = false; // 失敗時は次回再試行
  });
}

/* ── データ層（メモリキャッシュ、サーバーが唯一のデータソース） ── */

let _remindersCache = [];

export function getRemindersSnapshot() {
  return _remindersCache;
}

/** トップページの楽観描画（localStorage キャッシュ）から流し込む用 */
export function setRemindersSnapshot(list) {
  if (Array.isArray(list)) _remindersCache = list;
}

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

/** セッション内同期に短い TTL を設け、画面往復での重複 API 呼び出しを避ける */
const SESSION_SYNC_TTL_MS = 5 * 60 * 1000; // 5分
let _lastRemindersSyncAt = 0;

export async function syncRemindersWithCache() {
  if (Date.now() - _lastRemindersSyncAt < SESSION_SYNC_TTL_MS && _remindersCache.length > 0) return;
  await syncRemindersFromServer();
  _lastRemindersSyncAt = Date.now();
}

export function getActiveReminders() {
  return getReminders().filter((r) => !r.archived);
}

function getArchivedReminders() {
  return getReminders().filter((r) => r.archived);
}

/* ── 文字スタイル設定（サイズ・太さ）── */

const REMINDER_STYLE_KEY = "reminder-text-style";
const REMINDER_STYLE_DEFAULT = { size: 18, weight: 700 };
const REMINDER_STYLE_LIMITS = { sizeMin: 12, sizeMax: 32, weightMin: 300, weightMax: 900 };
let stickyStylePanelOpen = false;

/* ── モーダル本文サイズ（カード側とは独立、A-/A+ で調整） ── */
const REMINDER_MODAL_SIZE_KEY = "reminder-modal-text-size";
const REMINDER_MODAL_SIZE_DEFAULT = 23;
const REMINDER_MODAL_SIZE_LIMITS = { min: 12, max: 48, step: 2 };

function clampNum(v, min, max) {
  v = Number(v);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function getReminderStyle() {
  try {
    const raw = localStorage.getItem(REMINDER_STYLE_KEY);
    if (!raw) return { ...REMINDER_STYLE_DEFAULT };
    const obj = JSON.parse(raw) || {};
    return {
      size: clampNum(obj.size ?? REMINDER_STYLE_DEFAULT.size, REMINDER_STYLE_LIMITS.sizeMin, REMINDER_STYLE_LIMITS.sizeMax),
      weight: clampNum(obj.weight ?? REMINDER_STYLE_DEFAULT.weight, REMINDER_STYLE_LIMITS.weightMin, REMINDER_STYLE_LIMITS.weightMax),
    };
  } catch {
    return { ...REMINDER_STYLE_DEFAULT };
  }
}

function applyReminderStyle(style) {
  const s = style || getReminderStyle();
  const root = document.documentElement;
  root.style.setProperty("--reminder-text-size", `${s.size}px`);
  root.style.setProperty("--reminder-text-weight", String(s.weight));
  // --reminder-modal-text-size はモーダル側で独立管理（applyModalTextSize）
}

function getModalTextSize() {
  try {
    const raw = localStorage.getItem(REMINDER_MODAL_SIZE_KEY);
    if (raw === null || raw === "") return REMINDER_MODAL_SIZE_DEFAULT;
    return clampNum(parseInt(raw, 10), REMINDER_MODAL_SIZE_LIMITS.min, REMINDER_MODAL_SIZE_LIMITS.max);
  } catch {
    return REMINDER_MODAL_SIZE_DEFAULT;
  }
}

function applyModalTextSize(size) {
  document.documentElement.style.setProperty("--reminder-modal-text-size", `${size}px`);
}

function setModalTextSize(size) {
  const next = clampNum(size, REMINDER_MODAL_SIZE_LIMITS.min, REMINDER_MODAL_SIZE_LIMITS.max);
  try { localStorage.setItem(REMINDER_MODAL_SIZE_KEY, String(next)); } catch {}
  applyModalTextSize(next);
  return next;
}

function saveReminderStyle(style) {
  try {
    localStorage.setItem(REMINDER_STYLE_KEY, JSON.stringify(style));
  } catch {
    // localStorage が使えなくても表示反映は行う
  }
  applyReminderStyle(style);
}

// モジュール読み込み時に保存済みスタイルを反映
applyReminderStyle();
applyModalTextSize(getModalTextSize());

export function formatReminderDate(timestamp) {
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

/* ── ページ状態 ── */

let currentReminderTab = "active"; // "active" | "archived"
let michSearchQuery = "";
let michCurrentIndex = 0;   // モーダルで表示中のインデックス（表示リスト基準）
let michRandomMode = false; // モーダルのランダム送りモード

/** 現在のタブ + 検索でフィルタし、新しい順（createdAt 降順）で返す */
function getDisplayReminders() {
  const list = currentReminderTab === "archived" ? getArchivedReminders() : getActiveReminders();
  const q = michSearchQuery.trim().toLowerCase();
  const filtered = q ? list.filter((r) => (r.text || "").toLowerCase().includes(q)) : list;
  return [...filtered].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/* ── ページ描画 ── */

function buildTabsHTML() {
  const activeCount = getActiveReminders().length;
  const archivedCount = getArchivedReminders().length;
  const isArchive = currentReminderTab === "archived";
  return `<div class="sticky-tabs" role="tablist">
    <button type="button" class="sticky-tab${!isArchive ? " active" : ""}" data-tab="active" role="tab" aria-selected="${!isArchive}">
      アクティブ <span class="sticky-tab-count">${activeCount}</span>
    </button>
    <button type="button" class="sticky-tab${isArchive ? " active" : ""}" data-tab="archived" role="tab" aria-selected="${isArchive}">
      アーカイブ <span class="sticky-tab-count">${archivedCount}</span>
    </button>
  </div>`;
}

function buildStyleSettingsPanelHTML() {
  const s = getReminderStyle();
  const { sizeMin, sizeMax, weightMin, weightMax } = REMINDER_STYLE_LIMITS;
  const hidden = stickyStylePanelOpen ? "" : " hidden";
  return `<div class="sticky-style-panel" id="sticky-style-panel"${hidden}>
    <div class="sticky-style-row">
      <label class="sticky-style-label" for="sticky-style-size-range">サイズ</label>
      <div class="sticky-style-controls">
        <input type="range" id="sticky-style-size-range" min="${sizeMin}" max="${sizeMax}" step="1" value="${s.size}">
        <button class="sticky-style-stepper" data-target="size" data-step="-1" type="button">&minus;</button>
        <input type="number" id="sticky-style-size-number" min="${sizeMin}" max="${sizeMax}" step="1" value="${s.size}">
        <button class="sticky-style-stepper" data-target="size" data-step="1" type="button">&plus;</button>
      </div>
    </div>
    <div class="sticky-style-row">
      <label class="sticky-style-label" for="sticky-style-weight-range">太さ</label>
      <div class="sticky-style-controls">
        <input type="range" id="sticky-style-weight-range" min="${weightMin}" max="${weightMax}" step="100" value="${s.weight}">
        <button class="sticky-style-stepper" data-target="weight" data-step="-100" type="button">&minus;</button>
        <input type="number" id="sticky-style-weight-number" min="${weightMin}" max="${weightMax}" step="100" value="${s.weight}">
        <button class="sticky-style-stepper" data-target="weight" data-step="100" type="button">&plus;</button>
      </div>
    </div>
    <div class="sticky-style-actions">
      <button class="sticky-style-reset" id="sticky-style-reset" type="button">デフォルトに戻す</button>
    </div>
  </div>`;
}

function buildMichNoteHTML(r) {
  const dateStr = formatReminderDate(r.createdAt);
  const archiveActionHTML = r.archived
    ? `<button class="sticky-restore" title="アクティブに戻す">&#x21a9;&#xfe0f;</button>`
    : `<button class="sticky-archive" title="アーカイブ">&#x1f4e5;</button>`;
  return `<div class="mich-note" data-id="${escapeHTML(r.id)}">
    <div class="mich-note-head">
      ${dateStr ? `<span class="sticky-note-date">${dateStr}</span>` : "<span></span>"}
      <div class="mich-note-actions">
        <button class="sticky-edit" title="編集">&#9998;</button>
        ${archiveActionHTML}
        <button class="sticky-delete" title="削除">&times;</button>
      </div>
    </div>
    <div class="mich-note-text sticky-text sticky-text-md">${renderStickyMd(r.text)}</div>
  </div>`;
}

function buildGridInnerHTML() {
  const reminders = getDisplayReminders();
  if (reminders.length === 0) {
    if (michSearchQuery.trim()) {
      return '<p class="sticky-empty">検索に一致するメモはありません。</p>';
    }
    return currentReminderTab === "archived"
      ? '<p class="sticky-empty">アーカイブされたメモはまだありません。</p>'
      : '<p class="sticky-empty">まだメモがありません。<br>上の入力欄から追加してみましょう。</p>';
  }
  return reminders.map((r) => buildMichNoteHTML(r)).join("");
}

/** 本文がはみ出しているカードにフェード用クラスを付ける */
function markClampedNotes() {
  document.querySelectorAll("#mich-grid .mich-note-text").forEach((el) => {
    el.classList.toggle("clamped", el.scrollHeight > el.clientHeight + 2);
  });
}

function buildMichPageHTML() {
  const isArchive = currentReminderTab === "archived";
  return `
    <div class="mich-page">
      <div class="card reminder-board-card mich-board-card">
        <div class="card-title">道しるべ</div>
        <p class="mich-page-desc">今日意識すること。付箋をクリックすると大きく表示されます。</p>
        ${buildTabsHTML()}
        <div class="mich-toolbar">
          <input type="search" class="mich-search" id="mich-search" placeholder="メモを検索..." value="${escapeHTML(michSearchQuery)}">
          <button class="sticky-nav-btn sticky-style-btn${stickyStylePanelOpen ? " active" : ""}" id="sticky-style-btn" title="文字スタイル">&#x2699;&#xfe0f;</button>
        </div>
        ${buildStyleSettingsPanelHTML()}
        <div class="sticky-add-area" id="sticky-add-area"${isArchive ? " hidden" : ""}>
          <div class="sticky-add-row">
            <div id="sticky-input" class="sticky-input" contenteditable="true" spellcheck="false" data-placeholder=""></div>
            <button class="btn btn-primary btn-sm" id="btn-add-sticky">追加</button>
          </div>
        </div>
        <div class="mich-grid" id="mich-grid">
          ${buildGridInnerHTML()}
        </div>
      </div>
    </div>`;
}

/** グリッド・タブ・入力欄表示をまとめて再描画する（追加/削除/タブ切替/検索後） */
function refreshMichGrid() {
  const page = document.querySelector(".mich-page");
  if (!page) return;

  const existingTabs = page.querySelector(".sticky-tabs");
  if (existingTabs) {
    existingTabs.outerHTML = buildTabsHTML();
    attachTabEvents();
  }

  const addArea = page.querySelector("#sticky-add-area");
  if (addArea) addArea.hidden = currentReminderTab === "archived";

  const grid = document.getElementById("mich-grid");
  if (grid) {
    grid.innerHTML = buildGridInnerHTML();
    markClampedNotes();
  }
}

/**
 * 道しるべページをメインエリアにレンダリングする
 */
export async function renderMichishirube() {
  const main = document.querySelector("main");
  michCurrentIndex = 0;

  // 楽観描画: キャッシュがあれば即表示、なければスピナー
  let painted = false;
  if (getReminders().length > 0) {
    main.innerHTML = buildMichPageHTML();
    attachMichPageEvents();
    markClampedNotes();
    painted = true;
  } else {
    main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;
  }

  const before = JSON.stringify(getReminders());
  await syncRemindersWithCache();

  if (!painted) {
    main.innerHTML = buildMichPageHTML();
    attachMichPageEvents();
    markClampedNotes();
  } else if (JSON.stringify(getReminders()) !== before) {
    // 入力中のテキストを消さないよう、フレッシュデータではグリッドだけ差し替える
    refreshMichGrid();
  }
}

/* ── イベント ── */

function attachTabEvents() {
  document.querySelectorAll(".mich-page .sticky-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (!tab || tab === currentReminderTab) return;
      currentReminderTab = tab;
      michCurrentIndex = 0;
      refreshMichGrid();
    });
  });
}

function attachStyleSettingsEvents() {
  const btn = document.getElementById("sticky-style-btn");
  const panel = document.getElementById("sticky-style-panel");
  if (!btn || !panel) return;

  btn.addEventListener("click", () => {
    stickyStylePanelOpen = !stickyStylePanelOpen;
    panel.hidden = !stickyStylePanelOpen;
    btn.classList.toggle("active", stickyStylePanelOpen);
  });

  const sizeRange = document.getElementById("sticky-style-size-range");
  const sizeNum = document.getElementById("sticky-style-size-number");
  const wRange = document.getElementById("sticky-style-weight-range");
  const wNum = document.getElementById("sticky-style-weight-number");
  const resetBtn = document.getElementById("sticky-style-reset");

  function update(target, rawValue) {
    const cur = getReminderStyle();
    const limits = REMINDER_STYLE_LIMITS;
    if (target === "size") {
      cur.size = clampNum(rawValue, limits.sizeMin, limits.sizeMax);
      if (sizeRange) sizeRange.value = String(cur.size);
      if (sizeNum) sizeNum.value = String(cur.size);
    } else if (target === "weight") {
      // step 100 に丸める
      const w = Math.round(clampNum(rawValue, limits.weightMin, limits.weightMax) / 100) * 100;
      cur.weight = clampNum(w, limits.weightMin, limits.weightMax);
      if (wRange) wRange.value = String(cur.weight);
      if (wNum) wNum.value = String(cur.weight);
    }
    saveReminderStyle(cur);
  }

  if (sizeRange) sizeRange.addEventListener("input", (e) => update("size", e.target.value));
  if (sizeNum) sizeNum.addEventListener("input", (e) => update("size", e.target.value));
  if (wRange) wRange.addEventListener("input", (e) => update("weight", e.target.value));
  if (wNum) wNum.addEventListener("input", (e) => update("weight", e.target.value));

  panel.querySelectorAll(".sticky-style-stepper").forEach((b) => {
    b.addEventListener("click", () => {
      const target = b.dataset.target;
      const step = Number(b.dataset.step) || 0;
      const cur = getReminderStyle();
      update(target, (target === "size" ? cur.size : cur.weight) + step);
    });
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      saveReminderStyle({ ...REMINDER_STYLE_DEFAULT });
      if (sizeRange) sizeRange.value = String(REMINDER_STYLE_DEFAULT.size);
      if (sizeNum) sizeNum.value = String(REMINDER_STYLE_DEFAULT.size);
      if (wRange) wRange.value = String(REMINDER_STYLE_DEFAULT.weight);
      if (wNum) wNum.value = String(REMINDER_STYLE_DEFAULT.weight);
    });
  }
}

function attachMichPageEvents() {
  attachTabEvents();
  attachStyleSettingsEvents();

  // 検索
  const search = document.getElementById("mich-search");
  if (search) {
    search.addEventListener("input", () => {
      michSearchQuery = search.value || "";
      michCurrentIndex = 0;
      const grid = document.getElementById("mich-grid");
      if (grid) {
        grid.innerHTML = buildGridInnerHTML();
        markClampedNotes();
      }
    });
  }

  // 追加
  const addBtn = document.getElementById("btn-add-sticky");
  const input = document.getElementById("sticky-input");
  if (addBtn && input) {
    appendMarkdownToEditor(input, "");
    attachFloatingToolbar(input);

    addBtn.addEventListener("click", () => {
      const text = readEditableMarkdown(input);
      if (!text) return;
      const reminders = getReminders();
      reminders.push({ id: Date.now().toString(36), text, createdAt: Date.now(), archived: false });
      saveReminders(reminders);
      currentReminderTab = "active"; // アーカイブ閲覧中に追加した場合もアクティブへ戻す
      refreshMichGrid();
      writeEditableMarkdown(input, "");
      input.focus();
    });
  }

  // グリッド内の操作（イベント委譲）
  const grid = document.getElementById("mich-grid");
  if (grid) {
    grid.addEventListener("click", (e) => {
      const note = e.target.closest(".mich-note");
      if (!note) return;
      const id = note.dataset.id;

      // 削除（×）。アーカイブと取り違えないよう確認ダイアログを出す。
      if (e.target.closest(".sticky-delete")) {
        if (!confirm("このメモを完全に削除しますか？\n（アーカイブで残したい場合はキャンセルして 📥 ボタンを使ってください）")) return;
        saveReminders(getReminders().filter((r) => r.id !== id));
        refreshMichGrid();
        return;
      }

      // アーカイブ
      if (e.target.closest(".sticky-archive")) {
        const target = getReminders().find((r) => r.id === id);
        if (!target) return;
        target.archived = true;
        saveReminders(getReminders());
        refreshMichGrid();
        showToast("アーカイブしました", "success");
        return;
      }

      // 復元（アーカイブ → アクティブ）
      if (e.target.closest(".sticky-restore")) {
        const target = getReminders().find((r) => r.id === id);
        if (!target) return;
        target.archived = false;
        saveReminders(getReminders());
        refreshMichGrid();
        showToast("アクティブに戻しました", "success");
        return;
      }

      // 編集（✎）→ モーダルを編集モードで開く
      if (e.target.closest(".sticky-edit")) {
        openModalForId(id, true);
        return;
      }

      // カード本体クリック → 詳細モーダル
      openModalForId(id, false);
    });
  }
}

function openModalForId(id, editing) {
  const list = getDisplayReminders();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return;
  michCurrentIndex = idx;
  openReminderModal(editing);
}

/* ── 詳細モーダル ── */

let reminderModalKeyHandler = null;
let reminderModalEditing = false;

function navigateModal(delta) {
  const reminders = getDisplayReminders();
  const len = reminders.length;
  if (len === 0) return;
  if (michRandomMode && len > 1) {
    let next;
    do { next = Math.floor(Math.random() * len); } while (next === michCurrentIndex);
    michCurrentIndex = next;
  } else {
    michCurrentIndex = (michCurrentIndex + delta + len) % len;
  }
}

function openReminderModal(startEditing = false) {
  const reminders = getDisplayReminders();
  if (reminders.length === 0) return;

  // 既存モーダルがあれば閉じる
  closeReminderModal();
  reminderModalEditing = !!startEditing;

  const overlay = document.createElement("div");
  overlay.id = "reminder-modal-overlay";
  overlay.className = "reminder-modal-overlay";
  overlay.innerHTML = `
    <div class="reminder-modal" role="dialog" aria-modal="true" aria-label="道しるべ">
      <button class="reminder-modal-close" id="reminder-modal-close" aria-label="閉じる">&times;</button>
      <div class="reminder-modal-header">
        <span class="reminder-modal-title">道しるべ</span>
        <span class="reminder-modal-date" id="reminder-modal-date"></span>
      </div>
      <div class="reminder-modal-body" id="reminder-modal-body"></div>
      <div class="reminder-modal-actions">
        <div class="reminder-modal-nav">
          <div class="reminder-modal-nav-center">
            ${reminders.length > 1 ? `
              <button class="sticky-nav-btn" id="reminder-modal-prev" title="前へ">&#9664;</button>
              <span class="sticky-counter" id="reminder-modal-counter"></span>
              <button class="sticky-nav-btn" id="reminder-modal-next" title="次へ">&#9654;</button>
              <button class="sticky-nav-btn sticky-random-btn${michRandomMode ? ' active' : ''}" id="reminder-modal-random" title="ランダム">&#x1f500;</button>
            ` : ""}
          </div>
          <div class="reminder-modal-fontsize" role="group" aria-label="文字サイズ">
            <button class="sticky-nav-btn reminder-fontsize-btn" id="reminder-modal-font-dec" title="文字を小さく" aria-label="文字を小さく">A-</button>
            <button class="sticky-nav-btn reminder-fontsize-btn" id="reminder-modal-font-inc" title="文字を大きく" aria-label="文字を大きく">A+</button>
          </div>
        </div>
        <div class="reminder-modal-buttons" id="reminder-modal-buttons"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  renderReminderModalContent();
  renderReminderModalButtons();

  // × ボタン
  document.getElementById("reminder-modal-close")?.addEventListener("click", () => {
    closeReminderModal();
  });

  // 背景クリック
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeReminderModal();
    }
  });

  // ESC キー
  reminderModalKeyHandler = (e) => {
    if (e.key !== "Escape") return;
    if (reminderModalEditing) {
      // 編集中は ESC で編集をキャンセル（破棄）
      reminderModalEditing = false;
      renderReminderModalContent();
      renderReminderModalButtons();
    } else {
      closeReminderModal();
    }
  };
  document.addEventListener("keydown", reminderModalKeyHandler);

  // ナビ
  document.getElementById("reminder-modal-prev")?.addEventListener("click", () => {
    navigateModal(-1);
    renderReminderModalContent();
  });
  document.getElementById("reminder-modal-next")?.addEventListener("click", () => {
    navigateModal(1);
    renderReminderModalContent();
  });
  document.getElementById("reminder-modal-random")?.addEventListener("click", (e) => {
    michRandomMode = !michRandomMode;
    e.currentTarget.classList.toggle("active", michRandomMode);
  });

  // 文字サイズ A-/A+
  applyModalTextSize(getModalTextSize());
  updateModalFontButtonsState();
  document.getElementById("reminder-modal-font-dec")?.addEventListener("click", () => {
    const cur = getModalTextSize();
    const next = setModalTextSize(cur - REMINDER_MODAL_SIZE_LIMITS.step);
    if (next !== cur) updateModalFontButtonsState();
  });
  document.getElementById("reminder-modal-font-inc")?.addEventListener("click", () => {
    const cur = getModalTextSize();
    const next = setModalTextSize(cur + REMINDER_MODAL_SIZE_LIMITS.step);
    if (next !== cur) updateModalFontButtonsState();
  });
}

function updateModalFontButtonsState() {
  const cur = getModalTextSize();
  const decBtn = document.getElementById("reminder-modal-font-dec");
  const incBtn = document.getElementById("reminder-modal-font-inc");
  if (decBtn) decBtn.disabled = cur <= REMINDER_MODAL_SIZE_LIMITS.min;
  if (incBtn) incBtn.disabled = cur >= REMINDER_MODAL_SIZE_LIMITS.max;
}

function renderReminderModalContent() {
  const reminders = getDisplayReminders();
  if (reminders.length === 0) {
    closeReminderModal();
    return;
  }
  if (michCurrentIndex >= reminders.length) michCurrentIndex = Math.max(0, reminders.length - 1);
  const target = reminders[michCurrentIndex];
  if (!target) return;

  const body = document.getElementById("reminder-modal-body");
  if (body) {
    if (reminderModalEditing) {
      body.innerHTML = `<div class="reminder-modal-editor" id="reminder-modal-editor" contenteditable="true" spellcheck="false"></div>`;
      const ed = document.getElementById("reminder-modal-editor");
      if (ed) {
        ed.dataset.id = target.id;
        appendMarkdownToEditor(ed, target.text);
        // ロード直後のシリアライズ結果を「変更なし」基準にする
        // (target.text と serialize 結果は等価でも文字列としては微差が出るため)
        ed.dataset.original = serializeEditorMarkdown(ed);
        attachFloatingToolbar(ed);
        setTimeout(() => {
          ed.focus();
          const range = document.createRange();
          range.selectNodeContents(ed);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }, 30);
      }
    } else {
      body.innerHTML = `<div class="reminder-modal-text sticky-text-md" id="reminder-modal-text" data-id="${escapeHTML(target.id)}"></div>`;
      const textEl = document.getElementById("reminder-modal-text");
      if (textEl) {
        textEl.innerHTML = renderStickyMd(target.text);
        textEl.title = "クリックで次へ";
        textEl.addEventListener("click", () => {
          if (reminders.length <= 1) return;
          navigateModal(1);
          renderReminderModalContent();
        });
      }
    }
  }

  const dateEl = document.getElementById("reminder-modal-date");
  if (dateEl) dateEl.textContent = formatReminderDate(target.createdAt);

  const counter = document.getElementById("reminder-modal-counter");
  if (counter) counter.textContent = `${michCurrentIndex + 1} / ${reminders.length}`;
}

function renderReminderModalButtons() {
  const container = document.getElementById("reminder-modal-buttons");
  if (!container) return;
  if (reminderModalEditing) {
    container.innerHTML = `
      <button class="btn btn-outline btn-sm" id="reminder-modal-cancel">キャンセル</button>
      <button class="btn btn-primary btn-sm" id="reminder-modal-save">保存</button>
    `;
    document.getElementById("reminder-modal-cancel")?.addEventListener("click", () => {
      reminderModalEditing = false;
      renderReminderModalContent();
      renderReminderModalButtons();
    });
    document.getElementById("reminder-modal-save")?.addEventListener("click", () => {
      saveReminderModalEdit();
      reminderModalEditing = false;
      renderReminderModalContent();
      renderReminderModalButtons();
      showToast("保存しました", "success");
    });
  } else {
    const isArchive = currentReminderTab === "archived";
    const archiveBtnHTML = isArchive
      ? `<button class="btn btn-outline btn-sm" id="reminder-modal-restore">↩ 戻す</button>`
      : `<button class="btn btn-outline btn-sm" id="reminder-modal-archive">📥 アーカイブ</button>`;
    container.innerHTML = `
      <button class="btn btn-danger btn-sm" id="reminder-modal-delete">🗑 削除</button>
      ${archiveBtnHTML}
      <button class="btn btn-primary btn-sm" id="reminder-modal-edit">✎ 編集</button>
    `;
    document.getElementById("reminder-modal-edit")?.addEventListener("click", () => {
      reminderModalEditing = true;
      renderReminderModalContent();
      renderReminderModalButtons();
    });
    document.getElementById("reminder-modal-delete")?.addEventListener("click", () => {
      const list = getDisplayReminders();
      const target = list[michCurrentIndex];
      if (!target) return;
      if (!confirm("このメモを削除しますか？")) return;
      saveReminders(getReminders().filter((r) => r.id !== target.id));
      afterModalMutation();
    });
    document.getElementById("reminder-modal-archive")?.addEventListener("click", () => {
      const list = getDisplayReminders();
      const target = list[michCurrentIndex];
      if (!target) return;
      const found = getReminders().find((r) => r.id === target.id);
      if (!found) return;
      found.archived = true;
      saveReminders(getReminders());
      afterModalMutation("アーカイブしました");
    });
    document.getElementById("reminder-modal-restore")?.addEventListener("click", () => {
      const list = getDisplayReminders();
      const target = list[michCurrentIndex];
      if (!target) return;
      const found = getReminders().find((r) => r.id === target.id);
      if (!found) return;
      found.archived = false;
      saveReminders(getReminders());
      afterModalMutation("アクティブに戻しました");
    });
  }
}

/** モーダル内で削除/アーカイブ/復元した後のグリッド + モーダルの後始末 */
function afterModalMutation(toastMessage) {
  if (getDisplayReminders().length === 0) {
    closeReminderModal();
    refreshMichGrid();
    if (toastMessage) showToast(toastMessage, "success");
    return;
  }
  if (michCurrentIndex >= getDisplayReminders().length) {
    michCurrentIndex = Math.max(0, getDisplayReminders().length - 1);
  }
  refreshMichGrid();
  renderReminderModalContent();
  renderReminderModalButtons();
  if (toastMessage) showToast(toastMessage, "success");
}

function saveReminderModalEdit() {
  const ed = document.getElementById("reminder-modal-editor");
  if (!ed) return;
  const id = ed.dataset.id;
  const original = ed.dataset.original ?? "";
  const newText = serializeEditorMarkdown(ed).trim();
  if (!id || !newText || newText === original) return;
  const reminders = getReminders();
  const target = reminders.find((r) => r.id === id);
  if (!target) return;
  target.text = newText;
  saveReminders(reminders);
  ed.dataset.original = newText;
  refreshMichGrid();
}

function closeReminderModal() {
  const overlay = document.getElementById("reminder-modal-overlay");
  if (overlay) overlay.remove();
  if (reminderModalKeyHandler) {
    document.removeEventListener("keydown", reminderModalKeyHandler);
    reminderModalKeyHandler = null;
  }
  reminderModalEditing = false;
}
