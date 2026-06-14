/**
 * ありがたいノート画面
 *
 * 「今自分が恵まれている点 / 感謝できる対象」を思いついた時にその都度書き残す。
 * 複数行 textarea + 追加ボタン → 新しい順フラットリスト（日付バッジ付き）。
 * 各エントリは編集・削除可能。
 */

import { gratitudeApi } from "../api.js?v=20260614d";
import { showToast } from "../app.js?v=20260614d";
import {
  attachFloatingToolbar,
  appendMarkdownToEditor,
  serializeEditorMarkdown,
} from "../floating-toolbar.js?v=20260614d";

/** contenteditable から markdown を読む（textarea にも対応） */
function readEditorMd(el) {
  if (!el) return "";
  if (el.tagName === "TEXTAREA") return (el.value || "").trim();
  return serializeEditorMarkdown(el).trim();
}
function writeEditorMd(el, text) {
  if (!el) return;
  if (el.tagName === "TEXTAREA") { el.value = text || ""; return; }
  appendMarkdownToEditor(el, text || "");
}

const state = {
  items: [],
  editingId: null,
  loading: false,
};

// ===== ユーティリティ =====

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function escapeAttr(str) {
  return escapeHtml(str);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateJa(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEKDAYS[d.getDay()];
  return `${y}年${m}月${day}日（${w}）`;
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(iso) {
  const date = formatDateJa(iso);
  const time = formatTime(iso);
  return date && time ? `${date} ${time}` : (date || time);
}

// 内容を表示用 HTML に変換：改行 → <br>、**bold** → <strong>、<span style="font-size:Xem"> → そのまま
function nl2br(str) {
  if (!str) return "";
  // 1) 画像はサポート対象外（gratitude には画像入力 UI が無いため）
  // 2) <span style="font-size:..em">...</span> を抜き出して保持
  // 3) **bold** を <strong> に変換
  // 4) その他はエスケープ
  return renderInlineFormatting(str).replace(/\n/g, "<br>");
}

function renderInlineFormatting(text) {
  if (!text) return "";
  const sizeRegex = /<span\s+style="font-size:\s*([0-9.]+)em\s*">([\s\S]*?)<\/span>/g;
  let result = "";
  let lastIndex = 0;
  let m;
  while ((m = sizeRegex.exec(text)) !== null) {
    result += renderBoldAndEscape(text.slice(lastIndex, m.index));
    const em = parseFloat(m[1]);
    const inner = m[2];
    if (!isNaN(em) && em > 0 && em !== 1.0) {
      result += `<span style="font-size:${em}em">${renderBoldAndEscape(inner)}</span>`;
    } else {
      result += renderBoldAndEscape(inner);
    }
    lastIndex = sizeRegex.lastIndex;
  }
  result += renderBoldAndEscape(text.slice(lastIndex));
  return result;
}

function renderBoldAndEscape(text) {
  if (!text) return "";
  const boldRegex = /\*\*([^\n*][^\n]*?)\*\*/g;
  let result = "";
  let lastIndex = 0;
  let m;
  while ((m = boldRegex.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, m.index));
    result += `<strong>${escapeHtml(m[1])}</strong>`;
    lastIndex = boldRegex.lastIndex;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

// textarea を内容に合わせて自動拡張
function autoResize(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// ===== レンダリング =====

function buildSkeleton() {
  return `
    <div class="gratitude-page">
      <div class="gr-header">
        <h1 class="gr-title"><span class="gr-title-icon">💗</span>ありがたいノート</h1>
        <p class="gr-subtitle">今、自分が恵まれている点・感謝できる対象を思いついた時に書き残す。</p>
      </div>

      <div class="gr-add-card card">
        <div
          id="gr-add-input"
          class="gr-add-input is-empty"
          contenteditable="true"
          spellcheck="false"
          data-placeholder="ありがたいと感じたことを書く…（例：今日も家族が元気でいてくれたこと、暖かい部屋で眠れること）"></div>
        <div class="gr-add-actions">
          <span class="gr-add-hint" id="gr-add-hint">Ctrl + Enter で追加</span>
          <button type="button" id="gr-add-btn" class="btn btn-primary btn-sm">
            <span class="gr-add-btn-icon">💗</span>追加する
          </button>
        </div>
      </div>

      <div id="gr-list-container" class="gr-list-container"></div>
    </div>
  `;
}

function renderList() {
  const container = document.getElementById("gr-list-container");
  if (!container) return;

  if (state.loading && state.items.length === 0) {
    container.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;
    return;
  }

  if (state.items.length === 0) {
    container.innerHTML = `
      <div class="empty-state gr-empty">
        <div class="icon">💗</div>
        <p>まだ何も書かれていません。<br>
           上の入力欄に、今ありがたいと感じたことを書いてみましょう。</p>
      </div>
    `;
    return;
  }

  // 新しい順のフラットなリスト。各エントリに日付バッジ（曜日付き）と時刻を表示。
  const rows = state.items.map((item) => buildEntryHTML(item)).join("");

  container.innerHTML = `<div class="gr-list">${rows}</div>`;
}

function buildEntryHTML(item) {
  const isEditing = state.editingId === item.id;
  const dateBadge = `<span class="gr-badge" title="${escapeAttr(formatDateTime(item.created_at))}">${escapeHtml(formatDateJa(item.created_at))}</span>`;
  const timeOnly = formatTime(item.created_at);

  if (isEditing) {
    return `
      <div class="gr-entry gr-entry-editing" data-id="${escapeAttr(item.id)}">
        <div class="gr-entry-meta">
          ${dateBadge}<span class="gr-time">${timeOnly}</span>
        </div>
        <div class="gr-edit-input" contenteditable="true" spellcheck="false" data-initial="${escapeAttr(encodeURIComponent(item.content || ""))}"></div>
        <div class="gr-entry-actions">
          <button type="button" class="btn btn-outline btn-sm" data-action="cancel-edit" data-id="${escapeAttr(item.id)}">キャンセル</button>
          <button type="button" class="btn btn-primary btn-sm" data-action="save-edit" data-id="${escapeAttr(item.id)}">保存</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="gr-entry" data-id="${escapeAttr(item.id)}">
      <div class="gr-entry-meta">
        ${dateBadge}<span class="gr-time">${timeOnly}</span>
        <span class="gr-spacer"></span>
        <button type="button" class="gr-icon-btn" data-action="edit" data-id="${escapeAttr(item.id)}" title="編集" aria-label="編集">✎</button>
        <button type="button" class="gr-icon-btn gr-icon-danger" data-action="delete" data-id="${escapeAttr(item.id)}" title="削除" aria-label="削除">×</button>
      </div>
      <div class="gr-entry-body">${nl2br(item.content)}</div>
    </div>
  `;
}

// ===== データ操作 =====

async function loadItems() {
  state.loading = true;
  try {
    state.items = await gratitudeApi.list();
  } catch (e) {
    showToast(`読み込みに失敗: ${e.message}`, "error");
    state.items = [];
  } finally {
    state.loading = false;
  }
}

async function submitAdd() {
  const input = document.getElementById("gr-add-input");
  if (!input) return;
  const content = readEditorMd(input);
  if (!content) {
    input.focus();
    return;
  }
  const btn = document.getElementById("gr-add-btn");
  if (btn) { btn.disabled = true; btn.textContent = "追加中..."; }
  try {
    await gratitudeApi.create(content);
    writeEditorMd(input, "");
    updateGratitudeEmptyClass(input);
    showToast("ありがたいノートに追加しました 💗", "success");
    await loadItems();
    renderList();
    input.focus();
  } catch (err) {
    showToast(`追加に失敗: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="gr-add-btn-icon">💗</span>追加する`;
    }
  }
}

function updateGratitudeEmptyClass(el) {
  if (!el) return;
  const hasContent = (el.textContent && el.textContent.trim() !== "") || el.querySelector("img");
  el.classList.toggle("is-empty", !hasContent);
}

async function saveEdit(id) {
  const wrap = document.querySelector(`.gr-entry[data-id="${CSS.escape(id)}"]`);
  if (!wrap) return;
  const ta = wrap.querySelector(".gr-edit-input");
  if (!ta) return;
  const content = readEditorMd(ta);
  if (!content) {
    ta.focus();
    return;
  }
  try {
    await gratitudeApi.update(id, content);
    state.editingId = null;
    showToast("更新しました", "success");
    await loadItems();
    renderList();
  } catch (err) {
    showToast(`更新に失敗: ${err.message}`, "error");
  }
}

async function deleteEntry(id) {
  if (!confirm("このありがたいノートを削除しますか？")) return;
  try {
    await gratitudeApi.delete(id);
    if (state.editingId === id) state.editingId = null;
    showToast("削除しました", "success");
    await loadItems();
    renderList();
  } catch (err) {
    showToast(`削除に失敗: ${err.message}`, "error");
  }
}

// ===== イベントバインド =====

function attachEvents() {
  const input = document.getElementById("gr-add-input");
  const btn = document.getElementById("gr-add-btn");

  if (input) {
    appendMarkdownToEditor(input, "");
    updateGratitudeEmptyClass(input);
    attachFloatingToolbar(input);
    input.addEventListener("input", () => updateGratitudeEmptyClass(input));
    // Ctrl+Enter / Cmd+Enter で追加（Enter 単体は改行のまま）
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitAdd();
      }
    });
  }
  btn?.addEventListener("click", submitAdd);

  // 一覧内の編集 / 削除 / 編集確定
  const listContainer = document.getElementById("gr-list-container");
  listContainer?.addEventListener("click", async (e) => {
    const actionBtn = e.target.closest("[data-action]");
    if (!actionBtn) return;
    const id = actionBtn.dataset.id;
    const action = actionBtn.dataset.action;
    if (!id || !action) return;

    if (action === "edit") {
      state.editingId = id;
      renderList();
      const ta = document.querySelector(`.gr-entry[data-id="${CSS.escape(id)}"] .gr-edit-input`);
      if (ta) {
        const initial = decodeURIComponent(ta.dataset.initial || "");
        appendMarkdownToEditor(ta, initial);
        ta.removeAttribute("data-initial");
        attachFloatingToolbar(ta);
        ta.focus();
        // カーソルを末尾に
        const range = document.createRange();
        range.selectNodeContents(ta);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else if (action === "cancel-edit") {
      state.editingId = null;
      renderList();
    } else if (action === "save-edit") {
      await saveEdit(id);
    } else if (action === "delete") {
      await deleteEntry(id);
    }
  });
}

// ===== エントリポイント =====

export async function renderGratitude() {
  const main = document.querySelector("main");
  state.editingId = null;
  main.innerHTML = buildSkeleton();
  attachEvents();
  await loadItems();
  renderList();
}
