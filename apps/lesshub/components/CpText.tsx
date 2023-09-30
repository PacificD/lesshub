'use client'

import { useState } from 'react'
import { copyTextToClipboard } from '@pacificd/utils'
import {
  Input,
  Button,
  Alert,
  AlertTitle,
  AlertDescription
} from 'ui/components'

type Status = 'PENDING' | 'SUCCESS' | 'ERROR'

const alertVariant = {
  SUCCESS: ['default', 'success'],
  ERROR: ['destructive', 'error'],
  PENDING: ['default', '']
}

export default function CpText() {
  const [text, setText] = useState('modify')
  const [status, setStatus] = useState<Status>('PENDING')

  const handelBtnClick = () =>
    copyTextToClipboard(text)
      .then(() => setStatus('SUCCESS'))
      .catch(() => setStatus('ERROR'))

  return (
    <>
      <Alert
        variant={alertVariant[status][0] as 'default' | 'destructive'}
        className={status === 'PENDING' ? 'hidden' : 'block'}
      >
        <AlertTitle>{alertVariant[status][1]}</AlertTitle>
        <AlertDescription>{text}</AlertDescription>
      </Alert>
      <div className='flex w-full max-w-sm items-center space-x-2'>
        <Input
          type='text'
          placeholder='modify'
          value={text}
          onChange={v => setText(v.currentTarget.value)}
        />
        <Button onClick={handelBtnClick}>copy to clipboard</Button>
      </div>
    </>
  )
}
