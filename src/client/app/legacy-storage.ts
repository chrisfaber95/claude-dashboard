/** Drop the old per-browser task history, replaced by the server-side launch history. */
export function clearLegacyRecentTasks(): void {
  try {
    localStorage.removeItem('recentTasks');
  } catch {
    // storage unavailable
  }
}
