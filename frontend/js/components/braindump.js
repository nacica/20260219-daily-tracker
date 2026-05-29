/**
 * ブレインダンプ コンポーネント
 * プレーンテキストのメモ帳。1日に複数メモ作成可能。
 * 自動保存、AIタイトル自動生成、画像貼り付け対応。
 * ラベル機能: メモごとに複数ラベル付与可、ラベルOR検索、専用管理モーダル。
 */

import { braindumpApi } from "../api.js?v=20260529c";
import { showToast } from "../app.js?v=20260529c";

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
// 行内太字 **...** （単一行内、`**` を含まない）
const BOLD_MATCH = /\*\*([^\n*][^\n]*?)\*\*/g;
// 文字サイズ <span style="font-size:Xem">...</span>（中身に <br>/<strong>/改行を含み得る）
const SIZE_SPAN_MATCH = /<span\s+style="font-size:\s*([0-9.]+)em\s*">([\s\S]*?)<\/span>/g;
// 表示用に size span タグだけ剥がす（中身は残す）
const SIZE_SPAN_STRIP = /<span\s+style="font-size:[^"]*"\s*>|<\/span>/gi;
// 文字サイズプリセット（順送り）
const SIZE_LEVELS = [0.8, 1.0, 1.25, 1.5, 2.0];
const DEFAULT_SIZE = 1.0;

// ===== contenteditable エディタ ↔ markdown 相互変換 =====

/** markdown 文字列を contenteditable エディタに流し込む（テキスト + <br> + <img>） */
function setEditorContent(editor, markdown) {
  editor.innerHTML = "";
  const text = markdown || "";

  // 画像マークダウンで分割し、テキスト部と画像部のセグメント列を作る
  const segments = [];
  let lastIdx = 0;
  let m;
  const re = new RegExp(IMG_MATCH.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) segments.push({ type: "text", value: text.slice(lastIdx, m.index) });
    segments.push({ type: "img", alt: m[1] || "画像", src: m[2] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) segments.push({ type: "text", value: text.slice(lastIdx) });

  for (const seg of segments) {
    if (seg.type === "text") {
      appendTextWithSizeAndBold(editor, seg.value);
    } else {
      editor.appendChild(createInlineImg(seg.src, seg.alt));
    }
  }

  if (editor.childNodes.length === 0) {
    editor.appendChild(document.createElement("br"));
  }
}

/** 改行を <br> に展開しつつテキストを target に追加 */
function appendTextLines(target, text) {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) target.appendChild(document.createElement("br"));
    if (lines[i]) target.appendChild(document.createTextNode(lines[i]));
  }
}

/** テキストを **...** で分割し、太字部分は <strong> でラップして parent に追加 */
function appendTextWithBold(parent, text) {
  const re = new RegExp(BOLD_MATCH.source, "g");
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) appendTextLines(parent, text.slice(lastIdx, m.index));
    const strong = document.createElement("strong");
    appendTextLines(strong, m[1]);
    if (strong.childNodes.length > 0) parent.appendChild(strong);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) appendTextLines(parent, text.slice(lastIdx));
}

/** テキストを <span style="font-size:..em"> で分割し、span 内外それぞれで bold + 改行を展開 */
function appendTextWithSizeAndBold(parent, text) {
  const re = new RegExp(SIZE_SPAN_MATCH.source, "g");
  let lastIdx = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) appendTextWithBold(parent, text.slice(lastIdx, m.index));
    const em = parseFloat(m[1]);
    const inner = m[2];
    if (!isNaN(em) && em > 0 && em !== DEFAULT_SIZE) {
      const span = document.createElement("span");
      span.style.fontSize = `${em}em`;
      appendTextWithBold(span, inner);
      if (span.childNodes.length > 0) parent.appendChild(span);
    } else {
      // 1.0em（リセット相当）や不正値は素通し
      appendTextWithBold(parent, inner);
    }
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) appendTextWithBold(parent, text.slice(lastIdx));
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
  if (!editor) return "";
  let out = "";

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === "BR") { out += "\n"; return; }
    if (tag === "IMG") {
      const src = node.getAttribute("src") || "";
      const alt = node.getAttribute("alt") || "画像";
      // アップロード中の一時画像（blob:URL）は markdown には書かない
      if (src.startsWith("blob:") || node.classList.contains("bd-inline-img-uploading")) return;
      out += `![${alt}](${src})`;
      return;
    }
    // 文字サイズ <span style="font-size:..em">...</span>: そのまま再シリアライズ
    if (tag === "SPAN") {
      const fs = node.style && node.style.fontSize;
      if (fs && fs.endsWith("em")) {
        const em = parseFloat(fs);
        if (!isNaN(em) && em > 0 && em !== DEFAULT_SIZE) {
          const before = out.length;
          for (const child of node.childNodes) walk(child);
          const inner = out.slice(before);
          if (inner === "") return;
          out = out.slice(0, before) + `<span style="font-size:${em}em">` + inner + `</span>`;
          return;
        }
      }
      // 通常の span はスタイル無し扱い（中身だけ出力）
      for (const child of node.childNodes) walk(child);
      return;
    }
    // 太字: <strong> または <b> を **...** に変換（中身が空白だけならマーカーを付けない）
    if (tag === "STRONG" || tag === "B") {
      const before = out.length;
      for (const child of node.childNodes) walk(child);
      const inner = out.slice(before);
      if (inner.trim() === "") return;
      // 先頭/末尾の空白は ** の外に出す（**foo ** にならないように）
      const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const left = m ? m[1] : "";
      const core = m ? m[2] : inner;
      const right = m ? m[3] : "";
      // 中身に既存の ** が含まれていれば二重マーカー化を避けて素通しする
      if (core.includes("**")) return;
      out = out.slice(0, before) + left + "**" + core + "**" + right;
      return;
    }
    const isBlock = (tag === "DIV" || tag === "P" || tag === "BLOCKQUOTE" || tag === "PRE" || tag === "LI");
    if (isBlock && out.length > 0 && !out.endsWith("\n")) out += "\n";
    for (const child of node.childNodes) walk(child);
  };

  for (const child of editor.childNodes) walk(child);
  // 先頭/末尾の余分な改行は削らない（ユーザーが意図的に空行入れることがある）
  // ただし完全に空ならから文字に
  if (out.replace(/\n+/g, "").trim() === "" && !editor.querySelector("img")) return "";
  return out;
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

  // 選択時フローティング太字ツールバー（モジュール単位で1回だけ初期化）
  ensureFloatingBoldToolbar();

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

// ===== Tab キー処理 / 太字ショートカット =====

function handleTabInsert(e) {
  // Ctrl+B / Cmd+B → 選択範囲の太字トグル
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    toggleBoldOnSelection();
    return;
  }
  if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  insertPlainTextAtCursor("\t");
  e.target.dispatchEvent(new Event("input", { bubbles: true }));
}

// ===== 太字トグル =====

/**
 * 選択範囲の太字をトグルする。
 * contenteditable では execCommand('bold') がクロスブラウザで安定し、
 * 完全に太字なら解除、そうでなければ太字化、というトグル動作を内蔵している。
 */
function toggleBoldOnSelection() {
  const editor = document.getElementById("bd-new-textarea");
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  // フォーカスを確保してから実行（フローティングボタン経由で focus が外れているケース対策）
  if (document.activeElement !== editor) editor.focus({ preventScroll: true });
  try {
    document.execCommand("bold", false, null);
  } catch {
    return;
  }
  // 自動保存トリガ
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  // ツールバー位置を再計算（選択範囲の rect が変わるため）
  requestAnimationFrame(updateFloatingBoldToolbarPosition);
}

// ===== 選択時フローティング太字ツールバー =====

let floatingBoldToolbarInited = false;

function ensureFloatingBoldToolbar() {
  if (floatingBoldToolbarInited) return;
  floatingBoldToolbarInited = true;

  const tb = document.createElement("div");
  tb.id = "bd-floating-bold-toolbar";
  tb.className = "bd-floating-bold-toolbar";
  tb.setAttribute("role", "toolbar");
  tb.setAttribute("aria-label", "テキスト書式");
  tb.style.display = "none";
  // flex 子要素間の空白テキストノード混入を避けるため改行なしで連結
  tb.innerHTML = [
    `<button type="button" class="bd-fb-btn bd-fb-bold-btn" title="太字 (Ctrl+B)" aria-label="太字"><b>B</b></button>`,
    `<span class="bd-fb-sep" aria-hidden="true"></span>`,
    `<button type="button" class="bd-fb-btn bd-fb-size-down-btn" title="文字を小さく" aria-label="文字を小さく">A<span class="bd-fb-sub">−</span></button>`,
    `<button type="button" class="bd-fb-btn bd-fb-size-reset-btn" title="文字サイズをデフォルトに戻す" aria-label="文字サイズをデフォルトに戻す">A</button>`,
    `<button type="button" class="bd-fb-btn bd-fb-size-up-btn" title="文字を大きく" aria-label="文字を大きく">A<span class="bd-fb-sup">+</span></button>`,
  ].join("");
  document.body.appendChild(tb);

  // 各ボタン: mousedown で preventDefault して選択範囲を保持したまま発火
  const bindBtn = (sel, fn) => {
    const b = tb.querySelector(sel);
    if (!b) return;
    b.addEventListener("mousedown", (e) => { e.preventDefault(); fn(); });
    b.addEventListener("touchstart", (e) => { e.preventDefault(); fn(); }, { passive: false });
  };
  bindBtn(".bd-fb-bold-btn", toggleBoldOnSelection);
  bindBtn(".bd-fb-size-down-btn", () => bumpSelectionFontSize(-1));
  bindBtn(".bd-fb-size-reset-btn", () => setSelectionFontSize(DEFAULT_SIZE));
  bindBtn(".bd-fb-size-up-btn", () => bumpSelectionFontSize(+1));

  // 選択範囲が変わるたびに位置を更新
  document.addEventListener("selectionchange", updateFloatingBoldToolbarPosition);
  // 編集中のスクロール・リサイズでも追従
  window.addEventListener("scroll", updateFloatingBoldToolbarPosition, true);
  window.addEventListener("resize", updateFloatingBoldToolbarPosition);
}

// ===== 文字サイズ操作 =====

/** 選択範囲の起点側にある最も近い font-size 設定を返す（無ければ DEFAULT_SIZE） */
function getCurrentSelectionFontSize() {
  const editor = document.getElementById("bd-new-textarea");
  if (!editor) return DEFAULT_SIZE;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return DEFAULT_SIZE;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node && node !== editor) {
    if (node.style && node.style.fontSize && node.style.fontSize.endsWith("em")) {
      const em = parseFloat(node.style.fontSize);
      if (!isNaN(em) && em > 0) return em;
    }
    node = node.parentElement;
  }
  return DEFAULT_SIZE;
}

/** SIZE_LEVELS のうち em に最も近いインデックスを返す */
function nearestSizeLevelIndex(em) {
  let bestIdx = 1;
  let bestDiff = Infinity;
  for (let i = 0; i < SIZE_LEVELS.length; i++) {
    const diff = Math.abs(SIZE_LEVELS[i] - em);
    if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
  }
  return bestIdx;
}

/** 現在のサイズから dir (+1 / -1) 段階ずれた SIZE_LEVELS を適用 */
function bumpSelectionFontSize(dir) {
  const cur = getCurrentSelectionFontSize();
  const idx = nearestSizeLevelIndex(cur);
  const nextIdx = Math.max(0, Math.min(SIZE_LEVELS.length - 1, idx + dir));
  setSelectionFontSize(SIZE_LEVELS[nextIdx]);
}

/**
 * 選択範囲のフォントサイズを em 値に設定する。
 * 重要: 選択範囲を囲む size span 祖先がある場合は、まず span を分割して
 * 選択範囲を span の外側に「持ち上げる」。これにより
 *  - リセット(1.0em)時に外側の span が消えず残るバグを防ぐ
 *  - 連続適用時に em がネスト累積して 1.25 * 1.5 = 1.875em のように
 *    意図しないサイズになるのを防ぐ
 */
function setSelectionFontSize(targetEm) {
  const editor = document.getElementById("bd-new-textarea");
  if (!editor) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  let range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  if (range.collapsed) {
    showToast("文字を範囲選択してから操作してください");
    return;
  }
  // 選択に画像が含まれる場合は適用しない（保存形式の整合のため）
  const peek = range.cloneContents();
  if (peek.querySelector && peek.querySelector("img")) {
    showToast("画像を含む範囲には文字サイズを適用できません");
    return;
  }

  if (document.activeElement !== editor) editor.focus({ preventScroll: true });

  // ① 選択範囲を囲む size span 祖先を全て分割し、選択部分を「外側」に持ち上げる
  //    （複数階層ネストしているケースに備え繰り返す）
  for (let safety = 0; safety < 5; safety++) {
    const enclosing = findEnclosingSizeSpan(editor, range);
    if (!enclosing) break;
    const lifted = splitSizeSpanAroundRange(enclosing, range);
    if (!lifted) {
      updateFloatingBoldToolbarPosition();
      return;
    }
    range = lifted;
  }

  // ② 選択範囲を抽出し、内部に残った size span もアンラップ
  const fragment = range.extractContents();
  fragment.querySelectorAll("span").forEach((s) => {
    if (s.style && s.style.fontSize && s.style.fontSize.endsWith("em")) {
      while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s);
      s.remove();
    }
  });

  // ③ 1.0em ならそのまま戻す。それ以外は新しい size span で包んで戻す。
  const newRange = document.createRange();
  if (Math.abs(targetEm - DEFAULT_SIZE) < 1e-3) {
    const firstChild = fragment.firstChild;
    const lastChild = fragment.lastChild;
    range.insertNode(fragment);
    if (firstChild && lastChild) {
      newRange.setStartBefore(firstChild);
      newRange.setEndAfter(lastChild);
    } else {
      newRange.setStart(range.startContainer, range.startOffset);
      newRange.collapse(true);
    }
  } else {
    const span = document.createElement("span");
    span.style.fontSize = `${targetEm}em`;
    span.appendChild(fragment);
    range.insertNode(span);
    newRange.selectNodeContents(span);
  }
  sel.removeAllRanges();
  sel.addRange(newRange);

  editor.dispatchEvent(new Event("input", { bubbles: true }));
  requestAnimationFrame(updateFloatingBoldToolbarPosition);
}

/** 選択範囲を完全に内包する最も内側の size span (font-size 指定の span) を返す。無ければ null */
function findEnclosingSizeSpan(editor, range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node && node !== editor) {
    if (node.tagName === "SPAN" && node.style && node.style.fontSize && node.style.fontSize.endsWith("em")) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * span に完全に内包される range について、span を
 *   [before-span (same fontSize)] [middle (unwrapped)] [after-span (same fontSize)]
 * の3つに分解する。中央のアンラップ済みコンテンツを選択する新しい range を返す。
 */
function splitSizeSpanAroundRange(span, range) {
  const fontSize = span.style.fontSize;
  const parent = span.parentNode;
  if (!parent) return null;

  // 末尾側を先に切り出す: 先頭側を切ると range の参照オフセットがずれる可能性があるため
  const afterRange = document.createRange();
  afterRange.selectNodeContents(span);
  afterRange.setStart(range.endContainer, range.endOffset);
  const afterFrag = afterRange.extractContents();

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(span);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const beforeFrag = beforeRange.extractContents();

  // span 前に before 用 size span を挿入
  if (beforeFrag.firstChild) {
    const bs = document.createElement("span");
    bs.style.fontSize = fontSize;
    bs.appendChild(beforeFrag);
    parent.insertBefore(bs, span);
  }
  // span 後ろに after 用 size span を挿入
  if (afterFrag.firstChild) {
    const as_ = document.createElement("span");
    as_.style.fontSize = fontSize;
    as_.appendChild(afterFrag);
    parent.insertBefore(as_, span.nextSibling);
  }

  // span の中身を持ち上げ、span 自体は削除
  const middleFrag = document.createDocumentFragment();
  while (span.firstChild) middleFrag.appendChild(span.firstChild);
  const firstMid = middleFrag.firstChild;
  const lastMid = middleFrag.lastChild;
  parent.insertBefore(middleFrag, span);
  span.remove();

  if (!firstMid || !lastMid) return null;

  const newRange = document.createRange();
  newRange.setStartBefore(firstMid);
  newRange.setEndAfter(lastMid);
  return newRange;
}

function updateFloatingBoldToolbarPosition() {
  const tb = document.getElementById("bd-floating-bold-toolbar");
  if (!tb) return;
  const editor = document.getElementById("bd-new-textarea");
  if (!editor) { tb.style.display = "none"; return; }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    tb.style.display = "none";
    return;
  }
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    tb.style.display = "none";
    return;
  }
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    tb.style.display = "none";
    return;
  }
  // 一旦表示してから offsetWidth/Height を取得
  tb.style.visibility = "hidden";
  tb.style.display = "";
  const tbW = tb.offsetWidth;
  const tbH = tb.offsetHeight;
  let top = window.scrollY + rect.top - tbH - 8;
  let left = window.scrollX + rect.left + rect.width / 2 - tbW / 2;
  // 画面端を超えないように clamp
  const minLeft = window.scrollX + 4;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - tbW - 4;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;
  if (top < window.scrollY + 4) {
    // 上に出すスペースがなければ選択範囲の下に出す
    top = window.scrollY + rect.bottom + 8;
  }
  tb.style.top = top + "px";
  tb.style.left = left + "px";
  tb.style.visibility = "";
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
