'use client'
import { useState } from 'react'
import { useEdgeStore } from '@/lib/edgestore'
import {
  MultiFileDropzone,
  type FileState
} from '@/components/muti-file-dropzone'
import { useToast } from '@ui/hooks/use-toast'
import { Input } from '@ui/components/input'
import { Button } from '@ui/components/button'
import { WithTooltip } from '@ui/components/tooltip'

const uploadToken = process.env.NEXT_PUBLIC_UPLOAD_TOKEN

export default function UploadPage() {
  const [fileStates, setFileStates] = useState<FileState[]>([])
  const [token, setToken] = useState('')
  const { toast } = useToast()
  const { edgestore } = useEdgeStore()
  const vaild = uploadToken === token

  function updateFileProgress(key: string, progress: FileState['progress']) {
    setFileStates(fileStates => {
      const newFileStates = structuredClone(fileStates)
      const fileState = newFileStates.find(fileState => fileState.key === key)
      if (fileState) {
        fileState.progress = progress
      }
      return newFileStates
    })
  }

  return (
    <div className='flex flex-col items-center py-8'>
      <div className='flex mb-8 w-full max-w-sm items-center space-x-2'>
        <Input
          type='password'
          value={token}
          onChange={e => setToken(e.currentTarget.value)}
        />
        <Button disabled>token</Button>
      </div>
      <WithTooltip
        content='Please enter the token'
        showTooltip={!vaild}
        trigger={
          <MultiFileDropzone
            value={fileStates}
            onChange={files => {
              if (!vaild) {
                toast({
                  variant: 'destructive',
                  title: 'Invaild token!'
                })
                setFileStates([])
              } else setFileStates(files)
            }}
            disabled={!vaild}
            onFilesAdded={async addedFiles => {
              if (!vaild) return
              setFileStates([...fileStates, ...addedFiles])
              await Promise.all(
                addedFiles.map(async addedFileState => {
                  try {
                    const res = await edgestore.publicFiles.upload({
                      file: addedFileState.file,
                      onProgressChange: async progress => {
                        updateFileProgress(addedFileState.key, progress)
                        if (progress === 100) {
                          // wait 1 second to set it to complete
                          // so that the user can see the progress bar at 100%
                          await new Promise(resolve =>
                            setTimeout(resolve, 1000)
                          )
                          updateFileProgress(addedFileState.key, 'COMPLETE')
                        }
                      }
                    })
                    if (res) {
                      toast({
                        title: 'Upload successful!'
                      })
                      setFileStates(fileStates =>
                        fileStates.map(fState =>
                          fState.key === addedFileState.key
                            ? {
                                ...fState,
                                url: res.url
                              }
                            : fState
                        )
                      )
                    } else throw new Error(String(res || 'Upload failed!'))
                  } catch (err) {
                    toast({
                      variant: 'destructive',
                      title: 'Error!',
                      description: String(err || 'Upload failed!')
                    })
                    updateFileProgress(addedFileState.key, 'ERROR')
                  }
                })
              )
            }}
          />
        }
      />
    </div>
  )
}
