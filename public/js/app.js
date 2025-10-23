import { apiGet, apiPost } from "./server.js";

const params = new URLSearchParams(window.location.search);
const categoryParam = params.get("category");
const appParam = params.get("app");

const heading = document.getElementById("app-heading");
const description = document.getElementById("app-description");
const list = document.getElementById("app-list");
const detail = document.getElementById("app-detail");
const promptField = document.getElementById("app-prompt");
const schemaField = document.getElementById("app-schema");
const saveButton = document.getElementById("save-app");
const schemaButton = document.getElementById("test-schema");
const runButton = document.getElementById("run-app");
const runUrlField = document.getElementById("run-url");
const runGoalField = document.getElementById("run-goal");
const runResult = document.getElementById("run-result");
const siteTable = document.getElementById("site-table");

function safeParse(value) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    alert(`Invalid JSON: ${error.message}`);
    throw error;
  }
}

async function loadCategory(category) {
  heading.textContent = `Apps in ${category}`;
  description.textContent = "Select an autopilot blueprint to configure or run.";
  const { apps } = await apiGet(`/apps/category/${encodeURIComponent(category)}`);
  detail.style.display = "none";
  list.innerHTML = "";
  apps.forEach(app => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${app.title}</h3>
      <p>${app.description ?? ""}</p>
      <button class="button" data-app="${app.name}">Open</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      window.location.href = `app.html?app=${encodeURIComponent(app.name)}`;
    });
    list.appendChild(card);
  });
}

async function loadApp(name) {
  const { app, sites } = await apiGet(`/apps/${encodeURIComponent(name)}`);
  heading.textContent = app.title;
  description.textContent = app.description ?? "";
  promptField.value = app.prompt;
  schemaField.value = app.schemaJson ? JSON.stringify(JSON.parse(app.schemaJson), null, 2) : "";
  detail.style.display = "grid";
  list.innerHTML = "";

  saveButton.onclick = async () => {
    const schemaValue = schemaField.value.trim();
    const parsed = schemaValue ? safeParse(schemaValue) : undefined;
    await apiPost(`/apps/${encodeURIComponent(name)}`, { prompt: promptField.value, schema_json: parsed });
    alert("App configuration saved");
  };

  schemaButton.onclick = async () => {
    const { schema } = await apiPost("/test-schema", { prompt: promptField.value });
    schemaField.value = JSON.stringify(schema, null, 2);
  };

  runButton.onclick = async () => {
    const payload = {};
    if (runUrlField.value.trim()) payload.url = runUrlField.value.trim();
    if (runGoalField.value.trim()) payload.goal = runGoalField.value.trim();
    if (schemaField.value.trim()) {
      try {
        payload.schema = JSON.parse(schemaField.value.trim());
      } catch (error) {
        alert(`Unable to parse schema: ${error.message}`);
        return;
      }
    }
    const response = await apiPost(`/apps/run/${encodeURIComponent(name)}`, payload);
    runResult.textContent = `Request launched: ${response.request_id}`;
    runResult.innerHTML += ` – <a href="request.html?id=${response.request_id}">open</a>`;
  };

  renderSites(sites);
}

function renderSites(sites) {
  siteTable.innerHTML = "";
  sites.forEach(site => {
    const row = document.createElement("tr");
    const suggestionsList = site.discoverySuggestions?.elements?.map(item => `${item.label}: ${item.selector}`).join("\n") ?? "No suggestions yet";
    const notes = site.discoverySuggestions?.notes ? `\nNotes: ${site.discoverySuggestions.notes}` : "";
    row.innerHTML = `
      <td>${site.siteName ?? "Unnamed"}</td>
      <td>${site.url}</td>
      <td><button class="button" data-site="${site.id}">Discover</button></td>
      <td><pre style="white-space:pre-wrap;">${suggestionsList}${notes}</pre></td>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      row.querySelector("button").textContent = "Discovering…";
      const { suggestions: result } = await apiPost(`/apps/discovery/${site.id}`);
      row.querySelector("button").textContent = "Discover";
      const text = `${result.elements.map(item => `${item.label}: ${item.selector}`).join("\n")}${result.notes ? `\nNotes: ${result.notes}` : ""}`;
      row.querySelector("pre").textContent = text;
    });
    siteTable.appendChild(row);
  });
}

if (appParam) {
  loadApp(appParam);
} else if (categoryParam) {
  loadCategory(categoryParam);
} else {
  heading.textContent = "Apps";
  description.textContent = "Provide a category parameter to explore curated autopilots.";
}
