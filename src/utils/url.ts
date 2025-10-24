export function deriveUrlPattern(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const segments = url.pathname.split("/").filter(Boolean);
    const normalized = segments
      .map(segment => (segment.length > 12 || /\d/.test(segment) ? "*" : segment))
      .join("/");
    return `${url.hostname}/${normalized || ""}`;
  } catch {
    return rawUrl;
  }
}
