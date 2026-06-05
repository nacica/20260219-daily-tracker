/**
 * ブレインダンプ コンポーネント
 * プレーンテキストのメモ帳。1日に複数メモ作成可能。
 * 自動保存、AIタイトル自動生成、画像貼り付け対応。
 * ラベル機能: メモごとに複数ラベル付与可、ラベルOR検索、専用管理モーダル。
 */

import { braindumpApi } from "../api.js?v=20260605a";
import { showToast } from "../app.js?v=20260605a";
import {
  attachFloatingToolbar,
  appendMarkdownToEditor,
  serializeEditorMarkdown,
  SIZE_SPAN_STRIP,
} from "../floating-toolbar.js?v=20260605a";

// ===== ユーティリティ =====

function today() {
  return new Date().toLocaleDateString("sv-SE");
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
}

// 「＋ 新しいメモ」押下時に textarea 1行目へ自動挿入する日時ヘッダー
const DATE_HEADER_REGEX = /^\s*\d{4}年\d{1,2}月\d{1,2}日\([日月火水木金土]\) \d{1,2}時\d{2}分\s*$/;

function formatDateTimeHeader() {
  const d = new Date();
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${wd}) ${d.getHours()}時${mi}分`;
}

function insertDateTimeHeader() {
  const ed = document.getElementById("bd-new-textarea");
  if (!ed) return;
  setEditorContent(ed, `${formatDateTimeHeader()}\n\n`);
  // カーソルを末尾へ
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  ed.focus();
  updateEditorEmptyState(ed);
}

function isHeaderOnly(text) {
  return DATE_HEADER_REGEX.test((text || "").trim());
}

// 一覧カードのタイトル/プレビュー算出用に、先頭の日時ヘッダー行（と続く空行）を取り除く
function stripDateHeader(text) {
  const lines = text.split("\n");
  if (lines.length === 0 || !DATE_HEADER_REGEX.test(lines[0])) return text;
  let i = 1;
  while (i < lines.length && lines[i].trim() === "") i++;
  return lines.slice(i).join("\n");
}

/** タグ名から決定的に HSL 色を生成（薄め背景・濃いめ文字） */
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
  // ライト/ダーク両対応は CSS 変数経由ではなく inline で。--label-bg/--label-fg を data-theme で切替
  return `--bd-chip-bg:${c.bg}; --bd-chip-fg:${c.fg}; --bd-chip-bg-dark:${c.bgDark}; --bd-chip-fg-dark:${c.fgDark};`;
}

// ===== 状態管理 =====

let currentDate = today();
let entries = [];
let recentEntries = []; // 過去15日分のメモ
let editingEntryId = null;
let newAutoSaveTimer = null;
let newEntryId = null; // 新規メモが自動保存された後のエントリID
let currentLabels = []; // 編集中メモ / 新規メモのラベル配列
let allLabels = []; // 全メモから集計したラベル一覧 [{name, count}]
let filterLabels = []; // 一覧フィルタで選択中のラベル名（OR検索）
// ノートID別の textarea スクロール位置を記憶（同ノートに戻ったとき前回位置を復元）
const scrollPositions = new Map();

function saveCurrentScroll() {
  const ed = document.getElementById("bd-new-textarea");
  if (!ed) return;
  const key = editingEntryId || newEntryId;
  if (key) scrollPositions.set(key, ed.scrollTop);
}

// ===== 画像マークダウン関連 =====

// タイトル/プレビュー算出用：画像マークダウンを空白に置換するための正規表現
const IMG_REGEX = /\n?!\[[^\]]*\]\([^)]+\)\n?/g;
const IMG_MATCH = /!\[([^\]]*)\]\(([^)]+)\)/g;

// ===== contenteditable エディタ ↔ markdown 相互変換 =====

/** markdown 文字列を contenteditable エディタに流し込む（テキスト + <br> + <img> + bold + size） */
function setEditorContent(editor, markdown) {
  appendMarkdownToEditor(editor, markdown, {
    imgPattern: IMG_MATCH,
    imgFactory: (m) => createInlineImg(m[2], m[1] || "画像"),
  });
}

/** インライン画像 <img> 要素を生成する */
function createInlineImg(src, alt = "画像") {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.className = "bd-inline-img";
  img.setAttribute("loading", "lazy");
  return img;
}

/** contenteditable エディタの内容を markdown 文字列に直す */
function getEditorMarkdown(editor) {
  return serializeEditorMarkdown(editor, {
    serializeImg: (img) => {
      const src = img.getAttribute("src") || "";
      const alt = img.getAttribute("alt") || "画像";
      // アップロード中の一時画像（blob:URL）は markdown には書かない
      if (src.startsWith("blob:") || img.classList.contains("bd-inline-img-uploading")) return null;
      return `![${alt}](${src})`;
    },
  });
}

/** エディタが空かどうか（プレースホルダー表示用に CSS クラスをトグル） */
function updateEditorEmptyState(editor) {
  if (!editor) return;
  const hasImg = !!editor.querySelector("img");
  const hasText = editor.textContent && editor.textContent.replace(/​/g, "").trim() !== "";
  editor.classList.toggle("is-empty", !hasImg && !hasText);
}

/** 選択位置にノードを挿入し、カーソルをノードの直後に置く */
function insertNodeAtCursor(node) {
  const editor = document.getElementById("bd-new-textarea");
  if (!editor) return;
  const sel = window.getSelection();
  let range;
  if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else {
    // フォーカス外なら末尾へ追加
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/** 選択位置にプレーンテキストを挿入する（\n は <br> に展開） */
function insertPlainTextAtCursor(text) {
  if (!text) return;
  const editor = document.getElementById("bd-new-textarea");
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();

  const frag = document.createDocumentFragment();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) frag.appendChild(document.createElement("br"));
    if (lines[i]) frag.appendChild(document.createTextNode(lines[i]));
  }
  const lastChild = frag.lastChild;
  range.insertNode(frag);
  if (lastChild) {
    range.setStartAfter(lastChild);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

// ===== メインレンダー =====

export async function renderBraindump() {
  currentDate = today();
  newEntryId = null; // ページ遷移時にリセット
  currentLabels = [];
  filterLabels = [];
  const main = document.querySelector("main");
  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;

  try {
    entries = await braindumpApi.listByDate(currentDate) || [];
  } catch {
    entries = [];
  }

  // 過去15日分のメモを取得
  try {
    recentEntries = await braindumpApi.list(daysAgo(14), today()) || [];
  } catch {
    recentEntries = [];
  }

  // ラベル一覧（全メモから集計）
  try {
    const res = await braindumpApi.listLabels();
    allLabels = (res && res.labels) || [];
  } catch {
    allLabels = [];
  }

  main.innerHTML = `
    <div class="braindump-container">
      <!-- 左カラム: 入力エリア (7) -->
      <div class="braindump-left">
        <div class="braindump-header">
          <h2 class="braindump-title">ブレインダンプ</h2>
          <div class="braindump-header-actions">
            <button class="btn btn-primary btn-sm" id="bd-new-btn">＋ 新しいメモ</button>
            <button class="btn btn-outline btn-sm" id="bd-manage-labels-btn" title="ラベルを管理">⚙ タグ管理</button>
          </div>
        </div>
        <div class="braindump-new-form" id="bd-new-form">
          <div class="braindump-labels-editor" id="bd-labels-editor">
            ${renderLabelsEditor()}
          </div>
          <div class="braindump-textarea-wrap">
            <div class="braindump-textarea is-empty" id="bd-new-textarea" contenteditable="true" spellcheck="false" data-placeholder="思いついたことを自由に書き出してください..."></div>
            <div class="braindump-resize-bar" id="bd-resize-bar" aria-hidden="true" title="ドラッグして縦幅を調整"></div>
          </div>
          <div class="braindump-form-actions">
            <button class="btn btn-danger btn-sm" id="bd-delete-btn" style="display: none;">🗑 削除</button>
          </div>
        </div>
      </div>

      <!-- 右カラム: メモ一覧 (3) -->
      <div class="braindump-right">
        <div class="braindump-filter-bar" id="bd-filter-bar">
          ${renderFilterBar()}
        </div>
        <div class="braindump-entries" id="bd-entries">
          ${renderRecentEntries()}
        </div>
      </div>
    </div>
  `;

  attachEvents();
}

// ===== ラベル入力エリア（テキストエリア上部） =====

function renderLabelsEditor() {
  const chips = currentLabels.map(name => `
    <span class="bd-label-chip" style="${labelChipStyle(name)}" data-label="${escapeHTML(name)}">
      ${escapeHTML(name)}
      <button class="bd-label-chip-remove" type="button" data-label="${escapeHTML(name)}" title="このラベルを外す">×</button>
    </span>
  `).join("");

  return `
    <div class="bd-labels-editor-inner">
      <span class="bd-labels-editor-icon" aria-hidden="true">🏷</span>
      <div class="bd-labels-editor-chips" id="bd-labels-editor-chips">${chips}</div>
      <button class="bd-label-add-btn" id="bd-label-add-btn" type="button" title="ラベルを追加">＋ ラベル</button>
      <div class="bd-label-picker" id="bd-label-picker" style="display:none;"></div>
    </div>
  `;
}

function refreshLabelsEditor() {
  const el = document.getElementById("bd-labels-editor");
  if (!el) return;
  el.innerHTML = renderLabelsEditor();
  attachLabelsEditorEvents();
}

function attachLabelsEditorEvents() {
  // チップ削除
  document.querySelectorAll(".bd-label-chip-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.label;
      currentLabels = currentLabels.filter(l => l !== name);
      refreshLabelsEditor();
      onLabelsChanged();
    });
  });

  // ラベル追加ボタン → ピッカー表示
  const addBtn = document.getElementById("bd-label-add-btn");
  const picker = document.getElementById("bd-label-picker");
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
  const picker = document.getElementById("bd-label-picker");
  if (!picker) return;

  // 既存ラベル: currentLabels に既にあるものは除外
  const available = allLabels.filter(l => !currentLabels.includes(l.name));

  const options = available.map(l => `
    <button class="bd-label-picker-option" type="button" data-name="${escapeHTML(l.name)}" style="${labelChipStyle(l.name)}">
      ${escapeHTML(l.name)} <span class="bd-label-count">${l.count}</span>
    </button>
  `).join("");

  picker.innerHTML = `
    <input type="text" class="bd-label-picker-input" placeholder="新規ラベル名を入力 / 既存から選択" maxlength="50" />
    <div class="bd-label-picker-options">${options || '<div class="bd-label-picker-empty">既存ラベルなし</div>'}</div>
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
    // 入力に応じて候補をフィルタ
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
  // allLabels にもまだなければ追加（count=1 で先頭表示）
  if (!allLabels.find(l => l.name === name)) {
    allLabels.unshift({ name, count: 1 });
  }
  refreshLabelsEditor();
  onLabelsChanged();
  // ピッカーを閉じる
  const picker = document.getElementById("bd-label-picker");
  if (picker) picker.style.display = "none";
}

/** ラベル変更直後にサーバへ反映（既存メモ編集中なら即保存、新規なら autoSave 経由で保存） */
async function onLabelsChanged() {
  if (editingEntryId) {
    try {
      await braindumpApi.update(editingEntryId, null, currentLabels);
      const idx = recentEntries.findIndex(e => e.id === editingEntryId);
      if (idx >= 0) recentEntries[idx].labels = [...currentLabels];
      refreshFilterBar();
      refreshEntriesList(editingEntryId);
    } catch {
      // 失敗時は静かに無視
    }
  } else if (newEntryId) {
    try {
      await braindumpApi.update(newEntryId, null, currentLabels);
      const idx = recentEntries.findIndex(e => e.id === newEntryId);
      if (idx >= 0) recentEntries[idx].labels = [...currentLabels];
      refreshFilterBar();
      refreshEntriesList(newEntryId);
    } catch {}
  }
  // 新規メモ（未保存）の場合は currentLabels だけ保持し、保存時に一緒に送る
}

// ===== フィルタバー（右カラム上部） =====

function renderFilterBar() {
  if (allLabels.length === 0) {
    return `<div class="bd-filter-empty">ラベルなし</div>`;
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
    ? `<button class="bd-filter-clear" type="button" id="bd-filter-clear-btn">× クリア</button>`
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
  const el = document.getElementById("bd-filter-bar");
  if (!el) return;
  el.innerHTML = renderFilterBar();
  attachFilterBarEvents();
}

function attachFilterBarEvents() {
  document.querySelectorAll(".bd-filter-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.name;
      if (filterLabels.includes(name)) {
        filterLabels = filterLabels.filter(n => n !== name);
      } else {
        filterLabels.push(name);
      }
      refreshFilterBar();
      refreshEntriesList();
    });
  });
  document.getElementById("bd-filter-clear-btn")?.addEventListener("click", () => {
    filterLabels = [];
    refreshFilterBar();
    refreshEntriesList();
  });
}

// ===== エントリ一覧レンダリング =====

function getFilteredEntries() {
  if (filterLabels.length === 0) return recentEntries;
  // OR: いずれかを含む
  return recentEntries.filter(e => {
    const labels = e.labels || [];
    return labels.some(l => filterLabels.includes(l));
  });
}

function renderRecentEntries() {
  const list = getFilteredEntries();
  if (list.length === 0) {
    const msg = filterLabels.length > 0
      ? `選択中のラベルに該当するメモはありません`
      : `過去15日間のメモはありません`;
    return `
      <div class="empty-state" style="padding: 32px 0;">
        <div class="icon">📝</div>
        <p>${msg}</p>
      </div>`;
  }

  // 日付ごとにグループ化（新しい日付順）
  const grouped = {};
  for (const entry of list) {
    const date = entry.date;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(entry);
  }
  const sortedDates = Object.keys(grouped).sort().reverse();

  // 各日付グループ内を sort_order 降順でソート（新しいメモが上、古いメモが下）
  // 未設定は entry_number にフォールバック
  const sortKey = (e) => {
    const so = e.sort_order;
    return so == null ? (e.entry_number || 1) : so;
  };
  for (const date of sortedDates) {
    grouped[date].sort((a, b) => sortKey(b) - sortKey(a) || (b.entry_number || 0) - (a.entry_number || 0));
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
    `;

    const entriesHTML = dateEntries.map((entry) => {
      const time = entry.created_at ? entry.created_at.slice(11, 16) : "";
      const cleanContent = entry.content.replace(IMG_REGEX, " ").replace(SIZE_SPAN_STRIP, "").trim();
      const bodyContent = stripDateHeader(cleanContent).trim();
      const title = bodyContent ? bodyContent.slice(0, 40).replace(/\n/g, " ") : "(無題)";
      const preview = bodyContent.slice(0, 80).replace(/\n/g, " ");
      const labels = entry.labels || [];
      const labelsHTML = labels.length > 0
        ? `<div class="bd-entry-labels">${labels.map(l => `
            <span class="bd-label-chip bd-label-chip-sm" style="${labelChipStyle(l)}">${escapeHTML(l)}</span>
          `).join("")}</div>`
        : "";

      return `
        <div class="braindump-entry" data-id="${entry.id}" data-date="${entry.date}" style="cursor: pointer;">
          <div class="braindump-entry-header">
            <span class="braindump-entry-title">${escapeHTML(title)}</span>
            <div class="braindump-entry-actions">
              <span class="braindump-entry-time">${time}</span>
              <button class="braindump-entry-delete" data-id="${entry.id}" title="削除">×</button>
            </div>
          </div>
          ${labelsHTML}
          <div class="braindump-entry-preview">${escapeHTML(preview)}${bodyContent.length > 80 ? '...' : ''}</div>
        </div>`;
    }).join("");

    return `
      <div class="braindump-date-group">
        <div class="braindump-date-group-header">${dateHeader}</div>
        ${entriesHTML}
      </div>`;
  }).join("");
}

function refreshEntriesList(activeId) {
  const container = document.getElementById("bd-entries");
  if (container) {
    container.innerHTML = renderRecentEntries();
    const targetId = activeId || editingEntryId;
    if (targetId) {
      const activeEl = container.querySelector(`.braindump-entry[data-id="${targetId}"]`);
      if (activeEl) activeEl.classList.add("active");
    }
  }
}

// ===== 削除確認モーダル + 長押し =====

const LONG_PRESS_MS = 500;
let suppressNextClick = false; // 長押し発火後の click を抑止

function getEntryDisplayInfo(entryId) {
  const entry = recentEntries.find(en => en.id === entryId);
  if (!entry) return { title: "(不明なメモ)", labels: [] };
  const cleanContent = entry.content.replace(IMG_REGEX, " ").replace(SIZE_SPAN_STRIP, "").trim();
  const bodyContent = stripDateHeader(cleanContent).trim();
  const title = bodyContent.slice(0, 40).replace(/\n/g, " ") || "(無題)";
  return { title, labels: entry.labels || [] };
}

function showDeleteConfirmModal({ title, labels, onConfirm }) {
  document.getElementById("bd-delete-confirm-modal")?.remove();

  const labelsHTML = labels && labels.length
    ? `<div class="bd-delete-confirm-labels">${labels.map(l =>
        `<span class="bd-label-chip bd-label-chip-sm" style="${labelChipStyle(l)}">${escapeHTML(l)}</span>`
      ).join("")}</div>`
    : "";

  const modal = document.createElement("div");
  modal.id = "bd-delete-confirm-modal";
  modal.className = "bd-modal-overlay";
  modal.innerHTML = `
    <div class="bd-modal bd-delete-confirm" role="alertdialog" aria-labelledby="bd-delete-confirm-heading">
      <div class="bd-modal-header">
        <h3 id="bd-delete-confirm-heading">本当に削除しますか？</h3>
        <button class="bd-modal-close" type="button" aria-label="閉じる">×</button>
      </div>
      <div class="bd-modal-body">
        <div class="bd-delete-confirm-title">${escapeHTML(title || "(無題)")}</div>
        ${labelsHTML}
        <div class="bd-delete-confirm-warning">この操作は取り消せません。</div>
      </div>
      <div class="bd-modal-footer">
        <button class="btn btn-outline btn-sm" id="bd-delete-confirm-cancel" type="button">キャンセル</button>
        <button class="btn btn-danger btn-sm" id="bd-delete-confirm-ok" type="button">削除する</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector(".bd-modal-close")?.addEventListener("click", close);
  modal.querySelector("#bd-delete-confirm-cancel")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener("keydown", function onEsc(e) {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", onEsc);
    }
  });
  modal.querySelector("#bd-delete-confirm-ok")?.addEventListener("click", async () => {
    close();
    await onConfirm();
  });
  setTimeout(() => modal.querySelector("#bd-delete-confirm-cancel")?.focus(), 30);
}

// 長押しハンドラ: ボタンに直接付与（フォーム内の固定ボタン用）
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

// 長押しハンドラ: イベント委譲版（動的に再描画される一覧の × ボタン用）
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
  // 新しいメモボタン（書きかけ内容を保存してから新規モードへリセット）
  document.getElementById("bd-new-btn")?.addEventListener("click", startNewMemo);

  // ラベル管理ボタン
  document.getElementById("bd-manage-labels-btn")?.addEventListener("click", openLabelsManager);

  // ページ表示時に自動フォーカス
  setTimeout(() => {
    document.getElementById("bd-new-textarea")?.focus();
  }, 100);

  const editorEl = document.getElementById("bd-new-textarea");
  // テキスト入力の自動保存（2秒間入力停止で発火 — 新規/既存メモ共通）
  editorEl?.addEventListener("input", handleNewTextareaInput);
  // クリップボードの貼り付け対応（画像はインライン挿入、テキストはプレーン化）
  editorEl?.addEventListener("paste", handlePasteEvent);
  // Tab キーでフォーカス移動を抑止し、タブ文字を挿入
  editorEl?.addEventListener("keydown", handleTabInsert);
  // インライン画像クリックで新しいタブに原寸表示
  editorEl?.addEventListener("click", (e) => {
    const img = e.target.closest && e.target.closest("img.bd-inline-img");
    if (!img) return;
    if (img.classList.contains("bd-inline-img-uploading")) return;
    if (!img.src) return;
    window.open(img.src, "_blank");
  });

  // 縦幅調整バーのドラッグ処理（デスクトップ専用）
  initResizeBar();

  // 選択時フローティング書式ツールバー（共有モジュール）にエディタを登録
  if (editorEl) attachFloatingToolbar(editorEl);

  // ラベル編集UIのイベント
  attachLabelsEditorEvents();

  // フィルタバーのイベント
  attachFilterBarEvents();

  // ピッカー外クリックで閉じる
  document.addEventListener("click", (e) => {
    const picker = document.getElementById("bd-label-picker");
    const addBtn = document.getElementById("bd-label-add-btn");
    if (!picker || picker.style.display === "none") return;
    if (picker.contains(e.target)) return;
    if (addBtn && addBtn.contains(e.target)) return;
    picker.style.display = "none";
  });

  // フォーム内の削除ボタン（長押し0.5秒で確認モーダル）
  const formDeleteBtn = document.getElementById("bd-delete-btn");
  if (formDeleteBtn) {
    // 通常クリック: 長押し直後のクリックは無視、それ以外はヒントを出す
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

  // エントリ削除ボタン / 並び替えボタン
  const entriesEl = document.getElementById("bd-entries");
  // 一覧の × ボタンに長押し操作を委譲で付与
  initEntriesLongPress(entriesEl);

  entriesEl?.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".braindump-entry-delete");
    if (deleteBtn) {
      // 同一要素上のエントリクリック・ハンドラ(エディタ読み込み)も止める
      e.stopPropagation();
      e.stopImmediatePropagation();
      // 長押しで発火済みの click は無視
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      // 通常タップではエントリ読み込みを抑止しつつヒントを表示
      showToast("削除するにはボタンを長押ししてください");
      return;
    }
  });

  // エントリクリック → 左側テキストエリアに内容を読み込んで編集
  document.getElementById("bd-entries")?.addEventListener("click", (e) => {
    const entryEl = e.target.closest(".braindump-entry");
    if (!entryEl) return;

    const entryId = entryEl.dataset.id;
    if (!entryId) return;

    // 対象エントリを recentEntries から探す
    const entry = recentEntries.find(en => en.id === entryId);
    if (!entry) return;

    // 左側エディタに内容を読み込み
    const editorEl = document.getElementById("bd-new-textarea");
    if (!editorEl) return;

    // 切り替え前ノートのスクロール位置を保存
    saveCurrentScroll();

    setEditorContent(editorEl, entry.content || "");
    updateEditorEmptyState(editorEl);
    currentLabels = [...(entry.labels || [])];
    editingEntryId = entryId;
    newEntryId = null; // 新規メモのIDをリセット
    refreshLabelsEditor();

    // 右カラムの該当エントリにアクティブ表示
    document.querySelectorAll(".braindump-entry").forEach(el => el.classList.remove("active"));
    entryEl.classList.add("active");

    // ヘッダーを編集モード表示に更新
    updateHeaderForEditing(entry);

    // 前回の表示位置を復元（未記録なら先頭）。focus/カーソル移動はしない
    editorEl.scrollTop = scrollPositions.get(entryId) || 0;

    // 自動保存を既存メモ更新に切り替え
    if (newAutoSaveTimer) clearTimeout(newAutoSaveTimer);
    editorEl.removeEventListener("input", handleNewTextareaInput);
    editorEl.addEventListener("input", handleNewTextareaInput);
  });
}

// ===== ヘッダーモード切替 =====

function updateHeaderForEditing(entry) {
  const cleanContent = entry.content.replace(IMG_REGEX, " ").replace(SIZE_SPAN_STRIP, "").trim();
  const bodyContent = stripDateHeader(cleanContent).trim();
  const title = bodyContent.slice(0, 40).replace(/\n/g, " ") || "(無題)";
  const header = document.querySelector(".braindump-header");
  if (!header) return;
  header.innerHTML = `
    <h2 class="braindump-title" style="font-size: 1rem;">編集中: ${escapeHTML(title)}</h2>
    <div class="braindump-header-actions">
      <button class="btn btn-outline btn-sm" id="bd-back-to-new-btn">＋ 新しいメモ</button>
      <button class="btn btn-outline btn-sm" id="bd-manage-labels-btn" title="ラベルを管理">⚙ タグ管理</button>
    </div>
  `;
  document.getElementById("bd-back-to-new-btn")?.addEventListener("click", () => {
    resetToNewMode();
    insertDateTimeHeader();
  });
  document.getElementById("bd-manage-labels-btn")?.addEventListener("click", openLabelsManager);

  // フォーム内の削除ボタンを表示
  const deleteBtn = document.getElementById("bd-delete-btn");
  if (deleteBtn) deleteBtn.style.display = "";
}

async function startNewMemo() {
  // 進行中の autosave タイマーをキャンセル（書きかけ内容は下で同期保存する）
  if (newAutoSaveTimer) {
    clearTimeout(newAutoSaveTimer);
    newAutoSaveTimer = null;
  }
  const editorEl = document.getElementById("bd-new-textarea");
  const md = editorEl ? getEditorMarkdown(editorEl) : "";
  const plainText = md.replace(IMG_REGEX, "").trim();
  // 自動挿入された日時ヘッダーだけの状態は「中身なし」として扱う
  const hasText = plainText.length > 0 && !isHeaderOnly(plainText);
  const hasImages = !!(editorEl && editorEl.querySelector("img.bd-inline-img"));
  if (hasText || hasImages) {
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
  // 離脱前ノートのスクロール位置を保存
  saveCurrentScroll();
  editingEntryId = null;
  newEntryId = null;
  const editorEl = document.getElementById("bd-new-textarea");
  if (editorEl) {
    setEditorContent(editorEl, "");
    updateEditorEmptyState(editorEl);
  }
  currentLabels = [];
  refreshLabelsEditor();

  // ヘッダーを元に戻す
  const header = document.querySelector(".braindump-header");
  if (header) {
    header.innerHTML = `
      <h2 class="braindump-title">ブレインダンプ</h2>
      <div class="braindump-header-actions">
        <button class="btn btn-primary btn-sm" id="bd-new-btn">＋ 新しいメモ</button>
        <button class="btn btn-outline btn-sm" id="bd-manage-labels-btn" title="ラベルを管理">⚙ タグ管理</button>
      </div>
    `;
    document.getElementById("bd-new-btn")?.addEventListener("click", startNewMemo);
    document.getElementById("bd-manage-labels-btn")?.addEventListener("click", openLabelsManager);
  }

  // フォーム内の削除ボタンを非表示
  const deleteBtn = document.getElementById("bd-delete-btn");
  if (deleteBtn) deleteBtn.style.display = "none";

  // 右カラムのアクティブ表示を解除
  document.querySelectorAll(".braindump-entry").forEach(el => el.classList.remove("active"));

  editorEl?.focus();
}

function handleNewTextareaInput() {
  const ed = document.getElementById("bd-new-textarea");
  if (ed) updateEditorEmptyState(ed);
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
  const editorEl = document.getElementById("bd-new-textarea");
  if (!editorEl) return;
  const content = getEditorMarkdown(editorEl);
  if (!content) return;

  try {
    const updated = await braindumpApi.update(entryId, content, currentLabels);
    // recentEntries を更新
    const idx = recentEntries.findIndex(e => e.id === entryId);
    if (idx >= 0 && updated) {
      recentEntries[idx] = updated;
    }
    refreshEntriesList(entryId);
  } catch {
    // 自動保存失敗は静かに無視
  }
}

// ===== CRUD操作 =====

async function autoSaveNewEntry() {
  const editorEl = document.getElementById("bd-new-textarea");
  if (!editorEl) return;

  const content = getEditorMarkdown(editorEl);
  const plainText = content.replace(IMG_REGEX, "").trim();
  const hasImages = !!editorEl.querySelector("img.bd-inline-img");
  // 自動挿入された日時ヘッダーだけの状態では空メモを作らない
  if (!hasImages && (plainText === "" || isHeaderOnly(plainText))) return;
  if (!content) return;

  try {
    if (newEntryId) {
      // 既に作成済み → 更新
      await braindumpApi.update(newEntryId, content, currentLabels);
    } else {
      // 初回 → 新規作成してIDを保持
      const created = await braindumpApi.create(currentDate, content, currentLabels);
      if (created && created.id) {
        newEntryId = created.id;
      }
    }
    // 右カラムの一覧も更新
    entries = await braindumpApi.listByDate(currentDate) || [];
    await refreshEntries();
  } catch {
    // 自動保存失敗は静かに無視
  }
}

async function deleteEntry(entryId) {
  try {
    await braindumpApi.delete(entryId);
    editingEntryId = null;
    entries = entries.filter(e => e.id !== entryId);
    await refreshEntries();
  } catch (e) {
    showToast(`削除に失敗しました: ${e.message}`, "error");
  }
}

async function refreshEntries() {
  // 過去15日分も再取得
  try {
    recentEntries = await braindumpApi.list(daysAgo(14), today()) || [];
  } catch {
    // 失敗時は既存データを維持
  }
  // ラベル一覧も再集計
  try {
    const res = await braindumpApi.listLabels();
    allLabels = (res && res.labels) || [];
  } catch {}
  refreshFilterBar();
  refreshEntriesList();
}

// ===== ラベル管理モーダル =====

async function openLabelsManager() {
  // 最新のラベル一覧を取得
  try {
    const res = await braindumpApi.listLabels();
    allLabels = (res && res.labels) || [];
  } catch {}

  // 既存のモーダルがあれば閉じる
  document.getElementById("bd-labels-modal")?.remove();

  const rows = allLabels.length === 0
    ? `<div class="bd-labels-modal-empty">まだラベルがありません。メモの「＋ ラベル」から追加してください。</div>`
    : allLabels.map(l => `
        <div class="bd-labels-modal-row" data-name="${escapeHTML(l.name)}">
          <span class="bd-label-chip" style="${labelChipStyle(l.name)}">${escapeHTML(l.name)}</span>
          <span class="bd-labels-modal-count">${l.count}件</span>
          <div class="bd-labels-modal-actions">
            <button class="btn btn-outline btn-sm bd-label-rename-btn" data-name="${escapeHTML(l.name)}">リネーム</button>
            <button class="btn btn-danger btn-sm bd-label-delete-btn" data-name="${escapeHTML(l.name)}">削除</button>
          </div>
        </div>
      `).join("");

  const modal = document.createElement("div");
  modal.id = "bd-labels-modal";
  modal.className = "bd-modal-overlay";
  modal.innerHTML = `
    <div class="bd-modal">
      <div class="bd-modal-header">
        <h3>ラベル管理</h3>
        <button class="bd-modal-close" type="button" title="閉じる">×</button>
      </div>
      <div class="bd-modal-body">
        ${rows}
      </div>
      <div class="bd-modal-footer">
        <button class="btn btn-outline btn-sm" id="bd-labels-modal-close-btn">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector(".bd-modal-close")?.addEventListener("click", close);
  modal.querySelector("#bd-labels-modal-close-btn")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  modal.querySelectorAll(".bd-label-rename-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const oldName = btn.dataset.name;
      const newName = prompt(`「${oldName}」を何にリネームしますか？`, oldName);
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName) return;
      try {
        const result = await braindumpApi.renameLabel(oldName, trimmed);
        showToast(`「${oldName}」→「${trimmed}」に変更（${result.affected}件）`);
        // 編集中メモにも反映
        if (currentLabels.includes(oldName)) {
          currentLabels = currentLabels.map(l => l === oldName ? trimmed : l);
          refreshLabelsEditor();
        }
        // フィルタにも反映
        if (filterLabels.includes(oldName)) {
          filterLabels = filterLabels.map(l => l === oldName ? trimmed : l);
        }
        await refreshEntries();
        // モーダルを再描画
        close();
        openLabelsManager();
      } catch (err) {
        showToast(`リネーム失敗: ${err.message}`, "error");
      }
    });
  });

  modal.querySelectorAll(".bd-label-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.name;
      const target = allLabels.find(l => l.name === name);
      const count = target ? target.count : 0;
      if (!confirm(`「${name}」を削除しますか？\n使用中のメモ ${count} 件からもこのラベルが外れます。`)) return;
      try {
        const result = await braindumpApi.deleteLabel(name);
        showToast(`「${name}」を削除（${result.affected}件から除去）`);
        // 編集中メモにも反映
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

// ===== 縦幅調整バー（デスクトップ専用、セッション中のみ保持） =====

function initResizeBar() {
  const bar = document.getElementById("bd-resize-bar");
  const ta = document.getElementById("bd-new-textarea");
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
// 太字ショートカット (Ctrl+B) は floating-toolbar.js が登録するため、ここでは扱わない。

function handleTabInsert(e) {
  if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  insertPlainTextAtCursor("\t");
  e.target.dispatchEvent(new Event("input", { bubbles: true }));
}


// ===== クリップボード貼り付け（画像はインライン挿入、テキストはプレーン化） =====

async function handlePasteEvent(e) {
  const clipboardData = e.clipboardData;
  if (!clipboardData) return;

  // 1) clipboardData.files で画像を探す（最も互換性が高い）
  let file = null;
  for (let i = 0; i < clipboardData.files.length; i++) {
    if (clipboardData.files[i].type.startsWith("image/")) {
      file = clipboardData.files[i];
      break;
    }
  }
  // 2) files になければ items をインデックスで走査
  if (!file && clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        file = item.getAsFile();
        break;
      }
    }
  }

  if (file) {
    e.preventDefault();
    await pasteImageAtCursor(file);
    return;
  }

  // 画像でない場合：リッチHTMLが入らないようプレーンテキストで挿入
  const text = clipboardData.getData("text/plain");
  if (text) {
    e.preventDefault();
    insertPlainTextAtCursor(text);
    const ed = document.getElementById("bd-new-textarea");
    ed?.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function pasteImageAtCursor(file) {
  const editorEl = document.getElementById("bd-new-textarea");
  if (!editorEl) return;

  // 一時的なオブジェクト URL で即座にプレビュー
  const tempUrl = URL.createObjectURL(file);
  const img = createInlineImg(tempUrl, "画像");
  img.classList.add("bd-inline-img-uploading");
  insertNodeAtCursor(img);
  updateEditorEmptyState(editorEl);

  try {
    const result = await braindumpApi.uploadImage(file);
    img.src = result.url;
    img.classList.remove("bd-inline-img-uploading");
    // 即座に保存
    if (editingEntryId) {
      await autoSaveExistingEntry(editingEntryId);
    } else {
      await autoSaveNewEntry();
    }
    showToast("画像を貼り付けました");
  } catch (err) {
    // アップロード失敗時はインライン画像を除去
    img.remove();
    updateEditorEmptyState(editorEl);
    showToast(`画像アップロードに失敗しました: ${err.message}`, "error");
  } finally {
    URL.revokeObjectURL(tempUrl);
  }
}
