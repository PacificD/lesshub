import { createStore } from 'zustand/vanilla'

interface CountState {
  count: number
  increaseCount: () => void
}

const counterStore = createStore<CountState>((set, get) => ({
  count: 0,
  increaseCount: () => {
    set(state => ({ count: state.count + 1 }))
    return get().count
  }
}))

export default counterStore
