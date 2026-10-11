<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PairingInfo } from '../../../shared/types/index.ts';
import type { QrShape } from './qr.logic.ts';

const props = defineProps<{ deviceName: string; info: PairingInfo }>();
const emit = defineEmits<{ close: []; expired: []; drawFailed: [] }>();

const NO_LAN_NOTE = 'No LAN address was found. The phone cannot reach this link unless it is opened from a LAN address.';

// The pairing links live only in memory while this component is mounted; never in storage or the console.
const links = computed(() => (props.info.urls.length > 0 ? [...props.info.urls] : [location.origin + props.info.path]));
const hasLan = computed(() => props.info.urls.length > 0);
const selectedIndex = ref(0);
const shape = ref<QrShape | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let drawCount = 0;

const addressOptions = computed(() =>
  links.value.map((link, index) => {
    try {
      return { index, label: new URL(link).host }; // host:port only, never the code
    } catch {
      return { index, label: `Address ${index + 1}` };
    }
  }),
);
const expiryText = computed(() => `Expires at ${new Date(props.info.expiresMs).toLocaleTimeString()}`);

/** Draw the selected link; the QR library is fetched on the first call only. */
async function draw(): Promise<void> {
  drawCount += 1;
  const thisDraw = drawCount;
  try {
    const { qrShape } = await import('./qr.logic.ts');
    const drawn = qrShape(links.value[selectedIndex.value] ?? '');
    if (thisDraw === drawCount) shape.value = drawn;
  } catch {
    if (thisDraw !== drawCount) return;
    shape.value = null;
    emit('drawFailed');
  }
}

watch([links, selectedIndex], () => void draw(), { immediate: true });

onMounted(() => {
  timer = setTimeout(() => emit('expired'), Math.max(0, props.info.expiresMs - Date.now()));
});

onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer);
  drawCount += 1;
});
</script>

<template>
  <div id="devices-qr" class="devices__qr">
    <div class="sub">
      <strong id="devices-qr-name">{{ deviceName }}</strong
      >: scan with the phone. Works once, for 10 minutes.
    </div>
    <select
      v-if="addressOptions.length > 1"
      id="devices-qr-addr"
      v-model.number="selectedIndex"
      aria-label="Address the QR code points to"
    >
      <option v-for="option in addressOptions" :key="option.index" :value="option.index">{{ option.label }}</option>
    </select>
    <div id="devices-qr-draw" class="devices__qr-draw">
      <svg
        v-if="shape"
        class="devices__qr-svg"
        :viewBox="`0 0 ${shape.size} ${shape.size}`"
        shape-rendering="crispEdges"
        role="img"
        :aria-label="`QR code to sign in ${deviceName}`"
      >
        <path :d="shape.d" />
      </svg>
    </div>
    <div id="devices-qr-expiry" class="sub">{{ expiryText }}</div>
    <div id="devices-qr-note" class="sub">{{ hasLan ? '' : NO_LAN_NOTE }}</div>
    <div class="devices__token-actions">
      <button id="devices-qr-close" class="btn btn--sm" type="button" @click="emit('close')">Close</button>
    </div>
  </div>
</template>
