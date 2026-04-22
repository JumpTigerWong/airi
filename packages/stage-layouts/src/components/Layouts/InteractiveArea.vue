<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { ChatHistory } from '@proj-airi/stage-ui/components'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useDeferredMount } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'

import ChatActionButtons from '../Widgets/ChatActionButtons.vue'
import ChatArea from '../Widgets/ChatArea.vue'

const { isReady } = useDeferredMount()
const { sending } = storeToRefs(useChatOrchestratorStore())
const { messages } = storeToRefs(useChatSessionStore())
const { streamingMessage } = storeToRefs(useChatStreamStore())

const detailsExpanded = ref(false)

const historyMessages = computed(() => {
  return (messages.value as unknown as ChatHistoryItem[]).filter(message => message.role !== 'system')
})

const displayedMessages = computed(() => historyMessages.value)
const hasMessages = computed(() => displayedMessages.value.length > 0)

function handleDeleteMessage(index: number) {
  messages.value = messages.value.filter((_, messageIndex) => messageIndex !== index)
}
</script>

<template>
  <div class="fixed bottom-6 left-1/2 z-20 max-w-[calc(100vw-2rem)] w-[min(44rem,68vw)] flex flex-col items-center justify-end -translate-x-1/2">
    <div
      v-if="detailsExpanded"
      class="absolute bottom-[calc(100%+1rem)] left-1/2 z-20 max-h-[45vh] w-full overflow-hidden border border-white/10 rounded-[24px] bg-black/35 backdrop-blur-xl -translate-x-1/2"
    >
      <div class="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-sm text-neutral-200">
        <div class="flex flex-col">
          <span class="font-medium">Conversation Details</span>
          <span class="text-xs text-neutral-400">Full history for context.</span>
        </div>
      </div>
      <div class="h-[min(36vh,32rem)] px-2 py-3">
        <ChatHistory
          v-if="isReady && hasMessages"
          :messages="displayedMessages"
          :sending="sending"
          :streaming-message="streamingMessage"
          h-full
          variant="desktop"
          @delete-message="handleDeleteMessage($event.index)"
        />
        <div
          v-else-if="isReady"
          class="h-full flex items-center justify-center px-6 text-center text-sm text-neutral-400"
        >
          No details yet. Send a message to populate the conversation view.
        </div>
      </div>
    </div>

    <ChatArea :details-expanded="detailsExpanded" @toggle-details="detailsExpanded = !detailsExpanded" />
    <ChatActionButtons />
  </div>
</template>
