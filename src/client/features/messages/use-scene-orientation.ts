import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Ref } from 'vue';
import type { KingdomOrientation } from './kingdom-layout-types.logic.ts';
import { orientationFor } from './kingdom-scene.logic.ts';

/** Wide or tall for the element's current size; follows resizes through a `ResizeObserver`, never a timer. */
export function useSceneOrientation(target: Ref<HTMLElement | null>): Ref<KingdomOrientation> {
  const orientation = ref<KingdomOrientation>('wide');
  let observer: ResizeObserver | null = null;

  onMounted(() => {
    const element = target.value;
    if (!element || typeof ResizeObserver === 'undefined') return;
    observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (size) orientation.value = orientationFor(size.width, size.height);
    });
    observer.observe(element);
  });
  onBeforeUnmount(() => observer?.disconnect());

  return orientation;
}
