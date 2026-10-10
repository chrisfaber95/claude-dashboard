const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value for HTML text or a quoted attribute; every interpolated value goes through it. */
export const esc = (value: unknown) => String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]!);
