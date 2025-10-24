import { apiGet, openGlobalLogStream } from "./server.js";

const rows = document.getElementById("request-rows");
const logs = document.getElementById("global-logs");

function statusBadge(status) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.dataset.variant = status === "completed" ? "success" : status === "failed" ? "danger" : "warning";
  badge.textContent = status.toUpperCase();
  return badge;
}

function outcomeBadge(outcome) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.dataset.variant = outcome === "pass" ? "success" : outcome === "fail" ? "danger" : "warning";
  badge.textContent = outcome.toUpperCase();
  return badge;
}

function renderRequests(list) {
  rows.innerHTML = "";
  list.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div>${item.id}</div>
        <small class="muted">${item.goal}</small>
      </td>
      <td>${item.url}</td>
      <td></td>
      <td></td>
      <td>${new Date(item.updatedAt).toLocaleString()}</td>
    `;
    const statusCell = tr.children[2];
    statusCell.appendChild(statusBadge(item.status));
    const outcomeCell = tr.children[3];
    outcomeCell.appendChild(outcomeBadge(item.outcome));
    tr.addEventListener("click", () => {
      window.location.href = `request.html?id=${item.id}`;
    });
    rows.appendChild(tr);
  });
}

function appendLog(entry) {
  const line = document.createElement("div");
  line.textContent = `[${entry.timestamp ?? new Date().toISOString()}] ${entry.level ?? "INFO"} :: ${entry.message ?? entry.raw}`;
  logs.appendChild(line);
  logs.scrollTop = logs.scrollHeight;
}

async function load() {
  try {
    const { requests } = await apiGet("/requests");
    renderRequests(requests);
  } catch (error) {
    logs.textContent = `Failed to load requests: ${error.message}`;
  }
}

load();
openGlobalLogStream(appendLog);
