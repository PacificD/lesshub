import { Checkbox } from 'ui/components'
import CpText from '@/components/CpText'

export default async function Home() {
  return (
    <main className='bg-red-100 w-full h-[100vh]'>
      {/* <CpText /> */}
      <div className='flex items-center space-x-2'>
        <Checkbox id='terms2' />
        <label
          htmlFor='terms2'
          className='text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
        >
          Accept terms and conditions
        </label>
      </div>
    </main>
  )
}
