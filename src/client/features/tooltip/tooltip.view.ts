import { elementById } from '../../shared/dom.ts';

const POINTER_OFFSET_PX = 14;
const VIEWPORT_MARGIN_PX = 8;

/** Show the `data-tip` text of the hovered element in the floating tooltip. Text only: never innerHTML. */
export function initTooltip(): void {
  const tooltip = elementById('tip');
  // Tooltips are plain text (newlines allowed): attribute values come back entity-decoded, so never use innerHTML here.
  function show(event: MouseEvent, text: string): void {
    tooltip.textContent = text;
    tooltip.hidden = false;
    const width = tooltip.offsetWidth;
    tooltip.style.left = `${Math.min(event.clientX + POINTER_OFFSET_PX, window.innerWidth - width - VIEWPORT_MARGIN_PX)}px`;
    tooltip.style.top = `${event.clientY + POINTER_OFFSET_PX}px`;
  }
  document.addEventListener('mousemove', (event) => {
    const target = (event.target as Element).closest('[data-tip]');
    if (target) show(event, target.getAttribute('data-tip')!);
    else tooltip.hidden = true;
  });
}
