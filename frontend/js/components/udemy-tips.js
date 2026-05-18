/**
 * Udemy コース制作 Tips コンポーネント
 * ブレインダンプと同形式のメモ帳。Udemy コース制作で見つけた小技を記録。
 * タグ複数付与可、タグ OR 検索、専用管理モーダル、自動保存、長押し削除確認。
 */

import { udemyTipsApi } from "../api.js?v=20260518c";
import { showToast } from "../app.js?v=20260518c";

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

function insertDateTimeHeader() {
  const ta = document.getElementById("ut-new-textarea");
  if (!ta) return;
  ta.value = `${formatDateTimeHeader()}\n\n`;
  const pos = ta.value.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
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

// ===== 状態管理 =====

let currentDate = today();
let allEntries = [];      // 全期間の Tips
let editingEntryId = null;
let newAutoSaveTimer = null;
let newEntryId = null;
let currentLabels = [];
let isDirty = false;
let allLabels = [];
let filterLabels = [];
const scrollPositions = new Map();

// ソートモード: 'tag'=タグ別グループ / 'date'=新しい順（日付グループ） / 'name'=タイトル五十音順
const SORT_MODE_KEY = "udemy-tips-sort-mode";
const VALID_SORT_MODES = new Set(["tag", "date", "name"]);
let sortMode = (() => {
  try {
    const saved = localStorage.getItem(SORT_MODE_KEY);
    return VALID_SORT_MODES.has(saved) ? saved : "tag";
  } catch {
    return "tag";
  }
})();

function setSortMode(mode) {
  if (!VALID_SORT_MODES.has(mode)) return;
  sortMode = mode;
  try { localStorage.setItem(SORT_MODE_KEY, mode); } catch {}
}

function saveCurrentScroll() {
  const textarea = document.getElementById("ut-new-textarea");
  if (!textarea) return;
  const key = editingEntryId || newEntryId;
  if (key) scrollPositions.set(key, textarea.scrollTop);
}

function setDirty(dirty) {
  isDirty = dirty;
  const btn = document.getElementById("ut-save-header-btn");
  if (btn) btn.style.display = dirty ? "" : "none";
}

// ===== コンパクトリスト/ソートタブ スタイル注入 =====

function injectCompactStyles() {
  if (document.getElementById("ut-compact-styles")) return;
  const style = document.createElement("style");
  style.id = "ut-compact-styles";
  style.textContent = `
    .ut-sort-tabs {
      display: flex;
      gap: 4px;
      padding: 6px 0 8px 0;
      flex-wrap: wrap;
    }
    .ut-sort-tab {
      padding: 4px 10px;
      font-size: 0.78rem;
      border: 1px solid var(--border, #d1d5db);
      border-radius: 999px;
      background: transparent;
      color: var(--text, inherit);
      cursor: pointer;
      transition: background 0.1s, border-color 0.1s;
    }
    .ut-sort-tab:hover {
      background: var(--hover-bg, rgba(0,0,0,0.04));
    }
    [data-theme="dark"] .ut-sort-tab:hover {
      background: rgba(255,255,255,0.06);
    }
    .ut-sort-tab.active {
      background: var(--accent, #2563eb);
      color: #fff;
      border-color: var(--accent, #2563eb);
    }
    .ut-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 4px 4px;
      font-size: 0.8rem;
      font-weight: 600;
      opacity: 0.85;
      border-bottom: 1px dashed var(--border, #e5e7eb);
      margin-bottom: 4px;
    }
    .ut-group-header-count {
      font-size: 0.72rem;
      opacity: 0.6;
      font-weight: 400;
    }
    .ut-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border: 1px solid transparent;
      border-radius: 6px;
      margin-bottom: 2px;
      cursor: pointer;
      font-size: 0.85rem;
      line-height: 1.4;
      transition: background 0.08s, border-color 0.08s;
    }
    .ut-row:hover {
      background: var(--hover-bg, rgba(0,0,0,0.04));
    }
    [data-theme="dark"] .ut-row:hover {
      background: rgba(255,255,255,0.05);
    }
    .ut-row.active {
      background: var(--accent-bg, rgba(37,99,235,0.10));
      border-color: var(--accent, #2563eb);
    }
    .ut-row-tags {
      display: flex;
      gap: 3px;
      flex-shrink: 0;
      max-width: 40%;
      overflow: hidden;
    }
    .ut-row-title {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .ut-row-meta {
      font-size: 0.72rem;
      opacity: 0.55;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .ut-row-actions {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
    }
    .ut-row-actions button {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 2px 5px;
      font-size: 0.7rem;
      opacity: 0.45;
      color: inherit;
      border-radius: 3px;
      transition: opacity 0.1s, background 0.1s;
    }
    .ut-row-actions button:hover:not(:disabled) {
      opacity: 1;
      background: rgba(0,0,0,0.08);
    }
    [data-theme="dark"] .ut-row-actions button:hover:not(:disabled) {
      background: rgba(255,255,255,0.10);
    }
    .ut-row-actions button:disabled {
      opacity: 0.15;
      cursor: default;
    }
    .ut-row-actions .braindump-entry-delete.bd-longpress-active {
      background: rgba(239,68,68,0.25) !important;
      opacity: 1 !important;
    }
    .ut-row .bd-label-chip {
      font-size: 0.68rem;
      padding: 1px 6px;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

// ===== メインレンダー =====

export async function renderUdemyTips() {
  currentDate = today();
  newEntryId = null;
  currentLabels = [];
  filterLabels = [];
  injectCompactStyles();
  const main = document.querySelector("main");
  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;

  // 全期間の Tips を取得（日付範囲指定なし）
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

  main.innerHTML = `
    <div class="braindump-container">
      <!-- 左カラム: 入力エリア -->
      <div class="braindump-left">
        <div class="braindump-header">
          <h2 class="braindump-title">Udemy 制作 Tips</h2>
          <div class="braindump-header-actions">
            <button class="btn btn-primary btn-sm" id="ut-save-header-btn" style="display: none;">💾 保存</button>
            <button class="btn btn-primary btn-sm" id="ut-new-btn">＋ 新しい Tip</button>
            <button class="btn btn-outline btn-sm" id="ut-manage-labels-btn" title="タグを管理">⚙ タグ管理</button>
          </div>
        </div>
        <div class="braindump-new-form" id="ut-new-form">
          <div class="braindump-labels-editor" id="ut-labels-editor">
            ${renderLabelsEditor()}
          </div>
          <div class="braindump-textarea-wrap">
            <textarea class="braindump-textarea" id="ut-new-textarea" placeholder="コース制作で見つけた小技を書いてください..." rows="36"></textarea>
            <div class="braindump-resize-bar" id="ut-resize-bar" aria-hidden="true" title="ドラッグして縦幅を調整"></div>
          </div>
          <div class="braindump-form-actions">
            <button class="btn btn-danger btn-sm" id="ut-delete-btn" style="display: none;">🗑 削除</button>
            <button class="btn btn-primary btn-sm" id="ut-save-new-btn">保存</button>
            <button class="btn btn-outline btn-sm" id="ut-cancel-new-btn">クリア</button>
          </div>
        </div>
      </div>

      <!-- 右カラム: Tips 一覧 -->
      <div class="braindump-right">
        <div id="ut-sort-tabs-wrap">
          ${renderSortTabs()}
        </div>
        <div class="braindump-filter-bar" id="ut-filter-bar">
          ${renderFilterBar()}
        </div>
        <div class="braindump-entries" id="ut-entries">
          ${renderEntriesList()}
        </div>
      </div>
    </div>
  `;

  attachEvents();
}

// ===== タグ入力エリア =====

function renderLabelsEditor() {
  const chips = currentLabels.map(name => `
    <span class="bd-label-chip" style="${labelChipStyle(name)}" data-label="${escapeHTML(name)}">
      ${escapeHTML(name)}
      <button class="bd-label-chip-remove" type="button" data-label="${escapeHTML(name)}" title="このタグを外す">×</button>
    </span>
  `).join("");

  return `
    <div class="bd-labels-editor-inner">
      <span class="bd-labels-editor-icon" aria-hidden="true">🏷</span>
      <div class="bd-labels-editor-chips" id="ut-labels-editor-chips">${chips}</div>
      <button class="bd-label-add-btn" id="ut-label-add-btn" type="button" title="タグを追加">＋ タグ</button>
      <div class="bd-label-picker" id="ut-label-picker" style="display:none;"></div>
    </div>
  `;
}

function refreshLabelsEditor() {
  const el = document.getElementById("ut-labels-editor");
  if (!el) return;
  el.innerHTML = renderLabelsEditor();
  attachLabelsEditorEvents();
}

function attachLabelsEditorEvents() {
  document.querySelectorAll("#ut-labels-editor .bd-label-chip-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.label;
      currentLabels = currentLabels.filter(l => l !== name);
      refreshLabelsEditor();
      onLabelsChanged();
    });
  });

  const addBtn = document.getElementById("ut-label-add-btn");
  const picker = document.getElementById("ut-label-picker");
  if (addBtn && picker) {
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (picker.style.display === "none") {
        renderLabelPicker();
        picker.style.display = "";
        const input = picker.querySelector(".bd-label-picker-input");
        if (input) {
          input.value = "";
          input.focus();
        }
      } else {
        picker.style.display = "none";
      }
    });
  }
}

function renderLabelPicker() {
  const picker = document.getElementById("ut-label-picker");
  if (!picker) return;

  const available = allLabels.filter(l => !currentLabels.includes(l.name));

  const options = available.map(l => `
    <button class="bd-label-picker-option" type="button" data-name="${escapeHTML(l.name)}" style="${labelChipStyle(l.name)}">
      ${escapeHTML(l.name)} <span class="bd-label-count">${l.count}</span>
    </button>
  `).join("");

  picker.innerHTML = `
    <input type="text" class="bd-label-picker-input" placeholder="新規タグ名を入力 / 既存から選択" maxlength="50" />
    <div class="bd-label-picker-options">${options || '<div class="bd-label-picker-empty">既存タグなし</div>'}</div>
    <div class="bd-label-picker-hint">Enter で確定 / Esc で閉じる</div>
  `;

  const input = picker.querySelector(".bd-label-picker-input");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = input.value.trim();
        if (val) addLabelToCurrent(val);
      } else if (e.key === "Escape") {
        e.preventDefault();
        picker.style.display = "none";
      }
    });
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      picker.querySelectorAll(".bd-label-picker-option").forEach(btn => {
        const name = btn.dataset.name.toLowerCase();
        btn.style.display = !q || name.includes(q) ? "" : "none";
      });
    });
  }

  picker.querySelectorAll(".bd-label-picker-option").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.name;
      addLabelToCurrent(name);
    });
  });
}

function addLabelToCurrent(rawName) {
  const name = rawName.trim();
  if (!name) return;
  if (currentLabels.includes(name)) return;
  currentLabels.push(name);
  if (!allLabels.find(l => l.name === name)) {
    allLabels.unshift({ name, count: 1 });
  }
  refreshLabelsEditor();
  onLabelsChanged();
  const picker = document.getElementById("ut-label-picker");
  if (picker) picker.style.display = "none";
}

async function onLabelsChanged() {
  if (editingEntryId) {
    try {
      await udemyTipsApi.update(editingEntryId, null, currentLabels);
      const idx = allEntries.findIndex(e => e.id === editingEntryId);
      if (idx >= 0) allEntries[idx].labels = [...currentLabels];
      refreshFilterBar();
      refreshEntries(editingEntryId);
    } catch {}
  } else if (newEntryId) {
    try {
      await udemyTipsApi.update(newEntryId, null, currentLabels);
      const idx = allEntries.findIndex(e => e.id === newEntryId);
      if (idx >= 0) allEntries[idx].labels = [...currentLabels];
      refreshFilterBar();
      refreshEntries(newEntryId);
    } catch {}
  }
}

// ===== フィルタバー =====

function renderFilterBar() {
  if (allLabels.length === 0) {
    return `<div class="bd-filter-empty">タグなし</div>`;
  }
  const chips = allLabels.map(l => {
    const active = filterLabels.includes(l.name);
    return `
      <button class="bd-filter-chip${active ? ' active' : ''}" type="button"
              data-name="${escapeHTML(l.name)}"
              style="${labelChipStyle(l.name)}">
        ${escapeHTML(l.name)} <span class="bd-label-count">${l.count}</span>
      </button>
    `;
  }).join("");
  const clearBtn = filterLabels.length > 0
    ? `<button class="bd-filter-clear" type="button" id="ut-filter-clear-btn">× クリア</button>`
    : "";
  return `
    <div class="bd-filter-bar-inner">
      <span class="bd-filter-label">フィルタ:</span>
      <div class="bd-filter-chips">${chips}</div>
      ${clearBtn}
    </div>
  `;
}

function refreshFilterBar() {
  const el = document.getElementById("ut-filter-bar");
  if (!el) return;
  el.innerHTML = renderFilterBar();
  attachFilterBarEvents();
}

function attachFilterBarEvents() {
  document.querySelectorAll("#ut-filter-bar .bd-filter-chip").forEach(btn => {
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
      refreshEntriesList();
    });
  });
}

// ===== エントリ一覧 =====

function getFilteredEntries() {
  if (filterLabels.length === 0) return allEntries;
  return allEntries.filter(e => {
    const labels = e.labels || [];
    return labels.some(l => filterLabels.includes(l));
  });
}

/** タイトル抽出: 先頭日時ヘッダーを取り除いた 1 行分（最大 60 文字） */
function entryTitle(entry) {
  const body = stripDateHeader(entry.content || "").trim();
  if (!body) return "(無題)";
  return body.slice(0, 60).replace(/\n/g, " ");
}

/** 1 行コンパクト表示。reorderable=true のときのみ ▲▼ ボタンを描画 */
function renderCompactRow(entry, { reorderable = false, upDisabled = false, downDisabled = false } = {}) {
  const time = entry.created_at ? entry.created_at.slice(11, 16) : "";
  const dateShort = entry.date ? entry.date.slice(5) : "";
  const title = entryTitle(entry);
  const labels = entry.labels || [];
  const tagsHTML = labels.length > 0
    ? `<div class="ut-row-tags">${labels.map(l =>
        `<span class="bd-label-chip bd-label-chip-sm" style="${labelChipStyle(l)}">${escapeHTML(l)}</span>`
      ).join("")}</div>`
    : "";

  const reorderHTML = reorderable
    ? `<button class="braindump-entry-reorder" data-id="${entry.id}" data-dir="up" title="上へ移動"${upDisabled ? " disabled" : ""}>▲</button>
       <button class="braindump-entry-reorder" data-id="${entry.id}" data-dir="down" title="下へ移動"${downDisabled ? " disabled" : ""}>▼</button>`
    : "";

  return `
    <div class="ut-row braindump-entry" data-id="${entry.id}" data-date="${entry.date}">
      ${tagsHTML}
      <span class="ut-row-title">${escapeHTML(title)}</span>
      <span class="ut-row-meta">${dateShort} ${time}</span>
      <div class="ut-row-actions">
        ${reorderHTML}
        <button class="braindump-entry-delete" data-id="${entry.id}" title="削除">×</button>
      </div>
    </div>
  `;
}

function renderEmptyState() {
  const msg = filterLabels.length > 0
    ? `選択中のタグに該当する Tips はありません`
    : `まだ Tips がありません。左側に書き込んで保存してください。`;
  return `
    <div class="empty-state" style="padding: 32px 0;">
      <div class="icon">💡</div>
      <p>${msg}</p>
    </div>`;
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
    const dateEntries = grouped[date];
    const d = new Date(date + "T00:00:00");
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    const wd = weekdays[d.getDay()];
    const isToday = date === today();
    const dateHeader = `
      <span class="braindump-date-pill">
        <span class="braindump-date-pill-md">${md}</span>
        <span class="braindump-date-pill-wd">${wd}</span>
      </span>
      ${isToday ? '<span class="braindump-today-badge"><span class="braindump-today-dot"></span>today</span>' : ''}
      <span class="ut-group-header-count">${dateEntries.length} 件</span>
    `;
    const lastIndex = dateEntries.length - 1;
    const rows = dateEntries.map((entry, idx) =>
      renderCompactRow(entry, {
        reorderable: true,
        upDisabled: idx === 0,
        downDisabled: idx === lastIndex,
      })
    ).join("");
    return `
      <div class="braindump-date-group">
        <div class="ut-group-header">${dateHeader}</div>
        ${rows}
      </div>`;
  }).join("");
}

function renderByTag(list) {
  // タグごとに Tip をグループ化（複数タグ持ちは複数グループに登場）
  const grouped = new Map();        // tagName → entries[]
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
  // タグ順: allLabels の並び（使用件数降順）に合わせ、grouped にあるもののみ
  const orderedTags = allLabels
    .map(l => l.name)
    .filter(name => grouped.has(name));
  // allLabels に載ってない（集計が古い場合の保険）
  for (const tag of grouped.keys()) {
    if (!orderedTags.includes(tag)) orderedTags.push(tag);
  }

  const sections = orderedTags.map(tag => {
    const entries = grouped.get(tag) || [];
    // タググループ内は新しい順
    entries.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const rows = entries.map(e => renderCompactRow(e)).join("");
    return `
      <div class="braindump-date-group">
        <div class="ut-group-header">
          <span class="bd-label-chip" style="${labelChipStyle(tag)}">${escapeHTML(tag)}</span>
          <span class="ut-group-header-count">${entries.length} 件</span>
        </div>
        ${rows}
      </div>`;
  });

  if (untagged.length > 0) {
    untagged.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    sections.push(`
      <div class="braindump-date-group">
        <div class="ut-group-header">
          <span>タグなし</span>
          <span class="ut-group-header-count">${untagged.length} 件</span>
        </div>
        ${untagged.map(e => renderCompactRow(e)).join("")}
      </div>
    `);
  }
  return sections.join("");
}

function renderByName(list) {
  const sorted = [...list].sort((a, b) =>
    entryTitle(a).localeCompare(entryTitle(b), "ja")
  );
  return sorted.map(e => renderCompactRow(e)).join("");
}

function renderEntriesList() {
  const list = getFilteredEntries();
  if (list.length === 0) return renderEmptyState();

  if (sortMode === "date") return renderByDate(list);
  if (sortMode === "name") return renderByName(list);
  return renderByTag(list);
}

function refreshEntriesList(activeId) {
  const container = document.getElementById("ut-entries");
  if (container) {
    container.innerHTML = renderEntriesList();
    const targetId = activeId || editingEntryId;
    if (targetId) {
      // タグ別モードでは同じ Tip が複数グループに登場するので、すべてに active を付与
      container.querySelectorAll(`.braindump-entry[data-id="${targetId}"]`).forEach(el => {
        el.classList.add("active");
      });
    }
  }
}

// ===== 削除確認モーダル + 長押し =====

const LONG_PRESS_MS = 500;
let suppressNextClick = false;

function getEntryDisplayInfo(entryId) {
  const entry = allEntries.find(en => en.id === entryId);
  if (!entry) return { title: "(不明な Tip)", labels: [] };
  const bodyContent = stripDateHeader(entry.content).trim();
  const title = bodyContent.slice(0, 40).replace(/\n/g, " ") || "(無題)";
  return { title, labels: entry.labels || [] };
}

function showDeleteConfirmModal({ title, labels, onConfirm }) {
  document.getElementById("ut-delete-confirm-modal")?.remove();

  const labelsHTML = labels && labels.length
    ? `<div class="bd-delete-confirm-labels">${labels.map(l =>
        `<span class="bd-label-chip bd-label-chip-sm" style="${labelChipStyle(l)}">${escapeHTML(l)}</span>`
      ).join("")}</div>`
    : "";

  const modal = document.createElement("div");
  modal.id = "ut-delete-confirm-modal";
  modal.className = "bd-modal-overlay";
  modal.innerHTML = `
    <div class="bd-modal bd-delete-confirm" role="alertdialog" aria-labelledby="ut-delete-confirm-heading">
      <div class="bd-modal-header">
        <h3 id="ut-delete-confirm-heading">本当に削除しますか？</h3>
        <button class="bd-modal-close" type="button" aria-label="閉じる">×</button>
      </div>
      <div class="bd-modal-body">
        <div class="bd-delete-confirm-title">${escapeHTML(title || "(無題)")}</div>
        ${labelsHTML}
        <div class="bd-delete-confirm-warning">この操作は取り消せません。</div>
      </div>
      <div class="bd-modal-footer">
        <button class="btn btn-outline btn-sm" id="ut-delete-confirm-cancel" type="button">キャンセル</button>
        <button class="btn btn-danger btn-sm" id="ut-delete-confirm-ok" type="button">削除する</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector(".bd-modal-close")?.addEventListener("click", close);
  modal.querySelector("#ut-delete-confirm-cancel")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", onEsc);
    }
  });
  modal.querySelector("#ut-delete-confirm-ok")?.addEventListener("click", async () => {
    close();
    await onConfirm();
  });
  setTimeout(() => modal.querySelector("#ut-delete-confirm-cancel")?.focus(), 30);
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

function initEntriesLongPress(container) {
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
    const btn = e.target.closest(".braindump-entry-delete");
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
      const { title, labels } = getEntryDisplayInfo(entryId);
      showDeleteConfirmModal({
        title,
        labels,
        onConfirm: async () => {
          await deleteEntry(entryId);
          if (editingEntryId === entryId) resetToNewMode();
          showToast("削除しました");
        },
      });
    }, LONG_PRESS_MS);
  });
  container.addEventListener("pointerup", cancel);
  container.addEventListener("pointerleave", cancel);
  container.addEventListener("pointercancel", cancel);
}

// ===== イベントハンドリング =====

function attachEvents() {
  document.getElementById("ut-new-btn")?.addEventListener("click", startNewTip);
  document.getElementById("ut-manage-labels-btn")?.addEventListener("click", openLabelsManager);

  setTimeout(() => {
    document.getElementById("ut-new-textarea")?.focus();
  }, 100);

  document.getElementById("ut-save-new-btn")?.addEventListener("click", saveCurrentEntry);
  document.getElementById("ut-save-header-btn")?.addEventListener("click", saveCurrentEntry);

  document.getElementById("ut-new-textarea")?.addEventListener("input", handleTextareaInput);
  document.getElementById("ut-new-textarea")?.addEventListener("keydown", handleTabInsert);

  initResizeBar();
  attachLabelsEditorEvents();
  attachFilterBarEvents();
  attachSortTabEvents();

  // ピッカー外クリックで閉じる
  document.addEventListener("click", (e) => {
    const picker = document.getElementById("ut-label-picker");
    const addBtn = document.getElementById("ut-label-add-btn");
    if (!picker || picker.style.display === "none") return;
    if (picker.contains(e.target)) return;
    if (addBtn && addBtn.contains(e.target)) return;
    picker.style.display = "none";
  });

  // フォーム内の削除ボタン（長押し）
  const formDeleteBtn = document.getElementById("ut-delete-btn");
  if (formDeleteBtn) {
    formDeleteBtn.addEventListener("click", (e) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.preventDefault();
        return;
      }
      showToast("削除するにはボタンを長押ししてください");
    });
    attachLongPressToButton(formDeleteBtn, () => {
      const targetId = editingEntryId || newEntryId;
      if (!targetId) return;
      const { title, labels } = getEntryDisplayInfo(targetId);
      showDeleteConfirmModal({
        title,
        labels,
        onConfirm: async () => {
          await deleteEntry(targetId);
          resetToNewMode();
          showToast("削除しました");
        },
      });
    });
  }

  // クリアボタン
  document.getElementById("ut-cancel-new-btn")?.addEventListener("click", () => {
    if (editingEntryId) {
      resetToNewMode();
    } else {
      saveCurrentScroll();
      newEntryId = null;
      currentLabels = [];
      refreshLabelsEditor();
      document.getElementById("ut-new-textarea").value = "";
      setDirty(false);
      document.getElementById("ut-new-textarea")?.focus();
    }
  });

  const entriesEl = document.getElementById("ut-entries");
  initEntriesLongPress(entriesEl);

  entriesEl?.addEventListener("click", async (e) => {
    const reorderBtn = e.target.closest(".braindump-entry-reorder");
    if (reorderBtn) {
      e.stopPropagation();
      if (reorderBtn.disabled) return;
      await handleReorderClick(reorderBtn.dataset.id, reorderBtn.dataset.dir);
      return;
    }

    const deleteBtn = e.target.closest(".braindump-entry-delete");
    if (deleteBtn) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      showToast("削除するにはボタンを長押ししてください");
      return;
    }
  });

  // エントリクリック → 左側に読み込み
  document.getElementById("ut-entries")?.addEventListener("click", (e) => {
    const entryEl = e.target.closest(".braindump-entry");
    if (!entryEl) return;

    const entryId = entryEl.dataset.id;
    if (!entryId) return;

    const entry = allEntries.find(en => en.id === entryId);
    if (!entry) return;

    const textarea = document.getElementById("ut-new-textarea");
    if (!textarea) return;

    saveCurrentScroll();

    textarea.value = entry.content;
    currentLabels = [...(entry.labels || [])];
    editingEntryId = entryId;
    newEntryId = null;
    setDirty(false);
    refreshLabelsEditor();

    document.querySelectorAll(".braindump-entry").forEach(el => el.classList.remove("active"));
    entryEl.classList.add("active");

    updateHeaderForEditing(entry);

    textarea.scrollTop = scrollPositions.get(entryId) || 0;

    if (newAutoSaveTimer) clearTimeout(newAutoSaveTimer);
    textarea.removeEventListener("input", handleTextareaInput);
    textarea.addEventListener("input", handleTextareaInput);
  });
}

// ===== ヘッダーモード切替 =====

function updateHeaderForEditing(entry) {
  const bodyContent = stripDateHeader(entry.content).trim();
  const title = bodyContent.slice(0, 40).replace(/\n/g, " ") || "(無題)";
  const header = document.querySelector(".braindump-header");
  if (!header) return;
  header.innerHTML = `
    <h2 class="braindump-title" style="font-size: 1rem;">編集中: ${escapeHTML(title)}</h2>
    <div class="braindump-header-actions">
      <button class="btn btn-primary btn-sm" id="ut-save-header-btn" style="display: ${isDirty ? "" : "none"};">💾 保存</button>
      <button class="btn btn-outline btn-sm" id="ut-back-to-new-btn">＋ 新しい Tip</button>
      <button class="btn btn-outline btn-sm" id="ut-manage-labels-btn" title="タグを管理">⚙ タグ管理</button>
    </div>
  `;
  document.getElementById("ut-back-to-new-btn")?.addEventListener("click", () => {
    resetToNewMode();
    insertDateTimeHeader();
  });
  document.getElementById("ut-save-header-btn")?.addEventListener("click", saveCurrentEntry);
  document.getElementById("ut-manage-labels-btn")?.addEventListener("click", openLabelsManager);

  const deleteBtn = document.getElementById("ut-delete-btn");
  if (deleteBtn) deleteBtn.style.display = "";
}

async function startNewTip() {
  if (newAutoSaveTimer) {
    clearTimeout(newAutoSaveTimer);
    newAutoSaveTimer = null;
  }
  const textarea = document.getElementById("ut-new-textarea");
  const text = textarea ? textarea.value : "";
  const hasText = text.trim().length > 0 && !isHeaderOnly(text);
  if (hasText) {
    if (editingEntryId) {
      await autoSaveExistingEntry(editingEntryId);
    } else {
      await autoSaveNewEntry();
    }
  }
  resetToNewMode();
  insertDateTimeHeader();
}

function resetToNewMode() {
  saveCurrentScroll();
  editingEntryId = null;
  newEntryId = null;
  const textarea = document.getElementById("ut-new-textarea");
  if (textarea) textarea.value = "";
  currentLabels = [];
  refreshLabelsEditor();

  const header = document.querySelector(".braindump-header");
  if (header) {
    header.innerHTML = `
      <h2 class="braindump-title">Udemy 制作 Tips</h2>
      <div class="braindump-header-actions">
        <button class="btn btn-primary btn-sm" id="ut-save-header-btn" style="display: none;">💾 保存</button>
        <button class="btn btn-primary btn-sm" id="ut-new-btn">＋ 新しい Tip</button>
        <button class="btn btn-outline btn-sm" id="ut-manage-labels-btn" title="タグを管理">⚙ タグ管理</button>
      </div>
    `;
    document.getElementById("ut-new-btn")?.addEventListener("click", startNewTip);
    document.getElementById("ut-save-header-btn")?.addEventListener("click", saveCurrentEntry);
    document.getElementById("ut-manage-labels-btn")?.addEventListener("click", openLabelsManager);
  }

  const deleteBtn = document.getElementById("ut-delete-btn");
  if (deleteBtn) deleteBtn.style.display = "none";

  document.querySelectorAll(".braindump-entry").forEach(el => el.classList.remove("active"));

  setDirty(false);
  textarea?.focus();
}

function handleTextareaInput() {
  setDirty(true);
  if (newAutoSaveTimer) clearTimeout(newAutoSaveTimer);
  newAutoSaveTimer = setTimeout(() => {
    if (editingEntryId) {
      autoSaveExistingEntry(editingEntryId);
    } else {
      autoSaveNewEntry();
    }
  }, 2000);
}

async function autoSaveExistingEntry(entryId) {
  const textarea = document.getElementById("ut-new-textarea");
  if (!textarea) return;
  const content = textarea.value.trim();
  if (!content) return;

  try {
    const updated = await udemyTipsApi.update(entryId, content, currentLabels);
    const idx = allEntries.findIndex(e => e.id === entryId);
    if (idx >= 0 && updated) {
      allEntries[idx] = updated;
    }
    refreshEntriesList(entryId);
    setDirty(false);
  } catch {}
}

// ===== CRUD =====

async function saveCurrentEntry() {
  const textarea = document.getElementById("ut-new-textarea");
  const content = textarea.value.trim();
  if (!content) {
    setDirty(false);
    return;
  }

  try {
    if (editingEntryId) {
      await udemyTipsApi.update(editingEntryId, content, currentLabels);
    } else if (newEntryId) {
      await udemyTipsApi.update(newEntryId, content, currentLabels);
    } else {
      const created = await udemyTipsApi.create(currentDate, content, currentLabels);
      if (created && created.id) {
        newEntryId = created.id;
      }
    }
    showToast("保存しました");
    await refreshEntries();
    if (editingEntryId) {
      const activeEl = document.querySelector(`.braindump-entry[data-id="${editingEntryId}"]`);
      if (activeEl) activeEl.classList.add("active");
    }
    setDirty(false);
  } catch (e) {
    showToast(`保存に失敗しました: ${e.message}`, "error");
  }
}

async function autoSaveNewEntry() {
  const textarea = document.getElementById("ut-new-textarea");
  if (!textarea) return;

  const text = textarea.value;
  if (text.trim() === "" || isHeaderOnly(text)) {
    setDirty(false);
    return;
  }

  const content = text.trim();
  if (!content) {
    setDirty(false);
    return;
  }

  try {
    if (newEntryId) {
      await udemyTipsApi.update(newEntryId, content, currentLabels);
    } else {
      const created = await udemyTipsApi.create(currentDate, content, currentLabels);
      if (created && created.id) {
        newEntryId = created.id;
      }
    }
    await refreshEntries();
    setDirty(false);
  } catch {}
}

async function deleteEntry(entryId) {
  try {
    await udemyTipsApi.delete(entryId);
    editingEntryId = null;
    allEntries = allEntries.filter(e => e.id !== entryId);
    await refreshEntries();
  } catch (e) {
    showToast(`削除に失敗しました: ${e.message}`, "error");
  }
}

async function handleReorderClick(entryId, direction) {
  if (!entryId || (direction !== "up" && direction !== "down")) return;
  const target = allEntries.find(e => e.id === entryId);
  if (!target) return;

  const sortKey = (e) => {
    const so = e.sort_order;
    return so == null ? (e.entry_number || 1) : so;
  };
  const sameDate = allEntries
    .filter(e => e.date === target.date)
    .sort((a, b) => sortKey(a) - sortKey(b) || (a.entry_number || 0) - (b.entry_number || 0));

  const idx = sameDate.findIndex(e => e.id === entryId);
  if (idx === -1) return;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sameDate.length) return;

  [sameDate[idx], sameDate[swapIdx]] = [sameDate[swapIdx], sameDate[idx]];

  sameDate.forEach((e, i) => {
    e.sort_order = i + 1;
  });
  refreshEntriesList();

  try {
    await udemyTipsApi.reorder(target.date, sameDate.map(e => e.id));
  } catch (err) {
    showToast(`並び替えに失敗しました: ${err.message}`, "error");
    await refreshEntries();
  }
}

async function refreshEntries(activeId) {
  try {
    allEntries = await udemyTipsApi.list() || [];
  } catch {}
  try {
    const res = await udemyTipsApi.listLabels();
    allLabels = (res && res.labels) || [];
  } catch {}
  refreshFilterBar();
  refreshEntriesList(activeId);
}

// ===== タグ管理モーダル =====

async function openLabelsManager() {
  try {
    const res = await udemyTipsApi.listLabels();
    allLabels = (res && res.labels) || [];
  } catch {}

  document.getElementById("ut-labels-modal")?.remove();

  const rows = allLabels.length === 0
    ? `<div class="bd-labels-modal-empty">まだタグがありません。Tip の「＋ タグ」から追加してください。</div>`
    : allLabels.map(l => `
        <div class="bd-labels-modal-row" data-name="${escapeHTML(l.name)}">
          <span class="bd-label-chip" style="${labelChipStyle(l.name)}">${escapeHTML(l.name)}</span>
          <span class="bd-labels-modal-count">${l.count}件</span>
          <div class="bd-labels-modal-actions">
            <button class="btn btn-outline btn-sm ut-label-rename-btn" data-name="${escapeHTML(l.name)}">リネーム</button>
            <button class="btn btn-danger btn-sm ut-label-delete-btn" data-name="${escapeHTML(l.name)}">削除</button>
          </div>
        </div>
      `).join("");

  const modal = document.createElement("div");
  modal.id = "ut-labels-modal";
  modal.className = "bd-modal-overlay";
  modal.innerHTML = `
    <div class="bd-modal">
      <div class="bd-modal-header">
        <h3>タグ管理</h3>
        <button class="bd-modal-close" type="button" title="閉じる">×</button>
      </div>
      <div class="bd-modal-body">
        ${rows}
      </div>
      <div class="bd-modal-footer">
        <button class="btn btn-outline btn-sm" id="ut-labels-modal-close-btn">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector(".bd-modal-close")?.addEventListener("click", close);
  modal.querySelector("#ut-labels-modal-close-btn")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

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
          refreshLabelsEditor();
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
        refreshLabelsEditor();
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

// ===== 縦幅調整バー =====

function initResizeBar() {
  const bar = document.getElementById("ut-resize-bar");
  const ta = document.getElementById("ut-new-textarea");
  if (!bar || !ta) return;

  let startY = 0;
  let startHeight = 0;
  let dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    const delta = e.clientY - startY;
    const next = Math.max(160, startHeight + delta);
    ta.style.height = next + "px";
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  bar.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    startHeight = ta.getBoundingClientRect().height;
    bar.classList.add("dragging");
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
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
