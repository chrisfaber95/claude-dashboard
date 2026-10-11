<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { loginErrorText } from './login.logic.ts';

const props = defineProps<{ errorCode: string | null }>();

const tokenInput = ref<HTMLInputElement | null>(null);
const errorText = computed(() => (props.errorCode ? loginErrorText(props.errorCode) : ''));

// The input is inserted after page load, so the `autofocus` attribute alone is not reliable.
onMounted(() => tokenInput.value?.focus());
</script>

<template>
  <form class="panel login__form" method="post" action="/login">
    <h1>Claude Dashboard</h1>
    <p class="sub">Paste the token from <code>.dashboard/token</code> on the dashboard PC.</p>
    <label>
      Token
      <input ref="tokenInput" name="token" type="password" autocomplete="current-password" required autofocus>
    </label>
    <p id="err" class="login__err" role="alert">{{ errorText }}</p>
    <button class="btn btn--primary" type="submit">Log in</button>
  </form>
</template>
