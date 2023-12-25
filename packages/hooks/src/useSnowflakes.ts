import { MutableRefObject, useEffect, useRef } from 'react'

const getRandomInitialValue = () => ({
  vx: 0.3 - Math.random(),
  vy: 0.5 + Math.random() * 1.2,
  r: 1 + Math.random() * 2,
  o: 0.5 + Math.random() * 0.5
})

type SnowflakeConfig = Record<'vx' | 'vy' | 'r' | 'o', number>

export type SnowflakeConfigOptions = Partial<SnowflakeConfig>

class Snowflake {
  x = 0
  y = 0
  vx = 0
  vy = 0
  r = 0
  o = 0
  config: SnowflakeConfig | undefined

  constructor(configOptions?: SnowflakeConfigOptions) {
    const randomInitialValue = getRandomInitialValue()
    this.config = configOptions
      ? {
          vx: configOptions.vx ?? randomInitialValue.vx,
          vy: configOptions.vy ?? randomInitialValue.vy,
          r: configOptions.r ?? randomInitialValue.r,
          o: configOptions.o ?? randomInitialValue.o
        }
      : randomInitialValue
  }

  reset(width: number, height: number) {
    this.x = Math.random() * width
    this.y = Math.random() * -height
    this.vx = this.config!.vx
    this.vy = this.config!.vy
    this.r = this.config!.r
    this.o = this.config!.o
  }
}

interface IProps {
  count?: number
  container: MutableRefObject<HTMLDivElement | null>
  configOptions?: SnowflakeConfigOptions
}

/**
 * Custom React Hook for creating a snowfall animation effect.
 *
 * @param {number} count - Number of snowflakes to render. The default value is 300.
 * @param {MutableRefObject} container - Ref object for the container where snowflakes will be rendered.
 * @param {SnowflakeConfigOptions} configOptions - Additional configuration options for individual snowflakes.
 *
 * @returns {void}
 */
export const useSnowflakes = ({
  count = 300,
  container,
  configOptions
}: IProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const snowflakes = useRef<Snowflake[]>([])

  const onResize = () => {
    if (!canvasRef.current || !container.current || !ctxRef.current) return
    const containerWidth = container.current.clientWidth
    canvasRef.current.width = containerWidth
    canvasRef.current.height = container.current.clientHeight
    ctxRef.current.fillStyle = '#fff'
  }

  const init = () => {
    if (!canvasRef.current) {
      const canvas = document.createElement('canvas')
      canvasRef.current = canvas
      canvasRef.current.style.position = 'absolute'
      canvasRef.current.style.top = '0'
      ctxRef.current = canvas.getContext('2d')
    }
    const [width, height] = [
      container.current?.clientWidth,
      container.current?.clientHeight
    ]
    snowflakes.current = Array.from({ length: count }, () => {
      const snowflake = new Snowflake(configOptions)
      snowflake.reset(width!, height!)
      return snowflake
    })
    container.current!.appendChild(canvasRef.current)
    onResize()
    update()
  }

  const update = () => {
    if (!canvasRef.current || !ctxRef.current) return
    const width = container.current!.clientWidth
    const height = container.current!.clientHeight
    const ctx = ctxRef.current
    ctx.clearRect(0, 0, width, height)
    snowflakes.current.forEach(snowflake => {
      snowflake.x += snowflake.vx
      snowflake.y += snowflake.vy

      ctx.globalAlpha = snowflake.o
      ctx.beginPath()
      ctx.arc(snowflake.x, snowflake.y, snowflake.r, 0, Math.PI * 2, false)
      ctx.closePath()
      ctx.fill()

      if (snowflake.y > height) snowflake.reset(width, height)
    })

    // shim here
    requestAnimationFrame(update)
  }

  useEffect(() => {
    init()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])
}
