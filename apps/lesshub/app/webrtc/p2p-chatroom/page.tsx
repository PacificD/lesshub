'use client'
import { useState, useRef, useEffect, ElementRef } from 'react'
import Peer, { DataConnection, MediaConnection } from 'peerjs'
import { toast } from 'sonner'

import { Button } from '@ui/components/button'
import { Textarea } from '@ui/components/textarea'
import { Spinner } from '@/components/spinner'
import { Input } from '@ui/components/input'
import { CopyButton } from '@ui/components/copy-button'

interface IMsg {
  id: number
  type: 'local' | 'remote'
  data: string
}

export default function P2PChatroom() {
  const [loading, setLoading] = useState(true)
  const [localId, setLocalId] = useState('')
  const [remoteId, setRemoteId] = useState('')
  const [messages, setMessages] = useState<IMsg[]>([])
  const [customMsg, setCustomMsg] = useState('')

  const currentCall = useRef<MediaConnection>()
  const currentConnection = useRef<DataConnection>()
  const peer = useRef<Peer>()
  const localVideo = useRef<ElementRef<'video'>>(null)
  const remoteVideo = useRef<ElementRef<'video'>>(null)

  const endCall = () => {
    if (currentCall.current) {
      currentCall.current.close()
    }
  }

  const callUser = async () => {
    if (!window || !navigator) return
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    })
    localVideo.current!.srcObject = stream
    localVideo.current?.play()

    const connection = peer.current!.connect(remoteId)
    currentConnection.current = connection
    connection.on('open', () => {
      toast.success('connected!')
    })

    connection.on('data', data => {
      setMessages(curtMessages => [
        ...curtMessages,
        { id: curtMessages.length + 1, type: 'remote', data: data as string }
      ])
    })

    const call = peer.current?.call(remoteId, stream)
    call?.on('stream', stream => {
      remoteVideo.current!.srcObject = stream
      remoteVideo.current?.play()
    })
    call?.on('error', err => {
      console.error(err)
      toast.error('connect error!')
    })
    call?.on('close', () => {
      endCall()
    })

    currentCall.current = call
  }

  const sendMsg = () => {
    if (!currentConnection.current) {
      toast.error('connection not established!')
    }
    if (!customMsg) {
      return
    }
    currentConnection.current?.send(customMsg)
    setMessages(curtMessages => [
      ...curtMessages,
      { id: curtMessages.length + 1, type: 'local', data: customMsg }
    ])
    setCustomMsg('')
  }

  const createPeer = () => {
    peer.current = new Peer()
    peer.current.on('open', id => {
      setLocalId(id)
      setLoading(false)
    })

    peer.current.on('connection', connection => {
      // receive message from remote
      connection.on('data', data => {
        setMessages(curtMessages => [
          ...curtMessages,
          { id: curtMessages.length + 1, type: 'remote', data: data as string }
        ])
      })

      currentConnection.current = connection
    })

    peer.current.on('call', async call => {
      if (window.confirm(`receive ${call.peer}?`)) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        })
        localVideo.current!.srcObject = stream
        localVideo.current?.play()

        call.answer(stream)

        call.on('stream', stream => {
          remoteVideo.current!.srcObject = stream
          remoteVideo.current?.play()
        })

        currentCall.current = call
      } else {
        call.close()
        alert('closed')
      }
    })
  }

  useEffect(() => {
    createPeer()

    return () => {
      endCall()
    }
  }, [])

  return (
    <main className='container'>
      <section className='flex items-center'>
        <div className='mr-2 whitespace-nowrap flex items-center'>
          <h1 className='mr-2 font-bold'>local Peer ID: </h1>
          {loading ? (
            <Spinner />
          ) : (
            <>
              {localId}
              <CopyButton value={localId} />
            </>
          )}
        </div>
        <Input
          value={remoteId}
          onChange={e => setRemoteId(e.target.value)}
          type='text'
          placeholder='remote Peer Id'
        />
        <Button className='mx-2' onClick={callUser} disabled={loading}>
          start
        </Button>
        <Button className='mx-2' onClick={endCall}>
          end
        </Button>
      </section>

      <section className='flex justify-between mt-4 gap-2'>
        <div className='flex flex-col items-center gap-2 flex-1'>
          <h2 className='font-bold text-lg'>local camera</h2>
          <video controls autoPlay ref={localVideo} muted />
        </div>
        <div className='flex flex-col items-center gap-2 flex-1'>
          <h2 className='font-bold text-lg'>remote camera</h2>
          <video controls autoPlay ref={remoteVideo} />
        </div>
      </section>

      <section className='flex justify-between mt-4 gap-2'>
        <div className='flex-1'>
          <h2 className='font-bold text-lg text-center'>chat messages list:</h2>
          {messages.map(msg => (
            <div key={msg.id} className='w-full flex items-center mt-2'>
              <span>
                {msg.type === 'local' ? (
                  <div className='bg-blue-400 p-1 rounded-md text-xs'>me</div>
                ) : (
                  <div className='bg-green-300 p-1 rounded-md text-xs'>
                    friend
                  </div>
                )}
              </span>
              <span className='ml-2'>{msg.data}</span>
            </div>
          ))}
        </div>
        <div className='flex-1 flex flex-col items-center'>
          <h2 className='font-bold text-lg text-center'>custom message:</h2>
          <Textarea
            placeholder='send custom message'
            value={customMsg}
            onChange={e => setCustomMsg(e.target.value)}
            rows={4}
            className='w-full'
          />
          <Button disabled={!customMsg} onClick={sendMsg} className='mt-2'>
            send
          </Button>
        </div>
      </section>
    </main>
  )
}
