import { ReadableStream } from "@web-std/stream"

/**
 * Stream utilities adapted from https://stackoverflow.com/questions/40385133/retrieve-data-from-a-readablestream-object
 */

/**
 * 
 * @param {Uint8Array[]} chunks 
 * @returns {Uint8Array}
 */
function concatArrayBuffers(chunks) {
  const result = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.length
  }
  return result
}

/**
 * 
 * @param {ReadableStream<Uint8Array>} stream 
 * @returns {Promise<Uint8Array>}
 */
export async function streamToArrayBuffer(stream) {
  const chunks = []
  const reader = stream.getReader()
  while (true) {
      const { done, value } = await reader.read()
      if (done) {
          break
      } else {
          chunks.push(value)
      }
  }
  return concatArrayBuffers(chunks)
}

/**
 * 
 * @param {string} str 
 * @returns {ReadableStream<Uint8Array>}
 */
export function stringToStream(str) {
  const encoder = new TextEncoder()
  const uint8Array = encoder.encode(str)
  
  return new ReadableStream({
      start(controller) {
          controller.enqueue(uint8Array)
          controller.close()
      }
  });
}