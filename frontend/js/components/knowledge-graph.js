/**
 * ナレッジグラフ可視化画面 (/knowledge)
 * エンティティ・リレーションの一覧とグラフ表示
 */

import { knowledgeApi } from "../api.js?v=20260306b";
import { showToast } from "../app.js?v=20260306b";

/** メインコンテンツエリアを返す */
function getMain() {
  return document.querySelector("main");
}

/** エンティティタイプのラベルマップ */
const TYPE_LABELS = {
  goal: "目標",
  behavior_pattern: "行動パターン",
  trigger: "トリガー",
  strength: "強み",
  weakness: "弱み",
  habit: "習慣",
  value: "価値観",
  emotion_pattern: "感情パターン",
  life_context: "生活文脈",
};

/** エンティティタイプの色マップ */
const TYPE_COLORS = {
  goal: "#00d4ff",
  behavior_pattern: "#a855f7",
  trigger: "#ff3366",
  strength: "#00ff94",
  weakness: "#ffaa00",
  habit: "#3b82f6",
  value: "#f472b6",
  emotion_pattern: "#fbbf24",
  life_context: "#6b7280",
};

/** リレーションタイプのラベルマップ */
const RELATION_LABELS = {
  triggers: "引き起こす",
  prevents: "防ぐ",
  supports: "助ける",
  conflicts_with: "対立",
  correlates_with: "相関",
  part_of: "の一部",
  leads_to: "に発展",
};

/**
 * ナレッジグラフ画面をレンダリング
 */
export async function renderKnowledgeGraph() {
  const main = getMain();
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>ナレッジグラフを読み込み中...</p>
    </div>`;

  try {
    const [entities, relations, summary] = await Promise.all([
      knowledgeApi.listEntities(null, null, 100),
      knowledgeApi.listRelations(null, 100),
      knowledgeApi.summary(),
    ]);

    if (entities.length === 0) {
      main.innerHTML = `
        <div class="empty-state">
          <div class="icon">🧠</div>
          <h2>ナレッジグラフはまだ空です</h2>
          <p>日次分析を実行すると、行動パターンやトリガーが自動的に抽出されます。</p>
          <button class="btn btn-primary" onclick="window.location.hash='/input'">行動を記録する</button>
        </div>`;
      return;
    }

    main.innerHTML = `
      <div class="kg-container">
        <div class="kg-header">
          <h2 class="kg-title">ナレッジグラフ</h2>
          <div class="kg-stats">
            <span class="kg-stat"><strong>${summary.total_entities}</strong> エンティティ</span>
            <span class="kg-stat"><strong>${summary.total_relations}</strong> リレーション</span>
          </div>
        </div>

        <!-- グラフ可視化エリア -->
        <div class="card kg-graph-card">
          <div class="card-title">関係性マップ</div>
          <div class="kg-graph" id="kg-graph"></div>
          <div class="kg-legend">
            ${Object.entries(TYPE_LABELS).map(([type, label]) => `
              <span class="kg-legend-item">
                <span class="kg-legend-dot" style="background:${TYPE_COLORS[type]}"></span>
                ${label}
              </span>
            `).join("")}
          </div>
        </div>

        <!-- フィルタ -->
        <div class="kg-filter">
          <select id="kg-type-filter" class="kg-select">
            <option value="">全タイプ</option>
            ${Object.entries(TYPE_LABELS).map(([type, label]) =>
              `<option value="${type}">${label}</option>`
            ).join("")}
          </select>
          <select id="kg-status-filter" class="kg-select">
            <option value="">全ステータス</option>
            <option value="active">アクティブ</option>
            <option value="monitoring">モニタリング</option>
            <option value="resolved">解決済み</option>
          </select>
        </div>

        <!-- エンティティ一覧 -->
        <div class="card">
          <div class="card-title">エンティティ一覧</div>
          <div class="kg-entities" id="kg-entities">
            ${_renderEntitiesList(entities)}
          </div>
        </div>

        <!-- リレーション一覧 -->
        <div class="card">
          <div class="card-title">関係性一覧</div>
          <div class="kg-relations" id="kg-relations">
            ${_renderRelationsList(relations)}
          </div>
        </div>
      </div>
    `;

    _setupFilters(entities);
    _renderGraph(entities, relations);

  } catch (err) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="icon">❌</div>
        <p>ナレッジグラフの読み込みに失敗しました: ${err.message}</p>
      </div>`;
  }
}

function _renderEntitiesList(entities) {
  if (!entities.length) return "<p class='kg-empty'>エンティティがありません</p>";
  return entities.map(e => {
    const color = TYPE_COLORS[e.entityType] || "#6b7280";
    const label = TYPE_LABELS[e.entityType] || e.entityType;
    const obs = e.observations || [];
    const latestObs = obs.length > 0 ? obs[obs.length - 1].content : "";
    return `
      <div class="kg-entity-item" data-type="${e.entityType}" data-status="${e.status}">
        <div class="kg-entity-header">
          <span class="kg-entity-name" style="color:${color}">${_esc(e.name)}</span>
          <span class="kg-tag" style="border-color:${color};color:${color}">${label}</span>
          <span class="kg-tag kg-status-${e.status}">${e.status}</span>
        </div>
        <div class="kg-entity-meta">
          観測 ${e.observation_count || 0}回 | 初回: ${e.first_observed || '-'} | 最終: ${e.last_observed || '-'}
        </div>
        ${latestObs ? `<div class="kg-entity-obs">${_esc(latestObs)}</div>` : ""}
        ${obs.length > 1 ? `
          <details class="kg-obs-details">
            <summary>全観測記録 (${obs.length}件)</summary>
            <ul class="kg-obs-list">
              ${obs.map(o => `<li><span class="kg-obs-date">${o.source_date}</span> ${_esc(o.content)} <span class="kg-obs-conf">(${(o.confidence * 100).toFixed(0)}%)</span></li>`).join("")}
            </ul>
          </details>
        ` : ""}
      </div>
    `;
  }).join("");
}

function _renderRelationsList(relations) {
  if (!relations.length) return "<p class='kg-empty'>リレーションがありません</p>";

  // 強度でソート
  const sorted = [...relations].sort((a, b) => (b.strength || 0) - (a.strength || 0));
  return sorted.map(r => {
    const label = RELATION_LABELS[r.relation_type] || r.relation_type;
    const strengthPercent = ((r.strength || 0) * 100).toFixed(0);
    return `
      <div class="kg-relation-item">
        <div class="kg-relation-flow">
          <span class="kg-rel-from">${_esc(r.from_entity)}</span>
          <span class="kg-rel-arrow">→ ${label} →</span>
          <span class="kg-rel-to">${_esc(r.to_entity)}</span>
        </div>
        <div class="kg-relation-meta">
          <div class="kg-strength-bar">
            <div class="kg-strength-fill" style="width:${strengthPercent}%"></div>
          </div>
          <span class="kg-strength-label">強度 ${strengthPercent}%</span>
          <span>証拠 ${r.evidence_count || 0}回</span>
        </div>
        ${r.description ? `<div class="kg-relation-desc">${_esc(r.description)}</div>` : ""}
      </div>
    `;
  }).join("");
}

function _setupFilters(allEntities) {
  const typeFilter = document.getElementById("kg-type-filter");
  const statusFilter = document.getElementById("kg-status-filter");

  const applyFilter = () => {
    const type = typeFilter.value;
    const status = statusFilter.value;

    document.querySelectorAll(".kg-entity-item").forEach(el => {
      const matchType = !type || el.dataset.type === type;
      const matchStatus = !status || el.dataset.status === status;
      el.style.display = matchType && matchStatus ? "" : "none";
    });
  };

  typeFilter.addEventListener("change", applyFilter);
  statusFilter.addEventListener("change", applyFilter);
}

/** Canvas ベースのグラフ可視化 */
function _renderGraph(entities, relations) {
  const container = document.getElementById("kg-graph");
  if (!container) return;

  const canvas = document.createElement("canvas");
  const width = container.clientWidth || 600;
  const height = 400;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = "100%";
  canvas.style.height = height + "px";
  container.appendChild(canvas);

  const ctx = canvas.getContext("2d");

  // ノード位置を計算（力指向レイアウトの簡易版）
  const nodes = entities.map((e, i) => {
    const angle = (2 * Math.PI * i) / entities.length;
    const radius = Math.min(width, height) * 0.35;
    return {
      id: e.id,
      name: e.name,
      type: e.entityType,
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
      color: TYPE_COLORS[e.entityType] || "#6b7280",
    };
  });

  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.name] = n; });

  // エッジ描画
  ctx.lineWidth = 1;
  for (const r of relations) {
    const from = nodeMap[r.from_entity];
    const to = nodeMap[r.to_entity];
    if (!from || !to) continue;

    const strength = r.strength || 0.3;
    ctx.strokeStyle = `rgba(0, 212, 255, ${strength * 0.6})`;
    ctx.lineWidth = 1 + strength * 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // 矢印
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      const mx = from.x + dx * 0.65;
      const my = from.y + dy * 0.65;
      const ax = dx / len;
      const ay = dy / len;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(mx + ax * 6, my + ay * 6);
      ctx.lineTo(mx - ay * 4, my + ax * 4);
      ctx.lineTo(mx + ay * 4, my - ax * 4);
      ctx.fill();
    }
  }

  // ノード描画
  for (const node of nodes) {
    // グロー
    ctx.shadowColor = node.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = node.color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // ラベル
    ctx.fillStyle = "#dce8ff";
    ctx.font = "11px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(node.name, node.x, node.y + 20);
  }
}

function _esc(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}
