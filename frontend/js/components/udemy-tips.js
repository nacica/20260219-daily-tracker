/**
 * Udemy コース制作 Tips コンポーネント（一覧メイン + 中央モーダル編集）
 *
 * レイアウト方針:
 *   - メインは Tip 一覧（2 行カードのグリッド）
 *   - 上部ヘッダーに「＋ 新しい Tip」「⚙ タグ管理」+ ソートタブ + タグフィルタを横並び
 *   - Tip クリックで中央モーダルが開いて編集（自動保存・タグ編集・削除はモーダル内）
 *   - 編集モーダル内のみ自動保存タイマーが動く
 */

import { udemyTipsApi } from "../api.js?v=20260520a";
import { showToast } from "../app.js?v=20260520a";

// ===== ユーティリティ =====

function today() {
  return new Date().toLocaleDateString("sv-SE");
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

const DATE_HEADER_REGEX = /^\s*\d{4}年\d{1,2}月\d{1,2}日\([日月火水木金土]\) \d{1,2}時\d{2}分\s*$/;

function formatDateTimeHeader() {
  const d = new Date();
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${wd}) ${d.getHours()}時${mi}分`;
}

function isHeaderOnly(text) {
  return DATE_HEADER_REGEX.test(text);
}

function stripDateHeader(text) {
  const lines = text.split("\n");
  if (lines.length === 0 || !DATE_HEADER_REGEX.test(lines[0])) return text;
  let i = 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  return lines.slice(i).join("\n");
}

function labelColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return {
    bg: `hsl(${hue}, 70%, 88%)`,
    fg: `hsl(${hue}, 60%, 28%)`,
    bgDark: `hsl(${hue}, 35%, 22%)`,
    fgDark: `hsl(${hue}, 70%, 78%)`,
  };
}

function labelChipStyle(name) {
  const c = labelColor(name);
  return `--bd-chip-bg:${c.bg}; --bd-chip-fg:${c.fg}; --bd-chip-bg-dark:${c.bgDark}; --bd-chip-fg-dark:${c.fgDark};`;
}

/** タイトル: 日時ヘッダー除去後の先頭行を最大 60 文字 */
function entryTitle(entry) {
  const body = stripDateHeader(entry.content || "").trim();
  if (!body) return "(無題)";
  const firstLine = body.split("\n")[0];
  return firstLine.slice(0, 60);
}

/** プレビュー: タイトル直後の本文を 1〜2 行分（最大 120 文字） */
function entryPreview(entry) {
  const body = stripDateHeader(entry.content || "").trim();
  const lines = body.split("\n");
  if (lines.length <= 1) return "";
  // タイトル行（lines[0]）の後を 120 文字に丸める
  const rest = lines.slice(1).join(" ").trim();
  return rest.slice(0, 120);
}

// ===== 状態 =====

const SORT_MODE_KEY = "udemy-tips-sort-mode";
const VALID_SORT_MODES = new Set(["tag", "date", "name"]);

let allEntries = [];
let allLabels = [];
let filterLabels = [];
let sortMode = (() => {
  try {
    const saved = localStorage.getItem(SORT_MODE_KEY);
    return VALID_SORT_MODES.has(saved) ? saved : "tag";
  } catch {
    return "tag";
  }
})();

// 編集モーダル内の状態
let editingEntryId = null;   // 既存編集中: その ID
let newEntryId = null;       // 新規 → 初回オートセーブで割り当てられる ID
let currentLabels = [];      // モーダル内で編集中のタグ
let isDirty = false;
let newAutoSaveTimer = null;
let modalEl = null;          // 開いているモーダル要素
let modalMode = "view";      // "view" | "edit"

function setModalMode(mode) {
  if (mode !== "view" && mode !== "edit") return;
  modalMode = mode;
  const modal = modalEl?.querySelector(".ut-modal");
  if (modal) modal.dataset.mode = mode;
}

function setSortMode(mode) {
  if (!VALID_SORT_MODES.has(mode)) return;
  sortMode = mode;
  try { localStorage.setItem(SORT_MODE_KEY, mode); } catch {}
}

function setDirty(d) {
  isDirty = d;
  const btn = document.getElementById("ut-modal-save-btn");
  if (btn) {
    btn.classList.toggle("ut-btn-pulse", d);
  }
}

// ===== スタイル注入 =====

function injectStyles() {
  if (document.getElementById("ut-page-styles")) return;
  const style = document.createElement("style");
  style.id = "ut-page-styles";
  style.textContent = `
    .ut-page {
      max-width: 1280px;
      margin: 0 auto;
      padding: 12px 16px 80px;
    }

    /* ----- ヘッダー ----- */
    .ut-page-header {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .ut-page-title {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0;
      flex-shrink: 0;
    }
    .ut-page-count {
      font-size: 0.78rem;
      opacity: 0.6;
      flex-shrink: 0;
    }
    .ut-page-actions {
      margin-left: auto;
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    /* ----- ソートタブ ----- */
    .ut-sort-tabs {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      align-items: center;
      padding-bottom: 6px;
    }
    .ut-sort-tab {
      padding: 4px 12px;
      font-size: 0.78rem;
      border: 1px solid var(--border, #d1d5db);
      border-radius: 999px;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    .ut-sort-tab:hover {
      background: rgba(0,0,0,0.04);
    }
    [data-theme="dark"] .ut-sort-tab:hover {
      background: rgba(255,255,255,0.06);
    }
    .ut-sort-tab.active {
      background: var(--accent, #2563eb);
      color: #fff;
      border-color: var(--accent, #2563eb);
    }

    /* ----- フィルタバー ----- */
    .ut-filter-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      padding: 4px 0 12px;
      border-bottom: 1px solid var(--border, #e5e7eb);
      margin-bottom: 12px;
    }
    .ut-filter-label {
      font-size: 0.75rem;
      opacity: 0.6;
      margin-right: 4px;
    }
    .ut-filter-chip {
      padding: 3px 10px;
      font-size: 0.72rem;
      border-radius: 999px;
      cursor: pointer;
      background: var(--bd-chip-bg);
      color: var(--bd-chip-fg);
      border: 1px solid transparent;
      opacity: 0.7;
      transition: opacity 0.1s, transform 0.05s;
    }
    [data-theme="dark"] .ut-filter-chip {
      background: var(--bd-chip-bg-dark);
      color: var(--bd-chip-fg-dark);
    }
    .ut-filter-chip:hover { opacity: 1; }
    .ut-filter-chip.active {
      opacity: 1;
      box-shadow: 0 0 0 2px var(--accent, #2563eb);
    }
    .ut-filter-clear {
      padding: 3px 10px;
      font-size: 0.72rem;
      border-radius: 999px;
      cursor: pointer;
      border: 1px solid var(--border, #d1d5db);
      background: transparent;
      color: inherit;
      opacity: 0.7;
    }
    .ut-filter-clear:hover { opacity: 1; }
    .ut-filter-empty { font-size: 0.75rem; opacity: 0.5; }

    /* ----- グループ ----- */
    .ut-group {
      margin-bottom: 24px;
    }
    .ut-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 6px 2px;
      margin-bottom: 6px;
      border-bottom: 1px dashed var(--border, #e5e7eb);
    }
    .ut-group-count {
      font-size: 0.72rem;
      opacity: 0.55;
      font-weight: 400;
    }

    /* ----- カードグリッド ----- */
    .ut-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 10px;
    }
    .ut-card {
      position: relative;
      padding: 10px 12px;
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 8px;
      background: var(--card-bg, #fff);
      cursor: pointer;
      transition: transform 0.08s, box-shadow 0.08s, border-color 0.08s;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 76px;
    }
    [data-theme="dark"] .ut-card {
      background: var(--card-bg, rgba(255,255,255,0.04));
      border-color: rgba(255,255,255,0.10);
    }
    .ut-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      border-color: var(--accent, #2563eb);
    }
    [data-theme="dark"] .ut-card:hover {
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    }
    .ut-card-title {
      font-size: 0.92rem;
      font-weight: 600;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .ut-card-preview {
      font-size: 0.78rem;
      opacity: 0.65;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .ut-card-footer {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: auto;
    }
    .ut-card-tags {
      display: flex;
      gap: 3px;
      flex-wrap: wrap;
      flex: 1;
      min-width: 0;
    }
    .ut-card-meta {
      font-size: 0.7rem;
      opacity: 0.55;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .ut-card .bd-label-chip {
      font-size: 0.66rem;
      padding: 1px 7px;
      white-space: nowrap;
    }
    .ut-card-delete {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 22px;
      height: 22px;
      border-radius: 4px;
      border: none;
      background: transparent;
      color: inherit;
      opacity: 0;
      cursor: pointer;
      font-size: 0.85rem;
      line-height: 1;
      transition: opacity 0.1s, background 0.1s;
    }
    .ut-card:hover .ut-card-delete {
      opacity: 0.5;
    }
    .ut-card-delete:hover {
      opacity: 1 !important;
      background: rgba(239, 68, 68, 0.15);
    }
    .ut-card-delete.bd-longpress-active {
      opacity: 1 !important;
      background: rgba(239, 68, 68, 0.3) !important;
    }

    /* ----- 空状態 ----- */
    .ut-empty {
      text-align: center;
      padding: 64px 16px;
      opacity: 0.6;
    }
    .ut-empty-icon { font-size: 2.5rem; margin-bottom: 8px; }

    /* ----- 編集モーダル ----- */
    .ut-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
      backdrop-filter: blur(2px);
    }
    .ut-modal {
      background: var(--card-bg, #fff);
      color: inherit;
      width: 100%;
      max-width: 760px;
      max-height: 86vh;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 50px rgba(0,0,0,0.4);
      overflow: hidden;
    }
    [data-theme="dark"] .ut-modal {
      background: #1a1d24;
      border: 1px solid rgba(255,255,255,0.10);
    }
    .ut-modal-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border, #e5e7eb);
      flex-shrink: 0;
    }
    .ut-modal-nav-prev {
      width: 36px;
      height: 32px;
      border: 1px solid var(--border, #d1d5db);
      border-radius: 6px;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 0.95rem;
      flex-shrink: 0;
      transition: background 0.1s, transform 0.1s;
    }
    .ut-modal-nav-prev:hover:not(:disabled) {
      background: rgba(0,0,0,0.05);
    }
    [data-theme="dark"] .ut-modal-nav-prev:hover:not(:disabled) {
      background: rgba(255,255,255,0.06);
    }
    .ut-modal-nav-prev:hover:not(:disabled) {
      transform: translateX(-1px);
    }
    .ut-modal-nav-prev:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .ut-modal-title-area {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 6px;
    }
    .ut-modal-title {
      font-size: 0.95rem;
      font-weight: 600;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ut-modal-pos {
      font-size: 0.72rem;
      opacity: 0.55;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .ut-modal-close {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 1.1rem;
    }
    .ut-modal-close:hover { background: rgba(0,0,0,0.06); }
    [data-theme="dark"] .ut-modal-close:hover { background: rgba(255,255,255,0.08); }

    .ut-modal-labels {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border, #e5e7eb);
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      flex-shrink: 0;
      position: relative;
    }
    .ut-modal-labels-icon { opacity: 0.5; }
    .ut-modal-labels-chips {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .ut-modal-add-label {
      padding: 3px 10px;
      font-size: 0.72rem;
      border-radius: 999px;
      border: 1px dashed var(--border, #d1d5db);
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    .ut-modal-add-label:hover {
      border-style: solid;
      border-color: var(--accent, #2563eb);
    }
    .ut-label-picker {
      position: absolute;
      top: calc(100% - 2px);
      left: 14px;
      right: 14px;
      max-width: 360px;
      background: var(--card-bg, #fff);
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 8px;
      padding: 8px;
      box-shadow: 0 8px 20px rgba(0,0,0,0.12);
      z-index: 10;
    }
    [data-theme="dark"] .ut-label-picker {
      background: #232830;
      border-color: rgba(255,255,255,0.12);
    }
    .ut-label-picker-input {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--border, #d1d5db);
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font-size: 0.85rem;
      margin-bottom: 6px;
    }
    .ut-label-picker-options {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-height: 200px;
      overflow-y: auto;
    }
    .ut-label-picker-option {
      padding: 3px 9px;
      font-size: 0.72rem;
      border-radius: 999px;
      cursor: pointer;
      border: 1px solid transparent;
      background: var(--bd-chip-bg);
      color: var(--bd-chip-fg);
    }
    [data-theme="dark"] .ut-label-picker-option {
      background: var(--bd-chip-bg-dark);
      color: var(--bd-chip-fg-dark);
    }
    .ut-label-picker-empty {
      font-size: 0.75rem;
      opacity: 0.5;
      padding: 4px;
    }
    .ut-label-picker-hint {
      font-size: 0.65rem;
      opacity: 0.5;
      margin-top: 6px;
    }
    .ut-label-count {
      font-size: 0.65rem;
      opacity: 0.7;
      margin-left: 4px;
    }

    .ut-modal-body {
      flex: 1;
      min-height: 0;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
    }
    .ut-modal-textarea {
      flex: 1;
      min-height: 280px;
      width: 100%;
      padding: 10px;
      border: 1px solid var(--border, #d1d5db);
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.92rem;
      line-height: 1.55;
      resize: vertical;
      background: transparent;
      color: inherit;
    }
    .ut-modal-textarea:focus {
      outline: 2px solid var(--accent, #2563eb);
      outline-offset: -2px;
      border-color: transparent;
    }
    .ut-modal-view {
      flex: 1;
      min-height: 280px;
      width: 100%;
      padding: 10px;
      margin: 0;
      border: 1px solid transparent;
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.92rem;
      line-height: 1.55;
      background: transparent;
      color: inherit;
      white-space: pre-wrap;
      word-break: break-word;
      tab-size: 4;
      overflow-y: auto;
      user-select: text;
    }
    .ut-modal[data-mode="view"] .ut-modal-view {
      cursor: pointer;
      transition: background 0.1s;
    }
    .ut-modal[data-mode="view"] .ut-modal-view:hover {
      background: rgba(37,99,235,0.04);
    }
    [data-theme="dark"] .ut-modal[data-mode="view"] .ut-modal-view:hover {
      background: rgba(37,99,235,0.10);
    }

    /* ----- 閲覧/編集モード切替 ----- */
    .ut-modal[data-mode="view"] .ut-modal-textarea { display: none; }
    .ut-modal[data-mode="view"] .ut-modal-add-label { display: none; }
    .ut-modal[data-mode="view"] .bd-label-chip-remove { display: none; }
    .ut-modal[data-mode="view"] #ut-modal-save-btn { display: none; }
    .ut-modal[data-mode="view"] #ut-modal-delete-btn { display: none; }

    .ut-modal[data-mode="edit"] .ut-modal-view { display: none; }
    .ut-modal[data-mode="edit"] #ut-modal-edit-btn { display: none; }
    .ut-modal[data-mode="edit"] .ut-modal-labels { background: rgba(37,99,235,0.04); }
    [data-theme="dark"] .ut-modal[data-mode="edit"] .ut-modal-labels { background: rgba(37,99,235,0.10); }

    .ut-modal-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--border, #e5e7eb);
      flex-shrink: 0;
    }
    .ut-modal-footer-spacer { flex: 1; }
    .ut-btn-pulse {
      animation: ut-pulse 1.4s infinite;
    }
    @keyframes ut-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.4); }
      50%      { box-shadow: 0 0 0 4px rgba(37,99,235,0); }
    }

    /* ----- タグ管理モーダル（共通モーダルラッパー） ----- */
    .ut-labels-manager-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border, #e5e7eb);
    }
    .ut-labels-manager-row:last-child { border-bottom: none; }
    .ut-labels-manager-count {
      font-size: 0.75rem;
      opacity: 0.6;
      flex: 1;
    }

    /* モバイル */
    @media (max-width: 640px) {
      .ut-page { padding: 8px; }
      .ut-grid { grid-template-columns: 1fr; }
      .ut-modal { max-height: 92vh; }
      .ut-modal-textarea { min-height: 220px; }
    }
  `;
  document.head.appendChild(style);
}

// ===== メインレンダー =====

export async function renderUdemyTips() {
  injectStyles();
  filterLabels = [];
  const main = document.querySelector("main");
  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;

  await loadAllData();

  main.innerHTML = `
    <div class="ut-page">
      <div class="ut-page-header">
        <h2 class="ut-page-title">Udemy 制作 Tips</h2>
        <span class="ut-page-count" id="ut-page-count">${allEntries.length} 件</span>
        <div class="ut-page-actions">
          <button class="btn btn-outline btn-sm" id="ut-manage-labels-btn" title="タグを管理">⚙ タグ管理</button>
          <button class="btn btn-primary btn-sm" id="ut-new-btn">＋ 新しい Tip</button>
        </div>
      </div>
      <div id="ut-sort-tabs-wrap">${renderSortTabs()}</div>
      <div class="ut-filter-bar" id="ut-filter-bar">${renderFilterBar()}</div>
      <div id="ut-entries">${renderEntriesGrid()}</div>
    </div>
  `;

  attachPageEvents();
}

async function loadAllData() {
  try {
    allEntries = await udemyTipsApi.list() || [];
  } catch {
    allEntries = [];
  }
  try {
    const res = await udemyTipsApi.listLabels();
    allLabels = (res && res.labels) || [];
  } catch {
    allLabels = [];
  }
}

// ===== ソートタブ =====

function renderSortTabs() {
  const tabs = [
    { mode: "tag",  label: "タグ別" },
    { mode: "date", label: "新しい順" },
    { mode: "name", label: "五十音順" },
  ];
  return `
    <div class="ut-sort-tabs" role="tablist" aria-label="一覧のソート切替">
      ${tabs.map(t => `
        <button class="ut-sort-tab${sortMode === t.mode ? " active" : ""}"
                type="button" data-mode="${t.mode}"
                role="tab" aria-selected="${sortMode === t.mode}">
          ${t.label}
        </button>
      `).join("")}
    </div>
  `;
}

function refreshSortTabs() {
  const el = document.getElementById("ut-sort-tabs-wrap");
  if (!el) return;
  el.innerHTML = renderSortTabs();
  attachSortTabEvents();
}

function attachSortTabEvents() {
  document.querySelectorAll("#ut-sort-tabs-wrap .ut-sort-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      if (mode === sortMode) return;
      setSortMode(mode);
      refreshSortTabs();
      refreshEntries();
    });
  });
}

// ===== フィルタバー =====

function renderFilterBar() {
  if (allLabels.length === 0) {
    return `<span class="ut-filter-empty">タグなし</span>`;
  }
  const chips = allLabels.map(l => {
    const active = filterLabels.includes(l.name);
    return `
      <button class="ut-filter-chip${active ? " active" : ""}" type="button"
              data-name="${escapeHTML(l.name)}"
              style="${labelChipStyle(l.name)}">
        ${escapeHTML(l.name)} <span class="ut-label-count">${l.count}</span>
      </button>
    `;
  }).join("");
  const clearBtn = filterLabels.length > 0
    ? `<button class="ut-filter-clear" type="button" id="ut-filter-clear-btn">× クリア</button>`
    : "";
  return `
    <span class="ut-filter-label">フィルタ:</span>
    ${chips}
    ${clearBtn}
  `;
}

function refreshFilterBar() {
  const el = document.getElementById("ut-filter-bar");
  if (!el) return;
  el.innerHTML = renderFilterBar();
  attachFilterBarEvents();
}

function attachFilterBarEvents() {
  document.querySelectorAll("#ut-filter-bar .ut-filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.name;
      if (filterLabels.includes(name)) {
        filterLabels = filterLabels.filter(n => n !== name);
      } else {
        filterLabels.push(name);
      }
      refreshFilterBar();
      refreshEntries();
    });
  });
  document.getElementById("ut-filter-clear-btn")?.addEventListener("click", () => {
    filterLabels = [];
    refreshFilterBar();
    refreshEntries();
  });
}

// ===== 一覧グリッド =====

function getFilteredEntries() {
  if (filterLabels.length === 0) return allEntries;
  return allEntries.filter(e => {
    const labels = e.labels || [];
    return labels.some(l => filterLabels.includes(l));
  });
}

function renderCard(entry) {
  const title = entryTitle(entry);
  const preview = entryPreview(entry);
  const labels = entry.labels || [];
  const time = entry.created_at ? entry.created_at.slice(11, 16) : "";
  const dateShort = entry.date ? entry.date.slice(5) : "";
  const tagsHTML = labels.map(l =>
    `<span class="bd-label-chip" style="${labelChipStyle(l)}">${escapeHTML(l)}</span>`
  ).join("");
  const previewHTML = preview
    ? `<div class="ut-card-preview">${escapeHTML(preview)}</div>`
    : `<div class="ut-card-preview" style="opacity:0.3;">（本文なし）</div>`;
  return `
    <div class="ut-card" data-id="${entry.id}" tabindex="0">
      <button class="ut-card-delete" data-id="${entry.id}" title="削除（長押し）" aria-label="削除">×</button>
      <div class="ut-card-title">${escapeHTML(title)}</div>
      ${previewHTML}
      <div class="ut-card-footer">
        <div class="ut-card-tags">${tagsHTML}</div>
        <span class="ut-card-meta">${dateShort} ${time}</span>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  const msg = filterLabels.length > 0
    ? "選択中のタグに該当する Tips はありません"
    : "まだ Tips がありません。右上の「＋ 新しい Tip」から書き始めましょう。";
  return `
    <div class="ut-empty">
      <div class="ut-empty-icon">💡</div>
      <p>${msg}</p>
    </div>
  `;
}

function renderByDate(list) {
  const grouped = {};
  for (const entry of list) {
    const date = entry.date;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(entry);
  }
  const sortedDates = Object.keys(grouped).sort().reverse();
  const sortKey = (e) => {
    const so = e.sort_order;
    return so == null ? (e.entry_number || 1) : so;
  };
  for (const date of sortedDates) {
    grouped[date].sort((a, b) => sortKey(a) - sortKey(b) || (a.entry_number || 0) - (b.entry_number || 0));
  }
  return sortedDates.map(date => {
    const entries = grouped[date];
    const d = new Date(date + "T00:00:00");
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    const wd = weekdays[d.getDay()];
    const isToday = date === today();
    return `
      <div class="ut-group">
        <div class="ut-group-header">
          <span>${md}（${wd}）</span>
          ${isToday ? '<span class="ut-group-count" style="color: var(--accent, #2563eb);">today</span>' : ""}
          <span class="ut-group-count">${entries.length} 件</span>
        </div>
        <div class="ut-grid">${entries.map(renderCard).join("")}</div>
      </div>
    `;
  }).join("");
}

function renderByTag(list) {
  const grouped = new Map();
  const untagged = [];
  for (const entry of list) {
    const labels = entry.labels || [];
    if (labels.length === 0) {
      untagged.push(entry);
      continue;
    }
    for (const lbl of labels) {
      if (!grouped.has(lbl)) grouped.set(lbl, []);
      grouped.get(lbl).push(entry);
    }
  }
  const orderedTags = allLabels.map(l => l.name).filter(name => grouped.has(name));
  for (const tag of grouped.keys()) {
    if (!orderedTags.includes(tag)) orderedTags.push(tag);
  }
  const sections = orderedTags.map(tag => {
    const entries = grouped.get(tag) || [];
    entries.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return `
      <div class="ut-group">
        <div class="ut-group-header">
          <span class="bd-label-chip" style="${labelChipStyle(tag)}">${escapeHTML(tag)}</span>
          <span class="ut-group-count">${entries.length} 件</span>
        </div>
        <div class="ut-grid">${entries.map(renderCard).join("")}</div>
      </div>
    `;
  });
  if (untagged.length > 0) {
    untagged.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    sections.push(`
      <div class="ut-group">
        <div class="ut-group-header">
          <span>タグなし</span>
          <span class="ut-group-count">${untagged.length} 件</span>
        </div>
        <div class="ut-grid">${untagged.map(renderCard).join("")}</div>
      </div>
    `);
  }
  return sections.join("");
}

function renderByName(list) {
  const sorted = [...list].sort((a, b) =>
    entryTitle(a).localeCompare(entryTitle(b), "ja")
  );
  return `<div class="ut-grid">${sorted.map(renderCard).join("")}</div>`;
}

function renderEntriesGrid() {
  const list = getFilteredEntries();
  if (list.length === 0) return renderEmptyState();
  if (sortMode === "date") return renderByDate(list);
  if (sortMode === "name") return renderByName(list);
  return renderByTag(list);
}

/**
 * モーダルの「次へ」ナビゲーション用に、現在の sortMode/filter を適用した
 * 表示順の entry を平坦な配列で返す。タグ別モードでは同じ Tip が複数タグ
 * グループに登場するため重複を含む。
 */
function getOrderedFilteredEntries() {
  const list = getFilteredEntries();
  if (list.length === 0) return [];

  if (sortMode === "date") {
    const sortKey = (e) => {
      const so = e.sort_order;
      return so == null ? (e.entry_number || 1) : so;
    };
    return [...list].sort((a, b) => {
      const dateCmp = (b.date || "").localeCompare(a.date || "");
      if (dateCmp !== 0) return dateCmp;
      return sortKey(a) - sortKey(b) || (a.entry_number || 0) - (b.entry_number || 0);
    });
  }

  if (sortMode === "name") {
    return [...list].sort((a, b) => entryTitle(a).localeCompare(entryTitle(b), "ja"));
  }

  // tag mode: renderByTag と同じ順序
  const grouped = new Map();
  const untagged = [];
  for (const entry of list) {
    const labels = entry.labels || [];
    if (labels.length === 0) {
      untagged.push(entry);
      continue;
    }
    for (const lbl of labels) {
      if (!grouped.has(lbl)) grouped.set(lbl, []);
      grouped.get(lbl).push(entry);
    }
  }
  const orderedTags = allLabels.map(l => l.name).filter(name => grouped.has(name));
  for (const tag of grouped.keys()) {
    if (!orderedTags.includes(tag)) orderedTags.push(tag);
  }
  const ordered = [];
  for (const tag of orderedTags) {
    const entries = grouped.get(tag) || [];
    entries.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    ordered.push(...entries);
  }
  if (untagged.length > 0) {
    untagged.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    ordered.push(...untagged);
  }
  return ordered;
}

async function refreshEntries() {
  await loadAllData();
  const countEl = document.getElementById("ut-page-count");
  if (countEl) countEl.textContent = `${allEntries.length} 件`;
  refreshFilterBar();
  const ent = document.getElementById("ut-entries");
  if (ent) ent.innerHTML = renderEntriesGrid();
  initCardLongPress(ent);
}

// ===== ページレベルのイベント =====

function attachPageEvents() {
  document.getElementById("ut-new-btn")?.addEventListener("click", () => openTipModal(null));
  document.getElementById("ut-manage-labels-btn")?.addEventListener("click", openLabelsManager);
  attachSortTabEvents();
  attachFilterBarEvents();

  // カードクリックで編集モーダル
  const entriesEl = document.getElementById("ut-entries");
  initCardLongPress(entriesEl);
  entriesEl?.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest(".ut-card-delete");
    if (deleteBtn) {
      e.stopPropagation();
      if (suppressNextClick) { suppressNextClick = false; return; }
      showToast("削除するにはボタンを長押ししてください");
      return;
    }
    const card = e.target.closest(".ut-card");
    if (!card) return;
    const id = card.dataset.id;
    const entry = allEntries.find(en => en.id === id);
    if (entry) openTipModal(entry);
  });
  // Enter キーでカードを開く
  entriesEl?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const card = e.target.closest(".ut-card");
    if (!card) return;
    const id = card.dataset.id;
    const entry = allEntries.find(en => en.id === id);
    if (entry) openTipModal(entry);
  });
}

// ===== カードの長押し削除 =====

const LONG_PRESS_MS = 500;
let suppressNextClick = false;

function initCardLongPress(container) {
  if (!container || container.dataset.lpInit === "1") return;
  container.dataset.lpInit = "1";

  let timer = null;
  let activeBtn = null;
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (activeBtn) activeBtn.classList.remove("bd-longpress-active");
    activeBtn = null;
  };
  container.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".ut-card-delete");
    if (!btn) return;
    if (e.button !== undefined && e.button !== 0) return;
    cancel();
    activeBtn = btn;
    btn.classList.add("bd-longpress-active");
    const entryId = btn.dataset.id;
    timer = setTimeout(() => {
      cancel();
      suppressNextClick = true;
      if (navigator.vibrate) { try { navigator.vibrate(20); } catch {} }
      const entry = allEntries.find(en => en.id === entryId);
      const info = getDeleteInfo(entry);
      showDeleteConfirmModal({
        title: info.title,
        labels: info.labels,
        onConfirm: async () => {
          await deleteEntry(entryId);
          showToast("削除しました");
        },
      });
    }, LONG_PRESS_MS);
  });
  container.addEventListener("pointerup", cancel);
  container.addEventListener("pointerleave", cancel);
  container.addEventListener("pointercancel", cancel);
}

function getDeleteInfo(entry) {
  if (!entry) return { title: "(不明な Tip)", labels: [] };
  return { title: entryTitle(entry), labels: entry.labels || [] };
}

// ===== 編集モーダル =====

function openTipModal(entry) {
  closeTipModal({ save: false }); // 既存があれば閉じる（保存は呼び出し元責任）
  const isNew = !entry;
  editingEntryId = isNew ? null : entry.id;
  newEntryId = null;
  currentLabels = isNew ? [] : [...(entry.labels || [])];
  isDirty = false;

  // 位置情報（新規モード時は "新規" 表示）
  const ordered = isNew ? [] : getOrderedFilteredEntries();
  const idx = isNew ? -1 : ordered.findIndex(e => e.id === entry.id);
  const posText = isNew ? "新規" : (idx >= 0 ? `${idx + 1} / ${ordered.length}` : `- / ${ordered.length}`);
  const navDisabled = (isNew && ordered.length === 0) || (!isNew && ordered.length <= 1);

  // 初期モード: 新規なら edit、既存なら view
  modalMode = isNew ? "edit" : "view";

  const contentForView = isNew ? "" : (entry.content || "");
  const viewHTML = contentForView ? escapeHTML(contentForView) : "";

  modalEl = document.createElement("div");
  modalEl.className = "ut-modal-overlay";
  modalEl.id = "ut-tip-modal";
  modalEl.innerHTML = `
    <div class="ut-modal" role="dialog" aria-modal="true" data-mode="${modalMode}">
      <div class="ut-modal-header">
        <button class="ut-modal-nav-prev" id="ut-modal-nav-prev" type="button"
                title="前のカードへ" aria-label="前のカードへ"${navDisabled ? " disabled" : ""}>←</button>
        <div class="ut-modal-title-area">
          <span class="ut-modal-title" id="ut-modal-title">${escapeHTML(isNew ? "新しい Tip" : (entryTitle(entry) || "(無題)"))}</span>
          <span class="ut-modal-pos" id="ut-modal-pos">${posText}</span>
        </div>
        <button class="ut-modal-close" type="button" aria-label="閉じる" id="ut-modal-close-btn">×</button>
      </div>
      <div class="ut-modal-labels" id="ut-modal-labels">
        ${renderModalLabels()}
      </div>
      <div class="ut-modal-body">
        <pre class="ut-modal-view" id="ut-modal-view">${viewHTML}</pre>
        <textarea class="ut-modal-textarea" id="ut-modal-textarea">${escapeHTML(isNew ? "" : (entry.content || ""))}</textarea>
      </div>
      <div class="ut-modal-footer">
        <button class="btn btn-danger btn-sm" id="ut-modal-delete-btn" title="長押しで削除"${isNew ? ' style="display:none;"' : ""}>🗑 削除</button>
        <div class="ut-modal-footer-spacer"></div>
        <button class="btn btn-primary btn-sm" id="ut-modal-edit-btn">✏ 編集</button>
        <button class="btn btn-outline btn-sm" id="ut-modal-cancel-btn">閉じる</button>
        <button class="btn btn-primary btn-sm" id="ut-modal-save-btn">💾 保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalEl);

  // 新規モードの場合は日時ヘッダーを初期挿入
  const textarea = document.getElementById("ut-modal-textarea");
  if (isNew && textarea) {
    textarea.value = `${formatDateTimeHeader()}\n\n`;
    const pos = textarea.value.length;
    setTimeout(() => {
      textarea.setSelectionRange(pos, pos);
      textarea.focus();
    }, 30);
  } else if (textarea) {
    setTimeout(() => textarea.focus(), 30);
  }

  attachModalEvents();
}

/** 閲覧 → 編集モードへ切替。textarea にフォーカスし、カーソルを末尾へ */
function switchToEditMode() {
  setModalMode("edit");
  const textarea = document.getElementById("ut-modal-textarea");
  if (textarea) {
    textarea.focus();
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
    textarea.scrollTop = textarea.scrollHeight;
  }
}

function attachModalEvents() {
  // 閉じる
  const closeBtn = document.getElementById("ut-modal-close-btn");
  const cancelBtn = document.getElementById("ut-modal-cancel-btn");
  closeBtn?.addEventListener("click", () => closeTipModal());
  cancelBtn?.addEventListener("click", () => closeTipModal());
  modalEl?.addEventListener("click", (e) => {
    if (e.target === modalEl) closeTipModal();
  });
  document.addEventListener("keydown", onModalKeydown);

  // 保存
  document.getElementById("ut-modal-save-btn")?.addEventListener("click", saveCurrentEntry);

  // 前のカードへ（ヘッダー左の ← ボタン）
  document.getElementById("ut-modal-nav-prev")?.addEventListener("click", navigateToPrevTip);

  // 本文クリック → 次のカードへ（閲覧モード、かつテキスト未選択時のみ）
  const viewEl = document.getElementById("ut-modal-view");
  viewEl?.addEventListener("mouseup", (e) => {
    if (modalMode !== "view") return;
    if (e.button !== 0) return;
    // 直前にドラッグでテキスト選択していたら遷移しない（コピー操作を尊重）
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0 && viewEl.contains(sel.anchorNode)) return;
    navigateToNextTip();
  });

  // 閲覧 → 編集モード切替
  document.getElementById("ut-modal-edit-btn")?.addEventListener("click", switchToEditMode);

  // テキストエリア入力で自動保存
  const textarea = document.getElementById("ut-modal-textarea");
  textarea?.addEventListener("input", handleTextareaInput);
  textarea?.addEventListener("keydown", handleTabInsert);

  // 削除（長押し）
  const deleteBtn = document.getElementById("ut-modal-delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", (e) => {
      if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); return; }
      showToast("削除するにはボタンを長押ししてください");
    });
    attachLongPressToButton(deleteBtn, () => {
      const targetId = editingEntryId || newEntryId;
      if (!targetId) return;
      const entry = allEntries.find(en => en.id === targetId);
      const info = getDeleteInfo(entry);
      showDeleteConfirmModal({
        title: info.title,
        labels: info.labels,
        onConfirm: async () => {
          await deleteEntry(targetId);
          closeTipModal({ save: false });
          showToast("削除しました");
        },
      });
    });
  }

  // タグエディタ
  attachLabelsEditorEvents();
}

function onModalKeydown(e) {
  if (e.key === "Escape" && modalEl) {
    e.preventDefault();
    closeTipModal();
  }
}

/**
 * 「次のカードへ」: 現在の編集内容を自動保存してから、表示順の次の Tip を
 * モーダル内に読み込む。端で先頭に戻る（ループ）。
 * 本文クリックや、外部ロジックから呼ばれる。
 */
async function navigateToNextTip() {
  await navigateTip(+1);
}

/** 「前のカードへ」: 端で末尾に戻る（ループ）。ヘッダー左の ← ボタン用 */
async function navigateToPrevTip() {
  await navigateTip(-1);
}

async function navigateTip(direction) {
  if (!modalEl) return;

  // 進行中の自動保存タイマーを止め、現在の内容を確実に保存
  if (newAutoSaveTimer) { clearTimeout(newAutoSaveTimer); newAutoSaveTimer = null; }
  const textarea = document.getElementById("ut-modal-textarea");
  const text = textarea ? textarea.value : "";
  const hasText = text.trim().length > 0 && !isHeaderOnly(text);
  if (hasText) {
    if (editingEntryId) {
      await autoSaveExisting(editingEntryId);
    } else if (newEntryId) {
      await autoSaveExisting(newEntryId);
    } else {
      await autoSaveCreate();
    }
  }

  const ordered = getOrderedFilteredEntries();
  if (ordered.length === 0) {
    await closeTipModal({ save: false });
    return;
  }

  const currentId = editingEntryId || newEntryId;
  let idx = ordered.findIndex(e => e.id === currentId);
  if (idx === -1) {
    // 自分が ordered に居ない（フィルタから外れた等）→ 端から
    const fallback = direction > 0 ? 0 : ordered.length - 1;
    loadTipIntoModal(ordered[fallback], fallback, ordered.length);
    return;
  }
  if (ordered.length <= 1) return;

  const len = ordered.length;
  const targetIdx = ((idx + direction) % len + len) % len; // 端でループ
  loadTipIntoModal(ordered[targetIdx], targetIdx, len);
}

/** モーダル内のフィールドを別の entry の内容に差し替える（モーダル自体は再生成しない） */
function loadTipIntoModal(entry, idx, total) {
  if (!entry || !modalEl) return;
  editingEntryId = entry.id;
  newEntryId = null;
  currentLabels = [...(entry.labels || [])];
  setDirty(false);

  // モードを閲覧にリセット
  setModalMode("view");

  // タイトル & 位置インジケーター
  const titleEl = document.getElementById("ut-modal-title");
  if (titleEl) titleEl.textContent = entryTitle(entry) || "(無題)";
  const posEl = document.getElementById("ut-modal-pos");
  if (posEl) posEl.textContent = `${idx + 1} / ${total}`;
  const navBtn = document.getElementById("ut-modal-nav-prev");
  if (navBtn) navBtn.disabled = total <= 1;

  // 本文（textarea + 閲覧用 pre 両方を更新）
  const textarea = document.getElementById("ut-modal-textarea");
  if (textarea) {
    textarea.value = entry.content || "";
    textarea.scrollTop = 0;
    textarea.setSelectionRange(0, 0);
  }
  const viewEl = document.getElementById("ut-modal-view");
  if (viewEl) {
    viewEl.textContent = entry.content || "";
    viewEl.scrollTop = 0;
  }

  // タグエディタ
  refreshModalLabels();

  // 削除ボタン（新規モードで隠していた場合に備えて表示）
  const deleteBtn = document.getElementById("ut-modal-delete-btn");
  if (deleteBtn) {
    deleteBtn.style.display = "";
    delete deleteBtn.dataset.lpInit; // 長押しを再結線できるよう初期化フラグを外す
    attachLongPressToButton(deleteBtn, () => {
      const targetId = editingEntryId || newEntryId;
      if (!targetId) return;
      const en = allEntries.find(x => x.id === targetId);
      const info = getDeleteInfo(en);
      showDeleteConfirmModal({
        title: info.title,
        labels: info.labels,
        onConfirm: async () => {
          await deleteEntry(targetId);
          // 削除後は次の Tip へ進む。残件 0 ならモーダルを閉じる
          const remaining = getOrderedFilteredEntries();
          if (remaining.length === 0) {
            await closeTipModal({ save: false });
          } else {
            const ni = Math.min(idx, remaining.length - 1);
            loadTipIntoModal(remaining[ni], ni, remaining.length);
          }
          showToast("削除しました");
        },
      });
    });
  }
}

async function closeTipModal({ save = true } = {}) {
  if (!modalEl) return;
  if (save) {
    // 閉じる前に内容を保存（新規で空メモは作らない）
    const textarea = document.getElementById("ut-modal-textarea");
    const text = textarea ? textarea.value : "";
    const hasText = text.trim().length > 0 && !isHeaderOnly(text);
    if (hasText) {
      if (editingEntryId) {
        await autoSaveExisting(editingEntryId);
      } else if (newEntryId) {
        await autoSaveExisting(newEntryId);
      } else {
        await createNewEntry(text.trim());
      }
    }
  }
  if (newAutoSaveTimer) { clearTimeout(newAutoSaveTimer); newAutoSaveTimer = null; }
  document.removeEventListener("keydown", onModalKeydown);
  modalEl.remove();
  modalEl = null;
  editingEntryId = null;
  newEntryId = null;
  currentLabels = [];
  setDirty(false);
  await refreshEntries();
}

function handleTextareaInput() {
  setDirty(true);
  if (newAutoSaveTimer) clearTimeout(newAutoSaveTimer);
  newAutoSaveTimer = setTimeout(() => {
    if (editingEntryId || newEntryId) {
      autoSaveExisting(editingEntryId || newEntryId);
    } else {
      autoSaveCreate();
    }
  }, 2000);
}

async function autoSaveCreate() {
  const textarea = document.getElementById("ut-modal-textarea");
  if (!textarea) return;
  const text = textarea.value;
  if (text.trim() === "" || isHeaderOnly(text)) {
    setDirty(false);
    return;
  }
  try {
    const created = await udemyTipsApi.create(today(), text.trim(), currentLabels);
    if (created && created.id) {
      newEntryId = created.id;
      // 楽観的に allEntries にも追加
      allEntries.unshift(created);
      const countEl = document.getElementById("ut-page-count");
      if (countEl) countEl.textContent = `${allEntries.length} 件`;
      // 新規 → 既存になったので削除ボタンを表示
      const deleteBtn = document.getElementById("ut-modal-delete-btn");
      if (deleteBtn && deleteBtn.style.display === "none") {
        deleteBtn.style.display = "";
      }
    }
    setDirty(false);
  } catch {}
}

async function autoSaveExisting(entryId) {
  if (!entryId) return;
  const textarea = document.getElementById("ut-modal-textarea");
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) return;
  try {
    const updated = await udemyTipsApi.update(entryId, content, currentLabels);
    const idx = allEntries.findIndex(e => e.id === entryId);
    if (idx >= 0 && updated) allEntries[idx] = updated;
    setDirty(false);
    // モーダルのタイトルを更新
    const titleEl = document.getElementById("ut-modal-title");
    if (titleEl) titleEl.textContent = entryTitle(updated || { content }) || "(無題)";
  } catch {}
}

async function createNewEntry(content) {
  try {
    const created = await udemyTipsApi.create(today(), content, currentLabels);
    if (created && created.id) {
      newEntryId = created.id;
      allEntries.unshift(created);
    }
  } catch (e) {
    showToast(`保存に失敗しました: ${e.message}`, "error");
  }
}

async function saveCurrentEntry() {
  const textarea = document.getElementById("ut-modal-textarea");
  const content = textarea?.value.trim() || "";
  if (!content) {
    setDirty(false);
    await closeTipModal({ save: false });
    return;
  }
  try {
    if (editingEntryId) {
      await udemyTipsApi.update(editingEntryId, content, currentLabels);
    } else if (newEntryId) {
      await udemyTipsApi.update(newEntryId, content, currentLabels);
    } else {
      const created = await udemyTipsApi.create(today(), content, currentLabels);
      if (created && created.id) newEntryId = created.id;
    }
    showToast("保存しました");
    setDirty(false);
    await closeTipModal({ save: false });
  } catch (e) {
    showToast(`保存に失敗しました: ${e.message}`, "error");
  }
}

async function deleteEntry(entryId) {
  try {
    await udemyTipsApi.delete(entryId);
    allEntries = allEntries.filter(e => e.id !== entryId);
    await refreshEntries();
  } catch (e) {
    showToast(`削除に失敗しました: ${e.message}`, "error");
  }
}

// ===== モーダル内タグ編集 =====

function renderModalLabels() {
  const chips = currentLabels.map(name => `
    <span class="bd-label-chip" style="${labelChipStyle(name)}" data-label="${escapeHTML(name)}">
      ${escapeHTML(name)}
      <button class="bd-label-chip-remove" type="button" data-label="${escapeHTML(name)}" title="このタグを外す" style="background:transparent;border:none;cursor:pointer;color:inherit;opacity:0.6;margin-left:2px;">×</button>
    </span>
  `).join("");
  return `
    <span class="ut-modal-labels-icon" aria-hidden="true">🏷</span>
    <div class="ut-modal-labels-chips">${chips}</div>
    <button class="ut-modal-add-label" id="ut-modal-add-label" type="button" title="タグを追加">＋ タグ</button>
    <div class="ut-label-picker" id="ut-label-picker" style="display:none;"></div>
  `;
}

function refreshModalLabels() {
  const el = document.getElementById("ut-modal-labels");
  if (!el) return;
  el.innerHTML = renderModalLabels();
  attachLabelsEditorEvents();
}

function attachLabelsEditorEvents() {
  document.querySelectorAll("#ut-modal-labels .bd-label-chip-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.label;
      currentLabels = currentLabels.filter(l => l !== name);
      refreshModalLabels();
      onLabelsChanged();
    });
  });
  const addBtn = document.getElementById("ut-modal-add-label");
  const picker = document.getElementById("ut-label-picker");
  if (addBtn && picker) {
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (picker.style.display === "none") {
        renderLabelPicker();
        picker.style.display = "";
        const input = picker.querySelector(".ut-label-picker-input");
        if (input) { input.value = ""; input.focus(); }
      } else {
        picker.style.display = "none";
      }
    });
  }
  // ピッカー外クリックで閉じる
  if (!document._utPickerCloseInit) {
    document._utPickerCloseInit = true;
    document.addEventListener("click", (e) => {
      const picker = document.getElementById("ut-label-picker");
      const addBtn = document.getElementById("ut-modal-add-label");
      if (!picker || picker.style.display === "none") return;
      if (picker.contains(e.target)) return;
      if (addBtn && addBtn.contains(e.target)) return;
      picker.style.display = "none";
    });
  }
}

function renderLabelPicker() {
  const picker = document.getElementById("ut-label-picker");
  if (!picker) return;
  const available = allLabels.filter(l => !currentLabels.includes(l.name));
  const options = available.map(l => `
    <button class="ut-label-picker-option" type="button" data-name="${escapeHTML(l.name)}" style="${labelChipStyle(l.name)}">
      ${escapeHTML(l.name)} <span class="ut-label-count">${l.count}</span>
    </button>
  `).join("");
  picker.innerHTML = `
    <input type="text" class="ut-label-picker-input" maxlength="50" />
    <div class="ut-label-picker-options">${options}</div>
  `;
  const input = picker.querySelector(".ut-label-picker-input");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = input.value.trim();
        if (val) addLabelToCurrent(val);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        picker.style.display = "none";
      }
    });
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      picker.querySelectorAll(".ut-label-picker-option").forEach(btn => {
        const name = btn.dataset.name.toLowerCase();
        btn.style.display = !q || name.includes(q) ? "" : "none";
      });
    });
  }
  picker.querySelectorAll(".ut-label-picker-option").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      addLabelToCurrent(btn.dataset.name);
    });
  });
}

function addLabelToCurrent(rawName) {
  const name = rawName.trim();
  if (!name || currentLabels.includes(name)) return;
  currentLabels.push(name);
  if (!allLabels.find(l => l.name === name)) {
    allLabels.unshift({ name, count: 1 });
  }
  refreshModalLabels();
  onLabelsChanged();
  const picker = document.getElementById("ut-label-picker");
  if (picker) picker.style.display = "none";
}

async function onLabelsChanged() {
  const targetId = editingEntryId || newEntryId;
  if (!targetId) return;
  try {
    await udemyTipsApi.update(targetId, null, currentLabels);
    const idx = allEntries.findIndex(e => e.id === targetId);
    if (idx >= 0) allEntries[idx].labels = [...currentLabels];
  } catch {}
}

// ===== 削除確認モーダル =====

function showDeleteConfirmModal({ title, labels, onConfirm }) {
  document.getElementById("ut-delete-confirm")?.remove();
  const labelsHTML = labels && labels.length
    ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin:8px 0;">${labels.map(l =>
        `<span class="bd-label-chip" style="${labelChipStyle(l)}">${escapeHTML(l)}</span>`
      ).join("")}</div>`
    : "";
  const modal = document.createElement("div");
  modal.id = "ut-delete-confirm";
  modal.className = "ut-modal-overlay";
  modal.style.zIndex = "1100";
  modal.innerHTML = `
    <div class="ut-modal" style="max-width:420px;">
      <div class="ut-modal-header">
        <span class="ut-modal-title">本当に削除しますか？</span>
        <button class="ut-modal-close" type="button" aria-label="閉じる">×</button>
      </div>
      <div class="ut-modal-body" style="min-height:auto;">
        <div style="font-weight:600;">${escapeHTML(title || "(無題)")}</div>
        ${labelsHTML}
      </div>
      <div class="ut-modal-footer">
        <div class="ut-modal-footer-spacer"></div>
        <button class="btn btn-outline btn-sm" id="ut-delete-cancel">キャンセル</button>
        <button class="btn btn-danger btn-sm" id="ut-delete-ok">削除する</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector(".ut-modal-close")?.addEventListener("click", close);
  modal.querySelector("#ut-delete-cancel")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onEsc); }
  });
  modal.querySelector("#ut-delete-ok")?.addEventListener("click", async () => {
    close();
    await onConfirm();
  });
  setTimeout(() => modal.querySelector("#ut-delete-cancel")?.focus(), 30);
}

function attachLongPressToButton(btn, onTrigger) {
  if (!btn || btn.dataset.lpInit === "1") return;
  btn.dataset.lpInit = "1";
  let timer = null;
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    btn.classList.remove("bd-longpress-active");
  };
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    cancel();
    btn.classList.add("bd-longpress-active");
    timer = setTimeout(() => {
      cancel();
      suppressNextClick = true;
      if (navigator.vibrate) { try { navigator.vibrate(20); } catch {} }
      onTrigger();
    }, LONG_PRESS_MS);
  });
  btn.addEventListener("pointerup", cancel);
  btn.addEventListener("pointerleave", cancel);
  btn.addEventListener("pointercancel", cancel);
}

// ===== タグ管理モーダル =====

async function openLabelsManager() {
  try {
    const res = await udemyTipsApi.listLabels();
    allLabels = (res && res.labels) || [];
  } catch {}
  document.getElementById("ut-labels-manager")?.remove();

  const rows = allLabels.length === 0
    ? ""
    : allLabels.map(l => `
        <div class="ut-labels-manager-row">
          <span class="bd-label-chip" style="${labelChipStyle(l.name)}">${escapeHTML(l.name)}</span>
          <span class="ut-labels-manager-count">${l.count} 件</span>
          <button class="btn btn-outline btn-sm ut-label-rename-btn" data-name="${escapeHTML(l.name)}">リネーム</button>
          <button class="btn btn-danger btn-sm ut-label-delete-btn" data-name="${escapeHTML(l.name)}">削除</button>
        </div>
      `).join("");

  const modal = document.createElement("div");
  modal.id = "ut-labels-manager";
  modal.className = "ut-modal-overlay";
  modal.style.zIndex = "1050";
  modal.innerHTML = `
    <div class="ut-modal" style="max-width:560px;">
      <div class="ut-modal-header">
        <span class="ut-modal-title">タグ管理</span>
        <button class="ut-modal-close" type="button" aria-label="閉じる">×</button>
      </div>
      <div class="ut-modal-body" style="min-height:auto;">
        ${rows}
      </div>
      <div class="ut-modal-footer">
        <div class="ut-modal-footer-spacer"></div>
        <button class="btn btn-outline btn-sm" id="ut-labels-manager-close">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector(".ut-modal-close")?.addEventListener("click", close);
  modal.querySelector("#ut-labels-manager-close")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelectorAll(".ut-label-rename-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const oldName = btn.dataset.name;
      const newName = prompt(`「${oldName}」を何にリネームしますか？`, oldName);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      try {
        const result = await udemyTipsApi.renameLabel(oldName, trimmed);
        showToast(`「${oldName}」→「${trimmed}」に変更（${result.affected}件）`);
        if (currentLabels.includes(oldName)) {
          currentLabels = currentLabels.map(l => l === oldName ? trimmed : l);
          refreshModalLabels();
        }
        if (filterLabels.includes(oldName)) {
          filterLabels = filterLabels.map(l => l === oldName ? trimmed : l);
        }
        await refreshEntries();
        close();
        openLabelsManager();
      } catch (err) {
        showToast(`リネーム失敗: ${err.message}`, "error");
      }
    });
  });
  modal.querySelectorAll(".ut-label-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.name;
      const target = allLabels.find(l => l.name === name);
      const count = target ? target.count : 0;
      if (!confirm(`「${name}」を削除しますか？\n使用中の Tip ${count} 件からもこのタグが外れます。`)) return;
      try {
        const result = await udemyTipsApi.deleteLabel(name);
        showToast(`「${name}」を削除（${result.affected}件から除去）`);
        currentLabels = currentLabels.filter(l => l !== name);
        refreshModalLabels();
        filterLabels = filterLabels.filter(l => l !== name);
        await refreshEntries();
        close();
        openLabelsManager();
      } catch (err) {
        showToast(`削除失敗: ${err.message}`, "error");
      }
    });
  });
}

// ===== Tab キー処理 =====

function handleTabInsert(e) {
  if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  const ta = e.target;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + "\t" + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + 1;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
