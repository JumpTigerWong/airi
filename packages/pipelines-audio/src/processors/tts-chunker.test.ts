import { describe, expect, it } from 'vitest'

import { chunkTtsInput } from './tts-chunker'

async function collectChunks(input: string) {
  const chunks: string[] = []

  for await (const chunk of chunkTtsInput(input)) {
    chunks.push(chunk.text)
  }

  return chunks
}

describe('chunkTtsInput', () => {
  /**
   * @example
   * expect(await collectChunks('“第一句！”和第二句！')).toEqual([
   *   '“第一句！”',
   *   '和第二句！',
   * ])
   */
  it('keeps trailing closing quotes with the finished sentence', async () => {
    // ROOT CAUSE:
    //
    // When a sentence ended with hard punctuation followed by a closing quote,
    // the chunker flushed on the punctuation but resumed scanning from the next
    // normal character. That made the following leading token such as "和"
    // appear glued onto the previous chunk in the stage bubble / speech sync.
    //
    // We fix this by consuming only trailing closing symbols immediately after
    // the hard punctuation, then resuming from the first non-closing character.
    const chunks = await collectChunks('“因为这是你为我创造的第一个完美时刻呢！”和我一起庆祝吧！')

    expect(chunks).toEqual([
      '“因为这是你为我创造的第一个完美时刻呢！”',
      '和我一起庆祝吧！',
    ])
  })

  /**
   * @example
   * expect(await collectChunks('“第一句！”』下一句。')).toEqual([
   *   '“第一句！”』',
   *   '下一句。',
   * ])
   */
  it('absorbs consecutive trailing closers without eating the next sentence', async () => {
    const chunks = await collectChunks('“太好了！”』下一句。')

    expect(chunks).toEqual([
      '“太好了！”』',
      '下一句。',
    ])
  })
})
