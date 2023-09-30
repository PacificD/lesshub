import { counterStore } from '@/store'

export function setupCounter(element: HTMLButtonElement) {
  const { getState } = counterStore
  const { count, increaseCount } = getState()
  element.innerHTML = `count is ${count}`

  const setCounter = () => {
    const newCount = increaseCount()
    element.innerHTML = `count is ${newCount}`
  }
  element.addEventListener('click', () => setCounter())
}

export function mutiCounter(element: HTMLButtonElement) {
  const { getState, setState, subscribe } = counterStore
  element.innerHTML = `count is ${getState().count}`
  subscribe(console.log)

  const setCounter = () => {
    setState(state => ({ count: state.count * 2 }))
    element.innerHTML = `count is ${getState().count}`
  }
  element.addEventListener('click', () => setCounter())
}
