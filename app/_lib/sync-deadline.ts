/** Bound waits including cache operations, which do not accept AbortSignal. */
export async function withSyncDeadline<T>(operation: Promise<T>, timeoutMs: number, source: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`SYNC_TIMEOUT:${source}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
