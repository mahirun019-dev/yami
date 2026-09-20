export type ProductUpdate = {
  id: string;
  date: string;
  title: Record<'ja' | 'zh', string>;
  summary: Record<'ja' | 'zh', string>;
  changes: Record<'ja' | 'zh', string[]>;
};

const PRODUCT_UPDATE_READ_KEY = 'yami-product-update-read-ids';
const PRODUCT_UPDATE_READ_EVENT = 'yami:product-update-read-state-change';

export const PRODUCT_UPDATES: ProductUpdate[] = [{
  id: '2026-09-19-yami-brand-and-notification-update',
  date: '2026-09-19T09:00:00+09:00',
  title: { ja: 'Yamiがアップデートされました', zh: 'Yami 已更新' },
  summary: { ja: 'デザインと使いやすさを改善しました。', zh: '我们改进了设计与易用性。' },
  changes: {
    ja: [
      'Yamiのブランドデザインを刷新しました',
      '通知画面をより見やすく改善しました',
      'スマートフォンの操作性を調整しました',
    ],
    zh: [
      '更新了 Yami 的品牌设计',
      '优化了通知页面的阅读体验',
      '改进了手机端的操作体验',
    ],
  },
}, {
  id: '2026-09-20-yami-brand-mobile-experience-update',
  date: '2026-09-20T09:00:00+09:00',
  title: { ja: 'Yamiがアップデートされました', zh: 'Yami 已更新' },
  summary: { ja: 'ブランドデザインとモバイル体験を改善しました。', zh: '我们改进了品牌设计与移动端体验。' },
  changes: {
    ja: [
      'Yamiのブランドロゴを刷新しました',
      'アプリアイコンとブラウザアイコンを更新しました',
      'モバイルヘッダーとPCサイドバーの表示を調整しました',
    ],
    zh: [
      '更新了 Yami 品牌标志',
      '更新了应用图标和浏览器图标',
      '调整了移动端页眉和 PC 侧边栏显示',
    ],
  },
}];

export function loadReadProductUpdateIds() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PRODUCT_UPDATE_READ_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveReadProductUpdateIds(ids: string[]) {
  try { localStorage.setItem(PRODUCT_UPDATE_READ_KEY, JSON.stringify([...new Set(ids)])); } catch { /* Keep the current session usable if storage is unavailable. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PRODUCT_UPDATE_READ_EVENT));
}

export function getUnreadProductUpdateCount() {
  const readIds = new Set(loadReadProductUpdateIds());
  const uniqueUpdates = new Map(PRODUCT_UPDATES.map((update) => [update.id, update]));
  return [...uniqueUpdates.keys()].filter((id) => !readIds.has(id)).length;
}

export function subscribeProductUpdateReadState(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === PRODUCT_UPDATE_READ_KEY || event.key === null) onChange();
  };
  window.addEventListener(PRODUCT_UPDATE_READ_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(PRODUCT_UPDATE_READ_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
