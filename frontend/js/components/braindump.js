/**
 * ブレインダンプ コンポーネント
 * プレーンテキストのメモ帳。1日に複数メモ作成可能。
 * 日付切替（前日/翌日 + カレンダー）、自動保存、AIタイトル自動生成。
 */

import { braindumpApi } from "../api.js?v=20260424a";
import { showToast } from "../app.js?v=20260424a";

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

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
}

// ===== 状態管理 =====

let currentDate = today();
let entries = [];
let recentEntries = []; // 過去15日分のメモ
let editingEntryId = null;
let newAutoSaveTimer = null;
let newEntryId = null; // 新規メモが自動保存された後のエントリID
let calendarEntryDates = new Set();
let currentImages = []; // テキストとは別に管理する添付画像URLリスト

// ===== 画像とテキストの分離・結合ユーティリティ =====

const IMG_REGEX = /\n?!\[[^\]]*\]\([^)]+\)\n?/g;

/** content から画像マークダウンを抽出し、テキスト部分と画像URLリストに分離する */
function splitContentAndImages(content) {
  const images = [];
  const imgMatchRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = imgMatchRegex.exec(content)) !== null) {
    if (m[2]) images.push(m[2]);
  }
  const text = content.replace(IMG_REGEX, "\n").replace(/^\n+|\n+$/g, "");
  return { text, images };
}

/** テキストと画像URLリストを結合して保存用 content を生成する */
function buildContent(text, images) {
  let content = text.trim();
  if (images.length > 0) {
    content += "\n" + images.map(url => `![画像](${url})`).join("\n");
  }
  return content;
}

// ===== メインレンダー =====

export async function renderBraindump(date) {
  currentDate = date || today();
  newEntryId = null; // ページ遷移時にリセット
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
            <button class="btn btn-danger btn-sm" id="bd-delete-btn" style="display: none;">🗑 削除</button>
            <button class="btn btn-outline btn-sm" id="bd-summarize-btn">📝 MD要約</button>
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
          ${renderRecentEntries()}
        </div>
      </div>
    </div>
  `;

  attachEvents();
  renderCalendar();
}

// ===== エントリ一覧レンダリング =====

function renderRecentEntries() {
  if (recentEntries.length === 0) {
    return `
      <div class="empty-state" style="padding: 32px 0;">
        <div class="icon">📝</div>
        <p>過去15日間のメモはありません</p>
      </div>`;
  }

  // 日付ごとにグループ化（新しい日付順）
  const grouped = {};
  for (const entry of recentEntries) {
    const date = entry.date;
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(entry);
  }
  const sortedDates = Object.keys(grouped).sort().reverse();

  return sortedDates.map(date => {
    const dateEntries = grouped[date];
    const d = new Date(date + "T00:00:00");
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const dateLabel = `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
    const isToday = date === today();
    const badge = isToday ? ' <span class="braindump-today-badge">今日</span>' : '';

    const entriesHTML = dateEntries.map(entry => {
      const time = entry.created_at ? entry.created_at.slice(11, 16) : "";
      const cleanContent = entry.content.replace(IMG_REGEX, " ").trim();
      const title = entry.title || cleanContent.slice(0, 30).replace(/\n/g, " ");
      const preview = cleanContent.slice(0, 80).replace(/\n/g, " ");

      return `
        <div class="braindump-entry" data-id="${entry.id}" style="cursor: pointer;">
          <div class="braindump-entry-header">
            <span class="braindump-entry-title">${escapeHTML(title)}</span>
            <div class="braindump-entry-actions">
              <span class="braindump-entry-time">${time}</span>
              <button class="braindump-entry-delete" data-id="${entry.id}" title="削除">×</button>
            </div>
          </div>
          <div class="braindump-entry-preview">${escapeHTML(preview)}${entry.content.length > 80 ? '...' : ''}</div>
        </div>`;
    }).join("");

    return `
      <div class="braindump-date-group">
        <div class="braindump-date-group-header">${dateLabel}${badge}</div>
        ${entriesHTML}
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

  // テキストエリアの自動保存（2秒間入力停止で発火 — 新規/既存メモ共通）
  document.getElementById("bd-new-textarea")?.addEventListener("input", handleNewTextareaInput);

  // クリップボード画像の貼り付け対応
  document.getElementById("bd-new-textarea")?.addEventListener("paste", handlePasteImage);

  // マークダウン要約ボタン
  document.getElementById("bd-summarize-btn")?.addEventListener("click", summarizeContent);

  // フォーム内の削除ボタン
  document.getElementById("bd-delete-btn")?.addEventListener("click", async () => {
    const targetId = editingEntryId || newEntryId;
    if (!targetId) return;
    if (!confirm("このメモを削除しますか？")) return;
    await deleteEntry(targetId);
    resetToNewMode();
    showToast("削除しました");
  });

  // クリアボタン
  document.getElementById("bd-cancel-new-btn")?.addEventListener("click", () => {
    if (editingEntryId) {
      resetToNewMode();
    } else {
      newEntryId = null;
      currentImages = [];
      renderImagePreview();
      document.getElementById("bd-new-textarea").value = "";
      document.getElementById("bd-new-textarea")?.focus();
    }
  });

  // エントリ削除ボタン
  document.getElementById("bd-entries")?.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".braindump-entry-delete");
    if (deleteBtn) {
      e.stopPropagation();
      const entryId = deleteBtn.dataset.id;
      if (!entryId) return;
      if (!confirm("このメモを削除しますか？")) return;
      await deleteEntry(entryId);
      if (editingEntryId === entryId) {
        resetToNewMode();
      }
      showToast("削除しました");
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

    // 左側テキストエリアに内容を読み込み
    const textarea = document.getElementById("bd-new-textarea");
    if (!textarea) return;

    const { text, images } = splitContentAndImages(entry.content);
    textarea.value = text;
    currentImages = images;
    editingEntryId = entryId;
    newEntryId = null; // 新規メモのIDをリセット
    renderImagePreview();

    // 右カラムの該当エントリにアクティブ表示
    document.querySelectorAll(".braindump-entry").forEach(el => el.classList.remove("active"));
    entryEl.classList.add("active");

    // ヘッダーを編集モード表示に更新
    updateHeaderForEditing(entry);

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // 自動保存を既存メモ更新に切り替え
    if (newAutoSaveTimer) clearTimeout(newAutoSaveTimer);
    textarea.removeEventListener("input", handleNewTextareaInput);
    textarea.addEventListener("input", handleNewTextareaInput);
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

// ===== ヘッダーモード切替 =====

function updateHeaderForEditing(entry) {
  const title = entry.title || entry.content.slice(0, 30).replace(/\n/g, " ");
  const header = document.querySelector(".braindump-header");
  if (!header) return;
  header.innerHTML = `
    <h2 class="braindump-title" style="font-size: 1rem;">編集中: ${escapeHTML(title)}</h2>
    <button class="btn btn-outline btn-sm" id="bd-back-to-new-btn">＋ 新しいメモ</button>
  `;
  document.getElementById("bd-back-to-new-btn")?.addEventListener("click", resetToNewMode);

  // フォーム内の削除ボタンを表示
  const deleteBtn = document.getElementById("bd-delete-btn");
  if (deleteBtn) deleteBtn.style.display = "";
}

function resetToNewMode() {
  editingEntryId = null;
  newEntryId = null;
  const textarea = document.getElementById("bd-new-textarea");
  if (textarea) textarea.value = "";
  currentImages = [];
  renderImagePreview();

  // ヘッダーを元に戻す
  const header = document.querySelector(".braindump-header");
  if (header) {
    header.innerHTML = `
      <h2 class="braindump-title">ブレインダンプ</h2>
      <button class="btn btn-primary btn-sm" id="bd-new-btn">＋ 新しいメモ</button>
    `;
    document.getElementById("bd-new-btn")?.addEventListener("click", () => {
      document.getElementById("bd-new-textarea")?.focus();
    });
  }

  // フォーム内の削除ボタンを非表示
  const deleteBtn = document.getElementById("bd-delete-btn");
  if (deleteBtn) deleteBtn.style.display = "none";

  // 右カラムのアクティブ表示を解除
  document.querySelectorAll(".braindump-entry").forEach(el => el.classList.remove("active"));

  textarea?.focus();
}

function handleNewTextareaInput() {
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
  const textarea = document.getElementById("bd-new-textarea");
  if (!textarea) return;
  const content = buildContent(textarea.value, currentImages);
  if (!content) return;

  try {
    const updated = await braindumpApi.update(entryId, content);
    // recentEntries を更新
    const idx = recentEntries.findIndex(e => e.id === entryId);
    if (idx >= 0 && updated) {
      recentEntries[idx] = updated;
    }
    // 右カラムの一覧を再描画（アクティブ状態を維持）
    const container = document.getElementById("bd-entries");
    if (container) {
      container.innerHTML = renderRecentEntries();
      // アクティブ状態を再適用
      const activeEl = container.querySelector(`.braindump-entry[data-id="${entryId}"]`);
      if (activeEl) activeEl.classList.add("active");
    }
  } catch {
    // 自動保存失敗は静かに無視
  }
}

// ===== CRUD操作 =====

async function summarizeContent() {
  const textarea = document.getElementById("bd-new-textarea");
  const content = textarea.value.trim();
  if (!content) {
    showToast("要約する内容を入力してください", "error");
    return;
  }

  const btn = document.getElementById("bd-summarize-btn");
  const origText = btn.textContent;
  btn.textContent = "要約中...";
  btn.disabled = true;

  try {
    const result = await braindumpApi.summarize(content);
    textarea.value = result.summary;
    textarea.focus();
    // 自動保存タイマーをリセット（編集中メモ対応）
    if (newAutoSaveTimer) clearTimeout(newAutoSaveTimer);
    newAutoSaveTimer = setTimeout(() => {
      if (editingEntryId) {
        autoSaveExistingEntry(editingEntryId);
      } else {
        autoSaveNewEntry();
      }
    }, 2000);
  } catch (e) {
    showToast(`要約に失敗しました: ${e.message}`, "error");
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

async function saveNewEntry() {
  const textarea = document.getElementById("bd-new-textarea");
  const content = buildContent(textarea.value, currentImages);
  if (!content) return;

  try {
    if (editingEntryId) {
      // 既存メモの上書き保存
      await braindumpApi.update(editingEntryId, content);
      showToast("保存しました");
      resetToNewMode();
    } else if (newEntryId) {
      // 既に自動保存済みのエントリがあれば更新
      await braindumpApi.update(newEntryId, content);
      newEntryId = null;
      currentImages = [];
      renderImagePreview();
      textarea.value = "";
      textarea.focus();
    } else {
      await braindumpApi.create(currentDate, content);
      newEntryId = null;
      currentImages = [];
      renderImagePreview();
      textarea.value = "";
      textarea.focus();
    }
    entries = await braindumpApi.listByDate(currentDate) || [];
    refreshEntries();
    calendarEntryDates.add(currentDate);
    renderCalendar();
  } catch (e) {
    showToast(`保存に失敗しました: ${e.message}`, "error");
  }
}

async function autoSaveNewEntry() {
  const textarea = document.getElementById("bd-new-textarea");
  if (!textarea) return;

  const content = buildContent(textarea.value, currentImages);
  if (!content) return;

  try {
    if (newEntryId) {
      // 既に作成済み → 更新
      await braindumpApi.update(newEntryId, content);
    } else {
      // 初回 → 新規作成してIDを保持
      const created = await braindumpApi.create(currentDate, content);
      if (created && created.id) {
        newEntryId = created.id;
      }
      calendarEntryDates.add(currentDate);
      renderCalendar();
    }
    // 右カラムの一覧も更新
    entries = await braindumpApi.listByDate(currentDate) || [];
    refreshEntries();
  } catch {
    // 自動保存失敗は静かに無視
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

async function refreshEntries() {
  // 過去15日分も再取得
  try {
    recentEntries = await braindumpApi.list(daysAgo(14), today()) || [];
  } catch {
    // 失敗時は既存データを維持
  }
  const container = document.getElementById("bd-entries");
  if (container) {
    container.innerHTML = renderRecentEntries();
  }
}

// ===== クリップボード画像貼り付け =====

async function handlePasteImage(e) {
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
  // 2) files になければ items をインデックスで走査（for...of は DataTransferItemList 非対応環境がある）
  if (!file && clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        file = item.getAsFile();
        break;
      }
    }
  }

  if (!file) return;

  e.preventDefault();

  const textarea = document.getElementById("bd-new-textarea");
  if (!textarea) return;

  // プレビューエリアに一時表示
  const tempUrl = URL.createObjectURL(file);
  currentImages.push(tempUrl);
  renderImagePreview();

  try {
    const result = await braindumpApi.uploadImage(file);
    // 一時URLを実際のURLに差し替え
    const idx = currentImages.indexOf(tempUrl);
    if (idx >= 0) currentImages[idx] = result.url;
    renderImagePreview();
    // 即座に保存
    if (editingEntryId) {
      await autoSaveExistingEntry(editingEntryId);
    } else {
      await autoSaveNewEntry();
    }
    showToast("画像を貼り付けました");
  } catch (err) {
    // アップロード失敗時は一時URLを除去
    const idx = currentImages.indexOf(tempUrl);
    if (idx >= 0) currentImages.splice(idx, 1);
    renderImagePreview();
    showToast(`画像アップロードに失敗しました: ${err.message}`, "error");
  }

  URL.revokeObjectURL(tempUrl);
}

function renderImagePreview() {
  let container = document.getElementById("bd-image-preview");
  if (!container) {
    const form = document.getElementById("bd-new-form");
    if (!form) return;
    container = document.createElement("div");
    container.id = "bd-image-preview";
    container.className = "braindump-image-preview";
    const actions = form.querySelector(".braindump-form-actions");
    if (actions) {
      form.insertBefore(container, actions);
    } else {
      form.appendChild(container);
    }
  }

  if (currentImages.length === 0) {
    container.innerHTML = "";
    container.style.display = "none";
    return;
  }

  container.style.display = "flex";
  container.innerHTML = currentImages.map((url, i) => `
    <div class="braindump-image-thumb" data-index="${i}">
      <img src="${escapeHTML(url)}" alt="添付画像" loading="lazy" />
      <button class="braindump-image-remove" data-index="${i}" title="画像を削除">×</button>
    </div>
  `).join("");

  // 削除ボタン
  container.querySelectorAll(".braindump-image-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index);
      currentImages.splice(idx, 1);
      renderImagePreview();
      // 即座に保存して反映
      if (editingEntryId) {
        autoSaveExistingEntry(editingEntryId);
      } else if (newEntryId) {
        autoSaveNewEntry();
      }
    });
  });

  // サムネイルクリックでフルサイズ表示
  container.querySelectorAll(".braindump-image-thumb img").forEach(img => {
    img.addEventListener("click", () => {
      window.open(img.src, "_blank");
    });
  });
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
