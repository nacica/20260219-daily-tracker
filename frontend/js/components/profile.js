/**
 * 取扱説明書（自分の取扱説明書）画面 #/profile
 *
 * Claude（MCP 連携）が会話の最初に読む前提資料を作る画面。
 *   - 左（スマホでは上）: 確定版 content の編集エリア（書式ツールバー付き、1.5 秒で自動保存）
 *   - 右（スマホでは下）: AI 下書き draft の表示と「AI で下書きを生成」「下書きを採用」
 * 下書きは確定版を上書きしない。「下書きを採用」で確定版に流し込んでから手直しする。
 */

import { profileApi } from "../api.js?v=20261021b";
import { showToast } from "../app.js?v=20261021b";
import {
  attachFloatingToolbar,
  appendMarkdownToEditor,
  serializeEditorMarkdown,
} from "../floating-toolbar.js?v=20261021b";
import { renderStickyMd, addMdRefreshHook } from "./michishirube.js?v=20261021b";

const state = {
  content: "",
  draft: "",
  generated_at: null,
  edited_at: null,
  source_range: null,
  saving: false,
  dirty: false,
};

let saveTimer = null;

function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 前回の AI 生成から 30 日以上経っているか（未生成も true） */
export function isProfileStale(generatedAt) {
  if (!generatedAt) return true;
  const t = new Date(generatedAt).getTime();
  return Number.isNaN(t) || Date.now() - t > 30 * 24 * 60 * 60 * 1000;
}

function buildHTML() {
  const stale = isProfileStale(state.generated_at);
  return `
    <div class="profile-page">
      <div class="profile-header">
        <h1 class="profile-title">📘 取扱説明書</h1>
        <p class="profile-subtitle">Claude がユーザー個人に関わる相談の最初に読む「自分の取扱説明書」。AI が記録から下書きを作り、手直しして確定します。</p>
      </div>
      ${stale ? `<div class="profile-banner" id="profile-stale-banner">
        ${state.generated_at ? `前回の AI 下書きから 30 日以上経っています（${fmtDateTime(state.generated_at)}）。` : "AI 下書きはまだ生成されていません。"}
        右の「AI で下書きを生成」で最新の記録を反映できます。
      </div>` : ""}
      <div class="profile-grid">
        <section class="card profile-card">
          <div class="card-title"><span class="card-title-text">確定版（Claude に渡す内容）</span></div>
          <div class="profile-status" id="profile-status">${state.edited_at ? `最終編集 ${fmtDateTime(state.edited_at)}` : "未作成"}</div>
          <div id="profile-editor" class="journal-textarea profile-editor" contenteditable="true" spellcheck="false"
               data-placeholder="ここに取扱説明書を書く（右の AI 下書きを採用して手直しするのが早い）"></div>
          <p class="profile-hint">入力が止まって 1.5 秒で自動保存します。範囲選択で太字・赤字・文字サイズを変えられます。</p>
        </section>
        <section class="card profile-card">
          <div class="card-title"><span class="card-title-text">AI 下書き</span></div>
          <div class="profile-draft-actions">
            <button class="btn btn-primary btn-sm" id="profile-generate-btn">✨ AI で下書きを生成</button>
            <button class="btn btn-outline btn-sm" id="profile-adopt-btn" ${state.draft ? "" : "disabled"}>⬅ 下書きを採用</button>
          </div>
          <div class="profile-status">${state.generated_at ? `生成 ${fmtDateTime(state.generated_at)}${state.source_range ? `（対象 ${escapeHTML(state.source_range.start)} 〜 ${escapeHTML(state.source_range.end)}）` : ""}` : "まだ生成していません"}</div>
          <div class="profile-draft sticky-text sticky-text-md" id="profile-draft">${state.draft ? renderStickyMd(state.draft) : '<p class="sticky-empty">「AI で下書きを生成」を押すと、直近 3 か月の月次サマリー・12 週の週次分析・やりたいこと・道しるべ・トレードメモのラベルから下書きを作ります（非公開の記録は使いません）。</p>'}</div>
        </section>
      </div>
    </div>
  `;
}

function readEditor() {
  const el = document.getElementById("profile-editor");
  return el ? serializeEditorMarkdown(el).trim() : "";
}

function setStatus(text) {
  const el = document.getElementById("profile-status");
  if (el) el.textContent = text;
}

async function saveNow() {
  if (state.saving) { state.dirty = true; return; }
  const content = readEditor();
  if (content === state.content) return;
  state.saving = true;
  setStatus("保存中…");
  try {
    const res = await profileApi.save(content);
    state.content = res.content || content;
    state.edited_at = res.edited_at;
    setStatus(`保存しました ${fmtDateTime(state.edited_at)}`);
  } catch (err) {
    setStatus("保存に失敗しました（入力は残っています）");
    showToast(`保存に失敗: ${err.message}`, "error");
  } finally {
    state.saving = false;
    if (state.dirty) { state.dirty = false; saveNow(); }
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
}

function attachEvents() {
  const editor = document.getElementById("profile-editor");
  if (editor) {
    appendMarkdownToEditor(editor, state.content || "");
    attachFloatingToolbar(editor);
    editor.addEventListener("input", scheduleSave);
    editor.addEventListener("blur", () => { clearTimeout(saveTimer); saveNow(); });
  }

  document.getElementById("profile-generate-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "生成中…（30 秒ほどかかります）";
    try {
      const res = await profileApi.generate();
      Object.assign(state, { draft: res.draft || "", generated_at: res.generated_at, source_range: res.source_range });
      showToast("下書きを生成しました。内容を確認して「下書きを採用」で確定版に流し込めます", "success");
      render();
    } catch (err) {
      showToast(`生成に失敗: ${err.message}`, "error");
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  document.getElementById("profile-adopt-btn")?.addEventListener("click", async () => {
    if (!state.draft) return;
    const current = readEditor();
    if (current && !confirm("確定版を下書きの内容で置き換えます。よろしいですか？（置き換え後も手直しできます）")) return;
    const ed = document.getElementById("profile-editor");
    if (!ed) return;
    ed.innerHTML = "";
    appendMarkdownToEditor(ed, state.draft);
    clearTimeout(saveTimer);
    await saveNow();
    showToast("下書きを確定版に採用しました", "success");
  });
}

function render() {
  const main = document.querySelector("main");
  if (!main) return;
  main.innerHTML = buildHTML();
  attachEvents();
}

addMdRefreshHook(() => {
  const el = document.getElementById("profile-draft");
  if (el && state.draft) el.innerHTML = renderStickyMd(state.draft);
});

export async function renderProfile() {
  const main = document.querySelector("main");
  if (!main) return;
  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;
  try {
    const res = await profileApi.get();
    Object.assign(state, {
      content: res.content || "",
      draft: res.draft || "",
      generated_at: res.generated_at || null,
      edited_at: res.edited_at || null,
      source_range: res.source_range || null,
    });
  } catch (err) {
    showToast(`読み込みに失敗: ${err.message}`, "error");
  }
  render();
}
