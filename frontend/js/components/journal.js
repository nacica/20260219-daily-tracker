/**
 * フリージャーナル コンポーネント
 * 1日に複数エントリ作成可能。各エントリに独立した分析・MD要約。
 */

import { journalApi, diaryDialogueApi } from "../api.js?v=20260321d";
import { showToast } from "../app.js?v=20260321d";

// ===== ユーティリティ =====

function renderMd(text) {
  if (!text || typeof text !== "string") return "";
  const m = window.marked;
  if (m) {
    if (typeof m.parse === "function") return m.parse(text);
    if (m.marked && typeof m.marked.parse === "function") return m.marked.parse(text);
    if (typeof m === "function") return m(text);
  }
  return text.replace(/\n/g, "<br>");
}

function formatDateJP(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

function today() {
  return new Date().toLocaleDateString("sv-SE");
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

function getWeekId(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function emotionValence(tag) {
  const positive = ["充実感", "やる気", "達成感", "感謝", "楽しさ", "安心", "集中"];
  const negative = ["焦り", "不安", "イライラ", "悲しみ", "孤独感"];
  if (positive.includes(tag)) return "positive";
  if (negative.includes(tag)) return "negative";
  return "neutral";
}

function moodRank(score) {
  if (score >= 65) return "good";
  if (score >= 40) return "mid";
  return "bad";
}

function getMonthStart(dateStr) {
  return dateStr.slice(0, 8) + "01";
}

/** エントリIDから時刻ラベルを生成 */
function entryLabel(entry) {
  const n = entry.entry_number || 1;
  const time = entry.created_at ? entry.created_at.slice(11, 16) : "";
  return time ? `#${n}（${time}）` : `#${n}`;
}

// ===== メインレンダー =====

export async function renderJournal(date) {
  const main = document.querySelector("main");
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>読み込み中...</p>
    </div>`;

  const [entriesResult, recentResult, diaryDialogueResult] = await Promise.allSettled([
    journalApi.listByDate(date),
    journalApi.list(getMonthStart(date), date),
    diaryDialogueApi.get(date),
  ]);

  const entries = entriesResult.status === "fulfilled" ? (entriesResult.value || []) : [];
  const recentEntries = recentResult.status === "fulfilled" ? recentResult.value : [];
  const diaryDialogue = diaryDialogueResult.status === "fulfilled" ? diaryDialogueResult.value : null;

  // エントリ番号順にソート
  entries.sort((a, b) => (a.entry_number || 1) - (b.entry_number || 1));

  const monthlyBlockers = aggregateBlockers(recentEntries);
  const last7 = recentEntries.filter((e) => e.is_analyzed).slice(0, 7).reverse();

  main.innerHTML = buildJournalHTML(date, entries, last7, monthlyBlockers, recentEntries, diaryDialogue);
  attachJournalEvents(date, entries);
  attachDiaryDialogueEvents(date);
}

function aggregateBlockers(entries) {
  const map = {};
  for (const e of entries) {
    const blockers = e.ai_analysis?.blockers || [];
    for (const b of blockers) {
      const cat = b.category || "その他";
      if (!map[cat]) map[cat] = { blocker: cat, count: 0, severities: [] };
      map[cat].count++;
      map[cat].severities.push(b.severity);
    }
  }
  return Object.values(map)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((b) => ({
      ...b,
      severity_avg: modeSeverity(b.severities),
    }));
}

function modeSeverity(arr) {
  const counts = { high: 0, medium: 0, low: 0 };
  arr.forEach((s) => counts[s]++);
  return counts.high >= counts.medium ? (counts.high >= counts.low ? "high" : "low") : counts.medium >= counts.low ? "medium" : "low";
}

// ===== HTML ビルダー =====

function buildJournalHTML(date, entries, last7, monthlyBlockers, recentEntries, diaryDialogue) {
  const dateJP = formatDateJP(date);
  const isToday = date === today();
  const isFuture = date > today();

  const savedMode = localStorage.getItem("journal-input-mode") || "free";
  const hasDiaryInProgress = diaryDialogue && diaryDialogue.status === "in_progress";
  const activeMode = hasDiaryInProgress ? "socratic" : savedMode;

  // 全エントリの分析結果を集約（トレンド用）
  const analyzedEntries = entries.filter((e) => e.is_analyzed && e.ai_analysis);

  return `
    <div class="journal-page">
      <!-- 日付ナビ -->
      <div class="card" style="padding:12px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <button class="btn btn-ghost btn-sm" id="journal-prev">&#9664;</button>
          <div style="text-align:center">
            <div class="card-title" style="margin:0">フリージャーナル</div>
            <div style="font-size:0.85rem;color:var(--text-secondary)">${dateJP}</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="journal-next" ${isFuture || isToday ? "disabled" : ""}>&#9654;</button>
        </div>
      </div>

      <!-- 既存エントリ一覧 -->
      ${entries.length > 0 ? buildEntryListHTML(entries, isFuture) : ""}

      <!-- 新規エントリ追加ボタン -->
      <button class="btn-add-entry" id="journal-accordion-toggle" ${isFuture ? "disabled" : ""}>
        <span class="btn-add-entry-icon">＋</span>
        ${entries.length > 0 ? "新しいエントリを追加" : "最近の気持ち・出来事を記録"}
      </button>

      <!-- 入力エリア（ボタンクリックで表示） -->
      <div class="card" id="journal-accordion-body" style="display:none">
        <div class="diary-mode-toggle">
          <button class="diary-mode-btn ${activeMode === "free" ? "active" : ""}" data-mode="free">フリー入力</button>
          <button class="diary-mode-btn ${activeMode === "socratic" ? "active" : ""}" data-mode="socratic">問答で記録</button>
        </div>
        <div id="journal-free-mode" style="${activeMode === "free" ? "" : "display:none"}">
          <textarea
            class="journal-textarea"
            id="journal-content"
            placeholder=""
            ${isFuture ? "disabled" : ""}
          ></textarea>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-primary" id="journal-save" ${isFuture ? "disabled" : ""}>
              保存する
            </button>
          </div>
        </div>
        <div id="journal-socratic-mode" style="${activeMode === "socratic" ? "" : "display:none"}">
          ${buildDiaryDialogueHTML(diaryDialogue)}
        </div>
      </div>

      ${last7.length >= 2 ? buildTrendSection(last7) : ""}
      ${monthlyBlockers.length > 0 ? buildBlockerSummary(monthlyBlockers) : ""}
      ${buildWeeklyDigestSection(date)}
      ${buildRecentList(recentEntries, date)}
    </div>
  `;
}

// ===== エントリ一覧 =====

function buildEntryListHTML(entries, isFuture) {
  return entries.map((entry) => {
    const entryId = entry.id;
    const label = entryLabel(entry);
    const analysis = entry.ai_analysis;
    const isAnalyzed = entry.is_analyzed;
    const mdSummary = entry.md_summary || "";
    const mood = analysis?.mood_score;
    const rank = mood != null ? moodRank(mood) : "";

    return `
      <div class="card journal-entry-card" data-entry-id="${escapeHTML(entryId)}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge" style="background:var(--bg-secondary);color:var(--text-primary);font-weight:600">${label}</span>
            ${mood != null ? `<div class="mood-score ${rank}" style="width:32px;height:32px;font-size:0.8rem">${mood}</div>` : ""}
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-ghost btn-sm entry-toggle-btn" data-entry-id="${escapeHTML(entryId)}" title="展開/折りたたみ">
              &#9660;
            </button>
          </div>
        </div>

        <!-- プレビュー行 -->
        <div class="entry-preview" data-entry-id="${escapeHTML(entryId)}" style="font-size:0.85rem;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer">
          ${escapeHTML(entry.content.slice(0, 80))}${entry.content.length > 80 ? "..." : ""}
        </div>

        <!-- 展開コンテンツ -->
        <div class="entry-detail" data-entry-id="${escapeHTML(entryId)}" style="display:none">
          <textarea
            class="journal-textarea entry-textarea"
            data-entry-id="${escapeHTML(entryId)}"
            ${isFuture ? "disabled" : ""}
          >${escapeHTML(entry.content)}</textarea>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm entry-update-btn" data-entry-id="${escapeHTML(entryId)}" ${isFuture ? "disabled" : ""}>
              更新
            </button>
            <button class="btn btn-secondary btn-sm entry-analyze-btn" data-entry-id="${escapeHTML(entryId)}" ${isFuture ? "disabled" : ""}>
              ${isAnalyzed ? "再分析" : "分析"}
            </button>
            <button class="btn btn-secondary btn-sm entry-md-btn" data-entry-id="${escapeHTML(entryId)}" ${isFuture ? "disabled" : ""}>
              MD要約
            </button>
            <button class="btn btn-ghost btn-sm entry-delete-btn" data-entry-id="${escapeHTML(entryId)}" style="margin-left:auto;color:var(--neon-red)">
              削除
            </button>
          </div>

          <!-- MD要約表示 -->
          <div class="entry-md-wrapper" data-entry-id="${escapeHTML(entryId)}" style="${mdSummary ? "" : "display:none;"}margin-top:12px">
            <div class="entry-md-output md-output" data-entry-id="${escapeHTML(entryId)}" style="padding:20px 24px;background:var(--card-bg, #f8f9fa);border-radius:10px;border:1px solid rgba(128,128,128,0.15);line-height:1.8;overflow-wrap:break-word">
              ${mdSummary ? renderMd(mdSummary) : ""}
            </div>
          </div>

          <!-- 分析結果 -->
          ${isAnalyzed && analysis ? buildAnalysisSection(analysis) : ""}
        </div>
      </div>
    `;
  }).join("");
}

// ===== 日記入力対話 HTML =====

function buildDiaryDialogueHTML(diaryDialogue) {
  if (diaryDialogue && diaryDialogue.status === "completed") {
    const messages = diaryDialogue.messages || [];
    return `
      <div class="diary-dialogue-completed">
        <p class="diary-dialogue-done-msg">問答から日記テキストを生成しました。フリー入力に反映済みです。</p>
        <button class="btn btn-outline btn-sm" id="btn-diary-dialogue-toggle">対話を見る</button>
        <div class="morning-dialogue-history" id="diary-dialogue-history" style="display:none; margin-top: 12px;">
          ${messages.map((m) => `
            <div class="dialogue-bubble ${m.role === "ai" ? "dialogue-bubble-ai" : "dialogue-bubble-user"}">
              <div class="dialogue-bubble-label">${m.role === "ai" ? "AI" : "あなた"}</div>
              <div class="dialogue-bubble-content">${escapeHTML(m.content)}</div>
            </div>
          `).join("")}
        </div>
        <button class="btn btn-outline btn-sm btn-danger" id="btn-diary-dialogue-reset" style="margin-top: 8px;">
          対話をリセット
        </button>
      </div>`;
  }

  if (diaryDialogue && diaryDialogue.status === "in_progress") {
    const messages = diaryDialogue.messages || [];
    const turnCount = diaryDialogue.turn_count || 0;
    const maxTurns = diaryDialogue.max_turns || 5;
    const isMaxed = turnCount >= maxTurns;

    return `
      <div id="diary-dialogue-chat">
        <div class="dialogue-header">
          <span>ターン ${turnCount}/${maxTurns}</span>
          <div class="dialogue-progress">
            <div class="dialogue-progress-bar" style="width: ${(turnCount / maxTurns) * 100}%"></div>
          </div>
        </div>
        <div class="dialogue-messages" id="diary-dialogue-messages">
          ${messages.map((m) => `
            <div class="dialogue-bubble ${m.role === "ai" ? "dialogue-bubble-ai" : "dialogue-bubble-user"}">
              <div class="dialogue-bubble-label">${m.role === "ai" ? "AI" : "あなた"}</div>
              <div class="dialogue-bubble-content">${escapeHTML(m.content)}</div>
            </div>
          `).join("")}
        </div>
        ${!isMaxed ? `
        <div class="dialogue-input-area">
          <textarea id="diary-dialogue-input" rows="2" placeholder=""></textarea>
          <button class="btn btn-primary btn-sm" id="btn-diary-dialogue-send">送信</button>
        </div>` : `
        <div class="dialogue-maxed-notice">
          <p>ターン上限に達しました。日記をまとめましょう。</p>
        </div>`}
        <div class="dialogue-actions" style="margin-top: 8px;">
          ${turnCount >= 1 ? `
          <button class="btn btn-primary btn-sm" id="btn-diary-dialogue-synthesize">
            日記をまとめる
          </button>` : ""}
          <button class="btn btn-outline btn-sm btn-danger" id="btn-diary-dialogue-cancel">
            キャンセル
          </button>
        </div>
      </div>`;
  }

  return `
    <div id="diary-dialogue-start">
      <p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.7;margin-bottom:14px">
        AIの質問に答えるだけで、最近の出来事や気持ちが日記になります。
      </p>
      <button class="btn btn-primary" id="btn-start-diary-dialogue" style="width: 100%;">
        問答を始める
      </button>
    </div>`;
}

// ===== 日記入力対話イベント =====

function attachDiaryDialogueEvents(date) {
  // 入力エリア開閉
  const accordionToggle = document.getElementById("journal-accordion-toggle");
  const accordionBody = document.getElementById("journal-accordion-body");
  if (accordionToggle && accordionBody) {
    accordionToggle.addEventListener("click", () => {
      const isOpen = accordionBody.style.display !== "none";
      accordionBody.style.display = isOpen ? "none" : "";
      accordionToggle.style.display = isOpen ? "" : "none";
    });
  }

  const modeButtons = document.querySelectorAll(".diary-mode-btn");
  for (const btn of modeButtons) {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      localStorage.setItem("journal-input-mode", mode);
      for (const b of modeButtons) b.classList.toggle("active", b.dataset.mode === mode);
      const freeArea = document.getElementById("journal-free-mode");
      const socraticArea = document.getElementById("journal-socratic-mode");
      if (freeArea) freeArea.style.display = mode === "free" ? "" : "none";
      if (socraticArea) socraticArea.style.display = mode === "socratic" ? "" : "none";
    });
  }

  const btnStart = document.getElementById("btn-start-diary-dialogue");
  if (btnStart) {
    btnStart.addEventListener("click", async () => {
      btnStart.disabled = true;
      btnStart.textContent = "準備中...";
      try {
        await diaryDialogueApi.start(date);
        await renderJournal(date);
      } catch (err) {
        showToast("問答の開始に失敗しました: " + err.message, "error");
        btnStart.disabled = false;
        btnStart.textContent = "問答を始める";
      }
    });
  }

  const btnSend = document.getElementById("btn-diary-dialogue-send");
  if (btnSend) {
    const input = document.getElementById("diary-dialogue-input");

    async function sendReply() {
      const message = input.value.trim();
      if (!message) return;
      btnSend.disabled = true;
      btnSend.textContent = "...";
      input.disabled = true;
      try {
        await diaryDialogueApi.reply(date, message);
        await renderJournal(date);
      } catch (err) {
        showToast("送信に失敗しました: " + err.message, "error");
        btnSend.disabled = false;
        btnSend.textContent = "送信";
        input.disabled = false;
      }
    }

    btnSend.addEventListener("click", sendReply);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); }
    });

    const messagesEl = document.getElementById("diary-dialogue-messages");
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    input.focus();
  }

  // まとめる → 新規エントリとして自動保存
  const btnSynthesize = document.getElementById("btn-diary-dialogue-synthesize");
  if (btnSynthesize) {
    btnSynthesize.addEventListener("click", async () => {
      btnSynthesize.disabled = true;
      btnSynthesize.textContent = "まとめ中...";
      try {
        const result = await diaryDialogueApi.synthesize(date);
        const text = result.raw_input || "";

        if (text) {
          // フリー入力に切り替え、テキストエリアに反映
          localStorage.setItem("journal-input-mode", "free");
          await renderJournal(date);
          const textarea = document.getElementById("journal-content");
          if (textarea) {
            textarea.value = text;
          }
          showToast("日記テキストを生成しました。保存ボタンで新規エントリとして保存できます。", "success");
        } else {
          await renderJournal(date);
        }
      } catch (err) {
        showToast("まとめに失敗しました: " + err.message, "error");
        btnSynthesize.disabled = false;
        btnSynthesize.textContent = "日記をまとめる";
      }
    });
  }

  const btnCancel = document.getElementById("btn-diary-dialogue-cancel");
  if (btnCancel) {
    btnCancel.addEventListener("click", async () => {
      btnCancel.disabled = true;
      try {
        await diaryDialogueApi.delete(date);
        showToast("問答をキャンセルしました", "info");
        await renderJournal(date);
      } catch (err) {
        showToast("キャンセルに失敗しました: " + err.message, "error");
        btnCancel.disabled = false;
      }
    });
  }

  const btnToggle = document.getElementById("btn-diary-dialogue-toggle");
  if (btnToggle) {
    btnToggle.addEventListener("click", () => {
      const history = document.getElementById("diary-dialogue-history");
      if (history) {
        const isHidden = history.style.display === "none";
        history.style.display = isHidden ? "" : "none";
        btnToggle.textContent = isHidden ? "対話を閉じる" : "対話を見る";
      }
    });
  }

  const btnReset = document.getElementById("btn-diary-dialogue-reset");
  if (btnReset) {
    btnReset.addEventListener("click", async () => {
      btnReset.disabled = true;
      try {
        await diaryDialogueApi.delete(date);
        showToast("対話をリセットしました", "info");
        await renderJournal(date);
      } catch (err) {
        showToast("リセットに失敗しました: " + err.message, "error");
        btnReset.disabled = false;
      }
    });
  }
}

function buildAnalysisSection(a) {
  const rank = moodRank(a.mood_score);
  const energyLabel = { high: "高い", medium: "普通", low: "低い" }[a.energy_level] || a.energy_level;

  return `
    ${a.encouragement ? `
      <div class="journal-encouragement" style="margin-top:12px;padding:12px;border-radius:8px;background:var(--bg-secondary)">
        <p style="font-size:0.95rem;line-height:1.7;margin:0">${a.encouragement}</p>
      </div>
    ` : ""}

    ${(a.advice?.length) ? `
      <div style="margin-top:12px">
        <div style="font-size:0.8rem;font-weight:600;color:var(--cyan);margin-bottom:6px">アドバイス</div>
        <ul class="analysis-list tip">
          ${a.advice.map((adv) => `<li>${adv}</li>`).join("")}
        </ul>
      </div>
    ` : ""}

    <div style="margin-top:12px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:0.8rem;font-weight:600;color:var(--text-secondary)">感情分析</span>
        <span style="font-size:0.8rem;color:var(--text-secondary)">エネルギー: ${energyLabel}</span>
        <div class="mood-score ${rank}" style="width:32px;height:32px;font-size:0.8rem">${a.mood_score}</div>
      </div>
      ${a.emotions.length > 0 ? `
        <div class="emotion-pills" style="margin-top:6px">
          ${a.emotions.map((e) => `
            <span class="emotion-pill ${emotionValence(e.tag)}">
              ${e.tag} <span class="emotion-intensity">${e.intensity.toFixed(1)}</span>
            </span>
          `).join("")}
        </div>
      ` : ""}
      ${a.summary ? `<p style="font-size:0.85rem;color:var(--text-secondary);margin:8px 0 0">${a.summary}</p>` : ""}
    </div>

    ${a.blockers.length > 0 ? `
      <div style="margin-top:12px">
        <div style="font-size:0.8rem;font-weight:600;color:var(--neon-red);margin-bottom:6px">行動ブロッカー</div>
        ${a.blockers.map((b) => `
          <div class="blocker-item ${b.severity}" style="margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:8px">
              <strong style="font-size:0.85rem">${b.blocker}</strong>
              <span class="badge badge-${b.severity}">${b.severity}</span>
              <span style="font-size:0.75rem;color:var(--text-muted)">${b.category}</span>
            </div>
          </div>
        `).join("")}
      </div>
    ` : ""}

    ${a.insights.length > 0 ? `
      <div style="margin-top:12px">
        <div style="font-size:0.8rem;font-weight:600;color:var(--violet);margin-bottom:6px">洞察</div>
        <ul class="analysis-list tip">
          ${a.insights.map((i) => `<li>${i}</li>`).join("")}
        </ul>
      </div>
    ` : ""}

    ${a.key_themes.length > 0 ? `
      <div style="margin-top:8px">
        <div class="emotion-pills">
          ${a.key_themes.map((t) => `<span class="emotion-pill neutral">${t}</span>`).join("")}
        </div>
      </div>
    ` : ""}

    ${a.gratitude.length > 0 ? `
      <div style="margin-top:12px">
        <div style="font-size:0.8rem;font-weight:600;color:var(--neon-green);margin-bottom:6px">感謝</div>
        <ul class="analysis-list good">
          ${a.gratitude.map((g) => `<li>${g}</li>`).join("")}
        </ul>
      </div>
    ` : ""}
  `;
}

function buildTrendSection(entries) {
  const allEmotions = new Set();
  entries.forEach((e) => {
    (e.ai_analysis?.emotions || []).forEach((em) => allEmotions.add(em.tag));
  });
  if (allEmotions.size === 0) return "";

  const trendData = JSON.stringify(
    entries.map((e) => ({
      date: e.date.slice(5),
      mood: e.ai_analysis?.mood_score || 0,
      emotions: Object.fromEntries(
        (e.ai_analysis?.emotions || []).map((em) => [em.tag, em.intensity]),
      ),
    })),
  );

  return `
    <div class="card">
      <div class="card-title">感情トレンド（直近${entries.length}日間）</div>
      <canvas class="journal-trend-canvas" id="journal-trend-canvas"></canvas>
      <script type="application/json" id="journal-trend-data">${trendData}</script>
    </div>
  `;
}

function buildBlockerSummary(blockers) {
  const maxCount = blockers[0]?.count || 1;
  return `
    <div class="card">
      <div class="card-title">今月のトップブロッカー</div>
      ${blockers.map((b) => `
        <div class="blocker-bar">
          <span class="blocker-bar-label">${b.blocker}</span>
          <div style="flex:1;background:var(--bg-secondary);border-radius:4px;overflow:hidden">
            <div class="blocker-bar-fill" style="width:${(b.count / maxCount) * 100}%"></div>
          </div>
          <span class="blocker-bar-count">${b.count}回</span>
        </div>
      `).join("")}
    </div>
  `;
}

function buildWeeklyDigestSection(date) {
  const weekId = getWeekId(date);
  return `
    <div class="card" id="weekly-digest-section">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div class="card-title" style="margin:0">週次ダイジェスト</div>
        <span style="font-size:0.8rem;color:var(--text-muted)">${weekId}</span>
      </div>
      <div id="weekly-digest-content">
        <div style="text-align:center;padding:16px 0">
          <button class="btn btn-secondary" id="digest-load">ダイジェストを読み込む</button>
        </div>
      </div>
    </div>
  `;
}

function buildRecentList(entries, currentDate) {
  // 日付でグループ化（同日の複数エントリをまとめる）
  const byDate = {};
  for (const e of entries) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  const otherDates = Object.keys(byDate).filter((d) => d !== currentDate).slice(0, 10);
  if (otherDates.length === 0) return "";

  return `
    <div class="card">
      <div class="card-title">過去のジャーナル</div>
      ${otherDates.map((d) => {
        const dateEntries = byDate[d];
        const count = dateEntries.length;
        const first = dateEntries[0];
        const a = first.ai_analysis;
        const emotions = (a?.emotions || []).slice(0, 3).map((em) => em.tag).join(", ");
        const mood = a?.mood_score;
        const rank = mood != null ? moodRank(mood) : "";
        return `
          <a href="#/journal/${d}" class="journal-entry-item">
            <div style="flex:0 0 70px;font-size:0.85rem;color:var(--text-secondary)">${d.slice(5)}</div>
            ${mood != null ? `<div class="mood-score ${rank}" style="width:36px;height:36px;font-size:0.85rem;margin-right:12px">${mood}</div>` : ""}
            <div style="flex:1;min-width:0">
              <div style="font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-primary)">
                ${escapeHTML(first.content.slice(0, 50))}${first.content.length > 50 ? "..." : ""}
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted)">
                ${count > 1 ? `${count}件のエントリ` : ""}${count > 1 && emotions ? " / " : ""}${emotions}
              </div>
            </div>
          </a>
        `;
      }).join("")}
    </div>
  `;
}

// ===== イベント =====

function attachJournalEvents(date, entries) {
  // 日付ナビ
  document.getElementById("journal-prev")?.addEventListener("click", () => {
    window.location.hash = `#/journal/${prevDate(date)}`;
  });
  document.getElementById("journal-next")?.addEventListener("click", () => {
    const next = nextDate(date);
    if (next <= today()) window.location.hash = `#/journal/${next}`;
  });

  // 新規エントリ保存
  document.getElementById("journal-save")?.addEventListener("click", async () => {
    const content = document.getElementById("journal-content")?.value?.trim();
    if (!content) {
      showToast("内容を入力してください", "error");
      return;
    }

    const btn = document.getElementById("journal-save");
    btn.disabled = true;
    btn.textContent = "保存中...";

    try {
      await journalApi.create(date, content);
      showToast("保存しました", "success");
      renderJournal(date);
    } catch (err) {
      showToast(err.message, "error");
      btn.disabled = false;
      btn.textContent = "保存する";
    }
  });

  // エントリカードの展開/折りたたみ
  document.querySelectorAll(".entry-toggle-btn, .entry-preview").forEach((el) => {
    el.addEventListener("click", () => {
      const entryId = el.dataset.entryId;
      const detail = document.querySelector(`.entry-detail[data-entry-id="${entryId}"]`);
      const preview = document.querySelector(`.entry-preview[data-entry-id="${entryId}"]`);
      const toggleBtn = document.querySelector(`.entry-toggle-btn[data-entry-id="${entryId}"]`);
      if (detail) {
        const isHidden = detail.style.display === "none";
        detail.style.display = isHidden ? "" : "none";
        if (preview) preview.style.display = isHidden ? "none" : "";
        if (toggleBtn) toggleBtn.innerHTML = isHidden ? "&#9650;" : "&#9660;";
      }
    });
  });

  // エントリ更新
  document.querySelectorAll(".entry-update-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.entryId;
      const textarea = document.querySelector(`.entry-textarea[data-entry-id="${entryId}"]`);
      const content = textarea?.value?.trim();
      if (!content) {
        showToast("内容を入力してください", "error");
        return;
      }
      btn.disabled = true;
      btn.textContent = "更新中...";
      try {
        await journalApi.update(entryId, content);
        showToast("更新しました", "success");
        renderJournal(date);
      } catch (err) {
        showToast(err.message, "error");
        btn.disabled = false;
        btn.textContent = "更新";
      }
    });
  });

  // エントリ分析
  document.querySelectorAll(".entry-analyze-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.entryId;
      const textarea = document.querySelector(`.entry-textarea[data-entry-id="${entryId}"]`);
      const content = textarea?.value?.trim();

      btn.disabled = true;

      try {
        // テキストエリアの内容が変わっていたら先に更新
        const entry = entries.find((e) => e.id === entryId);
        if (entry && content && content !== entry.content) {
          btn.textContent = "更新中...";
          await journalApi.update(entryId, content);
        }

        btn.textContent = "分析中...";
        await journalApi.analyze(entryId);
        showToast("分析が完了しました", "success");
        renderJournal(date);
      } catch (err) {
        showToast(err.message, "error");
        btn.disabled = false;
        btn.textContent = "分析";
      }
    });
  });

  // MD要約
  document.querySelectorAll(".entry-md-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entryId = btn.dataset.entryId;
      const wrapper = document.querySelector(`.entry-md-wrapper[data-entry-id="${entryId}"]`);
      const output = document.querySelector(`.entry-md-output[data-entry-id="${entryId}"]`);
      const textarea = document.querySelector(`.entry-textarea[data-entry-id="${entryId}"]`);
      const content = textarea?.value?.trim();

      // トグル: 既に表示中なら閉じる
      if (wrapper && wrapper.style.display !== "none" && output?.dataset.generated) {
        wrapper.style.display = "none";
        return;
      }

      btn.disabled = true;

      try {
        const entry = entries.find((e) => e.id === entryId);
        if (entry && content && content !== entry.content) {
          btn.textContent = "更新中...";
          await journalApi.update(entryId, content);
        }

        btn.textContent = "要約中...";
        const result = await journalApi.summarize(entryId);
        const md = result.md_summary || "";
        if (output) {
          output.innerHTML = renderMd(md);
          output.dataset.generated = "true";
        }
        if (wrapper) wrapper.style.display = "";
        btn.textContent = "MD要約";
        btn.disabled = false;
      } catch (err) {
        showToast(err.message, "error");
        btn.textContent = "MD要約";
        btn.disabled = false;
      }
    });
  });

  // エントリ削除
  document.querySelectorAll(".entry-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("このエントリを削除しますか？")) return;
      const entryId = btn.dataset.entryId;
      try {
        await journalApi.delete(entryId);
        showToast("削除しました", "success");
        renderJournal(date);
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  });

  // 週次ダイジェスト
  document.getElementById("digest-load")?.addEventListener("click", async () => {
    await loadWeeklyDigest(date);
  });

  // 感情トレンドチャート描画
  requestAnimationFrame(() => drawTrendChart());
}

// ===== 週次ダイジェスト =====

async function loadWeeklyDigest(date) {
  const weekId = getWeekId(date);
  const container = document.getElementById("weekly-digest-content");
  if (!container) return;

  container.innerHTML = `<div class="loading"><div class="spinner"></div><p>読み込み中...</p></div>`;

  try {
    let digest;
    try {
      digest = await journalApi.getDigest(weekId);
    } catch {
      container.innerHTML = `<div class="loading"><div class="spinner"></div><p>ダイジェストを生成中...</p></div>`;
      digest = await journalApi.generateDigest(weekId);
    }
    container.innerHTML = buildDigestHTML(digest);
  } catch (err) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:12px">
      ${err.message.includes("ジャーナルエントリがありません") ? "この週にジャーナルがまだありません" : err.message}
    </p>`;
  }
}

function buildDigestHTML(d) {
  let html = "";

  const mt = d.mood_trajectory;
  if (mt) {
    const trendLabel = { improving: "改善傾向", stable: "安定", declining: "低下傾向" }[mt.trend] || mt.trend;
    const trendColor = mt.trend === "improving" ? "var(--neon-green)" : mt.trend === "declining" ? "var(--neon-red)" : "var(--neon-amber)";
    html += `<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;flex-wrap:wrap">
      <div style="font-size:0.85rem;color:var(--text-secondary)">週初 <strong style="color:var(--text-primary)">${mt.start_of_week}</strong></div>
      <div style="font-size:1.2rem;color:${trendColor}">→</div>
      <div style="font-size:0.85rem;color:var(--text-secondary)">週末 <strong style="color:var(--text-primary)">${mt.end_of_week}</strong></div>
      <span class="badge" style="background:${trendColor};color:#000">${trendLabel}</span>
    </div>`;
  }

  if (d.hidden_patterns?.length) {
    html += `<div style="margin-bottom:16px">
      <div style="font-size:0.8rem;font-weight:600;color:var(--violet);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">隠れたパターン</div>
      <ul class="analysis-list cause">${d.hidden_patterns.map((p) => `<li>${p}</li>`).join("")}</ul>
    </div>`;
  }

  if (d.weekly_insights?.length) {
    html += `<div style="margin-bottom:16px">
      <div style="font-size:0.8rem;font-weight:600;color:var(--cyan);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">インサイト</div>
      <ul class="analysis-list tip">${d.weekly_insights.map((i) => `<li>${i}</li>`).join("")}</ul>
    </div>`;
  }

  if (d.top_blockers?.length) {
    html += `<div style="margin-bottom:16px">
      <div style="font-size:0.8rem;font-weight:600;color:var(--neon-red);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">トップブロッカー</div>
      ${d.top_blockers.map((b) => `
        <div class="blocker-item ${b.severity_avg}" style="margin-bottom:8px">
          <strong>${b.blocker}</strong> <span style="font-size:0.8rem;color:var(--text-muted)">(${b.frequency}回)</span>
          ${b.suggestion ? `<div style="font-size:0.82rem;color:var(--text-secondary);margin-top:4px">→ ${b.suggestion}</div>` : ""}
        </div>
      `).join("")}
    </div>`;
  }

  if (d.action_recommendations?.length) {
    html += `<div>
      <div style="font-size:0.8rem;font-weight:600;color:var(--neon-green);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">来週のアクション</div>
      <ul class="analysis-list good">${d.action_recommendations.map((a) => `<li>${a}</li>`).join("")}</ul>
    </div>`;
  }

  return html || `<p style="color:var(--text-muted);text-align:center">データが不足しています</p>`;
}

// ===== トレンドチャート（Canvas） =====

function drawTrendChart() {
  const canvas = document.getElementById("journal-trend-canvas");
  const dataEl = document.getElementById("journal-trend-data");
  if (!canvas || !dataEl) return;

  const data = JSON.parse(dataEl.textContent);
  if (data.length < 2) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const pad = { top: 20, right: 16, bottom: 32, left: 36 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const textColor = isDark ? "rgba(220,232,255,0.5)" : "rgba(17,24,39,0.5)";
  const gridColor = isDark ? "rgba(220,232,255,0.07)" : "rgba(17,24,39,0.08)";

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = textColor;
  ctx.font = "10px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (chartH / 4) * i;
    ctx.fillText(String(100 - i * 25), pad.left - 6, y + 3);
  }

  ctx.textAlign = "center";
  data.forEach((d, i) => {
    const x = pad.left + (chartW / (data.length - 1)) * i;
    ctx.fillText(d.date, x, H - 8);
  });

  ctx.strokeStyle = isDark ? "#00d4ff" : "#0284c7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = pad.left + (chartW / (data.length - 1)) * i;
    const y = pad.top + chartH * (1 - d.mood / 100);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  data.forEach((d, i) => {
    const x = pad.left + (chartW / (data.length - 1)) * i;
    const y = pad.top + chartH * (1 - d.mood / 100);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "#00d4ff" : "#0284c7";
    ctx.fill();
  });

  ctx.fillStyle = isDark ? "#00d4ff" : "#0284c7";
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("気分スコア", pad.left, pad.top - 6);
}
