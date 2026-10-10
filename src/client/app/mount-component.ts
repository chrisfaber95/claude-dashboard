import { createApp } from 'vue';
import type { App, Component } from 'vue';

/** Mount a Vue component into an existing page element by id; returns the app, or null when the element is missing. */
export function mountComponent(component: Component, elementId: string, props: Record<string, unknown> = {}): App | null {
  const host = document.getElementById(elementId);
  if (!host) return null;
  const app = createApp(component, props);
  app.mount(host);
  return app;
}
