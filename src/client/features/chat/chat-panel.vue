<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useChat } from './use-chat.ts';

const STICK_TO_BOTTOM_PX = 40;

const chat = useChat();
const input = ref('');
const logElement = ref<HTMLElement | null>(null);

// Runs before the DOM update: only a log already at the bottom follows new lines, so reading older ones is not interrupted.
// A new confirmation always scrolls into view.
watch([chat.history, chat.pending], async () => {
  const box = logElement.value;
  if (!box) return;
  const isNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_TO_BOTTOM_PX;
  await nextTick();
  if (isNearBottom || chat.pending.value) box.scrollTop = box.scrollHeight;
});

function send(): void {
  if (chat.submit(input.value)) input.value = '';
}
</script>

<template>
  <h2 id="h-chat">Ask the dashboard</h2>
  <div id="chat-log" ref="logElement" class="chat__log" role="log" aria-live="polite">
    <div v-for="entry in chat.history.value" :key="entry.id" :class="['chat__msg', `chat__msg--${entry.role}`]">{{ entry.text }}</div>
    <div v-if="chat.pending.value" id="chat-confirm" class="chat__confirm">
      <div>Send to <strong>{{ chat.pending.value.name }}</strong>:</div>
      <pre class="chat__quote">{{ chat.pending.value.text }}</pre>
      <div class="chat__actions">
        <button class="btn btn--sm btn--primary" type="button" @click="chat.confirm()">Confirm</button>
        <button class="btn btn--sm" type="button" @click="chat.cancel()">Cancel</button>
      </div>
    </div>
  </div>
  <form id="chat-form" class="chat__form" @submit.prevent="send">
    <input
      id="chat-input"
      v-model="input"
      type="text"
      maxlength="2000"
      autocomplete="off"
      aria-label="Ask the dashboard"
      placeholder="What is going on?"
    >
    <button class="btn btn--sm" type="submit">Send</button>
  </form>
</template>
