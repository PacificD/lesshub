export type BenchmarkSignal = 'SIGINT' | 'SIGTERM'

interface CancellationDependencies {
  writePartial(reason: BenchmarkSignal): Promise<void>
  cleanup(): Promise<void>
}

export function createCancellationCoordinator(
  dependencies: CancellationDependencies
) {
  const controller = new AbortController()
  let selectedSignal: BenchmarkSignal | undefined
  let cancellation: Promise<number> | undefined

  return {
    get cancelled() {
      return selectedSignal !== undefined
    },
    get signal() {
      return controller.signal
    },
    cancel(signal: BenchmarkSignal): Promise<number> {
      if (cancellation) return cancellation
      selectedSignal = signal
      controller.abort(new Error(`Benchmark cancelled by ${signal}`))
      cancellation = (async () => {
        await dependencies.writePartial(signal)
        await dependencies.cleanup()
        return signal === 'SIGINT' ? 130 : 143
      })()
      return cancellation
    },
    throwIfCancelled(): void {
      if (selectedSignal)
        throw new Error(`Benchmark cancelled by ${selectedSignal}`)
    }
  }
}
