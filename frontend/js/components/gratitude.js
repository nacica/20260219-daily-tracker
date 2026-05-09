/**
 * ありがたいノート画面
 *
 * 「今自分が恵まれている点 / 感謝できる対象」を思いついた時にその都度書き残す。
 * 複数行 textarea + 追加ボタン → 新しい順フラットリスト（日付バッジ付き）。
 * 各エントリは編集・削除可能。
 */

import { gratitudeApi } from "../api.js?v=20260509b";
import { showToast } from "../app.js?v=20260509b";

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

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = WEEKDAYS[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day}（${w}） ${hh}:${mm}`;
}

function formatDateOnly(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function dateKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 内容を表示用に改行を <br> に変換（HTMLエスケープ後）
function nl2br(str) {
  return escapeHtml(str).replace(/\n/g, "<br>");
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
        <textarea
          id="gr-add-input"
          class="gr-add-input"
          rows="3"
          maxlength="2000"
          placeholder="ありがたいと感じたことを書く…&#10;（例：今日も家族が元気でいてくれたこと、暖かい部屋で眠れること）"></textarea>
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

  // 「今日 / 昨日 / 1週間以内 / それ以前」の簡易セパレータを挟みたいが、
  // 仕様は「新しい順のフラットなリスト（日付バッジ付き）」なのでフラットに描画。
  // 連続して同じ日付の場合はバッジを少し控えめにする（視覚ノイズ削減）。
  let prevKey = null;
  const rows = state.items.map((item) => {
    const k = dateKey(item.created_at);
    const sameAsPrev = k && k === prevKey;
    prevKey = k;
    return buildEntryHTML(item, sameAsPrev);
  }).join("");

  container.innerHTML = `<div class="gr-list">${rows}</div>`;
}

function buildEntryHTML(item, sameDateAsPrev) {
  const isEditing = state.editingId === item.id;
  const dateBadge = sameDateAsPrev
    ? `<span class="gr-badge gr-badge-dim" title="${escapeAttr(formatDateTime(item.created_at))}">同じ日</span>`
    : `<span class="gr-badge" title="${escapeAttr(formatDateTime(item.created_at))}">${escapeHtml(formatDateOnly(item.created_at))}</span>`;
  const timeOnly = (() => {
    const d = new Date(item.created_at);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  })();

  if (isEditing) {
    return `
      <div class="gr-entry gr-entry-editing" data-id="${escapeAttr(item.id)}">
        <div class="gr-entry-meta">
          ${dateBadge}<span class="gr-time">${timeOnly}</span>
        </div>
        <textarea class="gr-edit-input" rows="3" maxlength="2000">${escapeHtml(item.content)}</textarea>
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
  const content = input.value.trim();
  if (!content) {
    input.focus();
    return;
  }
  const btn = document.getElementById("gr-add-btn");
  if (btn) { btn.disabled = true; btn.textContent = "追加中..."; }
  try {
    await gratitudeApi.create(content);
    input.value = "";
    autoResize(input);
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

async function saveEdit(id) {
  const wrap = document.querySelector(`.gr-entry[data-id="${CSS.escape(id)}"]`);
  if (!wrap) return;
  const ta = wrap.querySelector(".gr-edit-input");
  if (!ta) return;
  const content = ta.value.trim();
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
    autoResize(input);
    input.addEventListener("input", () => autoResize(input));
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
        autoResize(ta);
        ta.focus();
        // カーソルを末尾に
        try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {}
        ta.addEventListener("input", () => autoResize(ta));
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
