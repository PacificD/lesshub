export type Todo = {
  id: string
  content: string
  done: boolean
}

export enum UserClient {
  browser = 'browser',
  native = 'native',
  node = 'node'
}
