<script setup lang="ts">
import { useBroadcastChannel } from '@vueuse/core'
import { computed, onUnmounted, ref, watch } from 'vue'

import ChatBubbleMinimalism from './chat-bubble-minimalism.vue'

type PresentEvent
  = | { type: 'assistant-reset' }
    | { type: 'assistant-append', text: string }
    | { type: 'assistant-complete' }

/**
 * Keeps the bubble mirrored around the character center line so replies can
 * appear on either side while still pointing back toward the character.
 */
const mirroredOffsetPx = 246
const SENTENCE_WAIT_POLL_MS = 400
const SENTENCE_ENDINGS = new Set(['。', '！', '？', '!', '?', '；', ';', '：', ':'])
const SENTENCE_MS_PER_TEN_CHARS = 2000
const SENTENCE_ELLIPSIS_BONUS_MS = 500

const sentenceBuffer = ref('')
const pendingSentences = ref<string[]>([])
const currentSentence = ref('')
const isVisible = ref(false)
const isLoading = ref(false)
const bubbleKey = ref(0)
const placementSide = ref<'left' | 'right'>(Math.random() > 0.5 ? 'left' : 'right')

const bubbleText = computed(() => currentSentence.value.trim())
const bubbleTailSide = computed<'left' | 'right'>(() => placementSide.value === 'left' ? 'right' : 'left')

const { data: presentEvent } = useBroadcastChannel<PresentEvent, PresentEvent>({ name: 'airi-chat-present' })

let switchTimer: ReturnType<typeof setTimeout> | undefined

const bubblePositionStyle = computed(() => {
  return placementSide.value === 'left'
    ? {
        right: `${mirroredOffsetPx}px`,
        bottom: '0px',
        position: 'absolute',
      }
    : {
        left: `${mirroredOffsetPx}px`,
        bottom: '0px',
        position: 'absolute',
      }
})

function clearSwitchTimer() {
  if (!switchTimer)
    return

  clearTimeout(switchTimer)
  switchTimer = undefined
}

function scheduleSwitch(delayMs: number) {
  clearSwitchTimer()
  switchTimer = setTimeout(() => {
    showNextSentence()
  }, delayMs)
}

/**
 * Estimates how long a sentence should stay visible based on reading rhythm.
 * Roughly ten characters map to one second, with a small pause bonus for
 * ellipsis endings so hesitant lines do not flip too quickly.
 */
function getSentenceDisplayDurationMs(sentence: string): number {
  const normalizedSentence = sentence.trim()
  if (!normalizedSentence)
    return SENTENCE_MS_PER_TEN_CHARS

  const baseDurationMs = Math.max(
    SENTENCE_MS_PER_TEN_CHARS,
    Math.ceil(normalizedSentence.length / 10) * SENTENCE_MS_PER_TEN_CHARS,
  )

  const ellipsisBonusMs = normalizedSentence.includes('...')
    || normalizedSentence.includes('……')
    ? SENTENCE_ELLIPSIS_BONUS_MS
    : 0

  return baseDurationMs + ellipsisBonusMs
}

/**
 * Splits the stream cache into completed sentences while preserving any
 * trailing unfinished fragment for later tokens.
 */
function extractCompletedSentences(buffer: string): { completed: string[], remaining: string } {
  const completed: string[] = []
  let currentChunk = ''
  let lastConsumedIndex = 0

  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index]
    currentChunk += character

    const nextThreeCharacters = buffer.slice(index, index + 3)
    const nextTwoCharacters = buffer.slice(index, index + 2)
    const isSentenceEnding = SENTENCE_ENDINGS.has(character)
      || character === '\n'
      || nextThreeCharacters === '...'
      || nextTwoCharacters === '……'

    if (!isSentenceEnding)
      continue

    const normalizedSentence = currentChunk.trim()
    if (normalizedSentence)
      completed.push(normalizedSentence)

    currentChunk = ''
    lastConsumedIndex = index + 1

    if (nextThreeCharacters === '...')
      index += 2
    else if (nextTwoCharacters === '……')
      index += 1
  }

  return {
    completed,
    remaining: buffer.slice(lastConsumedIndex),
  }
}

function showNextSentence() {
  const nextSentence = pendingSentences.value.shift()

  if (nextSentence) {
    currentSentence.value = nextSentence
    isVisible.value = true
    isLoading.value = false
    bubbleKey.value += 1
    scheduleSwitch(getSentenceDisplayDurationMs(nextSentence))
    return
  }

  if (isLoading.value) {
    isVisible.value = true
    scheduleSwitch(SENTENCE_WAIT_POLL_MS)
    return
  }

  currentSentence.value = ''
  isVisible.value = false
}

function resetBubble() {
  clearSwitchTimer()
  placementSide.value = Math.random() > 0.5 ? 'left' : 'right'
  sentenceBuffer.value = ''
  pendingSentences.value = []
  currentSentence.value = ''
  isVisible.value = true
  isLoading.value = true
  bubbleKey.value += 1
}

function enqueueCompletedSentences(sentences: string[]) {
  const normalizedSentences = sentences.map(sentence => sentence.trim()).filter(Boolean)
  if (!normalizedSentences.length)
    return

  pendingSentences.value.push(...normalizedSentences)

  if (!currentSentence.value) {
    showNextSentence()
    return
  }

  if (!switchTimer)
    scheduleSwitch(getSentenceDisplayDurationMs(currentSentence.value))
}

function appendToBubble(nextText: string) {
  if (!nextText)
    return

  isVisible.value = true
  isLoading.value = false
  sentenceBuffer.value += nextText

  const { completed, remaining } = extractCompletedSentences(sentenceBuffer.value)
  sentenceBuffer.value = remaining

  enqueueCompletedSentences(completed)
}

function flushRemainingSentence() {
  isLoading.value = false

  if (sentenceBuffer.value.trim()) {
    enqueueCompletedSentences([sentenceBuffer.value])
    sentenceBuffer.value = ''
  }

  if (!switchTimer && currentSentence.value)
    scheduleSwitch(getSentenceDisplayDurationMs(currentSentence.value))
}

watch(presentEvent, (event) => {
  if (!event)
    return

  if (event.type === 'assistant-reset') {
    resetBubble()
    return
  }

  if (event.type === 'assistant-append') {
    appendToBubble(event.text)
    return
  }

  if (event.type === 'assistant-complete')
    flushRemainingSentence()
}, { immediate: true })

onUnmounted(() => {
  clearSwitchTimer()
})
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-300"
    leave-active-class="transition-opacity duration-400"
    enter-from-class="opacity-0"
    leave-to-class="opacity-0"
  >
    <div
      v-if="isVisible && (isLoading || bubbleText)"
      :style="bubblePositionStyle"
      :class="[
        'pointer-events-none absolute z-20 flex max-w-[min(28rem,calc(100vw-2rem))] flex-col',
      ]"
    >
      <div class="w-[min(24rem,calc(100vw-2rem))]">
        <ChatBubbleMinimalism
          :key="bubbleKey"
          :text="bubbleText"
          :loading="isLoading && !bubbleText"
          :side="bubbleTailSide"
          :container-class="[
            'w-fit max-w-full',
          ]"
          :container-class-extra="[
            'shadow-[0_18px_60px_rgba(0,0,0,0.18)]',
            'dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]',
          ]"
          :text-class="[
            'text-base leading-7 font-medium',
            'whitespace-normal break-words',
            'text-neutral-700 dark:text-neutral-100',
          ]"
        />
      </div>
    </div>
  </Transition>
</template>
