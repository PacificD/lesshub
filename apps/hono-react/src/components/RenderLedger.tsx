import type {
  CountryCode,
  Language,
  RenderVariant
} from '@lesshub/commerce-contracts'
import type { CacheStatus } from '../runtime/interfaces.js'

export function RenderLedger(props: {
  variant: RenderVariant
  cacheStatus: CacheStatus
  countryCode: CountryCode
  language: Language
  dataVersion?: number | undefined
  requestId: string
}) {
  const facts = [
    ['strategy', props.variant],
    ['cache', props.cacheStatus],
    ['market', props.countryCode],
    ['language', props.language],
    ['data', props.dataVersion ? `v${props.dataVersion}` : 'client'],
    ['request', props.requestId.slice(0, 8)]
  ]
  return (
    <aside className='render-ledger' aria-label='Render diagnostics'>
      <p className='render-ledger__title'>Render ledger</p>
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  )
}
