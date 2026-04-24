<script setup lang="ts">
import type { CSSProperties } from 'vue'

import { useBroadcastChannel } from '@vueuse/core'
import { computed, onUnmounted, ref, watch } from 'vue'

import ChatBubbleMinimalism from './chat-bubble-minimalism.vue'

type PresentEvent
  = | { type: 'assistant-reset' }
    | { type: 'assistant-append', text: string, mode: 'stream-sentence' }
    | { type: 'assistant-show-chunk', text: string }
    | { type: 'assistant-append-current-chunk', text: string }
    | { type: 'assistant-hide-chunk' }
    | { type: 'assistant-complete' }

/**
 * Keeps the bubble mirrored around the character center line so replies can
 * appear on either side while still pointing back toward the character.
 */
const mirroredOffsetPx = 246
const SENTENCE_WAIT_POLL_MS = 400
const SENTENCE_ENDINGS = new Set(['。', '！', '？', '!', '?', '；', ';', '：', ':'])
const LEADING_SENTENCE_OPENERS = new Set(['"', '\'', '“', '‘', '（', '【', '《', '「', '『'])
const TRAILING_SENTENCE_CLOSERS = new Set(['"', '\'', ')', ']', '}', '”', '’', '）', '】', '》', '」', '』'])
const QUOTE_LIKE_DECORATORS = new Set(['"', '\'', '“', '”', '‘', '’', '（', '）', '【', '】', '《', '》', '「', '」', '『', '』', '〔', '〕'])
const SENTENCE_MS_PER_TEN_CHARS = 2000
const SENTENCE_ELLIPSIS_BONUS_MS = 500

const sentenceBuffer = ref('')
const pendingSentences = ref<string[]>([])
const currentSentence = ref('')
const currentSpeechChunk = ref('')
const pendingSpeechLeadingOpeners = ref('')
const isVisible = ref(false)
const isLoading = ref(false)
const bubbleKey = ref(0)
const placementSide = ref<'left' | 'right'>(Math.random() > 0.5 ? 'left' : 'right')
const activeMode = ref<'speech-chunk' | 'stream-sentence'>('stream-sentence')

const bubbleText = computed(() => {
  if (activeMode.value === 'speech-chunk')
    return currentSpeechChunk.value

  return currentSentence.value.trim()
})
const bubbleTailSide = computed<'left' | 'right'>(() => placementSide.value === 'left' ? 'right' : 'left')

const { data: presentEvent } = useBroadcastChannel<PresentEvent, PresentEvent>({ name: 'airi-chat-present' })

let switchTimer: ReturnType<typeof setTimeout> | undefined

const bubblePositionStyle = computed<CSSProperties>(() => {
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

function isTrailingSentenceClosersOnly(text: string) {
  const normalizedText = text.trim()
  return normalizedText.length > 0
    && [...normalizedText].every(character => TRAILING_SENTENCE_CLOSERS.has(character))
}

function stripQuoteLikeDecorators(text: string) {
  return [...text]
    .filter(character => !QUOTE_LIKE_DECORATORS.has(character))
    .join('')
}

function isLeadingSentenceOpenersOnly(text: string) {
  const normalizedText = text.trim()
  return normalizedText.length > 0
    && [...normalizedText].every(character => LEADING_SENTENCE_OPENERS.has(character))
}

function mergeStandaloneQuoteFragments(completed: string[], remaining: string) {
  const normalizedCompleted: string[] = []
  let leadingOpeners = ''

  for (const sentence of completed) {
    const normalizedSentence = sentence.trim()
    if (!normalizedSentence)
      continue

    if (isLeadingSentenceOpenersOnly(normalizedSentence)) {
      leadingOpeners += normalizedSentence
      continue
    }

    if (leadingOpeners) {
      normalizedCompleted.push(`${leadingOpeners}${normalizedSentence}`)
      leadingOpeners = ''
      continue
    }

    normalizedCompleted.push(normalizedSentence)
  }

  return {
    completed: normalizedCompleted,
    remaining: leadingOpeners ? `${leadingOpeners}${remaining}` : remaining,
  }
}

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

    const sentenceEndingWidth = nextThreeCharacters === '...'
      ? 3
      : nextTwoCharacters === '……'
        ? 2
        : 1
    const sentenceEndingLastIndex = index + sentenceEndingWidth - 1
    const isBufferBoundarySentenceEnding = character !== '\n' && sentenceEndingLastIndex >= buffer.length - 1

    if (isBufferBoundarySentenceEnding) {
      break
    }

    while (index + 1 < buffer.length && TRAILING_SENTENCE_CLOSERS.has(buffer[index + 1])) {
      index += 1
      currentChunk += buffer[index]
    }

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

  return mergeStandaloneQuoteFragments(completed, buffer.slice(lastConsumedIndex))
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
  activeMode.value = 'stream-sentence'
  sentenceBuffer.value = ''
  pendingSentences.value = []
  currentSentence.value = ''
  currentSpeechChunk.value = ''
  pendingSpeechLeadingOpeners.value = ''
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

function attachTrailingClosersToPreviousSentence(text: string) {
  const trailingClosers = text.trim()
  if (!trailingClosers)
    return false

  const lastPendingSentenceIndex = pendingSentences.value.length - 1
  if (lastPendingSentenceIndex >= 0) {
    pendingSentences.value[lastPendingSentenceIndex] += trailingClosers
    return true
  }

  if (currentSentence.value) {
    currentSentence.value += trailingClosers
    bubbleKey.value += 1
    return true
  }

  return false
}

function appendToBubble(nextText: string) {
  const normalizedText = stripQuoteLikeDecorators(nextText)
  if (!normalizedText)
    return

  isVisible.value = true
  isLoading.value = false
  sentenceBuffer.value += normalizedText

  const { completed, remaining } = extractCompletedSentences(sentenceBuffer.value)
  sentenceBuffer.value = remaining

  enqueueCompletedSentences(completed)

  if (isTrailingSentenceClosersOnly(sentenceBuffer.value) && attachTrailingClosersToPreviousSentence(sentenceBuffer.value)) {
    sentenceBuffer.value = ''
  }
}

function showSpeechChunk(nextText: string) {
  const displayText = stripQuoteLikeDecorators(nextText)
  if (!displayText)
    return

  if (!displayText.trim())
    return

  const normalizedText = displayText

  if (isLeadingSentenceOpenersOnly(normalizedText)) {
    pendingSpeechLeadingOpeners.value += normalizedText
    return
  }

  if (isTrailingSentenceClosersOnly(normalizedText) && currentSpeechChunk.value) {
    currentSpeechChunk.value += normalizedText
    bubbleKey.value += 1
    return
  }

  clearSwitchTimer()
  activeMode.value = 'speech-chunk'
  currentSpeechChunk.value = `${pendingSpeechLeadingOpeners.value}${normalizedText}`
  pendingSpeechLeadingOpeners.value = ''
  isVisible.value = true
  isLoading.value = false
  bubbleKey.value += 1
}

function hideSpeechChunk() {
  if (activeMode.value !== 'speech-chunk')
    return

  if (pendingSpeechLeadingOpeners.value)
    return

  isVisible.value = false
}

function appendCurrentSpeechChunk(nextText: string) {
  if (activeMode.value !== 'speech-chunk')
    return

  const normalizedText = stripQuoteLikeDecorators(nextText)
  if (!normalizedText)
    return

  currentSpeechChunk.value += normalizedText
  if (isVisible.value)
    bubbleKey.value += 1
}

function flushRemainingSentence() {
  isLoading.value = false

  if (isTrailingSentenceClosersOnly(sentenceBuffer.value) && attachTrailingClosersToPreviousSentence(sentenceBuffer.value)) {
    sentenceBuffer.value = ''
  }
  else if (isLeadingSentenceOpenersOnly(sentenceBuffer.value)) {
    return
  }
  else if (sentenceBuffer.value.trim()) {
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
    activeMode.value = 'stream-sentence'
    appendToBubble(event.text)
    return
  }

  if (event.type === 'assistant-show-chunk') {
    showSpeechChunk(event.text)
    return
  }

  if (event.type === 'assistant-append-current-chunk') {
    appendCurrentSpeechChunk(event.text)
    return
  }

  if (event.type === 'assistant-hide-chunk') {
    hideSpeechChunk()
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
