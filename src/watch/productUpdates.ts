import {workspaceStorage as localStorage} from '../account/storage.ts';
export type ProductUpdate = {
  id: string;
  date: string;
  version?: string;
  title: Record<'ja' | 'zh', string>;
  summary: Record<'ja' | 'zh', string>;
  changes: Record<'ja' | 'zh', string[]>;
};

const PRODUCT_UPDATE_READ_KEY = 'yami-product-update-read-ids';
const PRODUCT_UPDATE_READ_EVENT = 'yami:product-update-read-state-change';

export const PRODUCT_UPDATES: ProductUpdate[] = [{
  id: '2026-11-18-yami-argon-embed-polish',
  date: '2026-11-18',
  title: { ja: 'Argon 内での狭い画面と透明表示を調整しました', zh: '优化了 Argon 中的窄窗口与透明外观显示' },
  summary: { ja: 'Argon のウィンドウ幅が狭いときの設定・企業画面と、透明マテリアル時の文字やカードの視認性を整えました。', zh: '完善了 Argon 窗口较窄时的设置与企业页面布局，并提升了透明材质下的文字与卡片可读性。' },
  changes: {
    ja: ['Argon 内で画面幅が狭い場合でも、設定と企業追加ボタンを崩れず表示します', '透明マテリアル時の文字色・カード・ダイアログの視認性とページ切り替えの動きを整えました', 'Web 版・スマートフォンでの表示とデータには影響しません'],
    zh: ['调整了 Argon 窄窗口下设置页布局与“新增企业”按钮显示', '改进了透明材质下的文字、卡片与弹窗对比度，并对齐页面切换动画', '网页版、手机端的显示和已保存的数据不受影响'],
  },
}, {
  id: '2026-11-18-yami-argon-embed-mode',
  date: '2026-11-18',
  title: { ja: 'Mac アプリ Argon 内での表示に対応しました', zh: '支持在 Mac 应用 Argon 中显示' },
  summary: { ja: 'Argon の中で Yami を開くと、Argon の画面になじむ表示になります。Web 版とスマートフォンでの表示やデータは変わりません。', zh: '在 Argon 中打开 Yami 时，界面会融入 Argon 的窗口。网页版和手机上的显示与数据保持不变。' },
  changes: {
    ja: ['Argon 内では背景を透明にし、ページの切り替えは Argon のサイドバーから行います', 'Argon 内ではテーマが Argon の外観設定に従います', 'Web 版・スマートフォンの表示と保存データには影響しません'],
    zh: ['在 Argon 中背景透明，通过 Argon 的侧边栏切换页面', '在 Argon 中主题跟随 Argon 的外观设置', '网页版、手机端的显示和已保存的数据不受影响'],
  },
}, {
  id: '2026-11-18-yami-plan-page-removed',
  date: '2026-11-18',
  title: { ja: 'プランと料金ページを削除し、企業ウォッチと画面を改善しました', zh: '已移除计划与价格页面，并改进企业监控与界面' },
  summary: { ja: 'Yami のすべての機能は引き続き無料で使えます。企業ウォッチの通知漏れを修正し、画面も見やすくしました。', zh: 'Yami 的全部功能继续免费使用，同时修复了企业监控的通知遗漏，并让界面更易读。' },
  changes: {
    ja: ['設定から「プランと料金」を削除しました。有料プランの予定はありません', '一時的な取得エラーの後でも、マイナビのエントリー開始を通知します', '「fc」「fd」で始まるドメインも監視先に登録できます', '一時停止中の監視先の URL を変更しても、勝手に再開しません', 'Shift_JIS の採用ページや「Inc.」「Co., Ltd.」表記の企業名も正しく確認できます', 'ホームに最初の企業登録の案内を追加し、数値の見出しを読みやすくしました', 'ダークモードの表示色をそろえ、重複していた「企業を追加」ボタンを整理しました'],
    zh: ['设置中已移除“计划与价格”，没有付费方案计划', '即使出现临时获取失败，也会通知マイナビ的报名开放', '以“fc”“fd”开头的域名也可以登记为监控对象', '修改已暂停监控对象的网址时，不会自动恢复监控', '可正确识别 Shift_JIS 编码的招聘页面，以及“Inc.”“Co., Ltd.”写法的企业名', '主页新增首次添加企业的引导，统计标签更易读', '统一深色模式配色，并整理了重复的“新增企业”按钮'],
  },
}, {
  id: '2026-10-29-yami-desktop-notification-avatar',
  date: '2026-10-29',
  title: { ja: 'PC の公式通知表示を調整しました', zh: 'PC 官方通知展示已优化' },
  summary: { ja: 'Yami のアバター表示と長いタイトルの折り返しを整えました。', zh: '完善了 Yami 头像显示与长标题换行。' },
  changes: {
    ja: ['PC の公式通知でアバターを切り取らずに表示します', '未読マークの配置と長いタイトルの表示を調整しました'],
    zh: ['PC 官方通知完整显示现有头像素材', '优化未读标记位置及长标题显示'],
  },
}, {
  id: '2026-10-29-yami-mobile-navigation-icons',
  date: '2026-10-29',
  title: { ja: 'モバイルナビゲーションを調整しました', zh: '手机底部导航图标已优化' },
  summary: { ja: '下部ナビゲーションのアイコンの大きさと見え方を揃えました。', zh: '统一了底部导航图标的视觉大小与重量。' },
  changes: {
    ja: ['アイコンの配置枠を統一し、図形ごとの見た目を調整しました', 'ナビゲーションの操作や表示・非表示の動作はそのままです'],
    zh: ['统一图标容器，并根据图形进行光学尺寸校正', '保留原有导航点击及隐藏、恢复交互'],
  },
}, {
  id: '2026-10-20-yami-company-hover-about-links',
  date: '2026-10-20',
  title: { ja: '企業カードの操作感を調整しました', zh: '企业卡片交互体验已优化' },
  summary: { ja: 'PC のホバー表示を見やすくし、「Yamiについて」の主要項目を整理しました。', zh: '增强了 PC 企业卡片的悬停反馈，并精简了“关于 Yami”的主要入口。' },
  changes: {
    ja: ['企業カードのホバー表示をライト・ダークそれぞれで調整しました', '「Yamiについて」の主要項目を更新履歴とデータ・プライバシーにまとめました'],
    zh: ['分别增强了浅色与深色主题下的企业卡片悬停效果', '“关于 Yami”的主要入口精简为更新记录和数据与隐私'],
  },
}, {
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
}, {
  id: '2026-09-20-yami-sidebar-home-company-refinement',
  date: '2026-09-20T09:00:00+09:00',
  title: { ja: 'Yami のアップデート', zh: 'Yami 更新' },
  summary: {
    ja: 'ホーム画面と企業一覧のブランド表現を整理しました。',
    zh: '整理了首页与企业列表的品牌表达。',
  },
  changes: {
    ja: [
      'カードの視認性を保ちながら、Yamiらしいアクセントを加えました',
      'ダッシュボードと企業一覧を、より見やすく整えました',
    ],
    zh: [
      '在保持卡片清晰易读的同时，加入了 Yami 风格点缀',
      '整理了 Dashboard 与企业列表的视觉表达',
    ],
  },
}, {
  id: '2026-09-22-yami-settings-and-template-management',
  date: '2026-09-22T09:00:00+09:00',
  title: { ja: 'Yami の設定をアップデートしました', zh: 'Yami 设置已更新' },
  summary: { ja: '設定とテンプレートを、より使いやすく整理しました。', zh: '我们整理了设置与模板管理，让日常调整更方便。' },
  changes: {
    ja: [
      'テーマ・言語・週の開始曜日を「一般」にまとめました',
      'ホーム画面の表示項目と並び順を同じ場所で調整できます',
      '保存済みテンプレートの作成・編集・削除を使いやすくしました',
    ],
    zh: [
      '将主题、语言和每周起始日整合到“常规”设置中',
      '可在同一处调整主页项目的显示与顺序',
      '优化了已保存模板的创建、编辑和删除',
    ],
  },
}, {
  id: '2026-10-20-yami-about-and-release-information',
  date: '2026-10-20',
  title: { ja: 'Yami のアプリ情報を見直しました', zh: 'Yami 应用信息已更新' },
  summary: { ja: '更新履歴、データの保存先、ライセンスを確認しやすくしました。', zh: '现在可以更清楚地查看更新记录、数据存储说明和许可证信息。' },
  changes: {
    ja: [
      '「Yamiについて」のブランド表示をコンパクトに整理しました',
      '実際の更新記録とビルド情報を表示し、固定のバージョン表記を廃止しました',
      '端末内のデータと企業ウォッチのサーバー保存データを区別して説明しました',
      'プロジェクトのライセンス状況と主要ライブラリのライセンスを確認できます',
    ],
    zh: [
      '精简了“关于 Yami”的品牌展示区域',
      '接入实际更新记录与构建信息，移除了固定版本号',
      '明确区分设备本地数据与企业监控服务保存的数据',
      '可以查看项目许可证状态与主要第三方组件许可证',
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
