export async function apiGet(path) {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

export async function apiPost(path, body) {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json();
}

function toWebSocketUrl(path) {
  const origin = window.location.origin.replace(/^http/, "ws");
  return new URL(path, origin);
}

export function openLogStream(requestId, onMessage) {
  const url = toWebSocketUrl(`/api/requests/${requestId}/stream`);
  const ws = new WebSocket(url);
  ws.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);
      onMessage(payload);
    } catch {
      onMessage({ raw: event.data });
    }
  };
  return ws;
}

export function openGlobalLogStream(onMessage) {
  const url = toWebSocketUrl(`/api/logs`);
  const ws = new WebSocket(url);
  ws.onmessage = event => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      onMessage({ raw: event.data });
    }
  };
  return ws;
}

export async function copyToClipboard(text, label = "Copied!") {
  await navigator.clipboard.writeText(text);
  const toast = document.createElement("div");
  toast.textContent = label;
  toast.style.position = "fixed";
  toast.style.bottom = "24px";
  toast.style.right = "24px";
  toast.style.background = "rgba(56, 189, 248, 0.9)";
  toast.style.color = "#0f172a";
  toast.style.padding = "12px 18px";
  toast.style.borderRadius = "12px";
  toast.style.fontWeight = "600";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}
