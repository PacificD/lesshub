import type { CountryCode, Language, User } from '@lesshub/commerce-contracts'

export interface StoredProduct {
  id: string
  slug: string
  translations: Record<Language, { name: string; description: string }>
  category: string
  imageUrl: string
  prices: Record<CountryCode, number>
  inventory: number
  updatedAt: string
}

const productNames = [
  ['Field Notebook', 'フィールドノート', '野外笔记本'],
  ['Brass Ruler', '真鍮の定規', '黄铜直尺'],
  ['Canvas Tool Roll', 'キャンバスツールロール', '帆布工具卷'],
  ['Archive Box', 'アーカイブボックス', '档案收纳盒'],
  ['Graph Pencil Set', '方眼鉛筆セット', '方格铅笔套装'],
  ['Desk Calendar', 'デスクカレンダー', '桌面日历'],
  ['Steel Scissors', 'スチールはさみ', '钢制剪刀'],
  ['Paper Tape Trio', '紙テープ三色', '纸胶带三件套'],
  ['Oak Pen Rest', 'オークペンレスト', '橡木笔托'],
  ['Index Card Case', '索引カードケース', '索引卡盒'],
  ['Letter Opener', 'レターオープナー', '拆信刀'],
  ['Pocket Magnifier', 'ポケットルーペ', '口袋放大镜'],
  ['Ledger Stamp', '台帳スタンプ', '账本印章'],
  ['Ceramic Clip Cup', '陶器クリップカップ', '陶瓷回形针杯'],
  ['Tracing Pad', 'トレーシングパッド', '描图本'],
  ['Binder Clip Set', 'バインダークリップ', '长尾夹套装'],
  ['Weekly Planner', '週間プランナー', '周计划本'],
  ['Document Folio', '書類フォリオ', '文件夹册'],
  ['Ink Roller', 'インクローラー', '油墨滚筒'],
  ['Pocket Receipt Book', 'ポケット領収書帳', '便携收据本']
] as const

const descriptions: Record<Language, string> = {
  'en-US': 'A durable studio essential selected for everyday field work.',
  'ja-JP': '日々の制作とフィールドワークのために選ばれた丈夫な道具です。',
  'zh-CN': '为日常创作与户外记录精选的耐用工具。'
}

export const PRODUCT_SEED: readonly StoredProduct[] = productNames.map(
  (names, index) => {
    const number = String(index + 1).padStart(2, '0')
    const base = 900 + index * 175
    return {
      id: `product-${number}`,
      slug: names[0].toLowerCase().replaceAll(' ', '-'),
      translations: {
        'en-US': { name: names[0], description: descriptions['en-US'] },
        'ja-JP': { name: names[1], description: descriptions['ja-JP'] },
        'zh-CN': { name: names[2], description: descriptions['zh-CN'] }
      },
      category:
        index % 3 === 0 ? 'archive' : index % 3 === 1 ? 'desk' : 'field',
      imageUrl: `/images/product-${number}.svg`,
      prices: {
        US: base,
        GB: Math.round(base * 0.82),
        JP: Math.round(base * 1.55) * 10,
        SG: Math.round(base * 1.34)
      },
      inventory: index === 0 ? 18 : 6 + ((index * 7) % 30),
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  }
)

export const USER_SEED: readonly User[] = [
  {
    id: 'user-ada',
    displayName: 'Ada Chen',
    avatar: '/avatars/ada.svg',
    points: 1280,
    membershipTier: 'archive'
  },
  {
    id: 'user-ren',
    displayName: 'Ren Ito',
    avatar: '/avatars/ren.svg',
    points: 3420,
    membershipTier: 'atelier'
  }
]
