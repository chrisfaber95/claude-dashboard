<script setup lang="ts">
import { ref } from 'vue';

const msg = ref('x');
const html = ref('<b>x</b>');
</script>

<template>
  <p v-html="html">{{ msg }}</p>
</template>
