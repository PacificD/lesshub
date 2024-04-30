import { getData } from './actions'
import Todos from './todos'

export default async function Page() {
  const data = await getData()
  return <Todos todos={data} />
}
