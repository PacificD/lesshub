'use client'
import { Button } from '@ui/components/button'

export default function DisplayScreen() {
  const playLocalStream = (stream: MediaStream) => {
    const videoEl = document.getElementById('localVideo') as HTMLVideoElement
    videoEl.srcObject = stream
  }

  const getDisplayMedia = async (
    constraints: MediaStreamConstraints = {
      audio: false, // default: true
      video: {
        width: 1280,
        height: 720
      }
    }
  ) => {
    const stream = await navigator.mediaDevices.getDisplayMedia(constraints)
    console.log(stream)
    playLocalStream(stream)
  }

  const getSupportedConstraints = () => {
    const supportedConstraints =
      navigator.mediaDevices.getSupportedConstraints()
    console.log('🚀🚀🚀 / SupportedConstraints', supportedConstraints)
    return supportedConstraints
  }

  return (
    <div className='flex flex-col items-center py-8 gap-4'>
      <Button onClick={getSupportedConstraints}>getSupportedConstraints</Button>
      <Button onClick={() => getDisplayMedia()}>getDisplayMedia</Button>
      <video id='localVideo' autoPlay playsInline muted></video>
    </div>
  )
}
