<script setup lang="ts">
import { useBroadcastChannel, useEventListener, useLocalStorage } from '@vueuse/core'
import { computed, onUnmounted, ref, watch } from 'vue'

import ChatBubbleMinimalism from './chat-bubble-minimalism.vue'

type PresentEvent
  = | { type: 'assistant-reset' }
    | { type: 'assistant-append', text: string }

withDefaults(defineProps<{
  side?: 'left' | 'right'
}>(), {
  side: 'left',
})

const text = ref('')
const isVisible = ref(false)
const isLoading = ref(false)
const bubbleKey = ref(0)
const bubbleText = computed(() => text.value.trim())
const bubbleRef = ref<HTMLElement>()
const dragHandleRef = ref<HTMLElement>()
const fixedPosition = useLocalStorage<{
  left: number | null
  top: number | null
}>('stage/present-bubble/fixed-position', {
  left: null,
  top: null,
})
const isDragging = ref(false)
const BUBBLE_IDLE_HIDE_DELAY_MS = 5000
let hideTimer: ReturnType<typeof setTimeout> | undefined

const { data: presentEvent } = useBroadcastChannel<PresentEvent, PresentEvent>({ name: 'airi-chat-present' })

const bubbleFixedStyle = computed(() => {
  if (fixedPosition.value.left === null || fixedPosition.value.top === null)
    return undefined

  return {
    left: `${fixedPosition.value.left}px`,
    top: `${fixedPosition.value.top}px`,
  }
})

function ensureFixedPositionFromViewport() {
  if (!bubbleRef.value)
    return

  if (fixedPosition.value.left !== null && fixedPosition.value.top !== null)
    return

  const rect = bubbleRef.value.getBoundingClientRect()
  fixedPosition.value = {
    left: rect.left,
    top: rect.top,
  }
}

function startDrag(event: PointerEvent) {
  if (!bubbleRef.value)
    return

  ensureFixedPositionFromViewport()

  const rect = bubbleRef.value.getBoundingClientRect()
  const pointerOffsetX = event.clientX - rect.left
  const pointerOffsetY = event.clientY - rect.top
  isDragging.value = true

  fixedPosition.value = {
    left: rect.left,
    top: rect.top,
  }

  const handlePointerMove = (moveEvent: PointerEvent) => {
    const nextLeft = moveEvent.clientX - pointerOffsetX
    const nextTop = moveEvent.clientY - pointerOffsetY

    fixedPosition.value = {
      left: Math.max(12, nextLeft),
      top: Math.max(12, nextTop),
    }
  }

  const stopDrag = () => {
    isDragging.value = false
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopDrag)
    window.removeEventListener('pointercancel', stopDrag)
  }

  window.addEventListener('pointermove', handlePointerMove)
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
}

useEventListener(dragHandleRef, 'pointerdown', (event) => {
  event.preventDefault()
  startDrag(event)
})

function resetBubble() {
  clearHideTimer()
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
  if (!text.value)
    text.value = nextText
  else
    text.value += nextText

  scheduleHide()
}

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

watch(isVisible, (visible) => {
  if (!visible)
    return

  requestAnimationFrame(() => {
    ensureFixedPositionFromViewport()
  })
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
      v-if="isVisible"
      ref="bubbleRef"
      :style="bubbleFixedStyle"
      :class="[
        'group pointer-events-auto flex w-fit max-w-[min(24rem,calc(100vw-2rem))] flex-col items-start select-none',
        bubbleFixedStyle ? 'fixed z-20' : '',
        isDragging ? 'z-20' : '',
      ]"
    >
      <div
        ref="dragHandleRef"
        :class="[
          'mb-1 inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/35 px-2.5 py-1 text-[11px] text-white/75 backdrop-blur-md',
          'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
          isDragging ? 'opacity-100' : '',
          'cursor-grab active:cursor-grabbing',
        ]"
      >
        <div class="i-solar:drag-horizontal-linear h-3.5 w-3.5" />
        <span>Drag</span>
      </div>
      <div class="w-[min(24rem,calc(100vw-2rem))]">
        <ChatBubbleMinimalism
          :key="bubbleKey"
          :text="bubbleText"
          :loading="isLoading"
          :side="side"
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
