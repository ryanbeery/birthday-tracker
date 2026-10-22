<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ApiError, createBirthday, errorMessage } from '../api'
import { todayUtc } from '../format'

const emit = defineEmits<{ submitted: [id: string] }>()

const WINDOW_DAYS = Array.from({ length: 14 }, (_, i) => i + 1)

const blank = () => ({ name: '', email: '', birthday: '', reminderWindowDays: 7, giftIdeas: '' })
const form = reactive(blank())

// The browser checks the attributes below first. The API's field errors show
// under each field, and anything else shows above the button.
const fieldErrors = ref<Record<string, string>>({})
const formError = ref<string>()
const submitting = ref(false)

// The API rejects a birthday after today's UTC date, so the picker stops there too.
const maxDate = todayUtc()

async function submit() {
  submitting.value = true
  fieldErrors.value = {}
  formError.value = undefined
  try {
    const { id } = await createBirthday({
      ...form,
      // Left out when blank. JSON.stringify drops undefined.
      giftIdeas: form.giftIdeas.trim() || undefined,
    })
    Object.assign(form, blank())
    emit('submitted', id)
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && error.details.length > 0) {
      fieldErrors.value = Object.fromEntries(error.details.map((d) => [d.field, d.message]))
    } else {
      formError.value = errorMessage(error)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="card" @submit.prevent="submit">
    <h2>Add a birthday</h2>

    <label>
      Name
      <input v-model="form.name" required maxlength="100" autocomplete="name" />
      <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
    </label>

    <label>
      Email
      <input v-model="form.email" type="email" required autocomplete="email" />
      <span v-if="fieldErrors.email" class="field-error">{{ fieldErrors.email }}</span>
    </label>

    <label>
      Birthday
      <input v-model="form.birthday" type="date" required min="1900-01-01" :max="maxDate" />
      <span v-if="fieldErrors.birthday" class="field-error">{{ fieldErrors.birthday }}</span>
    </label>

    <label>
      Remind me
      <select v-model.number="form.reminderWindowDays">
        <option v-for="days in WINDOW_DAYS" :key="days" :value="days">
          {{ days }} {{ days === 1 ? 'day' : 'days' }} before
        </option>
      </select>
      <span v-if="fieldErrors.reminderWindowDays" class="field-error">{{ fieldErrors.reminderWindowDays }}</span>
    </label>

    <label>
      Gift ideas (optional)
      <textarea v-model="form.giftIdeas" maxlength="500" rows="3" />
      <span class="hint">{{ form.giftIdeas.length }}/500</span>
      <span v-if="fieldErrors.giftIdeas" class="field-error">{{ fieldErrors.giftIdeas }}</span>
    </label>

    <p v-if="formError" class="error" role="alert">{{ formError }}</p>

    <!-- Disabled while posting, so a double click can't submit the same entry twice. -->
    <button type="submit" :disabled="submitting">{{ submitting ? 'Submitting…' : 'Submit' }}</button>
  </form>
</template>

<style scoped>
form {
  display: grid;
  gap: 0.75rem;
}

label {
  display: grid;
  gap: 0.25rem;
}

.field-error {
  color: var(--error);
  font-size: 0.875rem;
}

.hint {
  color: var(--muted);
  font-size: 0.75rem;
  justify-self: end;
}
</style>
