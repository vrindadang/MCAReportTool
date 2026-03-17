/**
 * Utility for retrying functions with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a rate limit error (429)
      const isRateLimit = error?.message?.includes('429') || 
                          error?.status === 'RESOURCE_EXHAUSTED' ||
                          JSON.stringify(error).includes('429');
      
      if (isRateLimit && attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.warn(`Rate limit hit. Retrying in ${delay}ms (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Simple delay utility
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
