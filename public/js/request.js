import { apiGet, copyToClipboard, openLogStream } from "./server.js";

const params = new URLSearchParams(window.location.search);
const requestId = params.get("id");
const title = document.getElementById("request-title");
const subtitle = document.getElementById("request-subtitle");
const summary = document.getElementById("request-summary");
const dataPanel = document.getElementById("data-panel");
const timeline = document.getElementById("timeline");
const logViewer = document.getElementById("request-logs");
const modalRoot = document.getElementById("modal-root");

if (!requestId) {
  subtitle.textContent = "Missing request id";
  throw new Error("Request id required");
}

function badge(label, variant) {
  const span = document.createElement("span");
  span.className = "badge";
  span.dataset.variant = variant;
  span.textContent = label.toUpperCase();
  return span;
}

function renderSummaryCard() {
  summary.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <h3>Request Metadata</h3>
    <p><strong>ID:</strong> ${requestId}</p>
    <p><strong>Goal:</strong> <span id="goal-text"></span></p>
    <button class="button" id="copy-request">Copy Request JSON</button>
  `;
  summary.appendChild(card);
}

function renderDataCard(payload, reasoning) {
  dataPanel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <h3>Extracted Data</h3>
    <pre id="data-json">${payload ? JSON.stringify(payload, null, 2) : "No data yet"}</pre>
    <button class="button copy-button" id="copy-data">Copy Data</button>
    <p class="muted">${reasoning ?? ""}</p>
  `;
  dataPanel.appendChild(card);
}

function renderTimeline(steps) {
  timeline.innerHTML = "";
  steps.forEach(step => {
    const item = document.createElement("div");
    item.className = "timeline-item card";
    item.innerHTML = `
      <div class="muted">Step ${step.stepIndex}</div>
      <h3>${step.goal ?? "Agent action"}</h3>
      <p>${step.actualOutcome ?? step.expectedOutcome ?? "Pending"}</p>
      <div class="tab-row">
        <button class="button" data-step="${step.id}">Open Step Detail</button>
      </div>
    `;
    item.querySelector("button").addEventListener("click", () => openStepModal(step));
    timeline.appendChild(item);
  });
}

async function openStepModal(step) {
  const assetsResponse = await apiGet(`/steps/${step.id}/assets`);
  const assets = assetsResponse.assets ?? [];
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-content">
        <header>
          <h2>Step ${step.stepIndex}</h2>
          <p>${step.goal ?? "Autopilot action"}</p>
        </header>
        <section>
          <div class="card">
            <p><strong>Thoughts:</strong> ${step.thoughts ?? "n/a"}</p>
            <p><strong>Planned Action:</strong> ${step.plannedAction ?? "n/a"}</p>
            <p><strong>Outcome:</strong> ${step.actualOutcome ?? step.expectedOutcome ?? "n/a"}</p>
          </div>
        </section>
        <section>
          <div class="tab-row" id="tabs"></div>
          <div id="tab-content"></div>
        </section>
        <section>
          <h3>Console Logs</h3>
          <pre>${assets.find(a => a.assetType === "console")?.textContent ?? "No console messages"}</pre>
        </section>
        <div style="display:flex;justify-content:flex-end;gap:12px;">
          <button class="button" id="close-modal">Close</button>
        </div>
      </div>
    </div>
  `;
  modalRoot.appendChild(modal);

  const closeButton = modal.querySelector("#close-modal");
  closeButton.addEventListener("click", () => modal.remove());

  const tabs = modal.querySelector("#tabs");
  const tabContent = modal.querySelector("#tab-content");

  const orderedAssets = [
    { type: "screenshot", label: "Screenshot", mime: "image/png" },
    { type: "html", label: "HTML", mime: "text/html" },
    { type: "text", label: "Text", mime: "text/plain" },
    { type: "css", label: "CSS", mime: "text/css" },
    { type: "analysis", label: "Analysis", mime: "application/json" },
  ];

  function renderTab(assetType) {
    const asset = assets.find(a => a.assetType === assetType);
    if (!asset) {
      tabContent.innerHTML = `<p class="muted">No ${assetType} captured</p>`;
      return;
    }
    if (assetType === "screenshot" && asset.content) {
      const binary = atob(asset.content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: asset.mimeType });
      const url = URL.createObjectURL(blob);
      tabContent.innerHTML = `<img src="${url}" alt="Screenshot" style="max-width:100%;border-radius:12px;" />`;
      return;
    }
    tabContent.innerHTML = `<pre>${asset.textContent ?? ""}</pre>`;
  }

  orderedAssets.forEach(entry => {
    const button = document.createElement("button");
    button.className = "tab-button";
    button.textContent = entry.label;
    button.addEventListener("click", () => {
      [...tabs.children].forEach(child => child.classList.remove("active"));
      button.classList.add("active");
      renderTab(entry.type);
    });
    tabs.appendChild(button);
  });

  if (tabs.firstElementChild) {
    tabs.firstElementChild.classList.add("active");
    renderTab(orderedAssets[0].type);
  }
}

function appendLog(entry) {
  const line = document.createElement("div");
  const message = entry.message ?? entry.raw ?? "";
  line.textContent = `[${entry.timestamp ?? new Date().toISOString()}] ${message}`;
  logViewer.appendChild(line);
  logViewer.scrollTop = logViewer.scrollHeight;
}

async function hydrate() {
  const data = await apiGet(`/requests/${requestId}`);
  const { request, steps, result } = data;
  title.textContent = `Request ${request.id}`;
  subtitle.innerHTML = ``;
  subtitle.appendChild(badge(request.status, request.status === "completed" ? "success" : request.status === "failed" ? "danger" : "warning"));
  subtitle.appendChild(document.createTextNode(" "));
  subtitle.appendChild(badge(request.outcome, request.outcome === "pass" ? "success" : request.outcome === "fail" ? "danger" : "warning"));
  renderSummaryCard();
  document.getElementById("goal-text").textContent = request.goal;
  document.getElementById("copy-request").addEventListener("click", () => copyToClipboard(JSON.stringify(request, null, 2)));
  const parsedData = result ? JSON.parse(result.resultJson) : null;
  renderDataCard(parsedData, result?.analysis ?? null);
  document.getElementById("copy-data").addEventListener("click", () => {
    const content = parsedData ? JSON.stringify(parsedData, null, 2) : "";
    copyToClipboard(content || "No data available");
  });
  renderTimeline(steps);
}

hydrate();
openLogStream(requestId, appendLog);
