const ja = {
  title: "企業ウォッチ", updates: "企業アップデート", add: "監視URLを追加", source: "監視先", url: "URL", label: "表示名（任意）", cancel: "キャンセル", save: "追加", edit: "編集",
  mynavi: "マイナビ", official: "公式採用ページ", other: "その他", active: "監視中", checking: "確認中", checkingTimeout: "確認に時間がかかっています", error: "取得エラー", robotsDisallowed: "robots.txt により取得できません", robotsUnverifiable: "robots.txt を確認できません", insufficientContent: "公開されている採用情報を確認できません", paused: "停止中", lastCheck: "最終確認", lastSuccess: "最終成功", unchecked: "未確認",
  entryStatus: "エントリー状況", entryUnavailable: "未受付", entryReservation: "予約受付中", entryOpen: "エントリー受付中", entryClosed: "受付終了", entryNeedsReview: "確認が必要",
  empty: "採用情報ページを登録すると、エントリー開始などの更新を定期的に確認できます。", unavailable: "監視サービスはまだ設定されていません。設定後にURLを登録できます。",
  preflightRequired: "監視先の確認が必要です。内容を確認してから保存してください。", confirmUnverified: "確認して保存", addedValidated: "監視先を確認して登録しました。", addedNeedsReview: "監視先を登録しました。状態を確認してください。", detectedCompany: "検出された企業名",
  auth: "監視サービスに接続", code: "アクセスコード", connect: "接続", connected: "接続済み", disconnect: "接続解除", settings: "設定を開く", connection: "企業ウォッチ接続", notConnected: "監視サービスに接続されていません", connectFromSettings: "設定から接続してください。", retry: "再試行", pause: "監視を停止", resume: "監視を再開", remove: "削除", open: "元ページを開く",
  before: "変更前", after: "変更後", detected: "検出日時", changes: "変更内容", sourcePage: "監視先", viewCompany: "企業を見る", openSource: "採用ページを開く", notifications: "通知", all: "すべて", unread: "未読", markAllRead: "すべて既読にする", noUpdates: "新しい通知はありません", today: "今日", yesterday: "昨日", goToSettings: "設定を開く", duplicate: "同じURLはすでに登録されています。", addedChecking: "URLを登録しました。初回確認を開始しました。", duplicateChecking: "登録済みURLの確認を再開しました。", duplicatePaused: "このURLは登録済みで、現在は監視停止中です。", invalid: "公開されている http / https URLを入力してください。"
} as const;
const zh: { [K in keyof typeof ja]: string } = {
  title: "企业监控", updates: "企业更新", add: "添加监控网址", source: "监控来源", url: "网址", label: "显示名称（可选）", cancel: "取消", save: "添加", edit: "编辑",
  mynavi: "Mynavi", official: "官方招聘页面", other: "其他", active: "监控中", checking: "正在确认", checkingTimeout: "确认时间较长，请稍后再查看", error: "获取错误", robotsDisallowed: "robots.txt 禁止抓取", robotsUnverifiable: "无法确认 robots.txt 规则", insufficientContent: "无法确认公开招聘信息", paused: "已暂停", lastCheck: "最后检查", lastSuccess: "最后成功", unchecked: "未确认",
  entryStatus: "报名状态", entryUnavailable: "尚未开放", entryReservation: "预约受理中", entryOpen: "报名受理中", entryClosed: "已结束", entryNeedsReview: "需要确认",
  empty: "登记招聘信息页面后，可定期检查报名开始等更新。", unavailable: "监控服务尚未配置，配置完成后才能登记网址。",
  preflightRequired: "需要确认监控来源，请检查后再保存。", confirmUnverified: "确认后保存", addedValidated: "已验证并登记监控来源。", addedNeedsReview: "已登记监控来源，请确认其状态。", detectedCompany: "检测到的企业名称",
  auth: "连接监控服务", code: "访问码", connect: "连接", connected: "已连接", disconnect: "断开连接", settings: "打开设置", connection: "企业监控连接", notConnected: "尚未连接监控服务", connectFromSettings: "请从设置中连接。", retry: "重试", pause: "暂停监控", resume: "恢复监控", remove: "删除", open: "打开来源页面",
  before: "变更前", after: "变更后", detected: "检测时间", changes: "变更内容", sourcePage: "监控来源", viewCompany: "查看企业", openSource: "打开招聘页面", notifications: "通知", all: "全部", unread: "未读", markAllRead: "全部标为已读", noUpdates: "暂无新通知", today: "今天", yesterday: "昨天", goToSettings: "打开设置", duplicate: "该公司已登记相同网址。", addedChecking: "网址已登记，正在进行首次确认。", duplicateChecking: "该网址已登记，正在重新确认。", duplicatePaused: "该网址已登记，但当前处于暂停状态。", invalid: "请输入公开可访问的 http / https 网址。"
};
export const watchText = { ja, zh } as const;
