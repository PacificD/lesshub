'use client'

import { Button } from '@ui/components/button'
import { FC } from 'react'

interface IProps {
  color: string
  content: string
  disable: boolean
}

const LoginBtn: FC<IProps> = ({ color, disable, content }) => {
  return (
    <Button disabled={disable} className={`bg-[${color}]`}>
      {content}
    </Button>
  )
}

export default LoginBtn
