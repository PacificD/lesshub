import {
  renderVariantSchema,
  type RenderVariant
} from '@lesshub/commerce-contracts'

export const NAVIGATION_VARIANT_PLACEHOLDER =
  '__LESSHUB_RENDER_VARIANT__' as const

export function materializeNavigationVariant(
  fragment: string,
  variant: RenderVariant
): string {
  const trustedVariant = renderVariantSchema.parse(variant)
  if (!fragment.includes(NAVIGATION_VARIANT_PLACEHOLDER))
    throw new Error('Navigation fragment is missing its variant placeholder')
  return fragment.replaceAll(NAVIGATION_VARIANT_PLACEHOLDER, trustedVariant)
}
