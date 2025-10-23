const channels = new Map<string, Set<WebSocket>>();

function getChannel(id: string) {
  const key = id || "*";
  if (!channels.has(key)) {
    channels.set(key, new Set());
  }
  return channels.get(key)!;
}

export function subscribeToRequestLogs(websocket: WebSocket, requestId?: string) {
  const channel = getChannel(requestId ?? "*");
  channel.add(websocket);

  websocket.addEventListener("close", () => {
    channel.delete(websocket);
    if (channel.size === 0) {
      channels.delete(requestId ?? "*");
    }
  });
}

export function broadcastLogEntry(entry: unknown, requestId?: string) {
  const targets = new Set<WebSocket>();
  const channelKey = requestId ?? "*";
  const specific = channels.get(channelKey);
  const broadcastAll = channels.get("*");
  if (specific) {
    specific.forEach(ws => targets.add(ws));
  }
  if (broadcastAll && channelKey !== "*") {
    broadcastAll.forEach(ws => targets.add(ws));
  }

  const payload = typeof entry === "string" ? entry : JSON.stringify(entry);
  for (const ws of targets) {
    try {
      ws.send(payload);
    } catch (error) {
      console.error("Failed to broadcast log entry", error);
      ws.close();
    }
  }
}
