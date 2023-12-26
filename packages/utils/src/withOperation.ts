/**
 * Higher-order function used to perform additional operations before calling the target function.
 * @param fn The target function to be wrapped.
 * @param extraFn The additional operation function.
 * @returns The wrapped new function that, when executed, will first perform the additional operation and then call the target function.
 */
export const withOperation = <T extends (...args: any[]) => any>(
  fn: T,
  extraFn: () => void
): ((...args: Parameters<T>) => ReturnType<T>) => {
  return function (...args: Parameters<T>): ReturnType<T> {
    extraFn()
    return fn(...args)
  }
}
