<script setup lang="ts">
import { computed, ref } from 'vue';
import { SEARCH_SOURCE_TYPES } from '../../../shared/types/index.ts';
import { useDashboardState } from '../../app/dashboard-state.ts';
import { MAX_QUESTION_LENGTH, describeLocation, safeHref } from './search.logic.ts';
import { useSearch } from './use-search.ts';

const state = useDashboardState();
const search = useSearch();
const question = ref('');
const project = ref('');
const sourceType = ref('');
const isHard = ref(false);

const projectNames = computed(() => (state.value?.projects ?? []).map((entry) => entry.name));
const isEmpty = computed(() => question.value.trim() === '');
const hasNoResults = computed(() => search.results.value !== null && search.results.value.length === 0);

function submit(): void {
  void search.submit(question.value, project.value, sourceType.value, isHard.value);
}
</script>

<template>
  <h2 id="h-search">Search</h2>
  <form id="search-form" class="search__form" @submit.prevent="submit">
    <input
      id="search-input"
      v-model="question"
      type="text"
      :maxlength="MAX_QUESTION_LENGTH"
      autocomplete="off"
      aria-label="Search question"
      placeholder="Ask about the projects, wiki or transcripts"
    >
    <div class="search__filters">
      <select id="search-project" v-model="project" aria-label="Project">
        <option value="">All projects</option>
        <option v-for="name in projectNames" :key="name" :value="name">{{ name }}</option>
      </select>
      <select id="search-source" v-model="sourceType" aria-label="Source type">
        <option value="">All sources</option>
        <option v-for="type in SEARCH_SOURCE_TYPES" :key="type" :value="type">{{ type }}</option>
      </select>
      <label class="search__hard"><input id="search-hard" v-model="isHard" type="checkbox"> Hard question (uses Claude)</label>
    </div>
    <button class="btn btn--sm btn--primary" type="submit" :disabled="isEmpty || search.isLoading.value">Search</button>
  </form>

  <p v-if="search.isLoading.value" class="sub search__status" role="status">Searching...</p>

  <div v-if="search.hasBothFailed.value" class="search__error" role="alert">
    <strong>Search service unreachable</strong>
    <div>{{ search.bothError.value }}</div>
    <button class="btn btn--sm" type="button" @click="submit">Retry</button>
  </div>

  <template v-else>
    <div v-if="search.askError.value" class="search__error" role="alert">
      <div>Could not get an answer: {{ search.askError.value }}</div>
      <button class="btn btn--sm" type="button" @click="search.retryAsk()">Retry</button>
    </div>
    <div v-if="search.answer.value" class="search__answer">
      <h3 class="h3">Answer</h3>
      <div class="search__text">{{ search.answer.value.answer }}</div>
      <ul v-if="search.answer.value.citations.length" class="search__citations" aria-label="Citations">
        <li v-for="(citation, index) in search.answer.value.citations" :key="index">
          <a v-if="safeHref(citation.url)" :href="safeHref(citation.url) ?? undefined" target="_blank" rel="noopener noreferrer">{{ describeLocation(citation.source, citation.location) }}</a>
          <template v-else>{{ describeLocation(citation.source, citation.location) }}</template>
        </li>
      </ul>
      <div v-if="search.answer.value.requestId !== ''" class="search__feedback">
        <button
          class="btn btn--sm"
          type="button"
          aria-label="Thumbs down: this answer was not helpful"
          :disabled="search.feedback.value === 'sending' || search.feedback.value === 'sent'"
          @click="search.sendFeedback()"
        >
          Thumbs down
        </button>
        <span v-if="search.feedback.value === 'sent'" class="sub" role="status">Thanks, noted</span>
        <span v-if="search.feedback.value === 'error'" class="sub" role="alert">{{ search.feedbackError.value }}</span>
      </div>
    </div>

    <div v-if="search.queryError.value" class="search__error" role="alert">
      <div>Could not list results: {{ search.queryError.value }}</div>
      <button class="btn btn--sm" type="button" @click="search.retryQuery()">Retry</button>
    </div>
    <template v-if="search.results.value">
      <h3 class="h3">Results</h3>
      <p v-if="hasNoResults" class="sub">Nothing found.</p>
      <ul v-else class="search__results">
        <li v-for="(result, index) in search.results.value" :key="index" class="search__result">
          <div class="search__meta">
            <a v-if="safeHref(result.url)" :href="safeHref(result.url) ?? undefined" target="_blank" rel="noopener noreferrer">{{ describeLocation(result.source, result.location) }}</a>
            <strong v-else>{{ describeLocation(result.source, result.location) }}</strong>
            <span v-if="result.date" class="sub">{{ result.date }}</span>
            <span v-if="result.project" class="sub">{{ result.project }}</span>
          </div>
          <div class="search__snippet">{{ result.snippet }}</div>
        </li>
      </ul>
    </template>
  </template>
</template>
