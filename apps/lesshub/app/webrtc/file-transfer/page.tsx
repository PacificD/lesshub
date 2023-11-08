'use client'
import { useEffect } from 'react'
import { Button } from '@ui/components/button'

export default function FileTransfer() {
  useEffect(() => {
    const PC = new RTCPeerConnection()
    const dataChannel = PC.createDataChannel('FileTransfer', {
      ordered: true
    })
  }, [])

  return <div className='flex flex-col items-center py-8 gap-4'>rtc</div>
}
