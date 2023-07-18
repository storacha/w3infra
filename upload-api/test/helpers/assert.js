/**
 * 
 * @param {import("ava").ExecutionContext} t 
 * @returns {import("@web3-storage/upload-api").Assert}
 */
export function assertsFromExecutionContext(t){
  return {
    ok: (actual, message) => t.truthy(actual, message),
    equal: (actual, expect, message) =>
      t.is(actual, expect, message ? String(message) : undefined),
    deepEqual: (actual, expect, message) =>
      t.deepEqual(actual, expect, message ? String(message) : undefined),
  }
}