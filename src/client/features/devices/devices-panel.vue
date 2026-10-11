<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { DeviceInfo, PairingInfo } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { api, ApiError } from '../../shared/api.ts';
import { cleanName, createdLabel, lastSeenLabel, sortDevices } from './devices.logic.ts';
import { clearQr, drawQrLink, showQr, shownQrDeviceId } from './devices-qr.view.ts';
import { devicesStatus } from './devices-status.ts';

const REFRESH_MS = 30_000;
// Only these server strings may reach the page; anything else becomes the generic message.
const KNOWN_ERRORS = new Set([
  'invalid device name',
  'at most 100 devices',
  'unknown device',
  'could not save the device',
  'device revoked, but the change could not be saved',
]);
const GENERIC_ERROR = 'Something went wrong. Try again.';

const state = useDashboardState();
const canManage = computed(() => state.value?.features.manageDevices === true);

const devices = ref<DeviceInfo[]>([]);
const fetchedAtMs = ref(0);
const nameInput = ref('');
// The one-time token lives only here and in the DOM while shown; cleared on Dismiss, next add and hide.
const token = ref('');
const isBusy = ref(false);

let isShown = false;
let lastFetchMs = 0;
let isLoading = false;
/** A refresh was asked for while one was in flight: run again once it ends, so the change just made shows. */
let shouldRefreshAgain = false;

const rows = computed(() =>
  sortDevices(devices.value).map((device) => ({
    device,
    addedText: createdLabel(device.createdMs),
    lastSeenText: lastSeenLabel(device.lastSeenMs, fetchedAtMs.value),
  })),
);

function errorText(error: unknown): string {
  return error instanceof ApiError && KNOWN_ERRORS.has(error.message) ? error.message : GENERIC_ERROR;
}

function clearToken(): void {
  token.value = '';
}

async function refresh(): Promise<void> {
  if (isLoading) {
    shouldRefreshAgain = true;
    return;
  }
  isLoading = true;
  lastFetchMs = Date.now();
  try {
    const response = await api<{ devices: DeviceInfo[] }>('/api/devices');
    if (!isShown) return;
    devices.value = response.devices;
    fetchedAtMs.value = Date.now();
  } catch (error) {
    if (isShown) devicesStatus.value = errorText(error);
  } finally {
    isLoading = false;
    if (shouldRefreshAgain && isShown) {
      shouldRefreshAgain = false;
      void refresh();
    }
    shouldRefreshAgain = false;
  }
}

function hide(): void {
  isShown = false;
  clearToken();
  clearQr();
  devices.value = [];
  devicesStatus.value = '';
}

// Shown only on this PC; re-fetch on show and at most every 30 s while shown.
watch(
  state,
  () => {
    if (!canManage.value) {
      if (isShown) hide();
      return;
    }
    const isFirstShow = !isShown;
    isShown = true;
    if (isFirstShow || Date.now() - lastFetchMs >= REFRESH_MS) void refresh();
  },
  { immediate: true },
);

async function copyToken(): Promise<void> {
  try {
    await navigator.clipboard.writeText(token.value);
    devicesStatus.value = 'Copied.';
  } catch {
    devicesStatus.value = 'Could not copy. Select the token and copy it by hand.';
  }
}

function dismissToken(): void {
  clearToken();
  devicesStatus.value = '';
}

function closeQr(): void {
  clearQr();
  devicesStatus.value = '';
}

function pickQrAddress(event: Event): void {
  if (event.target instanceof HTMLSelectElement) drawQrLink(Number(event.target.value));
}

async function addDevice(): Promise<void> {
  if (isBusy.value) return;
  const name = cleanName(nameInput.value);
  if (name === null) {
    devicesStatus.value = 'Enter a name of 1 to 40 characters.';
    return;
  }
  clearToken();
  clearQr();
  devicesStatus.value = '';
  isBusy.value = true;
  try {
    const created = await api<{ id: string; token: string }>('/api/devices', { name });
    // The panel may have been hidden while the request was in flight: then the token is dropped, not shown.
    if (isShown) {
      clearQr();
      token.value = created.token;
      nameInput.value = '';
      devicesStatus.value = 'Device added. Copy the token now; it is shown only once.';
      void refresh();
    }
  } catch (error) {
    if (isShown) devicesStatus.value = errorText(error);
  } finally {
    isBusy.value = false;
  }
}

async function requestPairing(device: DeviceInfo): Promise<void> {
  if (isBusy.value) return;
  clearQr();
  clearToken();
  devicesStatus.value = '';
  isBusy.value = true;
  try {
    const info = await api<PairingInfo>('/api/devices/pair', { id: device.id });
    // Dropped, not drawn, when the panel was hidden while the request was in flight.
    if (isShown) {
      clearToken();
      showQr(device.id, device.name, info);
    }
  } catch (error) {
    if (isShown) devicesStatus.value = errorText(error);
  } finally {
    isBusy.value = false;
  }
}

async function revoke(device: DeviceInfo): Promise<void> {
  if (isBusy.value) return;
  if (!window.confirm(`Revoke "${device.name}"? It will be signed out and can no longer connect.`)) return;
  devicesStatus.value = '';
  if (shownQrDeviceId() === device.id) clearQr();
  isBusy.value = true;
  try {
    await api('/api/devices/revoke', { id: device.id });
  } catch (error) {
    if (isShown) devicesStatus.value = errorText(error);
  } finally {
    isBusy.value = false;
    // A failed save may still have changed the list.
    void refresh();
  }
}
</script>

<template>
  <h2 id="h-devices">Devices</h2>
  <template v-if="canManage">
    <ul id="devices-list" class="devices__list">
      <li v-if="rows.length === 0" class="empty">No devices yet.</li>
      <li v-for="row in rows" :key="row.device.id" class="devices__item">
        <div class="devices__text">
          <div class="devices__name">{{ row.device.name }}</div>
          <div class="sub">Added {{ row.addedText }} · Last seen {{ row.lastSeenText }}</div>
        </div>
        <div class="devices__actions">
          <button
            class="btn btn--sm"
            type="button"
            :disabled="isBusy"
            :aria-label="`Show QR for ${row.device.name}`"
            @click="requestPairing(row.device)"
          >
            Show QR
          </button>
          <button
            class="btn btn--sm"
            type="button"
            :disabled="isBusy"
            :aria-label="`Revoke ${row.device.name}`"
            @click="revoke(row.device)"
          >
            Revoke
          </button>
        </div>
      </li>
    </ul>
    <form id="devices-form" class="devices__form" @submit.prevent="addDevice">
      <label>
        Device name
        <input id="devices-name" v-model="nameInput" type="text" maxlength="40" autocomplete="off" required />
      </label>
      <button class="btn btn--sm" type="submit" :disabled="isBusy">Add</button>
    </form>
    <div v-if="token" id="devices-token" class="devices__token">
      <div class="sub">New device token (shown once)</div>
      <code id="devices-token-value" class="devices__token-value">{{ token }}</code>
      <div class="devices__token-actions">
        <button id="devices-token-copy" class="btn btn--sm" type="button" :disabled="isBusy" @click="copyToken">Copy</button>
        <button id="devices-token-dismiss" class="btn btn--sm" type="button" @click="dismissToken">Dismiss</button>
      </div>
    </div>
    <!-- Drawn by devices-qr.view.ts until T-077 migrates it; keep these elements free of reactive bindings. -->
    <div id="devices-qr" class="devices__qr" hidden>
      <div class="sub">
        <strong id="devices-qr-name"></strong>: scan with the phone. Works once, for 10 minutes.
      </div>
      <select id="devices-qr-addr" aria-label="Address the QR code points to" hidden @change="pickQrAddress"></select>
      <div id="devices-qr-draw" class="devices__qr-draw"></div>
      <div id="devices-qr-expiry" class="sub"></div>
      <div id="devices-qr-note" class="sub"></div>
      <div class="devices__token-actions">
        <button id="devices-qr-close" class="btn btn--sm" type="button" @click="closeQr">Close</button>
      </div>
    </div>
    <p id="devices-status" class="sub" role="status">{{ devicesStatus }}</p>
  </template>
</template>
