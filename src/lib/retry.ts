export async function retry<T>(fn: () => Promise<T>, { attempts = 3, delayMs = 300 } = {}): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(delayMs * 2 ** (attempt - 1))
    }
  }
  throw lastError
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
