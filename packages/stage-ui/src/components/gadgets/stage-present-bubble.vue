<script setup lang="ts">
import { useBroadcastChannel } from '@vueuse/core'
import { computed, onUnmounted, ref, watch } from 'vue'

import ChatBubbleMinimalism from './chat-bubble-minimalism.vue'

type PresentEvent
  = | { type: 'assistant-reset' }
    | { type: 'assistant-append', text: string }

/**
 * Keeps the bubble mirrored around the character center line so replies can
 * appear on either side while still pointing back toward the character.
 */
const mirroredOffsetPx = 246
const BUBBLE_IDLE_HIDE_DELAY_MS = 20000

const text = ref('')
const isVisible = ref(false)
const isLoading = ref(false)
const bubbleKey = ref(0)
const placementSide = ref<'left' | 'right'>(Math.random() > 0.5 ? 'left' : 'right')

const bubbleText = computed(() => text.value.trim())
const bubbleTailSide = computed<'left' | 'right'>(() => placementSide.value === 'left' ? 'right' : 'left')

const { data: presentEvent } = useBroadcastChannel<PresentEvent, PresentEvent>({ name: 'airi-chat-present' })

let hideTimer: ReturnType<typeof setTimeout> | undefined

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

function clearHideTimer() {
  if (!hideTimer)
    return

  clearTimeout(hideTimer)
  hideTimer = undefined
}

function scheduleHide() {
  clearHideTimer()
  hideTimer = setTimeout(() => {
    isVisible.value = false
  }, BUBBLE_IDLE_HIDE_DELAY_MS)
}

function resetBubble() {
  clearHideTimer()
  placementSide.value = Math.random() > 0.5 ? 'left' : 'right'
  text.value = ''
  isVisible.value = true
  isLoading.value = true
  bubbleKey.value++
}

function appendToBubble(nextText: string) {
  if (!nextText)
    return

  isVisible.value = true
  isLoading.value = false
  text.value += nextText
  scheduleHide()
}

watch(presentEvent, (event) => {
  if (!event)
    return

  if (event.type === 'assistant-reset') {
    resetBubble()
    return
  }

  if (event.type === 'assistant-append')
    appendToBubble(event.text)
}, { immediate: true })

onUnmounted(() => {
  clearHideTimer()
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
          :loading="isLoading"
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
