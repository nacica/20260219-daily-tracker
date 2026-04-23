/**
 * スクリーンショットアップロードコンポーネント
 * iPhone のスクリーンタイム画像をアップロードして OCR 処理する
 */

import { showToast } from "../app.js?v=20260424b";

const API_BASE = window.API_BASE_URL || "http://localhost:8000/api/v1";

/**
 * スクリーンショットアップロード UI を指定コンテナに描画する
 * @param {string} date - 対象日 (YYYY-MM-DD)
 * @param {HTMLElement} container - 描画先のコンテナ要素
 * @param {Function} onSuccess - OCR 成功時のコールバック (screenTimeData) => void
 */
export function renderScreenshotUpload(date, container, onSuccess) {
  container.innerHTML = buildUploadHTML();
  attachUploadEvents(date, container, onSuccess);
}

function buildUploadHTML() {
  return `
    <div class="upload-area" id="upload-area">
      <input
        type="file"
        id="screenshot-input"
        accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
        style="display:none"
      />
      <div class="upload-placeholder" id="upload-placeholder">
        <div style="font-size: 2rem; margin-bottom: 8px;">📱</div>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px;">
          iPhoneのスクリーンタイム画面を<br>タップしてアップロード
        </p>
        <button class="btn btn-outline btn-sm" id="btn-select-file">
          画像を選択
        </button>
      </div>
      <div id="upload-preview" style="display:none;">
        <img id="preview-img" style="max-width:100%; border-radius:8px; margin-bottom:12px;" />
        <div style="display:flex; gap:8px;">
          <button class="btn btn-primary btn-sm" id="btn-upload" style="flex:1;">
            📤 OCR解析する
          </button>
          <button class="btn btn-outline btn-sm" id="btn-reset-upload">
            やり直す
          </button>
        </div>
      </div>
      <div id="ocr-result" style="display:none;"></div>
    </div>`;
}

function attachUploadEvents(date, container, onSuccess) {
  const input = container.querySelector("#screenshot-input");
  const area = container.querySelector("#upload-area");
  const placeholder = container.querySelector("#upload-placeholder");
  const preview = container.querySelector("#upload-preview");
  const previewImg = container.querySelector("#preview-img");

  // ファイル選択ボタン
  container.querySelector("#btn-select-file").addEventListener("click", () => input.click());

  // ドラッグ&ドロップ
  area.addEventListener("dragover", (e) => {
    e.preventDefault();
    area.style.borderColor = "var(--accent)";
  });
  area.addEventListener("dragleave", () => {
    area.style.borderColor = "var(--border)";
  });
  area.addEventListener("drop", (e) => {
    e.preventDefault();
    area.style.borderColor = "var(--border)";
    const file = e.dataTransfer.files[0];
    if (file) showPreview(file);
  });

  // ファイル選択
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (file) showPreview(file);
  });

  // プレビューリセット
  container.querySelector("#btn-reset-upload").addEventListener("click", () => {
    input.value = "";
    placeholder.style.display = "";
    preview.style.display = "none";
    container.querySelector("#ocr-result").style.display = "none";
  });

  // アップロード & OCR
  container.querySelector("#btn-upload").addEventListener("click", async (e) => {
    const file = input.files[0];
    if (!file) return;
    await uploadAndOcr(date, file, e.target, container, onSuccess);
  });

  function showPreview(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      previewImg.src = ev.target.result;
      placeholder.style.display = "none";
      preview.style.display = "";
    };
    reader.readAsDataURL(file);
    // input に file をセット
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  }
}

async function uploadAndOcr(date, file, btn, container, onSuccess) {
  btn.disabled = true;
  btn.textContent = "解析中...";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch(`${API_BASE}/screenshots/${date}`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    showOcrResult(container, data.screen_time);
    showToast("スクリーンタイムを読み取りました！", "success");
    if (onSuccess) onSuccess(data.screen_time);
  } catch (err) {
    showToast(`アップロードに失敗しました: ${err.message}`, "error");
    btn.disabled = false;
    btn.textContent = "📤 OCR解析する";
  }
}

function showOcrResult(container, screenTime) {
  const resultEl = container.querySelector("#ocr-result");
  container.querySelector("#upload-preview").style.display = "none";

  const apps = screenTime.apps || [];
  const total = screenTime.total_screen_time_minutes || 0;
  const confidence = screenTime.extraction_confidence || "unknown";
  const confidenceLabel = { high: "高", medium: "中", low: "低" }[confidence] || confidence;

  resultEl.style.display = "";
  resultEl.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
      <span style="font-size:0.85rem; font-weight:600; color:var(--text-muted);">
        解析結果 <span class="badge badge-cat">信頼度: ${confidenceLabel}</span>
      </span>
      <span style="font-size:0.85rem; color:var(--text-muted);">
        合計: ${Math.floor(total / 60)}h${total % 60}m
      </span>
    </div>
    <ul style="list-style:none; display:flex; flex-direction:column; gap:6px;">
      ${apps.map((app) => {
        const h = Math.floor(app.duration_minutes / 60);
        const m = app.duration_minutes % 60;
        const pct = total > 0 ? Math.round((app.duration_minutes / total) * 100) : 0;
        return `
          <li style="display:flex; align-items:center; gap:10px;">
            <span style="flex:1; font-size:0.88rem;">${esc(app.name)}</span>
            <div style="width:80px; background:var(--bg-primary); border-radius:4px; height:6px; overflow:hidden;">
              <div style="width:${pct}%; height:100%; background:var(--accent); border-radius:4px;"></div>
            </div>
            <span style="font-size:0.82rem; color:var(--text-muted); min-width:50px; text-align:right;">
              ${h > 0 ? `${h}h` : ""}${m}m
            </span>
          </li>`;
      }).join("")}
    </ul>
    <button class="btn btn-outline btn-sm" style="margin-top:12px; width:100%;" id="btn-re-upload">
      別の画像でやり直す
    </button>`;

  resultEl.querySelector("#btn-re-upload").addEventListener("click", () => {
    resultEl.style.display = "none";
    container.querySelector("#upload-placeholder").style.display = "";
    const input = container.querySelector("#screenshot-input");
    if (input) input.value = "";
  });
}

function esc(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
