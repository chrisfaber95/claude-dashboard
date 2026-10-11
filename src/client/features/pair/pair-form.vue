<script setup lang="ts">
import { ref } from 'vue';
import {
  PAIR_INVALID_TEXT,
  PAIR_UNREACHABLE_TEXT,
  isPairSuccess,
  pairFailureText,
} from './pair.logic.ts';

const props = defineProps<{
  isCodeValid: boolean;
  deviceName: string;
  code: string;
  goHome: () => void;
}>();

const errorText = ref(props.isCodeValid ? '' : PAIR_INVALID_TEXT);
const isBusy = ref(false);

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function submit(): Promise<void> {
  isBusy.value = true;
  errorText.value = '';
  try {
    const response = await fetch('/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ c: props.code }),
      credentials: 'same-origin',
    });
    if (response.ok && isPairSuccess(await readBody(response))) {
      props.goHome();
      return;
    }
    errorText.value = pairFailureText(response.status);
  } catch {
    errorText.value = PAIR_UNREACHABLE_TEXT;
  }
  isBusy.value = false;
}
</script>

<template>
  <form id="pair" class="panel login__form" @submit.prevent="submit">
    <h1>Claude Dashboard</h1>
    <!-- Without a valid code there is nothing to press: only the message shows. -->
    <p v-if="isCodeValid" id="ask" class="sub">Sign in as <strong>{{ deviceName }}</strong>?</p>
    <p id="err" class="login__err" role="alert">{{ errorText }}</p>
    <button v-if="isCodeValid" id="go" class="btn btn--primary" type="submit" :disabled="isBusy">Sign in</button>
  </form>
</template>
