<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiError, errorMessage, getBirthday, listBirthdays, type Birthday } from './api'
import BirthdayForm from './components/BirthdayForm.vue'
import { formatDate, formatDaysUntil } from './format'

// The list

const birthdays = ref<Birthday[]>([])
const listLoading = ref(true)
const listError = ref<string>()
const nameFilter = ref('')

const shown = computed(() => {
  const needle = nameFilter.value.trim().toLowerCase()
  return birthdays.value.filter((b) => b.name.toLowerCase().includes(needle))
})

async function loadList() {
  listLoading.value = true
  listError.value = undefined
  try {
    birthdays.value = await listBirthdays()
  } catch (error) {
    listError.value = errorMessage(error)
  } finally {
    listLoading.value = false
  }
}

onMounted(loadList)

// The detail panel

type Detail =
  | { state: 'empty' }
  | { state: 'loading' }
  | { state: 'loaded'; birthday: Birthday }
  // Submitted (202) but not saved yet, so the API still answers 404.
  | { state: 'processing' }
  | { state: 'not-found' }
  | { state: 'error'; message: string }

const selectedId = ref<string>()
const detail = ref<Detail>({ state: 'empty' })
// The last submission's id, so a 404 for it reads "processing", not "not found".
const submittedId = ref<string>()

async function loadDetail(id: string) {
  selectedId.value = id
  // Keep "processing" on screen while it checks again.
  if (detail.value.state !== 'processing') {
    detail.value = { state: 'loading' }
  }
  try {
    const birthday = await getBirthday(id)
    if (selectedId.value === id) {
      detail.value = { state: 'loaded', birthday }
    }
  } catch (error) {
    // Ignore the answer if another entry was opened in the meantime.
    if (selectedId.value !== id) return
    if (error instanceof ApiError && error.status === 404) {
      detail.value = { state: id === submittedId.value ? 'processing' : 'not-found' }
    } else {
      detail.value = { state: 'error', message: errorMessage(error) }
    }
  }
}

function onSubmitted(id: string) {
  submittedId.value = id
  selectedId.value = id
  detail.value = { state: 'processing' }
  // A 202 means accepted, not saved. Give the coordinator about a second, then
  // look once. If it's still not there, the Refresh button checks again.
  setTimeout(() => {
    if (selectedId.value === id) {
      loadDetail(id)
    }
    loadList()
  }, 1000)
}

function refresh() {
  if (selectedId.value) {
    loadDetail(selectedId.value)
  }
  loadList()
}
</script>

<template>
  <header>
    <h1>Birthday Tracker</h1>
  </header>

  <main>
    <BirthdayForm @submitted="onSubmitted" />

    <section class="card">
      <h2>Upcoming birthdays</h2>
      <input v-model="nameFilter" type="search" placeholder="Filter by name" aria-label="Filter by name" />

      <p v-if="listLoading && birthdays.length === 0">Loading…</p>
      <div v-else-if="listError" class="error" role="alert">
        <p>{{ listError }}</p>
        <button type="button" @click="loadList">Retry</button>
      </div>
      <p v-else-if="birthdays.length === 0">No birthdays yet. Add one to get started.</p>
      <p v-else-if="shown.length === 0">No names match "{{ nameFilter }}".</p>
      <ul v-else class="list">
        <li v-for="b in shown" :key="b.id">
          <button type="button" :class="{ selected: b.id === selectedId }" @click="loadDetail(b.id)">
            <span class="name">{{ b.name }}</span>
            <span class="when">turning {{ b.turningAge }} {{ formatDaysUntil(b.daysUntil) }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>Details</h2>

      <p v-if="detail.state === 'empty'" class="muted">Select a birthday to see its details.</p>
      <p v-else-if="detail.state === 'loading'">Loading…</p>
      <div v-else-if="detail.state === 'processing'">
        <p>Submitted, processing. It should appear in a moment.</p>
        <button type="button" @click="refresh">Refresh</button>
      </div>
      <p v-else-if="detail.state === 'not-found'">This birthday wasn't found.</p>
      <div v-else-if="detail.state === 'error'" class="error" role="alert">
        <p>{{ detail.message }}</p>
        <button type="button" @click="refresh">Retry</button>
      </div>
      <dl v-else>
        <dt>Name</dt>
        <dd>{{ detail.birthday.name }}</dd>
        <dt>Email</dt>
        <dd>{{ detail.birthday.email }}</dd>
        <dt>Birthday</dt>
        <dd>{{ formatDate(detail.birthday.birthday) }}</dd>
        <dt>Next birthday</dt>
        <dd>
          {{ formatDate(detail.birthday.nextBirthday) }}: turning {{ detail.birthday.turningAge }}
          {{ formatDaysUntil(detail.birthday.daysUntil) }}
        </dd>
        <dt>Reminder</dt>
        <dd>
          {{ detail.birthday.reminderWindowDays }}
          {{ detail.birthday.reminderWindowDays === 1 ? 'day' : 'days' }} before
        </dd>
        <dt>Gift ideas</dt>
        <dd class="gift-ideas">{{ detail.birthday.giftIdeas ?? 'None' }}</dd>
      </dl>
    </section>
  </main>
</template>

<style>
:root {
  --text: #1f2328;
  --muted: #656d76;
  --border: #d0d7de;
  --surface: #ffffff;
  --background: #f6f8fa;
  --accent: #0969da;
  --error: #cf222e;
  font-family: system-ui, sans-serif;
  color: var(--text);
  background: var(--background);
}

body {
  margin: 0;
  padding: 1rem;
}

input,
select,
textarea,
button {
  font: inherit;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
}

button {
  cursor: pointer;
  background: var(--surface);
}

button[type='submit'] {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem;
}

.error {
  color: var(--error);
}

.muted {
  color: var(--muted);
}

h2 {
  margin-top: 0;
}
</style>

<style scoped>
header,
main {
  max-width: 72rem;
  margin: 0 auto;
}

main {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  align-items: start;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0.75rem 0 0;
  display: grid;
  gap: 0.25rem;
}

.list button {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  text-align: left;
}

.list button.selected {
  border-color: var(--accent);
  outline: 1px solid var(--accent);
}

.when {
  color: var(--muted);
}

.name {
  overflow-wrap: anywhere;
}

dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem 1rem;
  margin: 0;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

/* Gift ideas keep the line breaks they were typed with. */
.gift-ideas {
  white-space: pre-wrap;
}
</style>
