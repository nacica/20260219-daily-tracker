/**
 * ブレインダンプ コンポーネント
 * プレーンテキストのメモ帳。1日に複数メモ作成可能。
 * 日付切替（前日/翌日 + カレンダー）、自動保存、AIタイトル自動生成。
 */

import { braindumpApi } from "../api.js?v=20260323m";
import { showToast } from "../app.js?v=20260323m";

// ===== ユーティリティ =====

function today() {
  return new Date().toLocaleDateString("sv-SE");
}

function formatDateJP(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getFullYear()}年<br>${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

function prevDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("sv-SE");
}

function nextDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("sv-SE");
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ===== 状態管理 =====

let currentDate = today();
let entries = [];
let editingEntryId = null;
let autoSaveTimer = null;
let calendarEntryDates = new Set();

// ===== メインレンダー =====

export async function renderBraindump(date) {
  currentDate = date || today();
  const main = document.querySelector("main");
  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;

  try {
    entries = await braindumpApi.listByDate(currentDate) || [];
  } catch {
    entries = [];
  }

  main.innerHTML = `
    <div class="braindump-container">
      <!-- 左カラム: 入力エリア (7) -->
      <div class="braindump-left">
        <div class="braindump-header">
          <h2 class="braindump-title">ブレインダンプ</h2>
          <button class="btn btn-primary btn-sm" id="bd-new-btn">＋ 新しいメモ</button>
        </div>
        <div class="braindump-new-form" id="bd-new-form">
          <textarea class="braindump-textarea" id="bd-new-textarea" placeholder="思いついたことを自由に書き出してください..." rows="18"></textarea>
          <div class="braindump-form-actions">
            <button class="btn btn-primary btn-sm" id="bd-save-new-btn">保存</button>
            <button class="btn btn-outline btn-sm" id="bd-cancel-new-btn">クリア</button>
          </div>
        </div>
      </div>

      <!-- 右カラム: カレンダー + メモ一覧 (3) -->
      <div class="braindump-right">
        <div class="braindump-date-area">
          <div class="braindump-date-nav">
            <button class="btn btn-outline btn-sm" id="bd-prev-date">← 前日</button>
            <button class="braindump-date-label" id="bd-date-label">${formatDateJP(currentDate)}</button>
            <button class="btn btn-outline btn-sm" id="bd-next-date"${currentDate >= today() ? ' disabled' : ''}>翌日 →</button>
          </div>
          <div class="braindump-calendar" id="bd-calendar"></div>
        </div>
        <div class="braindump-entries" id="bd-entries">
          ${renderEntries()}
        </div>
      </div>
    </div>
  `;

  attachEvents();
  renderCalendar();
}

// ===== エントリ一覧レンダリング =====

function renderEntries() {
  if (entries.length === 0) {
    return `
      <div class="empty-state" style="padding: 32px 0;">
        <div class="icon">📝</div>
        <p>この日のメモはまだありません</p>
      </div>`;
  }

  return entries.map(entry => {
    const isEditing = editingEntryId === entry.id;
    const time = entry.created_at ? entry.created_at.slice(11, 16) : "";
    const title = entry.title || entry.content.slice(0, 30).replace(/\n/g, " ");
    const preview = entry.content.slice(0, 80).replace(/\n/g, " ");

    if (isEditing) {
      return `
        <div class="braindump-entry editing" data-id="${entry.id}">
          <textarea class="braindump-textarea" id="bd-edit-textarea" rows="8">${escapeHTML(entry.content)}</textarea>
          <div class="braindump-form-actions">
            <button class="btn btn-outline btn-sm bd-close-edit-btn">閉じる</button>
            <button class="btn btn-danger btn-sm bd-delete-btn" data-id="${entry.id}">削除</button>
          </div>
        </div>`;
    }

    return `
      <div class="braindump-entry" data-id="${entry.id}">
        <div class="braindump-entry-header">
          <span class="braindump-entry-title">${escapeHTML(title)}</span>
          <span class="braindump-entry-time">${time}</span>
        </div>
        <div class="braindump-entry-preview">${escapeHTML(preview)}${entry.content.length > 80 ? '...' : ''}</div>
      </div>`;
  }).join("");
}

// ===== イベントハンドリング =====

function attachEvents() {
  const main = document.querySelector("main");

  // 新しいメモボタン（テキストエリアにフォーカス）
  document.getElementById("bd-new-btn")?.addEventListener("click", () => {
    document.getElementById("bd-new-textarea")?.focus();
  });

  // ページ表示時に自動フォーカス
  setTimeout(() => {
    document.getElementById("bd-new-textarea")?.focus();
  }, 100);

  // 新規保存
  document.getElementById("bd-save-new-btn")?.addEventListener("click", saveNewEntry);

  // クリアボタン
  document.getElementById("bd-cancel-new-btn")?.addEventListener("click", () => {
    document.getElementById("bd-new-textarea").value = "";
    document.getElementById("bd-new-textarea")?.focus();
  });

  // エントリクリック（展開/編集）
  document.getElementById("bd-entries")?.addEventListener("click", (e) => {
    const entryEl = e.target.closest(".braindump-entry");
    if (!entryEl) return;

    // 閉じるボタン
    if (e.target.closest(".bd-close-edit-btn")) {
      editingEntryId = null;
      refreshEntries();
      return;
    }

    // 削除ボタン
    if (e.target.closest(".bd-delete-btn")) {
      const id = e.target.closest(".bd-delete-btn").dataset.id;
      deleteEntry(id);
      return;
    }

    // 編集中でなければ展開
    if (!entryEl.classList.contains("editing")) {
      editingEntryId = entryEl.dataset.id;
      refreshEntries();
      // 自動保存設定
      setTimeout(() => {
        const textarea = document.getElementById("bd-edit-textarea");
        if (textarea) {
          textarea.addEventListener("input", () => scheduleAutoSave(entryEl.dataset.id));
          textarea.focus();
          textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }
      }, 50);
    }
  });

  // 日付ナビゲーション
  document.getElementById("bd-prev-date")?.addEventListener("click", () => {
    window.location.hash = `/braindump/${prevDate(currentDate)}`;
  });

  document.getElementById("bd-next-date")?.addEventListener("click", () => {
    if (currentDate < today()) {
      window.location.hash = `/braindump/${nextDate(currentDate)}`;
    }
  });

  // 日付ラベルクリックでカレンダー表示/非表示
  document.getElementById("bd-date-label")?.addEventListener("click", () => {
    const cal = document.getElementById("bd-calendar");
    cal.style.display = cal.style.display === "none" ? "block" : "none";
  });
}

// ===== CRUD操作 =====

async function saveNewEntry() {
  const textarea = document.getElementById("bd-new-textarea");
  const content = textarea.value.trim();
  if (!content) return;

  try {
    await braindumpApi.create(currentDate, content);
    textarea.value = "";
    textarea.focus();
    entries = await braindumpApi.listByDate(currentDate) || [];
    refreshEntries();
    // カレンダーのマーク更新
    calendarEntryDates.add(currentDate);
    renderCalendar();
  } catch (e) {
    showToast(`保存に失敗しました: ${e.message}`, "error");
  }
}

function scheduleAutoSave(entryId) {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => autoSaveEntry(entryId), 2000);
}

async function autoSaveEntry(entryId) {
  const textarea = document.getElementById("bd-edit-textarea");
  if (!textarea) return;

  const content = textarea.value.trim();
  if (!content) return;

  try {
    const updated = await braindumpApi.update(entryId, content);
    // ローカルの entries を更新
    const idx = entries.findIndex(e => e.id === entryId);
    if (idx >= 0 && updated) {
      entries[idx] = updated;
    }
  } catch (e) {
    // 自動保存失敗は静かに無視（次回に再トライ）
  }
}

async function deleteEntry(entryId) {
  try {
    await braindumpApi.delete(entryId);
    editingEntryId = null;
    entries = entries.filter(e => e.id !== entryId);
    refreshEntries();
    if (entries.length === 0) {
      calendarEntryDates.delete(currentDate);
      renderCalendar();
    }
  } catch (e) {
    showToast(`削除に失敗しました: ${e.message}`, "error");
  }
}

function refreshEntries() {
  const container = document.getElementById("bd-entries");
  if (container) {
    container.innerHTML = renderEntries();
  }
}

// ===== カレンダー =====

let calYear, calMonth;

async function renderCalendar() {
  const cal = document.getElementById("bd-calendar");
  if (!cal) return;

  const d = new Date(currentDate + "T00:00:00");
  calYear = d.getFullYear();
  calMonth = d.getMonth();

  await fetchEntryDates(calYear, calMonth);
  cal.innerHTML = buildCalendarHTML(calYear, calMonth);
  cal.style.display = "block";

  // カレンダーイベント
  cal.addEventListener("click", async (e) => {
    e.stopPropagation();

    const navBtn = e.target.closest(".cal-nav-btn");
    if (navBtn) {
      const dir = parseInt(navBtn.dataset.dir);
      calMonth += dir;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      if (calMonth > 11) { calMonth = 0; calYear++; }
      await fetchEntryDates(calYear, calMonth);
      cal.innerHTML = buildCalendarHTML(calYear, calMonth);
      return;
    }

    const dayEl = e.target.closest(".cal-day");
    if (dayEl && !dayEl.classList.contains("future") && !dayEl.classList.contains("other-month")) {
      const date = dayEl.dataset.date;
      if (date) {
        window.location.hash = `/braindump/${date}`;
      }
    }
  });
}

async function fetchEntryDates(year, month) {
  try {
    const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const res = await braindumpApi.datesWithEntries(startDate, endDate);
    calendarEntryDates = new Set(res.dates || []);
  } catch {
    calendarEntryDates = new Set();
  }
}

function buildCalendarHTML(year, month) {
  const todayStr = today();
  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let days = "";

  // 前月の余白
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    days += `<div class="cal-day other-month">${d}</div>`;
  }

  // 今月
  const todayDate = new Date();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isFuture = new Date(year, month, d) > todayDate;
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === currentDate;
    const hasEntry = calendarEntryDates.has(dateStr);
    const classes = ["cal-day"];
    if (isToday) classes.push("today");
    if (isFuture) classes.push("future");
    if (isSelected) classes.push("selected");
    if (hasEntry) classes.push("has-record");
    days += `<div class="${classes.join(" ")}" data-date="${dateStr}">${d}</div>`;
  }

  // 次月の余白
  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remaining; d++) {
    days += `<div class="cal-day other-month future">${d}</div>`;
  }

  return `
    <div class="cal-header">
      <button class="cal-nav-btn" data-dir="-1">◀</button>
      <span class="cal-header-title">${year}年 ${monthNames[month]}</span>
      <button class="cal-nav-btn" data-dir="1">▶</button>
    </div>
    <div class="cal-weekdays">
      <span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>
    </div>
    <div class="cal-days">${days}</div>
  `;
}
