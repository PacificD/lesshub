import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import { useState, useRef } from 'react'

interface IProps<T> {
  initialInputValue?: string
  deferredValue: T
  setDeferredValue: Dispatch<SetStateAction<T>>
  compareFN?: (a: string, b: T) => boolean
  deferredTime?: number
}
const useDeferredInput = <T>({
  initialInputValue,
  deferredValue,
  setDeferredValue,
  compareFN,
  deferredTime = 1000
}: IProps<T>) => {
  const [inputValue, setInputValue] = useState(initialInputValue ?? '')

  const deferred = useRef<NodeJS.Timeout | null>(null)

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (deferred.current) clearTimeout(deferred.current)
    const newValue = e.target.value
    setInputValue(newValue)
    deferred.current = setTimeout(() => {
      // todo setState by callback
      newValue !== deferredValue && setDeferredValue(newValue as T)
    }, deferredTime)
  }

  return {
    inputValue,
    handleInputChange
  }
}

export default useDeferredInput
