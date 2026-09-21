import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type FormEvent,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createBackup, type BackupSnapshot } from "./backups";
import { geocodeCoordinates, getWeather, getWeatherByCoordinates, type WeatherResult } from "./weather";
import prefectureData from "./data/japan-prefectures.json";
import municipalityData from "./data/japan-municipalities.json";
import { companyWatchKey, useWatch, WatchProvider } from "./watch/WatchProvider";
import { CompanyWatchSection, CompanyWatchStatus, NotificationPage, WatchConnectionSettings } from "./watch/WatchUI";
import { getUnreadProductUpdateCount, subscribeProductUpdateReadState } from "./watch/productUpdates";
import { YamiAboutBrand, YamiLogoLockup } from "./brand/YamiLogo";
import { normalizeDashboardUrl } from "./route";

import {
  Database,
  DatabaseArrowDown,
  DatabaseArrowUp,
  ArrowLeft,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CalendarSync,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudSun,
  ExternalLink,
  Eye,
  FileJson,
  FileText,
  Globe,
  Home,
  MoreHorizontal,
  Menu,
  Monitor,
  Moon,
  NotebookPen,
  Palette,
  Plus,
  Settings,
  Info,
  Search,
  Sun,
  ClipboardCheck,
  PanelsTopLeft,
  SlidersHorizontal,
  Target,
  Timer,
  Trash2,
  Upload,
  X,
  Star,
} from "lucide-react";
import { getDeadlineUrgency, getHighestDeadlineUrgency, parseTokyoCalendarDate, selectWeeklyDeadlines } from "./deadline-selector";
import { compareCompanyStageToEvent, isInterviewProgressStage, shouldOfferInterviewStageSync, type StageProgressionCheck } from "./interview-stage";

type View = "dashboard" | "companies" | "notifications" | "schedule" | "materials";
type CompanyRouteFilter = "active" | "waiting-result";
type ScheduleRouteFilter = "this-week-deadline";
type Theme = "light" | "dark" | "system";
type Locale = "zh" | "ja";
type Stage =
  | "saved"
  | "briefing"
  | "es_draft"
  | "es_submitted"
  | "web_test"
  | "first_interview"
  | "second_interview"
  | "final_interview"
  | "offer"
  | "rejected"
  | "withdrawn";
type ItemType =
  | "es"
  | "web_test"
  | "resume"
  | "interview"
  | "briefing"
  | "research"
  | "general";
type RecordActionId = "document" | "interview" | "aptitude" | "briefing" | "other" | "preparation";
type EventFormPreset = Pick<Event, "type" | "stage">;
type Priority = "low" | "medium" | "high";
type CreateType = "company" | "schedule" | "es" | "interview" | "preparation";
type HomeSummaryModule = "active" | "deadlines" | "waiting";
type HomeSection = "upcoming" | "progress" | "month" | "featured";
type CompanySort = "updated" | "event" | "interest" | "name";
type TemplateCategory = "selfPr" | "gakuchika" | "motivation" | "interviewQuestion" | "reverseQuestion" | "preparation";
type CareerTemplate = {
  id: string;
  category: TemplateCategory;
  title: string;
  content: string;
  updatedAt: number;
};
type AppPreferences = {
  jobHunt: {
    homeRegion: string;
    defaultCompanyStage: Stage;
    defaultInterestLevel: number;
  };
  customize: {
    homeSummaryVisibility: Record<HomeSummaryModule, boolean>;
    homeSummaryOrder: HomeSummaryModule[];
    homeSectionVisibility: Record<HomeSection, boolean>;
    homeSectionVisibilityVersion?: number;
    homeSectionOrder: HomeSection[];
    companyCard: {
      industry: boolean;
      position: boolean;
      stage: boolean;
      interest: boolean;
      nextEvent: boolean;
    };
    companySort: CompanySort;
  };
  calendar: {
    timezone: "Asia/Tokyo";
    preferShare: boolean;
  };
};
type PrepType =
  | "research"
  | "es_fix"
  | "interview_practice"
  | "web_test_prep"
  | "documents"
  | "clothes"
  | "route"
  | "other";
type Company = {
  id: string;
  name: string;
  industry: string;
  position: string;
  jobCategory?: string;
  jobTitle?: string;
  interestLevel: number;
  stage: Stage;
  nextEventAt?: string;
  locationOrOnline?: string;
  careersUrl?: string;
  notes: string;
  tags: string[];
  color: string;
  createdAt: number;
  updatedAt: number;
};
type Material = {
  category?: "material";
  id: string;
  title: string;
  companyId?: string;
  type: ItemType;
  dueAt?: string;
  priority: Priority;
  tags: string[];
  notes: string;
  completed: boolean;
  isWeeklyFocus: boolean;
  createdAt: number;
  updatedAt: number;
  documentType?: "es" | "resume" | "other_document" | "open_es" | "transcript" | "graduation" | "recommendation" | "other";
  submissionStatus?: "not_started" | "drafting" | "submitted" | "review" | "returned";
  submittedAt?: string;
  versionName?: string;
  fileName?: string;
  language?: string;
  characterLimit?: string;
  motivation?: string;
  selfPr?: string;
  gakuchika?: string;
  strengths?: string;
  weaknesses?: string;
  research?: string;
  customQuestions?: { question: string; answer: string }[];
  result?: "undecided" | "passed" | "failed";
  resultAt?: string;
  revisionPoints?: string;
  question?: string;
  answer?: string;
  saveMode?: "upload" | "text";
  attachmentId?: string;
  mimeType?: string;
  fileSize?: number;
};
type Event = {
  id: string;
  companyId?: string;
  title: string;
  type: ItemType;
  stage: Stage;
  interviewStage?: "first_interview" | "second_interview" | "final_interview" | "other";
  interviewStageDetail?: string;
  startsAt: string;
  endsAt?: string;
  endAt?: string;
  durationMinutes?: number;
  locationOrOnline: string;
  eventMode?: "offline" | "online" | "undecided";
  isOnline?: boolean;
  location?: string;
  onlinePlatform?: string;
  meetingUrl?: string;
  attendanceMode?: "offline" | "online" | "undecided";
  prefecture?: string;
  city?: string;
  municipality?: string;
  municipalityCode?: string;
  detailLocation?: string;
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
  source?: "company-next";
  notes: string;
  createdAt: number;
};
type InterviewRecord = {
  category?: "interview";
  roundCode?: string;
  id: string;
  companyId?: string;
  round: string;
  interviewAt: string;
  format: string;
  participationMode?: string;
  interviewers: string;
  questions: string;
  answers: string;
  feeling: string;
  score: number;
  result: string;
  improvements: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
};
type Preparation = {
  category?: "preparation";
  id: string;
  title: string;
  companyId?: string;
  type: PrepType;
  dueAt?: string;
  priority: Priority;
  completed: boolean;
  notes: string;
  createdAt: number;
  updatedAt: number;
};
type Data = {
  schemaVersion: 5;
  companies: Company[];
  materials: Material[];
  events: Event[];
  interviews: InterviewRecord[];
  preparations: Preparation[];
  focusMinutes: number;
  preferences: AppPreferences;
  templates: CareerTemplate[];
};
const defaultHomeSummary: HomeSummaryModule[] = ["active", "deadlines", "waiting"];
const defaultHomeSections: HomeSection[] = ["upcoming", "progress", "month", "featured"];
const interviewStageOptions = ["first_interview", "second_interview", "final_interview", "other"] as const;
function isDeadlineEvent(event: Event) {
  return !(event as Event & { deletedAt?: boolean }).deletedAt
    && Number.isFinite(parseTokyoCalendarDate(event.startsAt).getTime());
}
function defaultPreferences(): AppPreferences {
  const savedRegion = typeof localStorage !== "undefined" ? localStorage.getItem("careerflow-home-region") || "" : "";
  return {
    jobHunt: {
      homeRegion: savedRegion,
      defaultCompanyStage: "saved",
      defaultInterestLevel: 3,
    },
    customize: {
      homeSummaryVisibility: { active: true, deadlines: true, waiting: true },
      homeSummaryOrder: [...defaultHomeSummary],
      homeSectionVisibility: { upcoming: true, progress: true, month: true, featured: true },
      homeSectionVisibilityVersion: 1,
      homeSectionOrder: [...defaultHomeSections],
      companyCard: { industry: true, position: true, stage: true, interest: true, nextEvent: true },
      companySort: "updated",
    },
    calendar: { timezone: "Asia/Tokyo", preferShare: true },
  };
}

function normalizePreferenceOrder<T extends string>(value: unknown, allowed: T[], fallback: T[], legacy?: unknown[]): T[] {
  const source = Array.isArray(value) ? value : Array.isArray(legacy) ? legacy : [];
  return allowed.filter((key) => source.includes(key)).concat(fallback.filter((key) => !source.includes(key)));
}

function normalizeVisibility<T extends string>(allowed: T[], value: unknown, fallback: Record<T, boolean>): Record<T, boolean> {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(allowed.map((key) => [key, typeof source[key] === "boolean" ? source[key] : fallback[key]])) as Record<T, boolean>;
}

function makeBackupSnapshot(data: Data, theme: Theme, locale: Locale): BackupSnapshot {
  return {
    schemaVersion: data.schemaVersion,
    createdAt: Date.now(),
    companies: data.companies,
    schedules: data.events,
    resources: data.materials,
    interviews: data.interviews,
    preparations: data.preparations,
    selectionRecords: data.companies.map((x) => ({ id: x.id, stage: x.stage, updatedAt: x.updatedAt })),
    settings: { theme, locale, preferences: data.preferences, templates: data.templates },
  };
}

function parseBackupPayload(value: unknown): { data: ReturnType<typeof normalize>; counts: { companies: number; schedules: number; materials: number; interviews: number; preparations: number } } {
  if (!value || typeof value !== "object") throw new Error("backup must be an object");
  const x = value as Record<string, unknown>;
  const version = x.schemaVersion;
  if (!(version === 5 || version === "5" || version === "v5")) throw new Error("schemaVersion must be 5");
  const array = (names: string[], required = false): unknown[] => {
    const found = names.find((name) => Array.isArray(x[name]));
    if (!found && required) throw new Error(`missing ${names.join(" or ")}`);
    return found ? x[found] as unknown[] : [];
  };
  const companies = array(["companies"], true);
  const events = array(["events", "schedules"]);
  const materials = array(["materials", "resources", "documents"]);
  const interviews = array(["interviews", "interviewRecords"]);
  const preparations = array(["preparations", "preparationItems"]);
  const backupSettings = (x.settings && typeof x.settings === "object" ? x.settings : {}) as Record<string, any>;
  const data = normalize({ schemaVersion: 5, companies, events, materials, interviews, preparations, focusMinutes: 0, preferences: backupSettings.preferences || x.preferences, templates: backupSettings.templates || x.templates });
  return { data, counts: { companies: companies.length, schedules: events.length, materials: materials.length, interviews: interviews.length, preparations: preparations.length } };
}
const KEY = "career-flow-data-v5",
  OLD = "career-flow-data-v4",
  BACKUP = "career-flow-pre-v5-backup",
  CLEAN = "career-flow-demo-cleaned-v1",
  THEME = "careerflow-theme",
  LOCALE = "careerflow-locale",
  ICON = "careerflow-custom-icon";
const demoNames = ["Rakuten Group", "三菱UFJ银行", "CyberAgent"];
const id = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const ATTACHMENT_DB = "careerflow-attachments";
const ATTACHMENT_STORE = "files";
function attachmentDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ATTACHMENT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(ATTACHMENT_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveAttachment(key: string, file: File) {
  const db = await attachmentDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
    tx.objectStore(ATTACHMENT_STORE).put(file, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function deleteAttachment(key?: string) {
  if (!key) return;
  const db = await attachmentDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
    tx.objectStore(ATTACHMENT_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const types: ItemType[] = [
  "es",
  "web_test",
  "resume",
  "interview",
  "briefing",
  "research",
  "general",
];
const stages: Stage[] = [
  "saved",
  "briefing",
  "es_draft",
  "es_submitted",
  "web_test",
  "first_interview",
  "second_interview",
  "final_interview",
  "offer",
  "rejected",
  "withdrawn",
];
const prefectures = prefectureData as string[];
const cityOptions = Object.fromEntries(Object.entries(municipalityData).map(([prefecture, municipalities]) => [prefecture, (municipalities as { name: string }[]).map((x) => x.name)])) as Record<string, string[]>;
const locationCoordinates: Record<string, [number, number]> = { "東京都渋谷区": [35.6618, 139.7041], "東京都新宿区": [35.6938, 139.7034], "東京都豊島区": [35.7263, 139.7169], "東京都千代田区": [35.6938, 139.7532], "東京都港区": [35.6581, 139.7516], "栃木県鹿沼市": [36.5671, 139.7454], "大阪府大阪市": [34.6937, 135.5023], "神奈川県横浜市": [35.4437, 139.638], "埼玉県さいたま市": [35.8617, 139.6455], "千葉県千葉市": [35.6073, 140.1063] };
const industryOptions = [
  "IT・ソフトウェア", "インターネット・Web", "通信", "SIer・システム開発", "メーカー", "電機・電子", "機械", "自動車", "化学", "食品", "建設", "不動産", "インフラ", "電力・ガス", "鉄道・交通", "物流", "商社", "小売", "金融", "銀行", "証券", "保険", "コンサルティング", "人材", "広告・メディア", "出版", "教育", "医療・福祉", "官公庁・公社", "その他",
];
const industryOccupationGroups: Array<{ industries: string[]; occupations: string[] }> = [
  {
    industries: ["IT・ソフトウェア", "インターネット・Web", "通信", "SIer・システム開発"],
    occupations: ["インフラエンジニア", "ネットワークエンジニア", "サーバーエンジニア", "クラウドエンジニア", "システムエンジニア（SE）", "アプリケーションエンジニア", "Webエンジニア", "フロントエンドエンジニア", "バックエンドエンジニア", "ソフトウェアエンジニア", "セキュリティエンジニア", "データエンジニア", "AI・機械学習エンジニア", "QA・テストエンジニア", "社内SE", "ITコンサルタント", "プリセールス", "テクニカルサポート", "営業", "企画"],
  },
  {
    industries: ["メーカー", "電機・電子", "機械", "自動車", "化学", "食品"],
    occupations: ["研究開発", "設計", "生産技術", "品質管理", "製造技術", "機械設計", "電気・電子設計", "組み込みエンジニア", "営業", "技術営業", "企画"],
  },
  {
    industries: ["金融", "銀行", "証券", "保険"],
    occupations: ["法人営業", "個人営業", "営業", "企画", "リスク管理", "システム", "IT", "事務"],
  },
  {
    industries: ["商社", "小売", "物流"],
    occupations: ["営業", "企画", "マーケティング", "販売", "物流管理", "SCM", "事務"],
  },
  {
    industries: ["建設", "不動産", "インフラ", "電力・ガス", "鉄道・交通"],
    occupations: ["施工管理", "設計", "技術職", "設備管理", "営業", "企画", "IT・システム"],
  },
];
const generalOccupationOptions = ["営業", "企画", "マーケティング", "経理・財務", "人事", "総務", "法務", "事務", "研究開発", "品質管理", "販売・サービス"];
function occupationsForIndustry(industry: string): string[] {
  const group = industryOccupationGroups.find((entry) => entry.industries.includes(industry.trim()));
  return [...new Set([...(group?.occupations || generalOccupationOptions), "その他"])];
}
const funnelStages: FunnelStage[] = ["funnelInterested", "funnelDocuments", "funnelAptitude", "funnelInterview", "funnelFinal", "funnelOffer"];
type FunnelStage = "funnelInterested" | "funnelDocuments" | "funnelAptitude" | "funnelInterview" | "funnelFinal" | "funnelOffer";
function funnelStageFor(stage: Company["stage"]): FunnelStage | null {
  const value = String(stage).trim().toLowerCase();
  if (["offer", "内定", "offer received"].includes(value)) return "funnelOffer";
  if (["final selection", "最终选考", "最終選考"].includes(value)) return "funnelFinal";
  if (["first_interview", "second_interview", "final_interview", "third_interview", "group_interview", "interview", "面试", "一次面试", "二次面试", "三次面试", "小组面试", "面谈", "面接中", "面接", "interviewing"].includes(value)) return "funnelInterview";
  if (["web_test", "spi", "玉手箱", "cab", "gab", "aptitude test", "适性検査", "适性检査", "web / aptitude test", "web・适性测试", "web・適性検査"].includes(value)) return "funnelAptitude";
  if (["es_draft", "es_submitted", "resume", "document screening", "书类选考", "書類選考", "材料选考", "document_screening", "es"].includes(value)) return "funnelDocuments";
  if (["saved", "briefing", "interested", "关注中", "気になる"].includes(value)) return "funnelInterested";
  return null;
}
function isActiveCompany(company: Company): boolean {
  return ["funnelDocuments", "funnelAptitude", "funnelInterview", "funnelFinal"].includes(funnelStageFor(company.stage) || "");
}
function isWaitingResultCompany(company: Company, events: Event[]): boolean {
  return ["web_test", "first_interview", "second_interview", "final_interview"].includes(company.stage) && !getUpcomingEvent(events, company.id);
}
function readRouteState(): { view: View; companyFilter: CompanyRouteFilter | null; scheduleFilter: ScheduleRouteFilter | null; selectedCompanyId: string | null } {
  if (typeof window === "undefined") return { view: "dashboard", companyFilter: null, scheduleFilter: null, selectedCompanyId: null };
  const params = new URLSearchParams(window.location.search);
  const routeByPath: Record<string, View> = {
    "/home": "dashboard",
    "/companies": "companies",
    "/notifications": "notifications",
    "/schedule": "schedule",
    "/materials": "materials",
    "/es-interview": "materials",
  };
  const path = window.location.pathname.replace(/\/$/, "");
  const requestedView = params.get("view");
  const view = (["dashboard", "companies", "notifications", "schedule", "materials"] as View[]).includes(requestedView as View)
    ? requestedView as View
    : routeByPath[path.slice(path.lastIndexOf("/"))] || "dashboard";
  const filter = params.get("filter");
  return {
    view,
    companyFilter: view === "companies" && (filter === "active" || filter === "waiting-result") ? filter : null,
    scheduleFilter: view === "schedule" && filter === "this-week-deadline" ? filter : null,
    selectedCompanyId: view === "companies" ? params.get("company") : null,
  };
}
const tr = {
  zh: {
    dashboard: "主页",
    notifications: "通知",
    companies: "企业",
    schedule: "日程",
    materials: "ES・面试",
    selectionRecords: "选考记录",
    addRecord: "添加记录",
    addTest: "添加 Web・适性测试",
    addBriefing: "添加说明会",
    addOtherRecord: "添加其他记录",
    materialCategory: "材料",
    interviewCategory: "面试记录",
    preparationCategory: "准备事项",
    recruitmentPage: "招聘页面",
    displayColor: "显示色",
    settings: "设置",
    new: "新建",
    title: "就活摘要",
    fieldTitle: "标题",
    subtitle: "日本就活进度与材料管理",
    addCompany: "新增企业",
    addEvent: "新增日程",
    addMaterial: "添加材料",
    addInterview: "新增面试记录",
    addPrep: "新增准备事项",
    deleteEventTitle: "删除此日程？",
    deleteEventDescription: "删除后无法恢复。",
    deleteAction: "删除",
    deleteEventAction: "删除日程",
    untitledSchedule: "未命名日程",
    interviews: "面试记录",
    preparations: "准备事项",
    round: "面试轮次",
    interviewAt: "面试日期和时间",
    format: "面试形式",
    interviewers: "面试官",
    questions: "提问内容",
    answers: "回答内容",
    feeling: "面试感受",
    score: "自我评分",
    result: "结果",
    improvements: "改进事项",
    prepType: "准备类型",
    es_fix: "ES 修改",
    interview_practice: "面试练习",
    web_test_prep: "Web 测试准备",
    documents: "证件准备",
    clothes: "服装准备",
    route: "交通路线确认",
    other: "其他",
    inProgress: "选考中",
    dueWeek: "本周截止",
    waiting: "等待结果",
    deadlines: "本周截止",
    deadlineNext: "截止与下一日程",
    funnel: "选考进度",
    monthSchedule: "本月日程", monthNoEvents: "本月暂无日程", featuredCompanies: "重点企业", viewAllCompanies: "查看全部企业",
    previousMonth: "上个月", nextMonth: "下个月", viewAllSchedules: "查看全部日程",
    results: "结果待办列表",
    dueToday: "今天截止", dueTomorrow: "明天截止", overdueLabel: "已逾期",
    focus: "本周准备重点",
    funnelInterested: "关注中",
    funnelDocuments: "材料选考",
    funnelAptitude: "Web・适性测试",
    funnelInterview: "面试中",
    funnelFinal: "最终选考",
    funnelOffer: "内定",
    company: "企业",
    companyInfo: "企业信息",
    selectionOverview: "选考概况",
    currentStage: "当前选考阶段",
    nextSchedule: "下一日程",
    futureSchedule: "后续日程",
    selectionHistory: "选考记录",
    noFutureSchedules: "暂无后续日程",
    noNextSchedule: "暂无下一日程",
    noSelectionRecords: "还没有选考记录",
    selectionRecordsHint: "从材料、测试、说明会或面试开始记录。",
    notSet: "未设置",
    editSchedule: "编辑日程",
    addSchedule: "添加日程",
    jobTitle: "招聘职位・类别",
    selectOption: "请选择",
    selectIndustryFirst: "请先选择行业",
    industryChanged: "行业已更改，请重新选择职种",
    industryInput: "输入行业",
    positionInput: "输入职种",
    industry: "行业",
    position: "职种",
    interest: "志望度",
    stage: "当前选考阶段",
    interviewStage: "面试阶段",
    interviewStageDetail: "输入其他面试阶段",
    syncCompanyStage: (stage: string) => `同时将企业选考阶段更新为「${stage}」`,
    currentCompanyStage: (company: string, stage: string) => `${company}的当前选考阶段：${stage}`,
    stageSyncFailed: "日程已保存，但企业选考阶段更新失败。",
    stageProgressionTitle: "确认选考阶段",
    stageProgressionCurrent: (stage: string) => `当前选考阶段是“${stage}”。`,
    stageProgressionBackward: (stage: string) => `“${stage}”是早于当前选考阶段的日程。要继续添加吗？`,
    stageProgressionTerminal: "添加此日程不会改变企业的选考阶段。",
    stageProgressionBack: "返回",
    stageProgressionContinue: "继续添加",
    event: "下一项日程",
    place: "地点或线上方式",
    url: "招聘页面",
    notes: "备注",
    saved: "关注中",
    briefing: "说明会",
    es_draft: "ES 准备",
    es_submitted: "ES 已提交",
    web_test: "Web 测试",
    first_interview: "一次面试",
    second_interview: "二次面试",
    final_interview: "最终面试",
    offer: "Offer",
    rejected: "不通过",
    withdrawn: "辞退",
    es: "ES",
    resume: "履历书",
    interview: "面试",
    research: "企业研究",
    general: "普通事项",
    high: "高",
    medium: "中",
    low: "低",
    due: "截止时间",
    priority: "优先级",
    tags: "标签",
    all: "全部",
    incomplete: "未完成",
    completed: "已完成",
    overdue: "已逾期",
    urgent: "24 小时内",
    today: "今天",
    tomorrow: "明天",
    daysAfter: (n: number) => `${n}天后`,
    days: "天",
    save: "保存",
    cancel: "取消",
    edit: "编辑",
    remove: "删除",
    appearance: "外观",
    language: "语言",
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
    backup: "导出备份",
    restore: "恢复备份",
    data: "数据管理",
    icon: "自定义图标",
    online: "线上",
    offline: "线下",
    undecided: "形式未确定",
    noData: "暂无事项",
    noSchedule: "暂无日程",
    deleteCompany: "删除企业",
    deleteQuestion: "是否同时删除该企业关联的日程、资料和选考记录？",
    deleteAll: "同时删除关联数据",
    deleteOnly: "仅删除企业",
    undo: "撤销",
    materialsSub: "材料、面试记录与准备事项",
    scheduleSub: "说明会、笔试、面试与截止时间",
    jobSettings: "求职设置", customize: "自定义", templates: "模板", calendarIntegration: "日历连接",
    homeRegion: "常驻就活地区", homeRegionHint: "没有填写详细地点的日程将使用此地区作为天气和出行参考。",
    defaultStage: "新企业默认选考阶段", defaultInterest: "新企业默认志望度", defaultStageHint: "这是新增企业时自动填入的默认值。", defaultInterestHint: "保存前仍可单独修改，不会影响已经登记的企业。", homeSummary: "顶部摘要", homeSummaryOrder: "摘要卡片顺序", homeSections: "主页内容区块", homeSectionsOrder: "内容区块顺序", companyCard: "企业卡片显示信息",
    showIndustry: "行业", showPosition: "职种", showStage: "选考阶段", showInterest: "志望度", showNextEvent: "下一日程", defaultCompanySort: "默认企业排序",
    sortUpdated: "最近更新", sortEvent: "下一日程", sortInterest: "志望度从高到低", sortName: "企业名称", moveUp: "上移", moveDown: "下移",
    templateNew: "新建模板", templateEdit: "编辑模板", templateDelete: "删除模板", templateDuplicate: "复制模板", templateCategory: "类别", templateTitle: "标题", templateContent: "内容", templateSave: "保存模板", templateEmpty: "还没有模板", templateInsert: "从模板插入", chooseTemplate: "选择模板", insertTemplate: "插入", noTemplates: "暂无可用模板",
    templateSelfPr: "自我PR", templateGakuchika: "学生时代经历", templateMotivation: "志望动机", templateInterviewQuestion: "面试问题", templateReverseQuestion: "反问问题", templatePreparation: "准备事项",
    calendarAdd: "添加到日历", calendarExportFuture: "汇总导出今后的日程", calendarMethod: "添加到日历的方式", calendarMethodHint: "Yami 使用标准 .ics 文件导出，不是实时同步或双向同步。", calendarDescription: "可以将 Yami 中的日程导出为 .ics 文件，再添加到 Apple 日历。", calendarNoSync: "不是实时同步。修改日程后，需要重新导出。", calendarHowTo: "使用方法", calendarIphoneTitle: "iPhone / iPad", calendarIphone: "1. 点击“汇总导出今后的日程”。\n2. 在分享菜单中保存或分享 .ics 文件。\n3. 打开 .ics 文件，按 iOS 提示添加到日历。\n设备或 Safari 版本不同，显示方式可能不同。", calendarMacTitle: "Mac", calendarMac: "1. 点击“汇总导出今后的日程”。\n2. 下载 .ics 文件。\n3. 打开文件，或在 Calendar.app 中选择“文件 → 导入”并选择该文件。", calendarGoogleTitle: "Google Calendar", calendarGoogle: "", calendarWindowsTitle: "Windows / Outlook", calendarWindows: "", calendarImportant: "重要：这不是自动同步。Yami 中的日程发生变化后，请按需要重新导出。", calendarPreferShare: "移动端优先使用分享", calendarExported: "日历文件已生成", calendarNoEvents: "没有可导出的后续日程",
  },
  ja: {
    dashboard: "ホーム",
    notifications: "通知",
    companies: "企業",
    schedule: "日程",
    materials: "ES・面接",
    selectionRecords: "選考記録",
    addRecord: "記録を追加",
    addTest: "Web・適性検査を追加",
    addBriefing: "説明会を追加",
    addOtherRecord: "その他の記録を追加",
    materialCategory: "書類",
    interviewCategory: "面接記録",
    preparationCategory: "準備事項",
    recruitmentPage: "採用ページ",
    displayColor: "表示色",
    settings: "設定",
    new: "新規作成",
    title: "就活サマリー",
    fieldTitle: "タイトル",
    subtitle: "日本就活進捗・書類管理",
    addCompany: "企業を追加",
    addEvent: "日程を追加",
    addMaterial: "書類を追加",
    addInterview: "面接記録を追加",
    addPrep: "準備事項を追加",
    deleteEventTitle: "この日程を削除しますか？",
    deleteEventDescription: "削除すると元に戻せません。",
    deleteAction: "削除",
    deleteEventAction: "日程を削除",
    untitledSchedule: "無題の日程",
    interviews: "面接記録",
    preparations: "準備事項",
    round: "面接回数",
    interviewAt: "面接日時",
    format: "面接形式",
    interviewers: "面接官",
    questions: "質問内容",
    answers: "回答内容",
    feeling: "面接の感触",
    score: "自己評価",
    result: "結果",
    improvements: "改善点",
    prepType: "準備タイプ",
    es_fix: "ES修正",
    interview_practice: "面接練習",
    web_test_prep: "Webテスト対策",
    documents: "書類準備",
    clothes: "服装準備",
    route: "交通経路確認",
    other: "その他",
    inProgress: "選考中",
    dueWeek: "今週の締切",
    waiting: "結果待ち",
    deadlines: "今週の締切",
    deadlineNext: "締切・次の予定",
    funnel: "選考進捗",
    monthSchedule: "今月の予定", monthNoEvents: "今月の予定はありません", featuredCompanies: "注目企業", viewAllCompanies: "すべての企業を見る",
    previousMonth: "前の月", nextMonth: "次の月", viewAllSchedules: "すべての日程を見る",
    results: "結果待ち一覧",
    dueToday: "今日締切", dueTomorrow: "明日締切", overdueLabel: "期限超過",
    focus: "今週の準備重点",
    funnelInterested: "気になる",
    funnelDocuments: "書類選考",
    funnelAptitude: "Web・適性検査",
    funnelInterview: "面接中",
    funnelFinal: "最終選考",
    funnelOffer: "内定",
    company: "企業",
    companyInfo: "企業情報",
    selectionOverview: "選考概要",
    currentStage: "現在の選考段階",
    nextSchedule: "次の予定",
    futureSchedule: "今後の予定",
    selectionHistory: "選考記録",
    noFutureSchedules: "今後の予定はありません",
    noNextSchedule: "予定なし",
    noSelectionRecords: "選考記録がまだありません",
    selectionRecordsHint: "書類、テスト、説明会、面接から記録を始めましょう。",
    notSet: "未設定",
    editSchedule: "日程を編集",
    addSchedule: "日程を追加",
    jobTitle: "募集職種・コース",
    selectOption: "選択してください",
    selectIndustryFirst: "先に業界を選択してください",
    industryChanged: "業界が変更されたため、職種を再選択してください",
    industryInput: "業界を入力",
    positionInput: "職種を入力",
    industry: "業界",
    position: "職種",
    interest: "志望度",
    stage: "選考段階",
    interviewStage: "面接段階",
    interviewStageDetail: "その他の面接段階を入力",
    syncCompanyStage: (stage: string) => `企業の選考段階も「${stage}」に更新する`,
    currentCompanyStage: (company: string, stage: string) => `${company}の現在の選考段階：${stage}`,
    stageSyncFailed: "日程は保存されましたが、企業の選考段階の更新に失敗しました。",
    stageProgressionTitle: "選考段階の確認",
    stageProgressionCurrent: (stage: string) => `現在の選考段階は「${stage}」です。`,
    stageProgressionBackward: (stage: string) => `「${stage}」は現在の選考段階より前の予定です。このまま追加しますか？`,
    stageProgressionTerminal: "この予定を追加しても選考段階は変更されません。",
    stageProgressionBack: "戻る",
    stageProgressionContinue: "そのまま追加",
    event: "次の日程",
    place: "場所・オンライン",
    url: "採用ページ",
    notes: "メモ",
    saved: "気になる",
    briefing: "説明会",
    es_draft: "ES作成",
    es_submitted: "ES提出済",
    web_test: "Webテスト",
    first_interview: "一次面接",
    second_interview: "二次面接",
    final_interview: "最終面接",
    offer: "内定",
    rejected: "不合格",
    withdrawn: "辞退",
    es: "エントリーシート",
    resume: "履歴書",
    interview: "面接",
    research: "企業研究",
    general: "その他",
    high: "高",
    medium: "中",
    low: "低",
    due: "締切",
    priority: "優先度",
    tags: "タグ",
    all: "すべて",
    incomplete: "未完了",
    completed: "完了",
    overdue: "期限切れ",
    urgent: "24時間以内",
    today: "今日",
    tomorrow: "明日",
    daysAfter: (n: number) => `あと${n}日`,
    days: "日",
    save: "保存",
    cancel: "キャンセル",
    edit: "編集",
    remove: "削除",
    appearance: "表示",
    language: "言語",
    light: "ライト",
    dark: "ダーク",
    system: "システム",
    backup: "バックアップを書き出す",
    restore: "バックアップを復元",
    data: "データ",
    icon: "アイコン",
    online: "オンライン",
    offline: "対面",
    undecided: "形式未定",
    noData: "予定なし",
    noSchedule: "日程なし",
    deleteCompany: "企業を削除",
    deleteQuestion: "関連する日程、資料、選考記録も削除しますか？",
    deleteAll: "関連データも削除",
    deleteOnly: "企業のみ削除",
    undo: "元に戻す",
    materialsSub: "書類・面接記録・準備事項",
    scheduleSub: "説明会・筆記・面接・締切",
    jobSettings: "就活設定", customize: "カスタマイズ", templates: "テンプレート", calendarIntegration: "カレンダー連携",
    homeRegion: "常駐就活地域", homeRegionHint: "詳細な場所がない日程では、この地域を天気や移動の目安に使用します。",
    defaultStage: "新規企業のデフォルト選考段階", defaultInterest: "新規企業のデフォルト志望度", defaultStageHint: "新しく企業を追加するときの初期値です。登録時に個別に変更できます。既存の企業には影響しません。", defaultInterestHint: "新しく企業を追加するときの初期値です。登録時に個別に変更できます。既存の企業には影響しません。", homeSummary: "上部サマリー", homeSummaryOrder: "サマリーカードの順序", homeSections: "ホームセクション", homeSectionsOrder: "セクションの順序", companyCard: "企業カードの表示情報",
    showIndustry: "業界", showPosition: "職種", showStage: "選考段階", showInterest: "志望度", showNextEvent: "次の日程", defaultCompanySort: "既定の企業並び替え",
    sortUpdated: "最近更新", sortEvent: "次の日程", sortInterest: "志望度の高い順", sortName: "企業名", moveUp: "上へ", moveDown: "下へ",
    templateNew: "新規作成", templateEdit: "編集", templateDelete: "削除", templateDuplicate: "複製", templateCategory: "カテゴリ", templateTitle: "タイトル", templateContent: "内容", templateSave: "テンプレートを保存", templateEmpty: "テンプレートはまだありません", templateInsert: "テンプレートから挿入", chooseTemplate: "テンプレートを選択", insertTemplate: "挿入", noTemplates: "使用できるテンプレートがありません",
    templateSelfPr: "自己PR", templateGakuchika: "ガクチカ", templateMotivation: "志望動機", templateInterviewQuestion: "面接質問", templateReverseQuestion: "逆質問", templatePreparation: "準備事項",
    calendarAdd: "カレンダーに追加", calendarExportFuture: "今後の予定をまとめて書き出す", calendarMethod: "カレンダーへの追加方法", calendarMethodHint: "Yami は標準の .ics ファイルを書き出します。リアルタイム同期や双方向同期ではありません。", calendarDescription: "Yami の予定を .ics ファイルとして Apple カレンダーに追加できます。", calendarNoSync: "リアルタイム同期ではありません。日程を変更した場合は、必要に応じて再度書き出してください。", calendarHowTo: "使い方", calendarIphoneTitle: "iPhone / iPad", calendarIphone: "1. 「今後の予定をまとめて書き出す」をタップします。\n2. 表示された共有メニューから .ics ファイルを保存・共有します。\n3. .ics ファイルを開き、iOS に表示される案内に従ってカレンダーへ追加します。\n端末や Safari のバージョンによって表示方法が異なる場合があります。", calendarMacTitle: "Mac", calendarMac: "1. 「今後の予定をまとめて書き出す」をクリックします。\n2. .ics ファイルをダウンロードします。\n3. ファイルを開く、または Calendar.app の「ファイル → 読み込む」から .ics を選択します。\n4. 追加先のカレンダーを選択します。", calendarGoogleTitle: "Google Calendar", calendarGoogle: "", calendarWindowsTitle: "Windows / Outlook", calendarWindows: "", calendarImportant: "重要：自動同期ではありません。Yami で日程を変更した場合は、必要に応じて再度書き出してください。", calendarPreferShare: "モバイルでは共有を優先", calendarExported: "カレンダーファイルを生成しました", calendarNoEvents: "書き出せる今後の予定はありません",
  },
  en: {
    dashboard: "Home",
    notifications: "Notifications",
    companies: "Companies",
    schedule: "Schedule",
    materials: "ES · Interview",
    selectionRecords: "Selection Records",
    addRecord: "Add Record",
    addTest: "Add Web / Aptitude Test",
    addBriefing: "Add briefing",
    addOtherRecord: "Add other record",
    materialCategory: "Documents",
    interviewCategory: "Interview records",
    preparationCategory: "Preparations",
    recruitmentPage: "Recruitment Page",
    displayColor: "Display Color",
    settings: "Settings",
    new: "New",
    title: "Career summary",
    fieldTitle: "Title",
    subtitle: "Japan job search progress and materials",
    addCompany: "Add company",
    addEvent: "Add event",
    addMaterial: "Add document",
    addInterview: "Add interview record",
    addPrep: "Add preparation",
    deleteEventTitle: "Delete this schedule?",
    deleteEventDescription: "This cannot be undone.",
    deleteAction: "Delete",
    deleteEventAction: "Delete schedule",
    untitledSchedule: "Untitled schedule",
    interviews: "Interview records",
    preparations: "Preparations",
    round: "Interview round",
    interviewAt: "Interview date and time",
    format: "Format",
    interviewers: "Interviewers",
    questions: "Questions",
    answers: "Answers",
    feeling: "Feeling",
    score: "Self score",
    result: "Result",
    improvements: "Improvements",
    prepType: "Preparation type",
    es_fix: "ES revision",
    interview_practice: "Interview practice",
    web_test_prep: "Web test prep",
    documents: "Documents",
    clothes: "Clothes",
    route: "Route check",
    other: "Other",
    inProgress: "In process",
    dueWeek: "Due this week",
    waiting: "Waiting",
    deadlines: "Due this week",
    deadlineNext: "Deadlines & next events",
    funnel: "Application funnel",
    monthSchedule: "This month's schedule", monthNoEvents: "No events this month", featuredCompanies: "Featured companies", viewAllCompanies: "View all companies",
    previousMonth: "Previous month", nextMonth: "Next month", viewAllSchedules: "View all schedules",
    results: "Waiting for result",
    dueToday: "Due today", dueTomorrow: "Due tomorrow", overdueLabel: "Overdue",
    focus: "Weekly priorities",
    funnelInterested: "Interested",
    funnelDocuments: "Document Screening",
    funnelAptitude: "Web / Aptitude Test",
    funnelInterview: "Interviewing",
    funnelFinal: "Final Selection",
    funnelOffer: "Offer",
    company: "Company",
    industry: "Industry",
    position: "Position",
    selectOption: "Select an option",
    selectIndustryFirst: "Select an industry first",
    industryChanged: "Industry changed. Please select a position again.",
    industryInput: "Enter an industry",
    positionInput: "Enter a position",
    interest: "Interest",
    stage: "Stage",
    interviewStage: "Interview stage",
    interviewStageDetail: "Enter another interview stage",
    syncCompanyStage: (stage: string) => `Also update the company's selection stage to “${stage}”`,
    currentCompanyStage: (company: string, stage: string) => `${company}'s current selection stage: ${stage}`,
    stageSyncFailed: "The schedule was saved, but the company stage could not be updated.",
    stageProgressionTitle: "Check selection stage",
    stageProgressionCurrent: (stage: string) => `The current selection stage is “${stage}”.`,
    stageProgressionBackward: (stage: string) => `“${stage}” is earlier than the current selection stage. Add it anyway?`,
    stageProgressionTerminal: "Adding this event will not change the company's selection stage.",
    stageProgressionBack: "Back",
    stageProgressionContinue: "Add anyway",
    event: "Next event",
    place: "Location or online",
    url: "Careers page",
    notes: "Notes",
    saved: "Saved",
    briefing: "Briefing",
    es_draft: "ES draft",
    es_submitted: "ES submitted",
    web_test: "Web test",
    first_interview: "First interview",
    second_interview: "Second interview",
    final_interview: "Final interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn",
    es: "ES",
    resume: "Resume",
    interview: "Interview",
    research: "Research",
    general: "General",
    high: "High",
    medium: "Medium",
    low: "Low",
    due: "Due",
    priority: "Priority",
    tags: "Tags",
    all: "All",
    incomplete: "Incomplete",
    completed: "Completed",
    overdue: "Overdue",
    urgent: "Within 24h",
    days: "days",
    save: "Save",
    cancel: "Cancel",
    edit: "Edit",
    remove: "Delete",
    appearance: "Appearance",
    language: "Language",
    light: "Light",
    dark: "Dark",
    system: "System",
    backup: "Export complete backup",
    restore: "Restore from backup",
    data: "Data",
    icon: "Custom icon",
    online: "Online",
    noData: "Nothing here",
    noSchedule: "No schedule",
    deleteCompany: "Delete company",
    deleteQuestion:
      "Also delete related events, materials and application records?",
    deleteAll: "Delete related data",
    deleteOnly: "Delete company only",
    undo: "Undo",
    materialsSub: "Documents, interview records and preparations",
    scheduleSub: "Briefings, tests, interviews and deadlines",
    jobSettings: "Job hunt settings", customize: "Customize", templates: "Templates", calendarIntegration: "Calendar integration",
    homeRegion: "Home job-search region", homeRegionHint: "Used as a weather and travel reference when an event has no detailed location.",
    defaultStage: "Default stage for new companies", defaultInterest: "Default interest for new companies", defaultStageHint: "Used as the initial value when adding a company. You can change it before saving; existing companies are unaffected.", defaultInterestHint: "Used as the initial value when adding a company. You can change it before saving; existing companies are unaffected.", homeSummary: "Summary cards", homeSummaryOrder: "Summary card order", homeSections: "Home sections", homeSectionsOrder: "Section order", companyCard: "Company card details",
    showIndustry: "Industry", showPosition: "Position", showStage: "Stage", showInterest: "Interest", showNextEvent: "Next event", defaultCompanySort: "Default company sort",
    sortUpdated: "Recently updated", sortEvent: "Next event", sortInterest: "Interest", sortName: "Company name", moveUp: "Move up", moveDown: "Move down",
    templateNew: "New template", templateEdit: "Edit", templateDelete: "Delete", templateDuplicate: "Duplicate", templateCategory: "Category", templateTitle: "Title", templateContent: "Content", templateSave: "Save template", templateEmpty: "No templates yet", templateInsert: "Insert from template", chooseTemplate: "Choose a template", insertTemplate: "Insert", noTemplates: "No templates available",
    templateSelfPr: "Self PR", templateGakuchika: "Student experience", templateMotivation: "Motivation", templateInterviewQuestion: "Interview question", templateReverseQuestion: "Reverse question", templatePreparation: "Preparation",
    calendarAdd: "Add to calendar", calendarExportFuture: "Export upcoming events", calendarMethod: "How calendar entries are added", calendarMethodHint: "Yami exports standard .ics files. This is not real-time or two-way sync.", calendarDescription: "Export Yami events as .ics files and add them to Apple Calendar.", calendarNoSync: "This is not real-time sync. Export again after changing an event.", calendarHowTo: "How to use", calendarIphoneTitle: "iPhone / iPad", calendarIphone: "1. Select “Export upcoming events”.\n2. Save or share the .ics file from the share sheet.\n3. Open the .ics file and follow iOS instructions to add it to Calendar.", calendarMacTitle: "Mac", calendarMac: "1. Select “Export upcoming events”.\n2. Download the .ics file.\n3. Open it, or use Calendar.app’s “File → Import” command.", calendarGoogleTitle: "Google Calendar", calendarGoogle: "", calendarWindowsTitle: "Windows / Outlook", calendarWindows: "", calendarImportant: "Important: this is not automatic sync. Re-export when needed after changing an event in Yami.", calendarPreferShare: "Prefer sharing on mobile", calendarExported: "Calendar file generated", calendarNoEvents: "No upcoming events to export",
  },
};
// Keep keyboard viewport changes out of React's render path. Safari can emit many
// visualViewport resize events while the keyboard and address bar settle.
if (typeof window !== "undefined") {
  let keyboardFrame = 0;
  const syncKeyboardClass = () => {
    cancelAnimationFrame(keyboardFrame);
    keyboardFrame = requestAnimationFrame(() => {
    const vv = window.visualViewport;
    const keyboardOpen = !!vv && window.innerHeight - vv.height > 140;
    document.documentElement.classList.toggle("keyboard-open", keyboardOpen);
    });
  };
  window.visualViewport?.addEventListener("resize", syncKeyboardClass, {
    passive: true,
  });
  window.visualViewport?.addEventListener("scroll", syncKeyboardClass, {
    passive: true,
  });
  window.addEventListener("resize", syncKeyboardClass, { passive: true });
  queueMicrotask(syncKeyboardClass);
}
function emptyData(): Data {
  return {
    schemaVersion: 5,
    companies: [],
    materials: [],
    events: [],
    interviews: [],
    preparations: [],
    focusMinutes: 0,
    preferences: defaultPreferences(),
    templates: [],
  };
}
function demo(): Data {
  const a = id(),
    b = id();
  return {
    ...emptyData(),
    companies: [
      {
        id: a,
        name: "Rakuten Group",
        industry: "互联网 / 电商",
        position: "Business Development",
        interestLevel: 5,
        stage: "first_interview",
        nextEventAt: at(2, 14),
        locationOrOnline: "Online",
        careersUrl: "",
        notes: "准备案例面试",
        tags: ["sample"],
        color: "#555555",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: b,
        name: "三菱UFJ银行",
        industry: "金融",
        position: "総合職",
        interestLevel: 4,
        stage: "es_submitted",
        nextEventAt: at(5, 23),
        locationOrOnline: "Online",
        careersUrl: "",
        notes: "",
        tags: ["sample"],
        color: "#d18135",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    materials: [
      {
        id: id(),
        title: "Rakuten 一次面接准备",
        companyId: a,
        type: "interview",
        dueAt: at(1, 20),
        priority: "high",
        tags: ["sample"],
        notes: "",
        completed: false,
        isWeeklyFocus: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  };
}
function at(days: number, hour = 18) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}
function inferEventMode(value: string): Event["eventMode"] {
  if (/zoom|teams|meet|online|オンライン|线上|https?:\/\//i.test(value)) return "online";
  return value.trim() ? "offline" : "undecided";
}
function getUpcomingEvent(events: Event[], companyId: string | undefined): Event | undefined {
  if (!companyId) return undefined;
  return events
    .filter((event) => event.companyId === companyId && !(event as Event & { deletedAt?: boolean }).deletedAt && Number.isFinite(new Date(event.startsAt).getTime()) && new Date(event.startsAt).getTime() >= Date.now())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
}
function icsEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function tokyoCalendarParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])) as { year: string; month: string; day: string; hour: string; minute: string };
}
function calendarTimestamp(value: string, addMinutes = 0) {
  const base = parseTokyoCalendarDate(value);
  base.setMinutes(base.getMinutes() + addMinutes);
  const next = tokyoCalendarParts(base);
  return `${next.year}${next.month}${next.day}T${next.hour}${next.minute}00`;
}
function utcCalendarTimestamp(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}
function eventToIcs(event: Event, company: Company | undefined, t: any) {
  const eventLabel = event.type === "general" ? (event.title || t.general) : t[event.type] || event.title || t.general;
  const location = event.locationLabel || event.location || event.locationOrOnline || "";
  const description = [
    company?.name ? `${t.company}: ${company.name}` : "",
    `${t.stage}: ${t[event.stage] || event.stage}`,
    event.eventMode ? `${t.format}: ${t[event.eventMode] || event.eventMode}` : "",
    event.notes ? `${t.notes}: ${event.notes}` : "",
    company?.careersUrl ? `${t.url}: ${company.careersUrl}` : "",
  ].filter(Boolean).join("\n");
  const endAt = event.endsAt || event.endAt;
  const parsedEnd = endAt ? parseTokyoCalendarDate(endAt) : undefined;
  const startDate = parseTokyoCalendarDate(event.startsAt);
  const hasValidEnd = parsedEnd && Number.isFinite(parsedEnd.getTime()) && parsedEnd.getTime() > startDate.getTime();
  const durationMinutes = Number(event.durationMinutes);
  const endTimestamp = hasValidEnd
    ? calendarTimestamp(endAt!)
    : calendarTimestamp(event.startsAt, Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 60);
  const uid = `${event.id}@careerflow`;
  return [
    "BEGIN:VEVENT",
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${utcCalendarTimestamp(new Date().toISOString())}Z`,
    `DTSTART;TZID=Asia/Tokyo:${calendarTimestamp(event.startsAt)}`,
    `DTEND;TZID=Asia/Tokyo:${endTimestamp}`,
    `SUMMARY:${icsEscape(`${company?.name ? `${company.name} - ` : ""}${eventLabel}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    location ? `LOCATION:${icsEscape(location)}` : "",
    company?.careersUrl ? `URL:${icsEscape(company.careersUrl)}` : "",
    "END:VEVENT",
  ].filter(Boolean).join("\r\n");
}
function makeIcs(events: Event[], byId: Record<string, Company>, t: any) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Yami//Yami Calendar//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-TIMEZONE:Asia/Tokyo",
    ...events.map((event) => eventToIcs(event, byId[event.companyId || ""], t)),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
async function shareOrDownloadCalendar(name: string, body: string) {
  const file = new File([body], name, { type: "text/calendar;charset=utf-8" });
  const canShare = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) && !!navigator.share && !!navigator.canShare?.({ files: [file] });
  if (canShare) {
    await navigator.share({ files: [file], title: "Yami Calendar" });
    return "shared" as const;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded" as const;
}
function getLegacyCompanyEventAt(company: any): string {
  const legacy = company.nextEventAt
    || company.scheduleDate
    || (typeof company.nextEvent === "string" ? company.nextEvent : company.nextEvent?.startsAt || company.nextEvent?.startAt)
    || (typeof company.nextSchedule === "string" ? company.nextSchedule : company.nextSchedule?.startsAt || company.nextSchedule?.startAt);
  return typeof legacy === "string" ? legacy.trim() : "";
}
function makeCompanyNextEvent(company: Company, startsAt: string, existing?: Event): Event {
  const locationOrOnline = company.locationOrOnline || "";
  const type: ItemType = company.stage === "briefing" ? "briefing" : company.stage === "web_test" ? "web_test" : company.stage.includes("interview") ? "interview" : "general";
  return {
    id: existing?.id || `company-next-${company.id}-${startsAt}`,
    companyId: company.id,
    title: type === "general" ? "" : type,
    type,
    stage: company.stage,
    startsAt,
    locationOrOnline,
    eventMode: inferEventMode(locationOrOnline),
    attendanceMode: inferEventMode(locationOrOnline),
    notes: existing?.notes || "",
    createdAt: existing?.createdAt || company.createdAt,
    source: "company-next",
  };
}
function normalize(x: any): Data {
  const defaults = defaultPreferences();
  const rawPreferences = (x.preferences || (x.settings && x.settings.preferences) || {}) as Partial<AppPreferences>;
  const rawJobHunt = (rawPreferences.jobHunt || {}) as Partial<AppPreferences["jobHunt"]>;
  const rawCustomize = (rawPreferences.customize || {}) as Partial<AppPreferences["customize"]> & { homeModules?: unknown[] };
  const rawCard = (rawCustomize.companyCard || {}) as Partial<AppPreferences["customize"]["companyCard"]>;
  const rawCalendar = (rawPreferences.calendar || {}) as Partial<AppPreferences["calendar"]>;
  const legacyHomeModules = Array.isArray(rawCustomize.homeModules) ? rawCustomize.homeModules : undefined;
  const summaryOrder = normalizePreferenceOrder(rawCustomize.homeSummaryOrder, defaultHomeSummary, defaultHomeSummary, legacyHomeModules);
  const sectionOrder = normalizePreferenceOrder(rawCustomize.homeSectionOrder, defaultHomeSections, defaultHomeSections, legacyHomeModules);
  const legacySummaryVisibility = Object.fromEntries(defaultHomeSummary.map((key) => [key, legacyHomeModules ? legacyHomeModules.includes(key) : true])) as Record<HomeSummaryModule, boolean>;
  const legacySectionVisibility = Object.fromEntries(defaultHomeSections.map((key) => [key, legacyHomeModules ? legacyHomeModules.includes(key) || !["upcoming", "progress"].includes(key) : true])) as Record<HomeSection, boolean>;
  const rawSummaryVisibility = (rawCustomize.homeSummaryVisibility || {}) as Partial<Record<HomeSummaryModule, boolean>>;
  const rawSectionVisibility = (rawCustomize.homeSectionVisibility || {}) as Partial<Record<HomeSection, boolean>>;
  const homeSectionVisibilityVersion = Number(rawCustomize.homeSectionVisibilityVersion) || 0;
  const migratedSectionVisibility = homeSectionVisibilityVersion < 1
    ? { ...rawSectionVisibility, month: true, featured: true }
    : rawSectionVisibility;
  const preferences: AppPreferences = {
    jobHunt: {
      homeRegion: typeof rawJobHunt.homeRegion === "string" ? rawJobHunt.homeRegion : defaults.jobHunt.homeRegion,
      defaultCompanyStage: stages.includes(rawJobHunt.defaultCompanyStage as Stage) ? rawJobHunt.defaultCompanyStage as Stage : defaults.jobHunt.defaultCompanyStage,
      defaultInterestLevel: Math.min(5, Math.max(1, Number(rawJobHunt.defaultInterestLevel) || defaults.jobHunt.defaultInterestLevel)),
    },
    customize: {
      homeSummaryVisibility: normalizeVisibility(defaultHomeSummary, rawSummaryVisibility, legacySummaryVisibility),
      homeSummaryOrder: summaryOrder,
      homeSectionVisibility: normalizeVisibility(defaultHomeSections, migratedSectionVisibility, legacySectionVisibility),
      homeSectionVisibilityVersion: 1,
      homeSectionOrder: sectionOrder,
      companyCard: { ...defaults.customize.companyCard, ...rawCard },
      companySort: ["updated", "event", "interest", "name"].includes(String(rawCustomize.companySort)) ? rawCustomize.companySort as CompanySort : defaults.customize.companySort,
    },
    calendar: { ...defaults.calendar, ...rawCalendar, timezone: "Asia/Tokyo" },
  };
  const companies = (x.companies || []).map((company: Company) => {
    const { nextEventAt: _legacyNextEventAt, nextSchedule: _legacyNextSchedule, nextEvent: _legacyNextEvent, scheduleDate: _legacyScheduleDate, ...withoutLegacyNext } = company as Company & Record<string, unknown>;
    return withoutLegacyNext;
  });
  const events = (x.events || []).map((event: Event) => {
    const legacy = String(event.locationOrOnline || "");
    const mode = event.eventMode || (event.isOnline === true ? "online" : event.isOnline === false && (event.location || legacy) ? "offline" : event.location ? "offline" : event.meetingUrl || event.onlinePlatform || /zoom|teams|meet|online|オンライン|线上|https?:\/\//i.test(legacy) ? "online" : "undecided");
    const locationLabel = event.locationLabel || event.location || legacy;
    const prefecture = event.prefecture || prefectures.find((value) => locationLabel.includes(value));
    const city = event.city || (prefecture && cityOptions[prefecture]?.find((value) => locationLabel.includes(value)));
    const coords = event.latitude && event.longitude ? [event.latitude, event.longitude] : locationCoordinates[`${prefecture || ""}${city || ""}`];
    return { ...event, eventMode: mode, attendanceMode: event.attendanceMode || mode, prefecture, city, municipality: event.municipality || city, municipalityCode: event.municipalityCode, detailLocation: event.detailLocation || (city ? locationLabel.replace(prefecture || "", "").replace(city, "").replace(/^・/, "") : ""), location: event.location || legacy, locationLabel, latitude: coords?.[0], longitude: coords?.[1], onlinePlatform: event.onlinePlatform || (mode === "online" ? legacy : ""), meetingUrl: event.meetingUrl || (/https?:\/\//i.test(legacy) ? legacy : "") };
  });
  for (const company of (x.companies || []) as Company[]) {
    const startsAt = getLegacyCompanyEventAt(company);
    if (!startsAt || events.some((event: Event) => event.companyId === company.id && event.startsAt === startsAt)) continue;
    events.push(makeCompanyNextEvent(company, startsAt));
  }
  const validTemplateCategories: TemplateCategory[] = ["selfPr", "gakuchika", "motivation", "interviewQuestion", "reverseQuestion", "preparation"];
  const templates = (Array.isArray(x.templates) ? x.templates : Array.isArray((x.settings || {}).templates) ? (x.settings || {}).templates : [])
    .filter((template: any) => template && validTemplateCategories.includes(template.category))
    .map((template: any): CareerTemplate => ({
      id: String(template.id || id()),
      category: template.category,
      title: String(template.title || ""),
      content: String(template.content || ""),
      updatedAt: Number(template.updatedAt) || Date.now(),
    }));
  return {
    schemaVersion: 5,
    companies,
    materials: (x.materials || []).map((m: Material) => ({
      ...m,
      category: "material",
      submissionStatus:
        m.submissionStatus === "review" || m.submissionStatus === "returned"
          ? "drafting"
          : m.submissionStatus,
      documentType: ["open_es", "transcript", "graduation", "recommendation", "other"].includes(m.documentType || "")
        ? "other_document"
        : m.documentType,
    })),
    events,
    interviews: (x.interviews || []).map((v: InterviewRecord) => ({ ...v, category: "interview" })),
    preparations: (x.preparations || []).map((v: Preparation) => ({ ...v, category: "preparation" })),
    focusMinutes: x.focusMinutes || 0,
    preferences,
    templates,
  };
}
function load(): Data {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) {
      const normalized = clean(normalize(JSON.parse(stored)));
      localStorage.setItem(KEY, JSON.stringify(normalized));
      return normalized;
    }
    const old = localStorage.getItem(OLD);
    if (!old) return emptyData();
    localStorage.setItem(BACKUP, old);
    const x = JSON.parse(old),
      ids = new Set(
        (x.companies || [])
          .filter((v: any) => !demoNames.includes(v.name))
          .map((v: any) => v.id),
      );
    return clean(
      normalize({
        schemaVersion: 5,
        companies: (x.companies || [])
          .filter((v: any) => !demoNames.includes(v.name))
          .map((v: any) => ({
            ...v,
            interestLevel: v.interestLevel || 3,
            tags: v.tags || [],
            color: v.color || "#555555",
          })),
        materials: (x.materials || [])
          .filter((v: any) => !v.companyId || ids.has(v.companyId))
          .map((v: any) => ({
            ...v,
            tags: v.tags || [],
            isWeeklyFocus: !!v.isWeeklyFocus,
          })),
        events: [],
        focusMinutes: x.focusMinutes || 0,
      }),
    );
  } catch {
    return emptyData();
  }
}
function clean(d: Data): Data {
  if (localStorage.getItem(CLEAN)) return d;
  const sampleIds = new Set(
    d.companies
      .filter((x) => demoNames.includes(x.name) || x.tags?.includes("sample"))
      .map((x) => x.id),
  );
  localStorage.setItem(CLEAN, "1");
  return sampleIds.size
    ? {
        ...d,
        companies: d.companies.filter((x) => !sampleIds.has(x.id)),
        materials: d.materials.filter(
          (x) =>
            !sampleIds.has(x.companyId || "") && !x.tags?.includes("sample"),
        ),
        events: d.events.filter((x) => !sampleIds.has(x.companyId || "")),
        interviews: d.interviews.filter(
          (x) => !sampleIds.has(x.companyId || ""),
        ),
        preparations: d.preparations.filter(
          (x) => !sampleIds.has(x.companyId || ""),
        ),
      }
    : d;
}
function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export default function App() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [data, setData] = useState<Data>(load);
  const initialRoute = readRouteState();
  const [view, setViewState] = useState<View>(initialRoute.view),
    [companyFilter, setCompanyFilter] = useState<CompanyRouteFilter | null>(initialRoute.companyFilter),
    [scheduleFilter, setScheduleFilter] = useState<ScheduleRouteFilter | null>(initialRoute.scheduleFilter),
    [theme, setTheme] = useState<Theme>(
      () => (localStorage.getItem(THEME) as Theme) || "system",
    ),
    [locale, setLocale] = useState<Locale>(() => {
      const saved = localStorage.getItem(LOCALE);
      return saved === "ja" ? "ja" : "zh";
    }),
    [settings, setSettings] = useState(false),
    [mobileSettingsPage, setMobileSettingsPage] = useState<string | null>(null),
    [form, setForm] = useState<CreateType | null>(null),
    [eventFormPreset, setEventFormPreset] = useState<EventFormPreset>(),
    [recordPickerOpen, setRecordPickerOpen] = useState(false),
    [editCompany, setEditCompany] = useState<Company>(),
    [editEvent, setEditEvent] = useState<Event>(),
    [scheduleCompanyId, setScheduleCompanyId] = useState<string>(),
    [editInterview, setEditInterview] = useState<InterviewRecord>(),
    [editPrep, setEditPrep] = useState<Preparation>(),
    [selected, setSelected] = useState<string | undefined>(initialRoute.selectedCompanyId || undefined),
    [companiesCollapsed, setCompaniesCollapsed] = useState(() => localStorage.getItem("careerflow-companies-collapsed") === "true"),
    [confirm, setConfirm] = useState<Company>(),
    [deleteEvent, setDeleteEvent] = useState<Event>(),
    [filter, setFilter] = useState("all"),
    [companyFilterOpen, setCompanyFilterOpen] = useState(false),
    [companyRecordMenuOpen, setCompanyRecordMenuOpen] = useState(false),
    [toast, setToast] = useState<{ text: string; undo: () => void }>(),
    [icon, setIcon] = useState(() => localStorage.getItem(ICON) || "");
  const json = useRef<HTMLInputElement>(null),
    iconRef = useRef<HTMLInputElement>(null),
    mobileHeaderRef = useRef<HTMLElement>(null),
    workspaceRef = useRef<HTMLElement>(null),
    companyListScrollTopRef = useRef(0),
    restoreCompanyListScrollRef = useRef(false);
  const firstDataRender = useRef(true);
  const t = tr[locale];
  const navigate = (nextView: View, nextFilter?: CompanyRouteFilter | ScheduleRouteFilter, nextCompanyId?: string) => {
    if (view === "companies" && !selected && nextView === "companies" && nextCompanyId) {
      companyListScrollTopRef.current = Math.max(workspaceRef.current?.scrollTop || 0, window.scrollY);
    }
    if (view === "companies" && selected && nextView === "companies" && !nextCompanyId) {
      restoreCompanyListScrollRef.current = true;
    }
    const params = new URLSearchParams();
    params.set("view", nextView);
    if (nextFilter) params.set("filter", nextFilter);
    if (nextView === "companies" && nextCompanyId) params.set("company", nextCompanyId);
    const nextUrl = nextView === "dashboard"
      ? `${window.location.pathname}${window.location.hash}`
      : `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.pushState(null, "", nextUrl);
    setViewState(nextView);
    setCompanyFilter(nextView === "companies" && (nextFilter === "active" || nextFilter === "waiting-result") ? nextFilter : null);
    setScheduleFilter(nextView === "schedule" && nextFilter === "this-week-deadline" ? nextFilter : null);
    setSelected(nextView === "companies" ? nextCompanyId : undefined);
  };
  const setView = (nextView: View) => navigate(nextView);
  const selectCompany = (companyId?: string) => {
    const route = readRouteState();
    navigate("companies", route.companyFilter || undefined, companyId);
  };
  const openCompany = (companyId: string) => selectCompany(companyId);
  const [watchHighlightEventId, setWatchHighlightEventId] = useState<string>();
  const openWatchedCompany = (companyId: string, companyName?: string, eventId?: string) => {
    const matchingCompany = data.companies.find((company) => company.id === companyId || (companyName && companyWatchKey(company.name) === companyWatchKey(companyName)));
    if (matchingCompany) { setWatchHighlightEventId(eventId); selectCompany(matchingCompany.id); }
  };
  const openWatchSettings = () => {
    if (isMobile) {
      setMobileSettingsPage("watch");
    }
    setSettings(true);
  };
  const backToCompanies = () => {
    const route = readRouteState();
    navigate("companies", route.companyFilter || undefined);
  };
  useEffect(() => {
    const onPopState = () => {
      const route = readRouteState();
      if (route.view === "dashboard") normalizeDashboardUrl();
      if (route.view === "companies" && route.selectedCompanyId) {
        restoreCompanyListScrollRef.current = false;
      } else if (route.view === "companies") {
        restoreCompanyListScrollRef.current = true;
      }
      setViewState(route.view);
      setCompanyFilter(route.companyFilter);
      setScheduleFilter(route.scheduleFilter);
      setSelected(route.selectedCompanyId || undefined);
      setCompanyRecordMenuOpen(false);
      setCompanyFilterOpen(false);
      setRecordPickerOpen(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (view !== "companies") return;
    const frame = requestAnimationFrame(() => {
      if (selected) {
        workspaceRef.current?.scrollTo({ top: 0, behavior: "auto" });
        window.scrollTo(0, 0);
      } else if (restoreCompanyListScrollRef.current) {
        const top = companyListScrollTopRef.current;
        workspaceRef.current?.scrollTo({ top, behavior: "auto" });
        window.scrollTo(0, top);
        restoreCompanyListScrollRef.current = false;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [view, selected]);
  const hasOpenOverlay = Boolean(form || settings || confirm || deleteEvent || recordPickerOpen || companyFilterOpen || companyRecordMenuOpen);
  useEffect(() => {
    if (hasOpenOverlay) document.body.dataset.overlayOpen = "true";
    else delete document.body.dataset.overlayOpen;
    return () => { delete document.body.dataset.overlayOpen; };
  }, [hasOpenOverlay]);
  useEffect(() => {
    if (!isMobile) return;
    const header = mobileHeaderRef.current;
    if (!header) return;

    const threshold = 10;
    const snapDelay = 180;
    const state = {
      lastScrollY: 0,
      offset: 0,
      height: header.getBoundingClientRect().height,
      confirmedDirection: 0,
      pendingDirection: 0,
      pendingDistance: 0,
      frame: 0,
      snapTimer: 0,
      resizeObserver: typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
        state.height = header.getBoundingClientRect().height;
        state.offset = Math.min(state.offset, state.height);
        header.style.setProperty("--mobile-header-offset", `${state.offset}px`);
      }),
    };
    const readScrollY = () => Math.max(
      window.scrollY,
      document.documentElement.scrollTop,
      document.body.scrollTop,
      workspaceRef.current?.scrollTop || 0,
    );
    const writeOffset = (offset: number, settling = false) => {
      state.offset = Math.min(state.height, Math.max(0, offset));
      header.dataset.scrollHidden = state.offset >= state.height - 0.5 ? "true" : "false";
      if (settling) header.dataset.scrollSettling = "true";
      else delete header.dataset.scrollSettling;
      header.style.setProperty("--mobile-header-offset", `${state.offset}px`);
    };
    const reset = () => {
      state.lastScrollY = readScrollY();
      state.offset = 0;
      state.confirmedDirection = 0;
      state.pendingDirection = 0;
      state.pendingDistance = 0;
      writeOffset(0);
    };
    const scheduleSnap = () => {
      window.clearTimeout(state.snapTimer);
      state.snapTimer = window.setTimeout(() => {
        if (settings) return;
        const currentY = readScrollY();
        if (currentY <= 4) {
          reset();
          return;
        }
        writeOffset(state.offset >= state.height / 2 ? state.height : 0, true);
        window.setTimeout(() => delete header.dataset.scrollSettling, 220);
      }, snapDelay);
    };
    const update = () => {
      state.frame = 0;
      state.height = header.getBoundingClientRect().height;
      const currentY = readScrollY();
      const delta = currentY - state.lastScrollY;
      state.lastScrollY = currentY;

      if (settings || currentY <= 4) {
        reset();
        return;
      }
      if (Math.abs(delta) < 0.1) return;

      const direction = delta > 0 ? 1 : -1;
      if (direction !== state.confirmedDirection) {
        if (direction !== state.pendingDirection) {
          state.pendingDirection = direction;
          state.pendingDistance = 0;
        }
        state.pendingDistance += Math.abs(delta);
        if (state.pendingDistance < threshold) {
          scheduleSnap();
          return;
        }
        state.confirmedDirection = direction;
        state.pendingDirection = 0;
        state.pendingDistance = 0;
      }

      writeOffset(state.offset + delta);
      scheduleSnap();
    };
    const onScroll = () => {
      delete header.dataset.scrollSettling;
      if (!state.frame) state.frame = window.requestAnimationFrame(update);
    };
    const onResize = () => {
      state.height = header.getBoundingClientRect().height;
      reset();
    };

    header.style.setProperty("--mobile-header-offset", "0px");
    header.dataset.scrollHidden = "false";
    state.resizeObserver?.observe(header);
    reset();
    window.addEventListener("scroll", onScroll, { passive: true });
    workspaceRef.current?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.clearTimeout(state.snapTimer);
      if (state.frame) window.cancelAnimationFrame(state.frame);
      state.resizeObserver?.disconnect();
      window.removeEventListener("scroll", onScroll);
      workspaceRef.current?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      delete header.dataset.scrollHidden;
      delete header.dataset.scrollSettling;
      header.style.removeProperty("--mobile-header-offset");
    };
  }, [isMobile, view, selected, settings]);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(data)), [data]);
  useEffect(() => {
    if (firstDataRender.current) {
      firstDataRender.current = false;
      return;
    }
    const snapshot = makeBackupSnapshot(data, theme, locale);
    createBackup(snapshot).catch(() => setToast({ text: locale === "ja" ? "自動バックアップに失敗しました" : "自动备份失败", undo: () => undefined }));
  }, [data, locale, theme]);
  useEffect(() => localStorage.setItem(LOCALE, locale), [locale]);
  useEffect(() => {
    const m = matchMedia("(prefers-color-scheme:dark)");
    const applyTheme = () => {
      const isDark = theme === "dark" || (theme === "system" && m.matches);
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      document.documentElement.style.colorScheme = isDark ? "dark" : "light";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#000000" : "#f7f7f8");
      const isStandalone = document.documentElement.dataset.displayMode === "standalone"
        || window.matchMedia("(display-mode: standalone)").matches;
      document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute(
        "content",
        isStandalone ? "black-translucent" : (isDark ? "black" : "default"),
      );
    };
    applyTheme();
    localStorage.setItem(THEME, theme);
    m.addEventListener("change", applyTheme);
    return () => m.removeEventListener("change", applyTheme);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const x = setTimeout(() => setToast(undefined), 5000);
    return () => clearTimeout(x);
  }, [toast]);
  const byId = useMemo(
    () => Object.fromEntries(data.companies.map((x) => [x.id, x])),
    [data.companies],
  );
  const now = Date.now(),
    due = selectWeeklyDeadlines(data, now),
    active = data.companies.filter(isActiveCompany),
    waiting = data.companies.filter((x) => isWaitingResultCompany(x, data.events));
  const schedules = [
    ...data.events.map((x) => ({
      kind: "event" as const,
      id: x.id,
      at: x.startsAt,
      title: scheduleDisplayTitle(x.title, x.type, t, x),
      company: byId[x.companyId || ""],
      type: x.type,
      event: x,
      isDeadline: isDeadlineEvent(x),
    })),
    ...data.materials
      .filter((x) => x.dueAt)
      .map((x) => ({
        kind: "material" as const,
        id: x.id,
        at: x.dueAt!,
        title: x.title,
        company: byId[x.companyId || ""],
        type: x.type,
      material: x,
      isDeadline: true,
      })),
    ...data.preparations
      .filter((x) => x.dueAt)
      .map((x) => ({
        kind: "preparation" as const,
        id: x.id,
        at: x.dueAt!,
        title: x.title,
        company: byId[x.companyId || ""],
        type: x.type,
      preparation: x,
      isDeadline: true,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const upcoming = schedules.filter((x) => x.kind === "event" && new Date(x.at).getTime() >= Date.now());
  const dueIds = new Set(due.map((x) => x.key));
  const visibleSchedules = scheduleFilter === "this-week-deadline"
    ? schedules.filter((x) => dueIds.has(`${x.kind}:${x.id}`))
    : schedules;
  const toggle = (x: string) =>
    setData((d) => ({
      ...d,
      materials: d.materials.map((v) =>
        v.id === x ? { ...v, completed: !v.completed } : v,
      ),
      preparations: d.preparations.map((v) =>
        v.id === x ? { ...v, completed: !v.completed } : v,
      ),
    }));
  const focusToggle = (x: string) =>
    setData((d) => ({
      ...d,
      materials: d.materials.map((v) =>
        v.id === x ? { ...v, isWeeklyFocus: !v.isWeeklyFocus } : v,
      ),
    }));
  const removeMaterial = (x: Material) => {
    deleteAttachment(x.attachmentId).catch(() => undefined);
    setData((d) => ({
      ...d,
      materials: d.materials.filter((v) => v.id !== x.id),
    }));
    setToast({
      text: x.title,
      undo: () => setData((d) => ({ ...d, materials: [x, ...d.materials] })),
    });
  };
  const removeEvent = (x: Event) => {
    setData((d) => ({ ...d, events: d.events.filter((v) => v.id !== x.id) }));
    setToast({
      text: x.title,
      undo: () => setData((d) => ({ ...d, events: [x, ...d.events] })),
    });
  };
  const confirmRemoveEvent = () => {
    if (!deleteEvent) return;
    removeEvent(deleteEvent);
    setDeleteEvent(undefined);
    setForm(null);
    setEditEvent(undefined);
  };
  const removeInterview = (x: InterviewRecord) => {
    setData((d) => ({
      ...d,
      interviews: d.interviews.filter((v) => v.id !== x.id),
    }));
    setToast({
      text: x.round,
      undo: () => setData((d) => ({ ...d, interviews: [x, ...d.interviews] })),
    });
  };
  const removePrep = (x: Preparation) => {
    setData((d) => ({
      ...d,
      preparations: d.preparations.filter((v) => v.id !== x.id),
    }));
    setToast({
      text: x.title,
      undo: () =>
        setData((d) => ({ ...d, preparations: [x, ...d.preparations] })),
    });
  };
  const saveCompany = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      base = editCompany,
      eventAt = String(f.get("event") || "").trim() || undefined;
    const v: Company = {
      id: base?.id || id(),
      name: String(f.get("name")),
      industry: String(f.get("industry")),
      position: String(f.get("jobCategory") || f.get("position") || ""),
      jobCategory: String(f.get("jobCategory") || f.get("position") || "") || undefined,
      jobTitle: String(f.get("jobTitle") || "") || undefined,
      interestLevel: Number(f.get("interest")) || data.preferences.jobHunt.defaultInterestLevel,
      stage: (f.get("stage") as Stage) || data.preferences.jobHunt.defaultCompanyStage,
      locationOrOnline: String(f.get("place") || base?.locationOrOnline || ""),
      careersUrl: String(f.get("url")),
      notes: String(f.get("notes")),
      tags: base?.tags || [],
      color: String(f.get("color")),
      createdAt: base?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    setData((d) => ({
      ...d,
      events: (() => {
        const managed = d.events.filter((event) =>
          event.companyId === v.id &&
          event.source === "company-next",
        );
        const remaining = d.events.filter((event) => !managed.some((item) => item.id === event.id));
        if (!eventAt) return base ? d.events : remaining;
        return [makeCompanyNextEvent(v, eventAt, managed[0]), ...remaining];
      })(),
      companies: base
        ? d.companies.map((x) => (x.id === v.id ? v : x))
        : [v, ...d.companies],
    }));
    setForm(null);
    setEditCompany(undefined);
  };
  const saveMaterial = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      file = f.get("attachment") instanceof File && (f.get("attachment") as File).size ? f.get("attachment") as File : undefined,
      attachmentId = file ? id() : undefined,
      v: Material = {
        category: "material",
        id: id(),
        title: String(f.get("versionName") || file?.name || (f.get("documentType") === "other_document" ? f.get("otherType") : f.get("documentType")) || "材料"),
        companyId: String(f.get("company") || "") || undefined,
        type: "es",
        dueAt: String(f.get("due") || "") || undefined,
        priority: (f.get("priority") || "medium") as Priority,
        tags: String(f.get("tags") || "")
          .split(/[，,\n]+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        notes: String(f.get("notes") || ""),
        completed: false,
        isWeeklyFocus: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        documentType: (f.get("documentType") === "other_document" ? f.get("otherType") : f.get("documentType")) as Material["documentType"],
        submissionStatus: f.get("submissionStatus") as Material["submissionStatus"],
        submittedAt: String(f.get("submittedAt") || "") || undefined,
        versionName: String(f.get("versionName") || "") || undefined,
        fileName: file?.name || String(f.get("fileName") || "") || undefined,
        language: String(f.get("language") || "") || undefined,
        characterLimit: String(f.get("characterLimit") || "") || undefined,
        motivation: String(f.get("motivation") || "") || undefined,
        selfPr: String(f.get("selfPr") || "") || undefined,
        gakuchika: String(f.get("gakuchika") || "") || undefined,
        strengths: String(f.get("strengths") || "") || undefined,
        weaknesses: String(f.get("weaknesses") || "") || undefined,
        research: String(f.get("research") || "") || undefined,
        customQuestions: String(f.get("customQuestions") || "[]") ? JSON.parse(String(f.get("customQuestions") || "[]")) : [],
        result: f.get("result") as Material["result"],
        resultAt: String(f.get("resultAt") || "") || undefined,
        revisionPoints: String(f.get("revisionPoints") || "") || undefined,
        question: String(f.get("question") || "") || undefined,
        answer: String(f.get("answer") || "") || undefined,
        saveMode: String(f.get("saveMode") || "text") as Material["saveMode"],
        attachmentId,
        mimeType: file?.type,
        fileSize: file?.size,
      };
    if (file && attachmentId) await saveAttachment(attachmentId, file);
    setData((d) => ({ ...d, materials: [v, ...d.materials] }));
    setForm(null);
  };
  const saveEvent = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      base = editEvent,
      prefecture = String(f.get("prefecture") || base?.prefecture || "") || undefined,
      municipality = String(f.get("city") || base?.municipality || base?.city || "") || undefined,
      detailLocation = String(f.get("detailLocation") || base?.detailLocation || ""),
      generatedLocation = [prefecture, municipality].filter(Boolean).join("") + (detailLocation ? `・${detailLocation}` : ""),
      coordinateKey = `${prefecture || ""}${municipality || ""}`,
      localCoordinates = locationCoordinates[coordinateKey],
      coordinates = localCoordinates || (prefecture && municipality ? await geocodeCoordinates(`${municipality}, ${prefecture}, Japan`) : undefined),
      v: Event = {
        id: base?.id || id(),
        companyId: String(f.get("company") || "") || undefined,
        title: String(f.get("type")),
        type: f.get("type") as ItemType,
        stage: (() => {
          const type = f.get("type") as ItemType;
          const interviewStage = String(f.get("interviewStage") || "");
          return type === "interview" && interviewStage !== "other" && interviewStageOptions.includes(interviewStage as typeof interviewStageOptions[number])
            ? interviewStage as Stage
            : base?.stage || eventFormPreset?.stage || data.preferences.jobHunt.defaultCompanyStage;
        })(),
        interviewStage: f.get("type") === "interview" ? String(f.get("interviewStage") || "other") as Event["interviewStage"] : undefined,
        interviewStageDetail: f.get("type") === "interview" && f.get("interviewStage") === "other" ? String(f.get("interviewStageDetail") || "") : undefined,
        startsAt: String(f.get("startsAt")),
        endsAt: base?.endsAt,
        endAt: base?.endAt,
        durationMinutes: base?.durationMinutes,
        locationOrOnline: String(f.get("location") || f.get("onlinePlatform") || (String(f.get("eventMode") || base?.eventMode) === "offline" ? generatedLocation : base?.locationOrOnline || "")),
        eventMode: String(f.get("eventMode") || base?.eventMode || "undecided") as Event["eventMode"],
        location: String(f.get("location") || (String(f.get("eventMode") || base?.eventMode) === "offline" ? generatedLocation : base?.location || "")),
        onlinePlatform: String(f.get("onlinePlatform") || base?.onlinePlatform || ""),
        meetingUrl: String(f.get("meetingUrl") || base?.meetingUrl || ""),
        attendanceMode: String(f.get("eventMode") || base?.eventMode || "undecided") as Event["attendanceMode"],
        prefecture,
        city: municipality,
        municipality,
        municipalityCode: String(f.get("city") || base?.municipalityCode || "") || undefined,
        detailLocation,
        locationLabel: String(f.get("manualLocation") || "") || generatedLocation,
        latitude: coordinates?.[0],
        longitude: coordinates?.[1],
        notes: String(f.get("notes")),
        createdAt: base?.createdAt || Date.now(),
        source: base?.source,
      };
    setData((d) => ({
      ...d,
      events: base && d.events.some((x) => x.id === v.id)
        ? d.events.map((x) => (x.id === v.id ? v : x))
        : [v, ...d.events],
    }));
    const syncCompanyStage = f.get("syncCompanyStage") === "on";
    const targetStage = v.interviewStage;
    if (syncCompanyStage && v.companyId && v.type === "interview" && isInterviewProgressStage(targetStage)) {
      try {
        setData((current) => {
          const company = current.companies.find((item) => item.id === v.companyId);
          if (!company || !shouldOfferInterviewStageSync(company.stage, targetStage)) return current;
          return {
            ...current,
            companies: current.companies.map((item) => item.id === company.id
              ? { ...item, stage: targetStage, updatedAt: Date.now() }
              : item),
          };
        });
      } catch {
        setToast({ text: t.stageSyncFailed, undo: () => undefined });
      }
    }
    setEventFormPreset(undefined);
  };
  const saveInterview = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      base = editInterview,
      v: InterviewRecord = {
        category: "interview",
        id: base?.id || id(),
        companyId: String(f.get("company") || "") || undefined,
        round: String(f.get("round")),
        roundCode: String(f.get("roundCode") || "other"),
        interviewAt: String(f.get("interviewAt")),
        format: String(f.get("format")),
        participationMode: String(f.get("participationMode") || "undecided"),
        interviewers: String(f.get("interviewers")),
        questions: String(f.get("questions")),
        answers: String(f.get("answers")),
        feeling: String(f.get("feeling")),
        score: Number(f.get("score") || 3),
        result: String(f.get("result")),
        improvements: String(f.get("improvements")),
        notes: String(f.get("notes")),
        createdAt: base?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
    setData((d) => ({
      ...d,
      interviews: base
        ? d.interviews.map((x) => (x.id === v.id ? v : x))
        : [v, ...d.interviews],
    }));
    setForm(null);
    setEditInterview(undefined);
  };
  const savePrep = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      base = editPrep,
      v: Preparation = {
        category: "preparation",
        id: base?.id || id(),
        title: String(f.get("title")),
        companyId: String(f.get("company") || "") || undefined,
        type: f.get("type") as PrepType,
        dueAt: String(f.get("due") || "") || undefined,
        priority: f.get("priority") as Priority,
        completed: f.get("completed") === "on",
        notes: String(f.get("notes")),
        createdAt: base?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
    setData((d) => ({
      ...d,
      preparations: base
        ? d.preparations.map((x) => (x.id === v.id ? v : x))
        : [v, ...d.preparations],
    }));
    setForm(null);
    setEditPrep(undefined);
  };
  const deleteCompany = (co: Company, all: boolean) => {
    setData((d) => ({
      ...d,
      companies: d.companies.filter((x) => x.id !== co.id),
      materials: all
        ? d.materials.filter((x) => x.companyId !== co.id)
        : d.materials.map((x) =>
            x.companyId === co.id ? { ...x, companyId: undefined } : x,
          ),
      events: all
        ? d.events.filter((x) => x.companyId !== co.id)
        : d.events.map((x) =>
            x.companyId === co.id ? { ...x, companyId: undefined } : x,
          ),
      interviews: all
        ? d.interviews.filter((x) => x.companyId !== co.id)
        : d.interviews.map((x) =>
            x.companyId === co.id ? { ...x, companyId: undefined } : x,
          ),
      preparations: all
        ? d.preparations.filter((x) => x.companyId !== co.id)
        : d.preparations.map((x) =>
            x.companyId === co.id ? { ...x, companyId: undefined } : x,
          ),
    }));
    setConfirm(undefined);
    setSelected(undefined);
  };
  const download = (name: string, body: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff", body], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportCalendar = async (requestedEvents?: Event[]) => {
    const events = (requestedEvents || data.events).filter((event) => Number.isFinite(parseTokyoCalendarDate(event.startsAt).getTime()) && parseTokyoCalendarDate(event.startsAt).getTime() >= Date.now());
    if (!events.length) {
      setToast({ text: t.calendarNoEvents, undo: () => undefined });
      return;
    }
    const name = requestedEvents?.length === 1 ? `yami-event-${events[0].id}.ics` : "yami-upcoming-events.ics";
    try {
      await shareOrDownloadCalendar(name, makeIcs(events, byId, t));
      setToast({ text: t.calendarExported, undo: () => undefined });
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setToast({ text: t.calendarNoEvents, undo: () => undefined });
    }
  };
  const closeMobileSettings = () => {
    const layer = document.querySelector<HTMLElement>(".mobile-settings-layer");
    const active = document.activeElement;
    if (layer?.contains(active) && active instanceof HTMLElement) active.blur();
    setSettings(false);
    setMobileSettingsPage(null);
  };
  const importJson = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const f = e.target.files?.[0];
    if (!f) return;
    const confirmed = window.confirm(locale === "ja" ? "バックアップを復元すると、このデバイスの現在のデータが上書きされます。続行しますか？" : "恢复备份将覆盖当前设备中的数据，是否继续？");
    if (!confirmed) { input.value = ""; return; }
    const r = new FileReader();
    r.onload = async () => {
      try {
        const x = JSON.parse(String(r.result));
        const parsed = parseBackupPayload(x);
        await createBackup(makeBackupSnapshot(data, theme, locale));
        setData(parsed.data);
        setSettings(false);
        setMobileSettingsPage(null);
        setToast({ text: locale === "ja" ? "復元しました" : "恢复成功", undo: () => undefined });
      } catch (error) {
        console.error("[backup] restore validation failed", error);
        setToast({ text: locale === "ja" ? "バックアップの形式が無効です" : "备份格式无效，原数据未改变", undo: () => undefined });
      }
      input.value = "";
    };
    r.onerror = () => { setToast({ text: locale === "ja" ? "バックアップを読み込めませんでした" : "无法读取备份文件", undo: () => undefined }); input.value = ""; };
    r.readAsText(f);
  };
  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const v = String(r.result);
      setIcon(v);
      localStorage.setItem(ICON, v);
    };
    r.readAsDataURL(f);
  };
  const updatePreferences = (change: (current: AppPreferences) => AppPreferences) => {
    setData((current) => ({ ...current, preferences: change(current.preferences) }));
  };
  const open = (kind: CreateType) => {
    setEventFormPreset(undefined);
    setForm(kind);
  };
  const openRecordEvent = (preset: EventFormPreset, companyId?: string) => {
    setEditEvent(undefined);
    setScheduleCompanyId(companyId);
    setEventFormPreset(preset);
    setForm("schedule");
  };
  return (
    <WatchProvider><div className="app-shell" data-app-shell="true">
      <div className="student-app career-app">
        <aside className="sidebar panel">
          <Brand />
          <StableNav view={view} setView={setView} t={t} />
          <div className={`course-nav ${companiesCollapsed ? "collapsed" : ""}`}>
            <div className="course-nav-heading" onClick={() => { const next = !companiesCollapsed; setCompaniesCollapsed(next); localStorage.setItem("careerflow-companies-collapsed", String(next)); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const next = !companiesCollapsed; setCompaniesCollapsed(next); localStorage.setItem("careerflow-companies-collapsed", String(next)); } }}>
              <span>{t.companies} <b>{data.companies.length}</b></span>
              <span className="course-nav-heading-actions">
                {companiesCollapsed ? <ChevronDown className="collapse-chevron" /> : <ChevronUp className="collapse-chevron" />}
              </span>
            </div>
            {!companiesCollapsed && data.companies.map((x) => (
              <button
                className={view === "companies" && selected === x.id ? "selected" : ""}
                title={x.name}
                key={x.id}
                onClick={() => {
                  selectCompany(x.id);
                }}
              >
                <i style={{ background: x.color }} />
                {x.name}
              </button>
            ))}
          </div>
          <button className="settings-link" onClick={() => setSettings(true)}>
            <Settings />
            {t.settings}
          </button>
        </aside>
        <header ref={mobileHeaderRef} className="mobile-header glass-lite">
          <button className="mobile-menu-button" data-menu-open={settings ? "true" : "false"} onClick={() => {
            if (settings) {
              closeMobileSettings();
              return;
            }
            // The global hamburger always opens at the root level. This must happen
            // before the persistent navigation surface begins its existing reveal.
            setMobileSettingsPage(null);
            setSettings(true);
          }} aria-label={settings ? t.cancel : t.settings}>
            {settings ? <X /> : <Menu />}
          </button>
          <YamiLogoLockup variant="mobile" className="mobile-header-title" />
          <span className="mobile-header-spacer" aria-hidden="true" />
        </header>
        <main
          ref={workspaceRef}
          className="workspace"
        >
          {view === "dashboard" && (
            <Dashboard
              {...{
                t,
                data,
                active,
                due,
                waiting,
                upcoming,
                schedules,
                byId,
                open,
                openWatchSettings,
                navigate,
                openCompany,
                setView,
                setEditEvent,
                setForm,
                onExportCalendar: (event: Event) => exportCalendar([event]),
              }}
            />
          )}
          {view === "companies" && (
            <Companies
              {...{
                t,
                data,
                byId,
                selected,
                open,
                setEditCompany,
                setEditEvent,
                setScheduleCompanyId,
                setForm,
                openRecordEvent,
                setConfirm,
                companyFilter,
                clearCompanyFilter: () => navigate("companies"),
                filterSheetOpen: companyFilterOpen,
                setFilterSheetOpen: setCompanyFilterOpen,
                recordMenuOpen: companyRecordMenuOpen,
                setRecordMenuOpen: setCompanyRecordMenuOpen,
                onBack: backToCompanies,
                onOpenCompany: openCompany,
                openWatchSettings,
                watchHighlightEventId,
              }}
            />
          )}
          {view === "notifications" && <NotificationPage locale={t.language === "言語" ? "ja" : "zh"} openCompany={openWatchedCompany} openSettings={openWatchSettings} />}
          {view === "schedule" && (
            <Schedule
              {...{
                t,
                schedules: visibleSchedules,
                scheduleFilter,
                clearScheduleFilter: () => navigate("schedule"),
                setEditEvent,
                setForm,
                removeEvent,
                removeMaterial,
                removePrep,
                setEditPrep,
                onExportCalendar: (event: Event) => exportCalendar([event]),
              }}
            />
          )}
          {view === "materials" && (
            <Materials
              {...{
                t,
                data,
                byId,
                filter,
                setFilter,
                toggle,
                focusToggle,
                open,
                removeMaterial,
                removeInterview,
                removePrep,
                setEditInterview,
                setEditPrep,
                recordPickerOpen,
                setRecordPickerOpen,
              }}
            />
          )}
        </main>
        {isMobile && (
          <MobileSettingsDrawer
            t={t}
            page={mobileSettingsPage}
            setPage={setMobileSettingsPage}
            close={closeMobileSettings}
            open={settings}
            theme={theme}
            setTheme={setTheme}
            locale={locale}
            setLocale={setLocale}
            data={data}
            setData={setData}
            icon={icon}
            json={json}
            iconRef={iconRef}
            importJson={importJson}
            upload={upload}
            download={download}
            updatePreferences={updatePreferences}
            exportCalendar={exportCalendar}
          />
        )}
        {!isMobile && settings && (
          <SettingsPanel
            t={t}
            theme={theme}
            setTheme={setTheme}
            locale={locale}
            setLocale={setLocale}
            close={() => setSettings(false)}
            data={data}
            setData={setData}
            icon={icon}
            json={json}
            iconRef={iconRef}
            importJson={importJson}
            upload={upload}
            download={download}
            updatePreferences={updatePreferences}
            exportCalendar={exportCalendar}
          />
        )}{" "}
        <input hidden ref={json} type="file" accept=".json,application/json" onChange={importJson} />
        {form === "company" && (
          <CompanyForm
            t={t}
            initial={editCompany}
            defaultStage={data.preferences.jobHunt.defaultCompanyStage}
            defaultInterest={data.preferences.jobHunt.defaultInterestLevel}
            nextEvent={editCompany ? getUpcomingEvent(data.events, editCompany.id) : undefined}
            openNextEvent={(event?: Event) => {
              setEditEvent(event);
              setScheduleCompanyId(editCompany?.id);
              setEditCompany(undefined);
              setForm("schedule");
            }}
            close={() => {
              setForm(null);
              setEditCompany(undefined);
            }}
            save={saveCompany}
          />
        )}{" "}
        {form === "es" && (
          <MaterialForm
            t={t}
            companies={data.companies}
            templates={data.templates}
            close={() => setForm(null)}
            save={saveMaterial}
          />
        )}{" "}
        {form === "schedule" && (
          <EventForm
            t={t}
            companies={data.companies}
            initial={editEvent}
            defaultCompanyId={scheduleCompanyId}
            defaultType={eventFormPreset?.type}
            defaultStage={eventFormPreset?.stage}
            close={() => {
              setForm(null);
              setEditEvent(undefined);
              setScheduleCompanyId(undefined);
              setEventFormPreset(undefined);
            }}
            save={saveEvent}
            remove={setDeleteEvent}
          />
        )}{" "}
        {form === "interview" && (
          <InterviewForm
            t={t}
            companies={data.companies}
            templates={data.templates}
            initial={editInterview}
            close={() => {
              setForm(null);
              setEditInterview(undefined);
            }}
            save={saveInterview}
          />
        )}{" "}
        {form === "preparation" && (
          <PreparationForm
            t={t}
            companies={data.companies}
            templates={data.templates}
            initial={editPrep}
            close={() => {
              setForm(null);
              setEditPrep(undefined);
            }}
            save={savePrep}
          />
        )}{" "}
        {confirm && (
          <Confirm
            t={t}
            company={confirm}
            close={() => setConfirm(undefined)}
            remove={deleteCompany}
          />
        )}{" "}
        {deleteEvent && (
          <DeleteEventConfirm
            t={t}
            close={() => setDeleteEvent(undefined)}
            remove={confirmRemoveEvent}
          />
        )}{" "}
        {toast && (
          <Toast t={t} toast={toast} close={() => setToast(undefined)} />
        )}
      </div>
      {isMobile && !hasOpenOverlay && createPortal(
        <MobileNav
          view={view}
          setView={setView}
          t={t}
        />,
        document.body,
      )}
    </div></WatchProvider>
  );
}

function Brand() {
  return <YamiLogoLockup variant="sidebar" className="brand" />;
}
function Nav({
  view,
  setView,
  t,
}: {
  view: View;
  setView: (v: View) => void;
  t: any;
}) {
  const { events } = useWatch();
  const unreadProductUpdates = useSyncExternalStore(subscribeProductUpdateReadState, getUnreadProductUpdateCount, () => 0);
  const unread = events.filter((event) => !event.read).length + unreadProductUpdates;
  const [activeSection, setActiveSection] = useState<View>(view);
  useEffect(() => setActiveSection(view), [view]);
  const a: [View, any, string][] = [
    ["dashboard", Home, "dashboard"],
    ["companies", Building2, "companies"],
    ["notifications", Bell, "notifications"],
    ["schedule", CalendarDays, "schedule"],
    ["materials", NotebookPen, "materials"],
  ];
  return (
    <div className="nav-list">
      {a.map(([v, I, k]) => (
        <button
          className={activeSection === v ? "active" : ""}
          onClick={() => {
            setActiveSection(v);
            requestAnimationFrame(() => {
              setView(v);
            });
          }}
          aria-current={view === v ? "page" : undefined}
          onPointerDown={(e) => { e.currentTarget.dataset.pressed = "true"; }}
          onPointerUp={(e) => { delete e.currentTarget.dataset.pressed; }}
          onPointerLeave={(e) => { delete e.currentTarget.dataset.pressed; }}
          key={v}
        >
          {activeSection === v ? <FilledSidebarIcon view={v} /> : <I aria-hidden="true" />}
          <span>{t[k]}{v === "notifications" && unread > 0 && <b className="nav-unread-badge">{Math.min(99, unread)}{unread > 99 ? "+" : ""}</b>}</span>
        </button>
      ))}
    </div>
  );
}

function FilledSidebarIcon({ view }: { view: View }) {
  let glyph: ReactNode;

  switch (view) {
    case "dashboard":
      glyph = <path fillRule="evenodd" d="M12 2.5 2 10.7l1.8 2.1 1.7-1.4V20h13v-8.6l1.7 1.4 1.8-2.1L12 2.5Zm-2 16v-5h4v5h-4Z" />;
      break;
    case "companies":
      glyph = <path fillRule="evenodd" d="M5 3h14a1 1 0 0 1 1 1v17H4V4a1 1 0 0 1 1-1Zm2.2 3.2v2h2v-2h-2Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Zm-8 4v2h2v-2h-2Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Zm-3.2 4.1V21h2v-6.7h-2Z" />;
      break;
    case "notifications":
      glyph = <>
        <path d="M12 2.5a2.1 2.1 0 0 0-2.1 2.1v.42a7.1 7.1 0 0 0-5.15 6.82v4.2L2.9 18.5h18.2l-1.85-2.45v-4.2a7.1 7.1 0 0 0-5.15-6.82V4.6A2.1 2.1 0 0 0 12 2.5Z" />
        <path d="M9.1 20a3 3 0 0 0 5.8 0H9.1Z" />
      </>;
      break;
    case "schedule":
      glyph = <>
        <path fillRule="evenodd" d="M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm2.2 7v2h2v-2h-2Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Zm-8 4v2h2v-2h-2Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Z" />
        <path d="M7 2h2v5H7zM15 2h2v5h-2z" />
      </>;
      break;
    case "materials":
      glyph = <>
        <path fillRule="evenodd" d="M6 3h13a2 2 0 0 1 2 2v16H6V3Zm3 4v1.6h8V7H9Zm0 4v1.6h8V11H9Zm0 4v1.6h5V15H9Z" />
        <path d="M4 5v2M4 10v2M4 15v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="m15.2 18.2 1.1-3.1 4.8-4.8 2 2-4.8 4.8-3.1 1.1Z" />
      </>;
      break;
  }

  return (
    <svg className="sidebar-nav-icon-filled" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
      {glyph}
    </svg>
  );
}

const StableNav = memo(Nav);
function MobileNav({
  view,
  setView,
  t,
}: {
  view: View;
  setView: (v: View) => void;
  t: any;
}) {
  const { events } = useWatch();
  const unreadProductUpdates = useSyncExternalStore(subscribeProductUpdateReadState, getUnreadProductUpdateCount, () => 0);
  const unread = events.filter((event) => !event.read).length + unreadProductUpdates;
  useLayoutEffect(() => {
    const nav = document.querySelector<HTMLElement>('[data-mobile-bottom-nav="true"]');
    if (!nav) return;

    const start = 0;
    const preferredEnd = 120;
    let frame = 0;

    const updateSurface = () => {
      frame = 0;
      const scrollRoot = document.scrollingElement;
      const scrollHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        scrollRoot?.scrollHeight || 0,
      );
      const maxScroll = Math.max(
        0,
        scrollHeight - window.innerHeight,
      );
      const effectiveEnd = Math.min(preferredEnd, maxScroll);
      const scrollY = Math.max(
        window.scrollY,
        document.documentElement.scrollTop,
        document.body.scrollTop,
        scrollRoot?.scrollTop || 0,
      );
      const progress = effectiveEnd > 0
        ? Math.min(1, Math.max(0, (scrollY - start) / effectiveEnd))
        : 0;
      const darkAlpha = 1 - progress * 0.78;
      const lightAlpha = 1 - progress * 0.58;

      nav.style.setProperty("--bottom-nav-scroll-progress", progress.toFixed(3));
      nav.style.setProperty(
        "--bottom-nav-dark-background",
        progress === 0 ? "rgb(0, 0, 0)" : `rgba(10, 10, 12, ${darkAlpha.toFixed(3)})`,
      );
      nav.style.setProperty(
        "--bottom-nav-light-background",
        progress === 0 ? "rgb(255, 255, 255)" : `rgba(255, 255, 255, ${lightAlpha.toFixed(3)})`,
      );
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateSurface);
    };

    updateSurface();
    const afterRouteLayout = window.requestAnimationFrame(updateSurface);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    resizeObserver?.observe(document.documentElement);
    resizeObserver?.observe(document.body);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      resizeObserver?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(afterRouteLayout);
    };
  }, [view]);

  return (
    <nav className="mobile-nav career-mobile-nav" data-testid="mobile-bottom-nav" data-mobile-bottom-nav="true" data-bottom-nav="true">
      <button
        className={view === "dashboard" ? "active" : ""}
        onClick={() => setView("dashboard")}
        aria-label={t.dashboard}
        aria-current={view === "dashboard" ? "page" : undefined}
        onPointerDown={(e) => { e.currentTarget.dataset.pressed = "true"; }}
        onPointerUp={(e) => { delete e.currentTarget.dataset.pressed; }}
        onPointerLeave={(e) => { delete e.currentTarget.dataset.pressed; }}
      >
        <Home />
        <span className="mobile-nav-label" aria-hidden="true">{t.dashboard}</span>
      </button>
      <button
        className={view === "companies" ? "active" : ""}
        onClick={() => setView("companies")}
        aria-label={t.companies}
        aria-current={view === "companies" ? "page" : undefined}
        onPointerDown={(e) => { e.currentTarget.dataset.pressed = "true"; }}
        onPointerUp={(e) => { delete e.currentTarget.dataset.pressed; }}
        onPointerLeave={(e) => { delete e.currentTarget.dataset.pressed; }}
      >
        <Building2 />
        <span className="mobile-nav-label" aria-hidden="true">{t.companies}</span>
      </button>
      <button
        className={view === "notifications" ? "active" : ""}
        onClick={() => setView("notifications")}
        aria-label={t.notifications}
        aria-current={view === "notifications" ? "page" : undefined}
        onPointerDown={(e) => { e.currentTarget.dataset.pressed = "true"; }}
        onPointerUp={(e) => { delete e.currentTarget.dataset.pressed; }}
        onPointerLeave={(e) => { delete e.currentTarget.dataset.pressed; }}
      >
        <span className="mobile-nav-bell"><Bell />{unread > 0 && <i>{unread > 99 ? "99+" : unread}</i>}</span>
        <span className="mobile-nav-label" aria-hidden="true">{t.notifications}</span>
      </button>
      <button
        className={view === "schedule" ? "active" : ""}
        onClick={() => setView("schedule")}
        aria-label={t.schedule}
        aria-current={view === "schedule" ? "page" : undefined}
        onPointerDown={(e) => { e.currentTarget.dataset.pressed = "true"; }}
        onPointerUp={(e) => { delete e.currentTarget.dataset.pressed; }}
        onPointerLeave={(e) => { delete e.currentTarget.dataset.pressed; }}
      >
        <CalendarDays />
        <span className="mobile-nav-label" aria-hidden="true">{t.schedule}</span>
      </button>
      <button
        className={view === "materials" ? "active" : ""}
        onClick={() => setView("materials")}
        aria-label={t.materials}
        aria-current={view === "materials" ? "page" : undefined}
        onPointerDown={(e) => { e.currentTarget.dataset.pressed = "true"; }}
        onPointerUp={(e) => { delete e.currentTarget.dataset.pressed; }}
        onPointerLeave={(e) => { delete e.currentTarget.dataset.pressed; }}
      >
        <NotebookPen />
        <span className="mobile-nav-label" aria-hidden="true">{t.materials}</span>
      </button>
    </nav>
  );
}
function Title({
  children,
  action,
  className = "",
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`section-title ${className}`}>
      <h2>{children}</h2>
      {action}
    </div>
  );
}
function PrimaryActionButton({
  children,
  onClick,
  onPointerDown,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <button type="button" className={`primary-action ${className}`} onClick={onClick} onPointerDown={onPointerDown}>
      {children}
    </button>
  );
}
function Empty({ t, kind = "general", open, onPointerDown, actionMenu }: { t: any; kind?: "company" | "schedule" | "materials" | "general"; open?: () => void; onPointerDown?: PointerEventHandler<HTMLButtonElement>; actionMenu?: ReactNode }) {
  const copy: Record<string, [string, string, string]> = t.language === "言語" ? { company: ["企業がまだ登録されていません", "応募先企業を追加して、選考状況や締切をまとめて管理できます。", t.addCompany], schedule: ["日程がまだありません", "説明会や面接の予定を登録すると、次の行動が見やすくなります。", t.addEvent], materials: ["資料・面接記録がまだありません", "ESや面接記録を登録して、就活の準備を整理しましょう。", t.addRecord], general: [t.noData, "ここから就活の記録を追加できます。", t.new] } : t.language === "Language" ? { company: ["No companies yet", "Add companies to keep applications, stages, and deadlines together.", t.addCompany], schedule: ["No schedule yet", "Add briefings and interviews to make your next action clear.", t.addEvent], materials: ["No materials or interview records yet", "Add ES, resumes, and interview notes to organize your search.", t.addRecord], general: [t.noData, "Start by adding your first career record.", t.new] } : { company: ["还没有企业", "添加应聘企业，集中管理选考进度和截止时间。", t.addCompany], schedule: ["还没有日程", "添加说明会或面试安排，让下一步更清晰。", t.addEvent], materials: ["还没有资料或面试记录", "添加 ES、履历书或面试记录，整理你的就活准备。", t.addRecord], general: [t.noData, "从这里开始添加你的就活记录。", t.new] };
  if (t.language === "言語") copy.schedule[1] = "説明会、筆記試験、面接などの予定を追加して、選考スケジュールを管理しましょう。";
  const [title, description, action] = copy[kind];
  return (
    <div className="empty-small">
      <BriefcaseBusiness aria-hidden="true" />
      <strong>{title}</strong>
      <p>{description}</p>
      {open && actionMenu ? <div className="record-action-wrap empty-action-wrap">
        <PrimaryActionButton onClick={open} onPointerDown={onPointerDown} className="empty-action"><Plus />{action}</PrimaryActionButton>
        {actionMenu}
      </div> : open && <PrimaryActionButton onClick={open} onPointerDown={onPointerDown} className="empty-action"><Plus />{action}</PrimaryActionButton>}
    </div>
  );
}
type RecordAction = {
  id: RecordActionId;
  label: string;
  icon: any;
  choose: () => void;
};

function RecordActionMenu({
  open,
  title,
  actions,
  cancelLabel,
  close,
  placement = "bottom-end",
}: {
  open: boolean;
  title: string;
  actions: RecordAction[];
  cancelLabel: string;
  close: () => void;
  placement?: "bottom-center" | "bottom-end";
}) {
  const isMobile = useMediaQuery("(max-width: 760px)");
  const menuRef = useRef<HTMLDivElement>(null);
  const actionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (!menuRef.current || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const current = document.activeElement;
      const index = actionRefs.current.findIndex((button) => button === current);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "ArrowDown"
        ? (index + 1) % actionRefs.current.length
        : (index - 1 + actionRefs.current.length) % actionRefs.current.length;
      actionRefs.current[next]?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const body = document.body;
    const previousOverflow = body.style.overflow;
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    if (isMobile) body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      if (isMobile) body.style.overflow = previousOverflow;
    };
  }, [close, isMobile, open]);
  if (isMobile && !open) return null;
  const content = (
    <div ref={menuRef} className={`record-action-menu record-action-menu--${placement}${isMobile ? " record-action-menu-mobile" : ""}`} data-open={open ? "true" : "false"} role="menu" aria-label={title} aria-hidden={!open}>
      {isMobile && <button type="button" className="record-action-backdrop" aria-label={cancelLabel} onClick={close} />}
      <section className="record-action-surface">
        {isMobile && <header className="record-action-header"><h2>{title}</h2><CloseButton className="record-action-close" onClick={close} label={cancelLabel} /></header>}
        <div className="record-action-items">
          {actions.map(({ id, label, icon: Icon, choose }, index) => <button type="button" role="menuitem" tabIndex={open ? 0 : -1} key={id} ref={(button) => { actionRefs.current[index] = button; }} onClick={choose}><Icon aria-hidden="true" /><span>{label}</span></button>)}
        </div>
        {isMobile && <button type="button" className="record-action-cancel" onClick={close}>{cancelLabel}</button>}
      </section>
    </div>
  );
  return isMobile ? createPortal(content, document.body) : content;
}

function CreateRecordPicker({
  open,
  t,
  close,
  choose,
}: {
  open: boolean;
  t: any;
  close: () => void;
  choose: (kind: CreateType) => void;
}) {
  return <RecordActionMenu
    open={open}
    title={t.addRecord}
    cancelLabel={t.cancel}
    close={close}
    placement="bottom-center"
    actions={[
      { id: "document", label: t.addMaterial, icon: FileJson, choose: () => choose("es") },
      { id: "interview", label: t.addInterview, icon: BriefcaseBusiness, choose: () => choose("interview") },
      { id: "preparation", label: t.addPrep, icon: Target, choose: () => choose("preparation") },
    ]}
  />;
}

function BackNavigation({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="back-navigation" onClick={onClick}>
    <ArrowLeft aria-hidden="true" />
    <span>{label}</span>
  </button>;
}
function Dashboard({
  t,
  data,
  active,
  due,
  waiting,
  upcoming,
  schedules,
  byId,
  open,
  navigate,
  openCompany,
  setView,
  setEditEvent,
  setForm,
}: any) {
  const initialMonth = new Date();
  const [displayedMonth, setDisplayedMonth] = useState({ year: initialMonth.getFullYear(), month: initialMonth.getMonth() });
  const [selectedMonthDay, setSelectedMonthDay] = useState<number | null>(null);
  const shiftMonth = (offset: number) => setDisplayedMonth((current) => {
    const next = new Date(current.year, current.month + offset, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  });
  const openFunnel = (stage: FunnelStage) => {
    localStorage.setItem("careerflow-company-stage-filter", stage);
    setView("companies");
  };
  const { homeSummaryVisibility, homeSummaryOrder, homeSectionVisibility, homeSectionOrder } = data.preferences.customize;
  const sectionVisible = (module: HomeSection) => homeSectionVisibility[module] !== false;
  const stages = [
    "funnelInterested",
    "funnelDocuments",
    "funnelAptitude",
    "funnelInterview",
    "funnelFinal",
    "funnelOffer",
  ] as FunnelStage[];
  const stageRows = stages.map((stage) => ({
    stage,
    count: data.companies.filter((company: Company) => funnelStageFor(company.stage) === stage).length,
  }));
  const StageRow = ({ stage, count }: { stage: FunnelStage; count: number }) => (
    <button type="button" className={`funnel-row${count > 0 ? " has-count" : ""}`} key={stage} onClick={() => openFunnel(stage)} aria-label={`${t[stage]}: ${count}`}>
      <span className="funnel-row-label">{t[stage]}</span>
      <span className="funnel-row-meta"><b className={count > 0 ? "has-count" : undefined}>{count}</b><ChevronRight aria-hidden="true" /></span>
    </button>
  );
  const progressModule = <section className="dashboard-section dashboard-progress-module">
    <Title>{t.funnel}</Title>
    <div className="funnel funnel-desktop">{stageRows.map(({ stage, count }) => <StageRow key={stage} stage={stage} count={count} />)}</div>
    <div className="funnel funnel-mobile">
      {stageRows.map(({ stage, count }) => <StageRow key={stage} stage={stage} count={count} />)}
    </div>
  </section>;
  const monthYear = displayedMonth.year;
  const monthIndex = displayedMonth.month;
  const monthPrefix = `${monthYear}-${String(monthIndex + 1).padStart(2, "0")}`;
  const daysInMonth = new Date(monthYear, monthIndex + 1, 0).getDate();
  const firstWeekday = new Date(monthYear, monthIndex, 1).getDay();
  const calendarLocale = t.language === "言語" ? "ja-JP" : t.language === "Language" ? "en-US" : "zh-CN";
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(calendarLocale, { weekday: "short" }).format(new Date(2021, 7, 1 + index)));
  const monthItems = schedules.filter((item: any) => item.at.slice(0, 7) === monthPrefix);
  const monthEventDays = new Map<number, typeof monthItems>();
  monthItems.forEach((item: any) => {
    const day = Number(item.at.slice(8, 10));
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) return;
    monthEventDays.set(day, [...(monthEventDays.get(day) || []), item]);
  });
  const monthLabel = new Intl.DateTimeFormat(calendarLocale, { month: "long", year: "numeric" }).format(new Date(monthYear, monthIndex, 1));
  const selectedMonthItems = selectedMonthDay ? monthEventDays.get(selectedMonthDay) || [] : [];
  const selectedMonthLabel = selectedMonthDay ? new Intl.DateTimeFormat(calendarLocale, { month: "long", day: "numeric" }).format(new Date(monthYear, monthIndex, selectedMonthDay)) : "";
  const deadlineToneFor = (at: string) => getDeadlineUrgency(at);
  const monthModule = <section className="dashboard-section home-month-module">
    <Title action={<div className="home-month-controls">
      <button type="button" onClick={() => shiftMonth(-1)} aria-label={t.previousMonth}><ChevronLeft aria-hidden="true" /></button>
      <span>{monthLabel}</span>
      <button type="button" onClick={() => shiftMonth(1)} aria-label={t.nextMonth}><ChevronRight aria-hidden="true" /></button>
    </div>}>{t.monthSchedule}</Title>
    <div className="home-month-calendar" aria-label={t.monthSchedule}>
      <div className="home-month-weekdays">{weekdayLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
      <div className="home-month-grid">
        {Array.from({ length: firstWeekday }, (_, index) => <span className="home-month-day is-empty" key={`empty-${index}`} aria-hidden="true" />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const eventsForDay = monthEventDays.get(day) || [];
          const hasEvents = eventsForDay.length > 0;
          const deadlineItem = eventsForDay.find((item: any) => item.isDeadline);
          const dotTone = deadlineItem ? deadlineToneFor(deadlineItem.at) : "event";
          const today = new Date();
          const isToday = today.getFullYear() === monthYear && today.getMonth() === monthIndex && today.getDate() === day;
          return <button type="button" className={`home-month-day${hasEvents ? " has-events" : ""}${isToday ? " is-today" : ""}${selectedMonthDay === day ? " is-selected" : ""}`} key={day} onClick={() => setSelectedMonthDay(day)} aria-label={`${monthYear}/${monthIndex + 1}/${day}${hasEvents ? ` ${eventsForDay.length}` : ""}`}><span>{day}</span>{hasEvents && <i className={`calendar-event-dot ${dotTone}`} />}</button>;
        })}
      </div>
    </div>
    {selectedMonthDay !== null && <div className="home-month-day-detail" aria-live="polite">
      <strong>{selectedMonthLabel}</strong>
      {selectedMonthItems.length ? <div>{selectedMonthItems.map((item: any) => <button type="button" key={item.id} onClick={() => item.kind === "event" ? (setEditEvent(item.event), setForm("schedule")) : setView("materials")}>
        <span className={`calendar-item-dot ${item.kind === "event" ? "event" : deadlineToneFor(item.at)}`} />
        <span><b>{item.title || item.company?.name || t.general}</b><small>{item.company?.name || t.general} · {whenForLocale(item.at, t)}</small></span>
      </button>)}</div> : <p>{t.language === "言語" ? "予定なし" : "暂无日程"}</p>}
    </div>}
    {!monthItems.length && selectedMonthDay === null && <p className="home-month-empty">{t.monthNoEvents}</p>}
    <button type="button" className="home-month-view-all text-button" onClick={() => setView("schedule")}>
      {t.viewAllSchedules}<ChevronRight aria-hidden="true" />
    </button>
  </section>;
  const featuredCandidates = data.companies.map((company: Company) => ({
    company,
    nextEvent: getUpcomingEvent(data.events, company.id),
    active: isActiveCompany(company),
  })).sort((a: any, b: any) => b.company.interestLevel - a.company.interestLevel
    || Number(Boolean(b.nextEvent)) - Number(Boolean(a.nextEvent))
    || Number(b.active) - Number(a.active)
    || b.company.updatedAt - a.company.updatedAt
    || a.company.name.localeCompare(b.company.name)).slice(0, 3);
  const featuredModule = featuredCandidates.length ? <section className="dashboard-section home-featured-module">
    <Title>{t.featuredCompanies}</Title>
    <div className="home-featured-list">
      {featuredCandidates.map(({ company, nextEvent }: any) => <button type="button" className="home-featured-row" key={company.id} onClick={() => openCompany(company.id)}>
        <StarRating value={company.interestLevel} className="home-featured-interest" />
        <span className="home-featured-copy"><strong>{company.name}</strong><small>{stageDisplayLabel(company.stage, t)}{nextEvent ? ` · ${whenForLocale(nextEvent.startsAt, t)}` : ""}</small></span>
        <ChevronRight aria-hidden="true" />
      </button>)}
    </div>
    {data.companies.length > 3 && <button type="button" className="text-button home-featured-more" onClick={() => setView("companies")}>{t.viewAllCompanies} <ChevronRight aria-hidden="true" /></button>}
  </section> : null;
  const deadlineKeys = new Set(due.map((item: any) => item.key));
  const visibleUpcoming = sectionVisible("upcoming") ? upcoming.filter((item: any) => !deadlineKeys.has(`event:${item.id}`)) : [];
  const visibleDeadlines = homeSummaryVisibility.deadlines ? due : [];
  const nextAndDeadlineModule = (visibleUpcoming.length || visibleDeadlines.length) ? <section className="dashboard-section dashboard-next-deadline-module">
    <Title>{t.deadlineNext}</Title>
    <div className="dashboard-next-deadline-list">
      {visibleDeadlines.slice(0, 2).map((item: any) => <button key={`deadline-${item.key}`} type="button" className={`dashboard-next-deadline-row ${deadlineToneFor(item.at)}`} onClick={() => item.kind === "event" ? (setEditEvent(item.event), setForm("schedule")) : setView("materials")}>
        <span><strong>{byId[item.companyId || ""]?.name || t.general}</strong><small>{item.kind === "event" ? scheduleDisplayTitle(item.title, item.type, t, item.event) : item.title || t[item.type] || t.general}</small></span><time>{whenForLocale(item.at, t)}</time>
      </button>)}
      {visibleUpcoming.slice(0, 3).map((item: any) => <button key={`event-${item.id}`} type="button" className="dashboard-next-deadline-row" onClick={() => { setEditEvent(item.event); setForm("schedule"); }}>
        <span><strong>{item.company?.name || t.general}</strong><small>{item.title || t.untitledSchedule}</small></span><time>{whenForLocale(item.at, t)}</time>
      </button>)}
    </div>
  </section> : null;
  const homeSections: Record<HomeSection, ReactNode> = { upcoming: null, progress: progressModule, month: monthModule, featured: featuredModule };
  const remainingHomeModules = homeSectionOrder.filter((module: HomeSection) => module !== "upcoming" && module !== "progress" && sectionVisible(module) && homeSections[module] !== null);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="dashboard-date">
            {new Intl.DateTimeFormat(undefined, {
              month: "long",
              day: "numeric",
              weekday: "long",
            }).format(new Date())}
          </h1>
        </div>
        <div className="dashboard-head-actions">
          <PrimaryActionButton className="dashboard-company-action" onClick={() => open("company")}>
            <Plus />
            {t.addCompany}
          </PrimaryActionButton>
        </div>
        </div>
        <div className="main-dashboard-layout">
          <div className="dashboard-main">
            <div className="overview-grid">
                {homeSummaryOrder.filter((module: HomeSummaryModule) => homeSummaryVisibility[module]).map((module: HomeSummaryModule) => module === "active"
                  ? <Metric key={module} n={active.length} l={t.inProgress} i={BriefcaseBusiness} onClick={() => navigate("companies", "active")} />
                  : module === "deadlines"
                    ? <Metric key={module} n={due.length} l={t.dueWeek} i={Clock3} tone={due.length ? getHighestDeadlineUrgency(due) : undefined} iconTone="neutral" onClick={() => navigate("schedule", "this-week-deadline")} />
                    : <Metric key={module} n={waiting.length} l={t.waiting} i={Timer} onClick={() => navigate("companies", "waiting-result")} />)}
            </div>
            {(sectionVisible("progress") || nextAndDeadlineModule) && <div className={`dashboard-local-grid${nextAndDeadlineModule ? " has-supporting" : ""}`}>
              {sectionVisible("progress") && progressModule}
              {nextAndDeadlineModule}
            </div>}
            {remainingHomeModules.length > 0 && <div className="dashboard-full-width-sections">
              <div className="dashboard-customizable-modules">
                {remainingHomeModules.map((module: HomeSection) => <div key={module}>{homeSections[module]}</div>)}
              </div>
            </div>}
          </div>
        {homeSummaryVisibility.waiting && waiting.length > 0 && <aside className="dashboard-sidebar">
          <section className="entity-card">
            <Title>{t.results}</Title>
            {waiting.length ? (
              waiting.map((x: any) => (
                <div className="wait-row" key={x.id}>
                  <div>
                    <strong>{x.name}</strong>
                    <span>{t[x.stage]}</span>
                  </div>
                  <b>
                    {Math.max(
                      1,
                      Math.floor((Date.now() - x.updatedAt) / 864e5),
                    )}{" "}
                    <small>{t.days}</small>
                  </b>
                </div>
              ))
            ) : (
              <Empty t={t} />
            )}
          </section>
        </aside>}
      </div>
    </>
  );
}
function Metric({ n, l, i: I, onClick, tone, iconTone }: { n: number; l: string; i: any; onClick: () => void; tone?: string; iconTone?: "neutral" }) {
  return (
    <button type="button" className={`metric metric-link entity-card${tone ? ` is-${tone}` : ""}${iconTone ? ` icon-${iconTone}` : ""}`} onClick={onClick} aria-label={`${l}: ${n}`}>
      <I className="metric-icon" aria-hidden="true" />
      <div>
        <strong className="kpi-number">{n}</strong>
        <span>{l}</span>
      </div>
      <ChevronRight className="metric-chevron" aria-hidden="true" />
    </button>
  );
}
function MaterialRow({
  x,
  company,
  t,
  toggle,
  focus,
}: {
  x: Material | Preparation;
  company?: Company;
  t: any;
  toggle: (x: string) => void;
  focus: (x: string) => void;
}) {
  const d = x.dueAt ? new Date(x.dueAt) : undefined,
    diff = d ? d.getTime() - Date.now() : Infinity;
  const isMaterial = "isWeeklyFocus" in x;
  return (
    <article
      className={`task-row-card entity-card ${diff < 0 ? "overdue" : diff < 864e5 ? "urgent" : ""}`}
    >
      <button
        className={`task-check ${x.completed ? "done" : ""}`}
        onClick={() => toggle(x.id)}
      >
        <Check />
      </button>
      <div>
        <h3>{x.title}</h3>
        <p>
          {company?.name || t.general} · {t[x.type]}
        </p>
      </div>
      <div className="task-due">
        <span>{d ? when(x.dueAt!) : "—"}</span>
        {diff < 0 && <b>{t.overdue}</b>}
        {diff >= 0 && diff < 864e5 && <b>{t.urgent}</b>}
      </div>
      {isMaterial && (
        <button
          className={`focus-star ${x.isWeeklyFocus ? "active" : ""}`}
          onClick={() => focus(x.id)}
        >
          <Target />
        </button>
      )}
    </article>
  );
}
function when(s: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(s));
}
function whenForLocale(s: string, t: any) {
  return new Intl.DateTimeFormat(t.language === "言語" ? "ja-JP" : "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parseTokyoCalendarDate(s));
}
function daysUntilLabel(s: string, t: any) {
  const days = Math.ceil((new Date(s).getTime() - Date.now()) / 864e5);
  if (days <= 0) return t.today;
  if (days === 1) return t.tomorrow;
  return t.daysAfter(days);
}
function companyJobCategory(company: Company) {
  return company.jobCategory || company.position || "";
}
function StarRating({ value, className = "" }: { value: number; className?: string }) {
  const rating = Math.max(0, Math.min(5, value));
  return <span className={`star-rating ${className}`} aria-label={`${rating} / 5`}>
    {Array.from({ length: 5 }, (_, index) => <Star key={index} className={index < rating ? "is-filled" : ""} aria-hidden="true" />)}
  </span>;
}
function formatCompanyMetadata(company: Company) {
  return [company.industry, companyJobCategory(company)].filter((value) => Boolean(value && value.trim()));
}
function recruitmentLabel(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "公式採用サイト"; }
}
function companyFutureEvents(events: Event[], companyId: string | undefined) {
  if (!companyId) return [];
  return events
    .filter((event) => event.companyId === companyId && !(event as Event & { deletedAt?: boolean }).deletedAt && Number.isFinite(new Date(event.startsAt).getTime()) && new Date(event.startsAt).getTime() >= Date.now())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
function companyHistoryEvents(events: Event[], companyId: string | undefined) {
  if (!companyId) return [];
  return events
    .filter((event) => event.companyId === companyId && !(event as Event & { deletedAt?: boolean }).deletedAt && Number.isFinite(new Date(event.startsAt).getTime()) && new Date(event.startsAt).getTime() < Date.now())
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
}
function relative(s: string, t: any) {
  const h = Math.ceil((new Date(s).getTime() - Date.now()) / 36e5);
  return h < 1 ? "Now" : h < 24 ? `${h}h` : `${Math.ceil(h / 24)} ${t.days}`;
}
function WeatherLine({ location, prefecture, municipality, date, latitude, longitude, locale = "zh" }: { location?: string; prefecture?: string; municipality?: string; date?: string; latitude?: number; longitude?: number; locale?: "zh" | "ja" }) {
  const [weather, setWeather] = useState<WeatherResult>();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "out_of_range" | "unavailable" | "error">("idle");
  useEffect(() => {
    const place = prefecture && municipality ? `${municipality}, ${prefecture}, Japan` : location?.trim() || localStorage.getItem("careerflow-home-region")?.trim();
    setWeather(undefined);
    if (!place || !date || /オンライン|online|webテスト|web test|オンライン面接/i.test(place)) { setStatus("unavailable"); return; }
    const target = new Date(`${date.slice(0, 10)}T00:00:00+09:00`).getTime();
    if (target < Date.now() - 86400000 || target > Date.now() + 7 * 86400000) { setStatus("out_of_range"); return; }
    setStatus("loading");
    const scheduleHour = `${date.slice(0, 13)}:00`;
    if (import.meta.env.DEV) console.info("[weather] schedule time", { raw: date, timezone: "Asia/Tokyo", selectedHour: scheduleHour, latitude, longitude });
    let cancelled = false;
    (async () => {
      const coordinates = latitude && longitude ? [latitude, longitude] as [number, number] : await geocodeCoordinates(place);
      if (cancelled) return;
      const value = coordinates ? await getWeatherByCoordinates(coordinates[0], coordinates[1], scheduleHour) : await getWeather(place, scheduleHour);
      if (!cancelled) { setWeather(value); setStatus(value ? "success" : "unavailable"); }
    })().catch((error) => { if (import.meta.env.DEV) console.warn("[weather] request failed", error); if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [location, prefecture, municipality, date, latitude, longitude]);
  const place = prefecture && municipality ? `${municipality}, ${prefecture}, Japan` : location?.trim() || localStorage.getItem("careerflow-home-region")?.trim();
  if (!place || !date || /オンライン|online|webテスト|web test|オンライン面接/i.test(place)) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00+09:00`).getTime();
  if (target < Date.now() - 86400000 || target > Date.now() + 7 * 86400000 || status !== "success" || !weather) return null;
  const Icon = weather.code >= 71 && weather.code <= 86 ? CloudSnow : weather.code >= 51 || weather.code >= 80 ? CloudRain : weather.code >= 1 ? CloudSun : Cloud;
  const description = weather.code === 0 ? (locale === "ja" ? "晴れ" : "晴") : weather.code <= 3 ? (locale === "ja" ? "曇り" : "多云") : weather.code >= 51 ? (locale === "ja" ? "雨の可能性" : "有降雨可能") : (locale === "ja" ? "天気の変化" : "天气变化");
  return <span className="weather-line"><Icon aria-hidden="true" />{weather.forecastTime.slice(11, 13)}{locale === "ja" ? "時ごろ" : "时左右"} · {description}</span>;
}
function eventModeText(event: Event | undefined, t: any) {
  if (event?.eventMode === "offline") return `${t.offline}${formatScheduleLocation(event) ? ` · ${formatScheduleLocation(event)}` : ""}`;
  if (event?.eventMode === "online") return `${t.online}${event.onlinePlatform ? ` · ${event.onlinePlatform}` : ""}`;
  return t.undecided;
}
function formatScheduleLocation(event: Event | undefined) {
  if (!event) return "";
  if (event.prefecture || event.municipality || event.city) {
    const base = `${event.prefecture || ""}${event.municipality || event.city || ""}`;
    return event.detailLocation ? `${base}・${event.detailLocation}` : base;
  }
  return event.locationLabel || event.location || "";
}
function getEventModeLabel(event: Event | undefined, locale: "zh" | "ja") {
  return event?.eventMode === "offline" ? (locale === "ja" ? "対面" : "线下") : event?.eventMode === "online" ? (locale === "ja" ? "オンライン" : "线上") : (locale === "ja" ? "未定" : "未确定");
}
function scheduleDisplayTitle(title: string | undefined, type: string | undefined, t: any, event?: Event) {
  if (type === "interview") {
    const interviewStage = event?.interviewStage || (interviewStageOptions.includes(event?.stage as typeof interviewStageOptions[number]) ? event?.stage : undefined);
    if (interviewStage === "other") return event?.interviewStageDetail?.trim() || t.interview;
    if (interviewStage) return t[interviewStage] || t.interview;
  }
  if (type === "general") return title?.trim() || t.general;
  return (type && t[type]) || t.untitledSchedule;
}
function stageDisplayLabel(stage: string | undefined, t: any) {
  const value = String(stage || "").trim().toLowerCase();
  if (value === "favorite" || value === "收藏" || value === "saved") return t.saved;
  return t[stage as keyof typeof t] || t.saved;
}
function Companies({
  t,
  data,
  byId,
  selected,
  open,
  setEditCompany,
  setEditEvent,
  setScheduleCompanyId,
  setForm,
  openRecordEvent,
  setConfirm,
  companyFilter,
  clearCompanyFilter,
  filterSheetOpen,
  setFilterSheetOpen,
  recordMenuOpen,
  setRecordMenuOpen,
  onBack,
  onOpenCompany,
  openWatchSettings,
  watchHighlightEventId,
}: any) {
  const co = selected ? byId[selected] : undefined;
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState(() => localStorage.getItem("careerflow-company-stage-filter") || "all");
  const initialSort = localStorage.getItem("careerflow-company-sort");
  const persistedSort = ["updated", "event", "interest", "name"].includes(initialSort || "") ? initialSort as CompanySort : data.preferences?.customize?.companySort || "updated";
  const [sortBy, setSortBy] = useState<CompanySort>(persistedSort);
  const [draftStageFilter, setDraftStageFilter] = useState("all");
  const [draftSortBy, setDraftSortBy] = useState<CompanySort>(persistedSort);
  useEffect(() => {
    if (!filterSheetOpen) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [filterSheetOpen]);
  useEffect(() => { localStorage.setItem("careerflow-company-stage-filter", stageFilter); }, [stageFilter]);
  useEffect(() => { localStorage.setItem("careerflow-company-sort", sortBy); }, [sortBy]);
  useEffect(() => {
    const defaultSort = data.preferences?.customize?.companySort || "updated";
    setSortBy(defaultSort);
    setDraftSortBy(defaultSort);
  }, [data.preferences?.customize?.companySort]);
  if (co) {
    const materials = data.materials.filter((x: any) => x.companyId === co.id),
      interviews = data.interviews.filter((x: any) => x.companyId === co.id),
      preps = data.preparations.filter((x: any) => x.companyId === co.id),
      futureEvents = companyFutureEvents(data.events, co.id),
      historyEvents = companyHistoryEvents(data.events, co.id),
      nextEvent = futureEvents[0],
      metadata = formatCompanyMetadata(co);
    return (
      <>
        <div className="page-head company-detail-page-head">
          <div>
            <BackNavigation label={t.companies} onClick={onBack} />
            <h1>{co.name}</h1>
            <p className="company-detail-metadata">{metadata.length ? <>{metadata.join(" · ")}<span aria-hidden="true"> · </span><StarRating value={co.interestLevel} /></> : <StarRating value={co.interestLevel} />}</p>
          </div>
          <div className="head-actions">
            <button
              onClick={() => {
                setEditCompany({ ...co });
                open("company");
              }}
            >
              {t.edit}
            </button>
            <button className="danger-button" onClick={() => setConfirm(co)}>
              {t.remove}
            </button>
          </div>
        </div>
        <div className="course-detail">
          <section className="course-profile detail-section">
            <i style={{ background: co.color }} />
            <h2>{t.language === "言語" ? "概要" : "概览"}</h2>
            <dl className="company-detail-list">
              <div>
                <dt>{t.currentStage}</dt>
                <dd>{stageDisplayLabel(co.stage, t)}</dd>
              </div>
              {nextEvent && <div>
                <dt>{t.nextSchedule}</dt>
                <dd className="company-next-summary">
                  <strong>{whenForLocale(nextEvent.startsAt, t)}</strong>
                  <span>{nextEvent.type === "general" ? (nextEvent.title || t.general) : t[nextEvent.type] || nextEvent.title || t.general}</span>
                  <span>{daysUntilLabel(nextEvent.startsAt, t)}</span>
                </dd>
              </div>}
              <div>
                <dt>{t.interest}</dt>
                <dd><StarRating value={co.interestLevel} /></dd>
              </div>
            </dl>
            <dl className="company-detail-list company-info-list">
              {co.industry && <div><dt>{t.industry}</dt><dd>{co.industry}</dd></div>}
              {companyJobCategory(co) && <div><dt>{t.position}</dt><dd>{companyJobCategory(co)}</dd></div>}
              {co.jobTitle && <div><dt>{t.jobTitle}</dt><dd>{co.jobTitle}</dd></div>}
              {co.careersUrl && <div><dt>{t.recruitmentPage}</dt><dd><a className="recruitment-link" href={co.careersUrl} target="_blank" rel="noopener noreferrer" title={co.careersUrl}>{recruitmentLabel(co.careersUrl)} <ExternalLink aria-hidden="true" /></a></dd></div>}
              {co.notes && <div><dt>{t.notes}</dt><dd>{co.notes}</dd></div>}
              {!co.industry && !companyJobCategory(co) && !co.jobTitle && !co.careersUrl && !co.notes && <div><dd className="company-detail-muted">{t.notSet}</dd></div>}
            </dl>
          </section>
          <section className="detail-stack">
            <CompanyWatchSection company={co} locale={t.language === "言語" ? "ja" : "zh"} openSettings={openWatchSettings} highlightEventId={watchHighlightEventId} />
            <Title action={<div className="record-action-wrap">
              <button type="button" className="primary" onPointerDown={(event) => event.stopPropagation()} onClick={() => setRecordMenuOpen(!recordMenuOpen)}><Plus />{t.addRecord}</button>
              <RecordActionMenu
                open={recordMenuOpen}
                title={t.addRecord}
                cancelLabel={t.cancel}
                close={() => setRecordMenuOpen(false)}
                actions={[
                  { id: "document", label: t.addMaterial, icon: FileJson, choose: () => { setRecordMenuOpen(false); open("es"); } },
                  { id: "interview", label: t.addInterview, icon: BriefcaseBusiness, choose: () => { setRecordMenuOpen(false); open("interview"); } },
                  { id: "aptitude", label: t.addTest, icon: ClipboardCheck, choose: () => { setRecordMenuOpen(false); openRecordEvent({ type: "web_test", stage: "web_test" }, co.id); } },
                  { id: "briefing", label: t.addBriefing, icon: CalendarClock, choose: () => { setRecordMenuOpen(false); openRecordEvent({ type: "briefing", stage: "briefing" }, co.id); } },
                  { id: "other", label: t.addOtherRecord, icon: FileText, choose: () => { setRecordMenuOpen(false); openRecordEvent({ type: "general", stage: "saved" }, co.id); } },
                ]}
              />
            </div>}>
              {t.selectionRecords}
            </Title>
            <div className="deadline-list">
              {historyEvents.map((event) => <EventHistoryRow key={event.id} event={event} t={t} />)}
              {materials.map((x: any) => (
                <MaterialRow
                  key={x.id}
                  x={x}
                  company={co}
                  t={t}
                  toggle={() => {}}
                  focus={() => {}}
                />
              ))}
              {interviews.map((x: any) => (
                <InterviewRow key={x.id} x={x} company={co} t={t} />
              ))}
              {preps.map((x: any) => (
                <MaterialRow
                  key={x.id}
                  x={x}
                  company={co}
                  t={t}
                  toggle={() => {}}
                  focus={() => {}}
                />
              ))}
              {!historyEvents.length && !materials.length && !interviews.length && !preps.length && <div className="selection-empty">
                <BriefcaseBusiness aria-hidden="true" />
                <strong>{t.noSelectionRecords}</strong>
                <p>{t.selectionRecordsHint}</p>
              </div>}
            </div>
          </section>
        </div>
      </>
    );
  }
  const filteredCompanies = data.companies
    .filter((x: Company) => !query.trim() || x.name.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((x: Company) => companyFilter === "active" ? isActiveCompany(x) : companyFilter === "waiting-result" ? isWaitingResultCompany(x, data.events) : true)
    .filter((x: Company) => stageFilter === "all" || (stageFilter.startsWith("funnel") ? funnelStageFor(x.stage) === stageFilter : x.stage === stageFilter))
    .sort((a: Company, b: Company) => {
      if (sortBy === "interest") return b.interestLevel - a.interestLevel;
      if (sortBy === "event") return (getUpcomingEvent(data.events, a.id)?.startsAt || "9999").localeCompare(getUpcomingEvent(data.events, b.id)?.startsAt || "9999");
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return b.updatedAt - a.updatedAt;
    });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.companies}</h1>
          <p>{t.subtitle}</p>
        </div>
        {data.companies.length > 0 && <PrimaryActionButton onClick={() => open("company")}>
          <Plus />
          {t.addCompany}
        </PrimaryActionButton>}
      </div>
      {companyFilter && <div className="route-filter-bar" role="status">
        <span>{companyFilter === "active" ? t.inProgress : t.waiting}</span>
        <button type="button" onClick={clearCompanyFilter} aria-label={t.cancel}>×</button>
      </div>}
      {data.companies.length > 0 && <div className="company-toolbar">
        <div className="company-search-field"><Search aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.language === "言語" ? "企業を検索" : t.language === "Language" ? "Search companies" : "搜索企业"} aria-label={t.language === "言語" ? "企業を検索" : t.language === "Language" ? "Search companies" : "搜索企业"} /></div>
        <button type="button" className={`company-filter-trigger${stageFilter !== "all" || sortBy !== "updated" ? " has-filter" : ""}`} aria-label={t.language === "言語" ? "絞り込みと並び替え" : "筛选与排序"} onClick={() => { setDraftStageFilter(stageFilter); setDraftSortBy(sortBy); setFilterSheetOpen(true); }}><SlidersHorizontal /></button>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label={t.stage}>
          <option value="all">{t.all}</option>
          {funnelStages.map((stage) => <option key={stage} value={stage}>{t[stage]}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as CompanySort)} aria-label={t.language === "言語" ? "並び替え" : t.language === "Language" ? "Sort" : "排序"}>
          <option value="updated">{t.language === "言語" ? "最近更新" : t.language === "Language" ? "Recently updated" : "最近更新"}</option>
          <option value="interest">{t.interest}</option>
          <option value="event">{t.event}</option>
          <option value="name">{t.language === "言語" ? "企業名" : t.language === "Language" ? "Company name" : "企业名称"}</option>
        </select>
      </div>}
      {filterSheetOpen && <div className="company-filter-sheet-layer">
        <button type="button" className="company-filter-sheet-backdrop" aria-label={t.cancel} onClick={() => setFilterSheetOpen(false)} />
        <section className="company-filter-sheet" role="dialog" aria-modal="true" aria-label={t.language === "言語" ? "絞り込みと並び替え" : "筛选与排序"}>
          <header className="company-filter-sheet-header"><h2>{t.language === "言語" ? "絞り込みと並び替え" : "筛选与排序"}</h2><CloseButton className="company-filter-sheet-close" onClick={() => setFilterSheetOpen(false)} label={t.cancel} /></header>
          <div className="company-filter-sheet-content"><fieldset><legend>{t.stage}</legend><div className="company-filter-options">
            {["all", ...funnelStages].map((stage) => <label key={stage} className={draftStageFilter === stage ? "selected" : ""}><input type="radio" name="company-stage" checked={draftStageFilter === stage} onChange={() => setDraftStageFilter(stage)} /><span>{stage === "all" ? t.all : t[stage]}</span><Check /></label>)}
          </div></fieldset><fieldset><legend>{t.language === "言語" ? "並び替え" : "排序方式"}</legend><div className="company-filter-options">
            {(["updated", "event", "interest", "name"] as CompanySort[]).map((sort) => <label key={sort} className={draftSortBy === sort ? "selected" : ""}><input type="radio" name="company-sort" checked={draftSortBy === sort} onChange={() => setDraftSortBy(sort)} /><span>{sort === "updated" ? (t.language === "言語" ? "最近更新" : "最近更新") : sort === "event" ? t.event : sort === "interest" ? (t.language === "言語" ? "志望度の高い順" : "志望度从高到低") : (t.language === "言語" ? "企業名" : "企业名称")}</span><Check /></label>)}
          </div></fieldset></div><footer className="company-filter-sheet-actions"><button type="button" onClick={() => { setDraftStageFilter("all"); setDraftSortBy("updated"); }}>{t.language === "言語" ? "リセット" : "重置"}</button><button type="button" className="primary" onClick={() => { setStageFilter(draftStageFilter); setSortBy(draftSortBy); setFilterSheetOpen(false); }}>{t.language === "言語" ? "適用" : "应用"}</button></footer>
        </section>
      </div>}
      <div className="company-grid">
        {filteredCompanies.length ? (
          filteredCompanies.map((x: Company) => {
            const nextEvent = getUpcomingEvent(data.events, x.id);
            return <button
              className="company-card entity-card"
              onClick={() => onOpenCompany(x.id)}
              key={x.id}
            >
              <i style={{ background: x.color }} />
              <div className="company-card-body">
                <h3 title={x.name}>{x.name}</h3>
                {(data.preferences.customize.companyCard.industry || data.preferences.customize.companyCard.position) && <p>{[data.preferences.customize.companyCard.industry ? x.industry : "", data.preferences.customize.companyCard.position ? companyJobCategory(x) : ""].filter(Boolean).join(" / ") || t.notSet}</p>}
                {(data.preferences.customize.companyCard.stage || data.preferences.customize.companyCard.interest) && <span className="company-card-stage">{data.preferences.customize.companyCard.stage ? stageDisplayLabel(x.stage, t) : ""}{data.preferences.customize.companyCard.stage && data.preferences.customize.companyCard.interest ? <span aria-hidden="true"> · </span> : null}{data.preferences.customize.companyCard.interest ? <StarRating value={x.interestLevel} /> : null}</span>}
                {data.preferences.customize.companyCard.nextEvent && <span>{nextEvent ? `${t.nextSchedule} · ${whenForLocale(nextEvent.startsAt, t)} · ${daysUntilLabel(nextEvent.startsAt, t)}` : t.noSchedule}</span>}
                <CompanyWatchStatus companyId={x.id} companyName={x.name} locale={t.language === "言語" ? "ja" : "zh"} />
              </div>
              <ChevronRight />
            </button>;
          })
        ) : (
          <Empty t={t} kind="company" open={() => open("company")} />
        )}
      </div>
    </>
  );
}
function Schedule({
  t,
  schedules,
  scheduleFilter,
  clearScheduleFilter,
  setEditEvent,
  setForm,
  removeEvent,
  removeMaterial,
  removePrep,
  setEditPrep,
  onExportCalendar,
}: any) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.schedule}</h1>
          <p>{t.scheduleSub}</p>
        </div>
        {schedules.length > 0 && <PrimaryActionButton onClick={() => setForm("schedule")}>
          <Plus />
          {t.addEvent}
        </PrimaryActionButton>}
      </div>
      {scheduleFilter && <div className="route-filter-bar" role="status">
        <span>{t.dueWeek}</span>
        <button type="button" onClick={clearScheduleFilter} aria-label={t.cancel}>×</button>
      </div>}
      <div className="timeline">
        {schedules.length ? (
          schedules.map((x: any) => (
            <Swipe
              key={x.kind + x.id}
              remove={() =>
                x.kind === "event"
                  ? removeEvent(x.event)
                  : x.kind === "preparation"
                    ? removePrep(x.preparation)
                    : removeMaterial(x.material)
              }
            >
              <div className="timeline-entry">
                <button
                  className="timeline-row entity-card"
                  onClick={() => {
                    if (x.kind === "event") {
                      setEditEvent(x.event);
                      setForm("schedule");
                    }
                    if (x.kind === "preparation") {
                      setEditPrep(x.preparation);
                      setForm("preparation");
                    }
                  }}
                >
                  <time>{when(x.at)}</time>
                  <i style={{ background: x.company?.color || "#d18135" }} />
                  <div>
                    <strong>{scheduleDisplayTitle(x.title, x.type, t, x.event)}</strong>
                    <span>
                      {x.company?.name || t.general} · {t[x.type]}
                    </span>
                    {x.kind === "event" && <><span>{eventModeText(x.event, t)}</span><WeatherLine location={x.event.eventMode === "offline" ? formatScheduleLocation(x.event) : undefined} prefecture={x.event.prefecture} municipality={x.event.municipality || x.event.city} latitude={x.event.latitude} longitude={x.event.longitude} date={x.at} locale={t.language === "言語" ? "ja" : "zh"} />{x.event.meetingUrl && <a className="meeting-link" href={x.event.meetingUrl} target="_blank" rel="noopener noreferrer">{t.language === "言語" ? "会議リンクを開く" : "打开会议链接"}</a>}</>}
                  </div>
                  <ChevronRight />
                </button>
                {x.kind === "event" && <button type="button" className="calendar-add-inline" onClick={(event) => { event.stopPropagation(); onExportCalendar(x.event); }}><CalendarDays aria-hidden="true" />{t.calendarAdd}</button>}
              </div>
            </Swipe>
          ))
        ) : (
          <Empty t={t} kind="schedule" open={() => setForm("schedule")} />
        )}
      </div>
    </>
  );
}
function Materials({
  t,
  data,
  byId,
  filter,
  setFilter,
  toggle,
  focusToggle,
  open,
  removeMaterial,
  removeInterview,
  removePrep,
  setEditInterview,
  setEditPrep,
  recordPickerOpen,
  setRecordPickerOpen,
}: any) {
  const matchesStatus = (completed: boolean) => filter !== "incomplete" && filter !== "completed" || filter === "completed" === completed;
  const materials = data.materials.filter((x: Material) => (filter === "all" || filter === "material" || filter === "incomplete" || filter === "completed") && (filter !== "material" || x.category === "material") && matchesStatus(!!x.completed));
  const interviews = data.interviews.filter((x: InterviewRecord) => (filter === "all" || filter === "interview" || filter === "incomplete" || filter === "completed") && (filter !== "interview" || x.category === "interview") && matchesStatus(!!x.result));
  const preps = data.preparations.filter((x: Preparation) => (filter === "all" || filter === "preparation" || filter === "incomplete" || filter === "completed") && (filter !== "preparation" || x.category === "preparation") && matchesStatus(x.completed));
  const toggleCreateRecordPicker = () => setRecordPickerOpen((current: boolean) => !current);
  const chooseCreateRecord = (kind: CreateType) => {
    setRecordPickerOpen(false);
    open(kind);
  };
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.materials}</h1>
          <p>{t.materialsSub}</p>
        </div>
        {(materials.length > 0 || interviews.length > 0 || preps.length > 0) && <div className="record-action-wrap">
          <PrimaryActionButton onClick={toggleCreateRecordPicker} onPointerDown={(event) => event.stopPropagation()}><Plus />{t.addRecord}</PrimaryActionButton>
          <CreateRecordPicker open={recordPickerOpen} t={t} close={() => setRecordPickerOpen(false)} choose={chooseCreateRecord} />
        </div>}
      </div>
      <div className="filter-bar entity-card">
        {[
          "all",
          "incomplete",
          "completed",
          "material",
          "interview",
          "preparation",
        ].map((x) => (
          <button
            className={filter === x ? "active" : ""}
            onClick={() => setFilter(x)}
            key={x}
          >
            {x === "material" ? t.materialCategory : x === "interview" ? t.interviewCategory : x === "preparation" ? t.preparationCategory : t[x]}
          </button>
        ))}
      </div>
      <div className="deadline-list">
        {materials.map((x: any) => (
          <Swipe key={x.id} remove={() => removeMaterial(x)}>
            <MaterialRow
              x={x}
              company={byId[x.companyId]}
              t={t}
              toggle={toggle}
              focus={focusToggle}
            />
          </Swipe>
        ))}
        {interviews.map((x: any) => (
          <Swipe key={x.id} remove={() => removeInterview(x)}>
            <button
              className="plain-row"
              onClick={() => {
                setEditInterview(x);
                open("interview");
              }}
            >
              <InterviewRow x={x} company={byId[x.companyId]} t={t} />
            </button>
          </Swipe>
        ))}
        {preps.map((x: any) => (
          <Swipe key={x.id} remove={() => removePrep(x)}>
            <button
              className="plain-row"
              onClick={() => {
                setEditPrep(x);
                open("preparation");
              }}
            >
              <MaterialRow
                x={x}
                company={byId[x.companyId]}
                t={t}
                toggle={toggle}
                focus={() => {}}
              />
            </button>
          </Swipe>
        ))}
        {!materials.length && !interviews.length && !preps.length && <>
          <Empty
            t={t}
            kind="materials"
            open={toggleCreateRecordPicker}
            onPointerDown={(event) => event.stopPropagation()}
            actionMenu={<CreateRecordPicker open={recordPickerOpen} t={t} close={() => setRecordPickerOpen(false)} choose={chooseCreateRecord} />}
          />
        </>}
      </div>
    </>
  );
}
function Swipe({
  children,
  remove,
}: {
  children: ReactNode;
  remove: () => void;
}) {
  const start = useRef(0);
  return (
    <div
      className="swipe-row"
      onTouchStart={(e) => (start.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (start.current - e.changedTouches[0].clientX > 70) remove();
      }}
    >
      {children}
    </div>
  );
}
function EventHistoryRow({ event, t }: { event: Event; t: any }) {
  const label = event.type === "general" ? (event.title || t.general) : t[event.type] || event.title || t.general;
  return (
    <article className="task-row-card entity-card company-history-event">
      <CalendarClock aria-hidden="true" />
      <div>
        <h3>{label}</h3>
        <p>{whenForLocale(event.startsAt, t)} · {eventModeText(event, t)}</p>
      </div>
    </article>
  );
}
function InterviewRow({
  x,
  company,
  t,
}: {
  x: InterviewRecord;
  company?: Company;
  t: any;
}) {
  return (
    <article className="task-row-card entity-card interview-card">
      <BriefcaseBusiness />
      <div>
        <h3>{x.round || t.interview}</h3>
        <p>
          {company?.name || t.general} · {x.format || t.online}
        </p>
      </div>
      <div className="task-due">
        <span>{x.interviewAt ? when(x.interviewAt) : "—"}</span>
        {x.result && <b>{x.result}</b>}
      </div>
    </article>
  );
}
function Modal({
  title,
  close,
  children,
  className = "",
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, []);
  return (
    <div className={`modal-layer ${className}`.trim()}>
      <button className="modal-backdrop" onClick={close} />
      <section className="drawer entity-card" role="dialog">
        <header>
          <h2>{title}</h2>
          <CloseButton onClick={close} />
        </header>
        {children}
      </section>
    </div>
  );
}

function CloseButton({
  onClick,
  label = "Close",
  className = "",
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button type="button" className={`close-button ${className}`.trim()} onClick={onClick} aria-label={label}>
      <X aria-hidden="true" />
    </button>
  );
}
function CompanyForm({
  t,
  initial,
  nextEvent,
  defaultStage,
  defaultInterest,
  openNextEvent,
  close,
  save,
}: {
  t: any;
  initial?: Company;
  nextEvent?: Event;
  defaultStage: Stage;
  defaultInterest: number;
  openNextEvent: (event?: Event) => void;
  close: () => void;
  save: any;
}) {
  const colors = ["#555555", "#777777", "#d18135", "#d4534d", "#2d9b78", "#9a6b44", "#6e7d91", "#c04f8a"];
  const [color, setColor] = useState(initial?.color || colors[0]);
  const [interest, setInterest] = useState(Math.min(5, Math.max(1, initial?.interestLevel || defaultInterest)));
  const initialIndustry = initial?.industry || "";
  const initialJobCategory = initial?.jobCategory || initial?.position || "";
  const standardIndustryOptions = useMemo(() => industryOptions.filter((option) => option !== "その他"), []);
  const [industry, setIndustry] = useState(initialIndustry);
  const [industryIsCustom, setIndustryIsCustom] = useState(Boolean(initialIndustry && !standardIndustryOptions.includes(initialIndustry)));
  const [jobCategory, setJobCategory] = useState(initialJobCategory);
  const [jobCategoryIsCustom, setJobCategoryIsCustom] = useState(Boolean(initialJobCategory && !occupationsForIndustry(initialIndustry).filter((option) => option !== "その他").includes(initialJobCategory)));
  const [industryChangedNotice, setIndustryChangedNotice] = useState(false);
  const previousIndustry = useRef(initialIndustry);
  const occupationOptions = useMemo(() => occupationsForIndustry(industry), [industry]);
  useEffect(() => {
    if (previousIndustry.current === industry) return;
    const shouldNotify = Boolean(previousIndustry.current && industry && jobCategory);
    previousIndustry.current = industry;
    setJobCategory("");
    setJobCategoryIsCustom(false);
    setIndustryChangedNotice(shouldNotify);
  }, [industry]);
  return (
    <Modal title={initial ? t.edit : t.addCompany} close={close}>
      <form className="form-grid" onSubmit={save}>
        <label>
          <span>{t.company}</span>
          <input name="name" defaultValue={initial?.name} required />
        </label>
        <label>
          <span>{t.industry}</span>
          <select
            name="industryChoice"
            value={industryIsCustom ? "__other__" : industry}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__other__") {
                setIndustryIsCustom(true);
                setIndustry("");
              } else {
                setIndustryIsCustom(false);
                setIndustry(value);
              }
            }}
          >
            <option value="" disabled>{t.selectOption}</option>
            {standardIndustryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            <option value="__other__">{t.other}</option>
          </select>
          {industryIsCustom && <input name="industryCustom" value={industry} onChange={(event) => setIndustry(event.target.value)} placeholder={t.industryInput} />}
          <input type="hidden" name="industry" value={industry} readOnly />
        </label>
        <label>
          <span>{t.position}</span>
          <select
            name="jobCategoryChoice"
            disabled={!industry.trim()}
            value={jobCategoryIsCustom ? "__other__" : jobCategory}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__other__") {
                setJobCategoryIsCustom(true);
                setJobCategory("");
              } else {
                setJobCategoryIsCustom(false);
                setJobCategory(value);
                if (value) setIndustryChangedNotice(false);
              }
            }}
          >
            <option value="" disabled>{industry.trim() ? t.selectOption : t.selectIndustryFirst}</option>
            {occupationOptions.filter((option) => option !== "その他").map((option) => <option key={option} value={option}>{option}</option>)}
            <option value="__other__">{t.other}</option>
          </select>
          {jobCategoryIsCustom && industry.trim() && <input name="jobCategoryCustom" value={jobCategory} onChange={(event) => setJobCategory(event.target.value)} placeholder={t.positionInput} />}
          <input type="hidden" name="jobCategory" value={jobCategory} readOnly />
        </label>
        {industryChangedNotice && <p className="form-field-notice" role="status">{t.industryChanged}</p>}
        <label>
          <span>{t.jobTitle}</span>
          <input name="jobTitle" defaultValue={initial?.jobTitle} placeholder={t.notSet} />
        </label>
        <label className="interest-field">
          <span>{t.interest}</span>
          <input type="hidden" name="interest" value={interest} readOnly />
          <div className="interest-stars" role="radiogroup" aria-label={t.interest}>
            {[1, 2, 3, 4, 5].map((x) => <button key={x} type="button" role="radio" aria-checked={interest === x} tabIndex={interest === x ? 0 : -1} className={x <= interest ? "selected" : ""} onClick={() => setInterest(x)} onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setInterest(Math.min(5, interest + 1)); } if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setInterest(Math.max(1, interest - 1)); } }}>{x <= interest ? "★" : "☆"}</button>)}
            <span>{interest} / 5</span>
          </div>
        </label>
        <label>
          <span>{t.stage}</span>
          <select name="stage" defaultValue={initial?.stage || defaultStage}>
            {stages.map((x) => (
              <option key={x} value={x}>
                {t[x]}
              </option>
            ))}
          </select>
        </label>
        {!initial && <label>
          <span>{t.nextSchedule}</span>
          <input name="event" type="datetime-local" />
        </label>}
        {initial && <div className="company-next-editor wide">
          <span>{t.nextSchedule}</span>
          {nextEvent ? <div className="company-next-editor-card"><div><strong>{whenForLocale(nextEvent.startsAt, t)}</strong><small>{nextEvent.type === "general" ? (nextEvent.title || t.general) : t[nextEvent.type] || nextEvent.title || t.general}</small></div><button type="button" onClick={() => openNextEvent(nextEvent)}>{t.editSchedule}</button></div> : <button type="button" className="company-next-add" onClick={() => openNextEvent()}><Plus />{t.addSchedule}</button>}
        </div>}
        <label>
          <span>{t.url}</span>
          <input name="url" type="url" defaultValue={initial?.careersUrl} />
        </label>
        <label>
          <span>{t.displayColor}</span>
          <input name="color" type="hidden" value={color} readOnly />
          <div className="color-swatches" role="radiogroup" aria-label={t.language === "言語" ? "表示色" : "Display color"}>
            {colors.map((value) => <button type="button" key={value} className={`color-swatch ${color === value ? "active" : ""}`} style={{ background: value }} aria-label={value} aria-pressed={color === value} onClick={() => setColor(value)}>{color === value && <Check />}</button>)}
          </div>
        </label>
        <label className="wide">
          <span>{t.notes}</span>
          <textarea name="notes" defaultValue={initial?.notes} />
        </label>
        <Actions t={t} close={close} />
      </form>
    </Modal>
  );
}
function TemplateInsert({
  t,
  templates,
  categories,
  targetName,
}: {
  t: any;
  templates: CareerTemplate[];
  categories: TemplateCategory[];
  targetName: string;
}) {
  const [selected, setSelected] = useState("");
  const available = templates.filter((template) => categories.includes(template.category));
  const insert = () => {
    const template = available.find((item) => item.id === selected);
    const target = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[name="${targetName}"]`);
    if (!template || !target) return;
    const current = target.value.trim();
    target.value = current ? `${current}\n\n${template.content}` : template.content;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    setSelected("");
  };
  return <div className="template-insert">
    <select value={selected} onChange={(event) => setSelected(event.target.value)} aria-label={t.templateInsert}>
      <option value="">{available.length ? t.chooseTemplate : t.noTemplates}</option>
      {available.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
    </select>
    <button type="button" onClick={insert} disabled={!selected}>{t.insertTemplate}</button>
  </div>;
}
function MaterialForm({
  t,
  companies,
  templates,
  close,
  save,
}: {
  t: any;
  companies: Company[];
  templates: CareerTemplate[];
  close: () => void;
  save: any;
}) {
  const ja = t.language === "言語";
  const en = t.language === "Language";
  const [documentType, setDocumentType] = useState("es");
  const [otherType, setOtherType] = useState("open_es");
  const [saveMode, setSaveMode] = useState<"upload" | "text">("text");
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    if (!file) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const label = (zh: string, jp: string, eng: string) => ja ? jp : en ? eng : zh;
  const otherTypes = [
    ["open_es", "OpenES"],
    ["transcript", label("成绩证明书", "成績証明書", "Academic transcript")],
    ["graduation", label("预计毕业证明书", "卒業見込証明書", "Expected graduation certificate")],
    ["recommendation", label("推荐信", "推薦状", "Recommendation letter")],
    ["other", label("其他", "その他", "Other")],
  ];
  const statuses = [["not_started", label("未着手", "未着手", "Not started")], ["drafting", label("作成中", "作成中", "Drafting")], ["submitted", label("已提交", "提出済み", "Submitted")]];
  const isOtherDocument = documentType === "other_document";
  const chooseDocumentType = (value: string) => {
    setDocumentType(value);
    setSaveMode(value === "es" || value === "other_document" ? "text" : "upload");
    setFile(undefined);
  };
  const onFile = (next?: File) => {
    if (!next) return;
    const valid = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg"];
    if (!valid.includes(next.type) || next.size > 10 * 1024 * 1024) {
      window.alert(label("请选择 PDF、Word、PNG 或 JPG，且文件不超过 10 MB。", "PDF、Word、PNG、JPGの10MB以下のファイルを選択してください。", "Choose a PDF, Word, PNG, or JPG file up to 10 MB."));
      return;
    }
    setFile(next);
  };
  return (
    <Modal title={label("添加材料", "書類を追加", "Add document")} close={close}>
      <form className="form-grid document-form" onSubmit={save}>
        <label>
          <span>{label("关联企业", "企業", "Company")} *</span>
          <select name="company" required>
            <option value="">—</option>
            {companies.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{label("材料类型", "書類の種類", "Document type")} *</span>
          <select name="documentType" value={documentType} onChange={(e) => chooseDocumentType(e.target.value)} required>
            <option value="es">ES</option>
            <option value="resume">履歴書</option>
            <option value="other_document">{label("其他材料", "その他の書類", "Other documents")}</option>
          </select>
        </label>
        <fieldset className="save-mode-field wide">
          <legend>{label("保存方式", "保存方法", "Save method")} *</legend>
          <div className="segmented-control">
            <label><input type="radio" name="saveMode" value="upload" checked={saveMode === "upload"} onChange={() => setSaveMode("upload")} /><span>{label("上传文件", "ファイルをアップロード", "Upload file")}</span></label>
            <label><input type="radio" name="saveMode" value="text" checked={saveMode === "text"} onChange={() => setSaveMode("text")} /><span>{label("直接填写", "直接入力", "Enter text")}</span></label>
          </div>
        </fieldset>
        {saveMode === "upload" && <div className="attachment-field wide">
          <label className="attachment-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
            <Upload aria-hidden="true" />
            <strong>{label("拖拽文件到这里，或点击选择文件", "ファイルをここにドロップするか、クリックして選択", "Drop a file here or click to choose")}</strong>
            <span>{label("支持 PDF、Word、PNG、JPG，最大 10 MB", "PDF、Word、PNG、JPG、最大10MB", "PDF, Word, PNG, JPG, up to 10 MB")}</span>
            <input name="attachment" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {file && <div className="attachment-card"><FileJson /><div><strong title={file.name}>{file.name}</strong><span>{file.type.split("/").pop()?.toUpperCase()} · {Math.ceil(file.size / 1024)} KB</span></div><a href={previewUrl} target="_blank" rel="noopener noreferrer">{file.type === "application/pdf" || file.type.startsWith("image/") ? label("预览", "プレビュー", "Preview") : label("下载查看", "ダウンロード", "Download")}</a><button type="button" onClick={() => setFile(undefined)} aria-label={label("删除附件", "添付ファイルを削除", "Remove attachment")}><Trash2 /></button></div>}
        </div>}
        {isOtherDocument && <label>
          <span>{label("具体材料类型", "書類の種類", "Specific document type")} *</span>
          <select name="otherType" value={otherType} onChange={(e) => setOtherType(e.target.value)} required>
            {otherTypes.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>}
        <label>
          <span>{label("截止日期", "締切", "Deadline")} *</span>
          <input name="due" type="datetime-local" required />
        </label>
        <label>
          <span>{label("提交状态", "提出状況", "Submission status")} *</span>
          <select name="submissionStatus" defaultValue="not_started" required>
            {statuses.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <label>
          <span>{label("提交日期", "提出日", "Submitted on")}</span>
          <input name="submittedAt" type="date" />
        </label>
        {saveMode === "text" && documentType === "es" && <>
          <label className="wide"><span>{label("题目", "設問", "Question")}</span><input name="question" /></label>
          <label className="wide"><span>{label("自我介绍", "自己PR", "Self PR")}</span><TemplateInsert t={t} templates={templates} categories={["selfPr"]} targetName="selfPr" /><textarea name="selfPr" /></label>
          <label className="wide"><span>{label("学生时代经历", "ガクチカ", "Student experience")}</span><TemplateInsert t={t} templates={templates} categories={["gakuchika"]} targetName="gakuchika" /><textarea name="gakuchika" /></label>
          <label className="wide"><span>{label("志望动机", "志望動機", "Motivation")}</span><TemplateInsert t={t} templates={templates} categories={["motivation"]} targetName="motivation" /><textarea name="motivation" /></label>
          <label className="wide"><span>{label("回答", "回答", "Answer")}</span><textarea name="answer" /></label>
          <label><span>{label("文字数限制", "文字数制限", "Character limit")}</span><input name="characterLimit" type="number" min="0" /></label>
        </>}
        {saveMode === "text" && documentType === "resume" && <>
          <label><span>{label("版本名", "バージョン名", "Version name")}</span><input name="versionName" /></label>
          <label><span>{label("文件名", "ファイル名", "File name")}</span><input name="fileName" /></label>
          <label><span>{label("使用语言", "使用言語", "Language")}</span><input name="language" placeholder="日本語 / 中文 / English" /></label>
        </>}
        {isOtherDocument && <label><span>{label("文件名", "ファイル名", "File name")}</span><input name="fileName" /></label>}
        <Actions t={t} close={close} primaryLabel={saveMode === "upload" ? label("上传并保存", "アップロードして保存", "Upload and save") : undefined} />
      </form>
    </Modal>
  );
}
function EventForm({
  t,
  companies,
  initial,
  defaultCompanyId,
  defaultType,
  defaultStage,
  close,
  save,
  remove,
}: {
  t: any;
  companies: Company[];
  initial?: Event;
  defaultCompanyId?: string;
  defaultType?: ItemType;
  defaultStage?: Stage;
  close: () => void;
  save: any;
  remove: (event: Event) => void;
}) {
  const initialType = initial?.type || defaultType || "interview";
  const legacyInterviewStage = initial?.interviewStage
    || (interviewStageOptions.includes(initial?.stage as typeof interviewStageOptions[number]) ? initial?.stage as typeof interviewStageOptions[number] : undefined)
    || (interviewStageOptions.includes(defaultStage as typeof interviewStageOptions[number]) ? defaultStage as typeof interviewStageOptions[number] : "first_interview");
  const [eventType, setEventType] = useState<ItemType>(initialType);
  const [interviewStage, setInterviewStage] = useState<typeof interviewStageOptions[number]>(legacyInterviewStage);
  const [companyId, setCompanyId] = useState(initial?.companyId || defaultCompanyId || "");
  const [mode, setMode] = useState<Event["eventMode"]>(initial?.eventMode || "undecided");
  const [prefecture, setPrefecture] = useState(initial?.prefecture || "");
  const [city, setCity] = useState(initial?.city || "");
  const [isSaving, setIsSaving] = useState(false);
  const [stageWarning, setStageWarning] = useState<StageProgressionCheck>();
  const selectedCompany = companies.find((company) => company.id === companyId);
  const formRef = useRef<HTMLFormElement>(null);
  const skipStageWarningRef = useRef(false);
  const canSyncCompanyStage = Boolean(
    eventType === "interview"
    && selectedCompany
    && isInterviewProgressStage(interviewStage)
    && shouldOfferInterviewStageSync(selectedCompany.stage, interviewStage),
  );
  const stageProgression = compareCompanyStageToEvent(selectedCompany?.stage, eventType, interviewStage);
  const shouldWarnStageProgression = Boolean(
    selectedCompany
    && (stageProgression.kind === "backward" || stageProgression.kind === "terminal"),
  );
  const [syncCompanyStage, setSyncCompanyStage] = useState(canSyncCompanyStage);
  const savingRef = useRef(false);
  const ja = t.language === "言語";
  useEffect(() => {
    setSyncCompanyStage(canSyncCompanyStage);
  }, [canSyncCompanyStage, companyId, eventType, interviewStage, selectedCompany?.stage]);
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving || savingRef.current) return;
    if (!skipStageWarningRef.current && shouldWarnStageProgression) {
      setStageWarning(stageProgression);
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    try {
      await save(event);
      close();
    } finally {
      skipStageWarningRef.current = false;
      savingRef.current = false;
      setIsSaving(false);
    }
  };
  const continueWithStageWarning = () => {
    setStageWarning(undefined);
    skipStageWarningRef.current = true;
    formRef.current?.requestSubmit();
  };
  return (
    <>
      <Modal title={initial ? t.edit : t.addEvent} close={close}>
      <form ref={formRef} className="form-grid" onSubmit={handleSubmit}>
        <label>
          <span>{t.company}</span>
          <select name="company" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
            <option value="">—</option>
            {companies.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.language === "言語" ? "種類" : t.language === "Language" ? "Type" : "类型"}</span>
          <select name="type" value={eventType} onChange={(event) => setEventType(event.target.value as ItemType)}>
            {types.map((x) => (
              <option key={x} value={x}>
                {t[x]}
              </option>
            ))}
          </select>
        </label>
        {eventType === "interview" && <>
          <label>
            <span>{t.interviewStage}</span>
            <select name="interviewStage" value={interviewStage} onChange={(event) => setInterviewStage(event.target.value as typeof interviewStageOptions[number])}>
              {interviewStageOptions.map((stage) => <option key={stage} value={stage}>{t[stage]}</option>)}
            </select>
          </label>
          {canSyncCompanyStage && selectedCompany && <label className="stage-sync-option wide">
            <input
              type="checkbox"
              name="syncCompanyStage"
              checked={syncCompanyStage}
              onChange={(event) => setSyncCompanyStage(event.target.checked)}
            />
            <span>{t.syncCompanyStage(t[interviewStage])}</span>
            <small>{t.currentCompanyStage(selectedCompany.name, t[selectedCompany.stage] || selectedCompany.stage)}</small>
          </label>}
          {interviewStage === "other" && <label>
            <span>{t.interviewStageDetail}</span>
            <input name="interviewStageDetail" defaultValue={initial?.interviewStage === "other" ? initial.interviewStageDetail : ""} required />
          </label>}
        </>}
        <label>
          <span>{t.due}</span>
          <input
            name="startsAt"
            type="datetime-local"
            defaultValue={initial?.startsAt}
            required
          />
        </label>
        <fieldset className="wide event-mode-field"><legend>{ja ? "開催形式" : "举办形式"}</legend><div className="mode-options">
          {(["offline", "online", "undecided"] as const).map((value) => { const inputId = `event-mode-${value}`; return <label key={value} htmlFor={inputId} className={mode === value ? "selected" : ""}><input id={inputId} type="radio" name="eventMode" value={value} checked={mode === value} onChange={() => setMode(value)} /><span>{value === "offline" ? (ja ? "対面" : "线下") : value === "online" ? (ja ? "オンライン" : "线上") : (ja ? "未定" : "未确定")}</span></label>; })}
        </div></fieldset>
        {mode === "offline" && <><label><span>{ja ? "都道府県" : "都道府县"}</span><select name="prefecture" value={prefecture} onChange={(e) => { setPrefecture(e.target.value); setCity(""); }}><option value="">{ja ? "選択してください" : "请选择"}</option>{prefectures.map((value) => <option key={value} value={value}>{value}</option>)}<option value="__other">{ja ? "その他／手入力" : "其他／手动输入"}</option></select></label>{prefecture === "__other" ? <label className="wide"><span>{ja ? "住所" : "完整地址"}</span><input name="manualLocation" defaultValue={initial?.locationLabel || initial?.location} /></label> : <><label><span>{ja ? "市区町村／主要エリア" : "市区町村／主要区域"}</span><select name="city" value={city} onChange={(e) => setCity(e.target.value)}><option value="">{ja ? "選択してください" : "请选择"}</option>{(cityOptions[prefecture] || []).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="wide"><span>{ja ? "詳細な場所" : "详细地点"}</span><input name="detailLocation" defaultValue={initial?.detailLocation} placeholder={ja ? "渋谷駅、○○ビル 3F" : "渋谷站、○○大楼 3F"} /></label></>}</>}
        {mode === "online" && <><label><span>{ja ? "オンラインプラットフォーム" : "线上平台"}</span><select name="onlinePlatform" defaultValue={initial?.onlinePlatform || ""}><option value="">—</option>{["Zoom", "Microsoft Teams", "Google Meet", ja ? "企業専用システム" : "企业专用系统", ja ? "電話" : "电话", ja ? "その他" : "其他"].map((x) => <option key={x} value={x}>{x}</option>)}</select></label><label><span>{ja ? "会議リンク" : "会议链接"}</span><input name="meetingUrl" type="url" defaultValue={initial?.meetingUrl || ""} /></label></>}
        <label className="wide">
          <span>{t.notes}</span>
          <textarea name="notes" defaultValue={initial?.notes} />
        </label>
        <Actions t={t} close={close} remove={initial ? () => remove(initial) : undefined} isSaving={isSaving} />
      </form>
      </Modal>
      {stageWarning && selectedCompany && stageProgression.eventStage && <StageProgressionWarning
        t={t}
        check={stageWarning}
        currentStageLabel={t[stageWarning.currentStage || selectedCompany.stage] || stageWarning.currentStage || selectedCompany.stage}
        eventStageLabel={t[stageProgression.eventStage] || stageProgression.eventStage}
        close={() => setStageWarning(undefined)}
        continueAnyway={continueWithStageWarning}
      />}
    </>
  );
}

function StageProgressionWarning({
  t,
  check,
  currentStageLabel,
  eventStageLabel,
  close,
  continueAnyway,
}: {
  t: any;
  check: StageProgressionCheck;
  currentStageLabel: string;
  eventStageLabel: string;
  close: () => void;
  continueAnyway: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);
  return createPortal(
    <div className="stage-progression-warning-layer" role="dialog" aria-modal="true" aria-labelledby="stage-progression-warning-title">
      <button type="button" className="stage-progression-warning-backdrop" onClick={close} aria-label={t.stageProgressionBack} />
      <section className="stage-progression-warning-dialog">
        <header>
          <h2 id="stage-progression-warning-title">{t.stageProgressionTitle}</h2>
          <CloseButton onClick={close} label={t.stageProgressionBack} />
        </header>
        <div className="stage-progression-warning-copy">
          <p>{t.stageProgressionCurrent(currentStageLabel)}</p>
          {check.kind === "backward"
            ? <p>{t.stageProgressionBackward(eventStageLabel)}</p>
            : <p>{t.stageProgressionTerminal}</p>}
        </div>
        <div className="stage-progression-warning-actions">
          <button type="button" onClick={close}>{t.stageProgressionBack}</button>
          <button type="button" className="primary" onClick={continueAnyway}>{t.stageProgressionContinue}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
function InterviewForm({
  t,
  companies,
  templates,
  initial,
  close,
  save,
}: {
  t: any;
  companies: Company[];
  templates: CareerTemplate[];
  initial?: InterviewRecord;
  close: () => void;
  save: any;
}) {
  const ja = t.language === "言語";
  const en = t.language === "Language";
  const label = (zh: string, jp: string, eng: string) => ja ? jp : en ? eng : zh;
  const roundOptions = [["first", label("一次面试", "一次面接", "First Interview")], ["second", label("二次面试", "二次面接", "Second Interview")], ["third", label("三次面试", "三次面接", "Third Interview")], ["final", label("最终面试", "最終面接", "Final Interview")], ["group", label("集团面试", "集団面接", "Group Interview")], ["meeting", label("面谈", "面談", "Meeting")], ["other", label("其他", "その他", "Other")]];
  const formatOptions = [["individual", label("个人面试", "個人面接", "Individual interview")], ["group", label("集团面试", "集団面接", "Group interview")], ["discussion", label("小组讨论", "グループディスカッション", "Group discussion")], ["hr", label("人事面谈", "人事面談", "HR meeting")], ["other", label("其他", "その他", "Other")]];
  const modeOptions = [["online", label("线上", "オンライン", "Online")], ["in_person", label("现场", "対面", "In person")], ["hybrid", label("混合", "ハイブリッド", "Hybrid")], ["undecided", label("未确定", "未定", "Undecided")]];
  const resultOptions = [["waiting", label("等待结果", "結果待ち", "Waiting")], ["passed", label("通过", "通過", "Passed")], ["failed", label("未通过", "不合格", "Not passed")], ["withdrawn", label("辞退", "辞退", "Withdrawn")], ["undecided", label("未确定", "未定", "Undecided")]];
  const initialRound = initial?.roundCode || roundOptions.find(([code, text]) => text === initial?.round)?.[0] || "other";
  const [roundCode, setRoundCode] = useState(initialRound);
  const [score, setScore] = useState(Math.min(5, Math.max(1, initial?.score || 3)));
  return (
    <Modal title={initial ? t.edit : t.addInterview} close={close}>
      <form className="form-grid" onSubmit={save}>
        <label>
          <span>{t.company}</span>
          <select name="company" defaultValue={initial?.companyId}>
            <option value="">—</option>
            {companies.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label><span>{t.round}</span><select name="roundCode" value={roundCode} onChange={(e) => setRoundCode(e.target.value)}>{roundOptions.map(([code, text]) => <option key={code} value={code}>{text}</option>)}</select></label>
        {roundCode === "other" && <label><span>{label("自定义轮次", "面接回数（自由入力）", "Custom round")}</span><input name="round" defaultValue={initial?.roundCode === "other" ? initial.round : ""} required /></label>}
        {roundCode !== "other" && <input type="hidden" name="round" value={roundOptions.find(([code]) => code === roundCode)?.[1] || ""} readOnly />}
        <label><span>{t.format}</span><select name="format" defaultValue={initial?.format || "individual"}>{formatOptions.map(([code, text]) => <option key={code} value={text}>{text}</option>)}</select></label>
        <label><span>{label("参加方式", "参加方法", "Attendance mode")}</span><select name="participationMode" defaultValue={initial?.participationMode || "undecided"}>{modeOptions.map(([code, text]) => <option key={code} value={code}>{text}</option>)}</select></label>
        <label><span>{t.interviewAt}</span><input name="interviewAt" type="datetime-local" defaultValue={initial?.interviewAt} required /></label>
        <label>
          <span>{t.interviewers}</span>
          <input name="interviewers" defaultValue={initial?.interviewers} />
        </label>
        <label className="interest-field"><span>{t.score}</span><input type="hidden" name="score" value={score} readOnly /><div className="interest-stars" role="radiogroup" aria-label={t.score}>{[1,2,3,4,5].map((x) => <button key={x} type="button" role="radio" aria-checked={score === x} tabIndex={score === x ? 0 : -1} className={x <= score ? "selected" : ""} onClick={() => setScore(x)} onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setScore(Math.min(5, score + 1)); } if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setScore(Math.max(1, score - 1)); } }}>{x <= score ? "★" : "☆"}</button>)}<span>{score} / 5</span></div></label>
        <label className="wide">
          <span>{t.questions}</span>
          <TemplateInsert t={t} templates={templates} categories={["interviewQuestion"]} targetName="questions" />
          <textarea name="questions" defaultValue={initial?.questions} />
        </label>
        <label className="wide">
          <span>{t.answers}</span>
          <TemplateInsert t={t} templates={templates} categories={["reverseQuestion"]} targetName="answers" />
          <textarea name="answers" defaultValue={initial?.answers} />
        </label>
        <label className="wide">
          <span>{t.feeling}</span>
          <textarea name="feeling" defaultValue={initial?.feeling} />
        </label>
        <label><span>{t.result}</span><select name="result" defaultValue={initial?.result || "undecided"}>{resultOptions.map(([code, text]) => <option key={code} value={text}>{text}</option>)}</select></label>
        <label className="wide">
          <span>{t.notes}</span>
          <textarea name="notes" defaultValue={initial?.notes} />
        </label>
        <Actions t={t} close={close} />
      </form>
    </Modal>
  );
}
function PreparationForm({
  t,
  companies,
  templates,
  initial,
  close,
  save,
}: {
  t: any;
  companies: Company[];
  templates: CareerTemplate[];
  initial?: Preparation;
  close: () => void;
  save: any;
}) {
  const prepTypes: PrepType[] = [
    "research",
    "es_fix",
    "interview_practice",
    "web_test_prep",
    "documents",
    "clothes",
    "route",
    "other",
  ];
  return (
    <Modal title={initial ? t.edit : t.addPrep} close={close}>
      <form className="form-grid" onSubmit={save}>
        <label className="wide">
          <span>{t.fieldTitle}</span>
          <input
            name="title"
            defaultValue={initial?.title}
            required
          />
        </label>
        <label>
          <span>{t.company}</span>
          <select name="company" defaultValue={initial?.companyId}>
            <option value="">—</option>
            {companies.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.prepType}</span>
          <select name="type" defaultValue={initial?.type || "research"}>
            {prepTypes.map((x) => (
              <option key={x} value={x}>
                {t[x]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.due}</span>
          <input
            name="due"
            type="datetime-local"
            defaultValue={initial?.dueAt}
          />
        </label>
        <label>
          <span>{t.priority}</span>
          <select name="priority" defaultValue={initial?.priority || "medium"}>
            {(["high", "medium", "low"] as Priority[]).map((x) => (
              <option key={x} value={x}>
                {t[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="check-label">
          <input
            name="completed"
            type="checkbox"
            defaultChecked={initial?.completed}
          />
          <span>{t.completed}</span>
        </label>
        <label className="wide">
          <span>{t.notes}</span>
          <TemplateInsert t={t} templates={templates} categories={["preparation"]} targetName="notes" />
          <textarea name="notes" defaultValue={initial?.notes} />
        </label>
        <Actions t={t} close={close} />
      </form>
    </Modal>
  );
}
function Actions({ t, close, remove, primaryLabel, isSaving = false }: { t: any; close: () => void; remove?: () => void; primaryLabel?: string; isSaving?: boolean }) {
  return (
    <>
      {remove && <button type="button" className="delete-event-button wide" onClick={remove}>
        <Trash2 />
        {t.deleteEventAction}
      </button>}
      <div className="form-actions wide">
      <button type="button" onClick={close}>
        {t.cancel}
      </button>
      <button type="submit" className="primary" disabled={isSaving} aria-busy={isSaving}>{isSaving ? "保存中…" : (primaryLabel || t.save)}</button>
      </div>
    </>
  );
}
function Confirm({
  t,
  company,
  close,
  remove,
}: {
  t: any;
  company: Company;
  close: () => void;
  remove: (x: Company, all: boolean) => void;
}) {
  return (
    <Modal title={t.deleteCompany} close={close}>
      <p className="confirm-copy">{t.deleteQuestion}</p>
      <div className="confirm-actions">
        <button className="danger-button" onClick={() => remove(company, true)}>
          {t.deleteAll}
        </button>
        <button onClick={() => remove(company, false)}>{t.deleteOnly}</button>
        <button onClick={close}>{t.cancel}</button>
      </div>
    </Modal>
  );
}
function DeleteEventConfirm({
  t,
  close,
  remove,
}: {
  t: any;
  close: () => void;
  remove: () => void;
}) {
  return (
    <Modal title={t.deleteEventTitle} close={close}>
      <p className="confirm-copy">{t.deleteEventDescription}</p>
      <div className="confirm-actions">
        <button onClick={close}>{t.cancel}</button>
        <button className="danger-solid" onClick={remove}>{t.deleteAction}</button>
      </div>
    </Modal>
  );
}
function Toast({
  t,
  toast,
  close,
}: {
  t: any;
  toast: { text: string; undo: () => void };
  close: () => void;
}) {
  return (
    <div className="toast">
      {toast.text}
      <button
        onClick={() => {
          toast.undo();
          close();
        }}
      >
        {t.undo}
      </button>
    </div>
  );
}
function BackupControls({ data, theme, locale, setData }: any) {
  const [error, setError] = useState("");
  const [lastExport, setLastExport] = useState<number>(() => Number(localStorage.getItem("careerflow-last-export") || 0));
  const fileRef = useRef<HTMLInputElement>(null);
  const snapshot = (): BackupSnapshot => makeBackupSnapshot(data, theme, locale);
  const exportBackup = async () => {
    const now = new Date();
    const pad = (x: number) => String(x).padStart(2, "0");
    const name = `yami-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
    const contents = JSON.stringify({ ...snapshot(), exportedAt: Date.now() }, null, 2);
    const backupFile = new File([contents], name, { type: "application/json" });
    const userAgent = navigator.userAgent || "";
    // macOS Safari may expose navigator.share, but it is still a desktop
    // browser. Only touch-capable iPadOS using the desktop-style UA qualifies.
    const isIOS = /iPad|iPhone|iPod/.test(userAgent) ||
      (/Macintosh/.test(userAgent) && navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    try {
      if (isIOS && navigator.share && navigator.canShare?.({ files: [backupFile] })) {
        await navigator.share({ files: [backupFile], title: "Yami Backup" });
      } else {
        const blobUrl = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = name;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      }
      const timestamp = Date.now();
      localStorage.setItem("careerflow-last-export", String(timestamp));
      setLastExport(timestamp);
      setError(locale === "ja" ? (isIOS ? "ファイルに保存を選択してください" : "バックアップファイルを生成しました") : locale === "en" ? "Backup file generated" : "备份文件已生成");
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(locale === "ja" ? "書き出しに失敗しました" : locale === "en" ? "Export failed" : "导出失败");
    }
  };
  const restoreFile = (e: ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = async () => { try { const parsed = parseBackupPayload(JSON.parse(String(reader.result))); await createBackup(snapshot()); setData(parsed.data); setError(`${parsed.counts.companies} 企业、${parsed.counts.schedules} 日程、${parsed.counts.materials} 资料已恢复`); } catch (error) { console.error("[backup] restore validation failed", error); setError("JSON 结构无效，原数据未改变"); } }; reader.readAsText(file); e.currentTarget.value = ""; };
  const labels = locale === "ja" ? { exportBackup:"バックアップを書き出す", restoreFile:"バックアップを復元", exportNote:"バックアップファイルはブラウザの既定のダウンロード先に保存されます。", restoreNote:"以前に書き出したバックアップファイルを選択してください。", notesTitle:"バックアップについて", notesData:"企業、日程、書類、面接記録、アプリ設定が含まれます。", notesDevice:"バックアップファイルはユーザーのデバイスにのみ保存されます。", format:"ファイル形式：JSON", last:"前回の書き出し", never:"まだバックアップを書き出していません" } : { exportBackup:"导出备份", restoreFile:"恢复备份", exportNote:"备份文件将下载到浏览器的默认下载位置。", restoreNote:"请选择此前导出的备份文件。", notesTitle:"备份说明", notesData:"备份包含企业、日程、材料、面试记录及应用设置。", notesDevice:"备份文件仅保存在用户设备中。", format:"文件格式：JSON", last:"上次导出", never:"尚未导出备份" };
  return <section className="backup-panel"><section><div className="backup-cloud-actions"><button className="primary" onClick={exportBackup}>{labels.exportBackup}</button><button onClick={() => fileRef.current?.click()}>{labels.restoreFile}</button></div><p>{labels.exportNote}</p><p>{labels.restoreNote}</p><div className="backup-notes"><strong>{labels.notesTitle}</strong><span>{labels.notesData}</span><span>{labels.notesDevice}</span><span>{labels.format}</span></div><p>{lastExport ? `${labels.last}: ${new Date(lastExport).toLocaleDateString()}` : labels.never}</p>{error && <p className="backup-error">{error}</p>}<input hidden ref={fileRef} type="file" accept="application/json,.json" onChange={restoreFile} /></section></section>;
}
const templateCategoryKeys: Array<[TemplateCategory, string]> = [
  ["selfPr", "templateSelfPr"],
  ["gakuchika", "templateGakuchika"],
  ["motivation", "templateMotivation"],
  ["interviewQuestion", "templateInterviewQuestion"],
  ["reverseQuestion", "templateReverseQuestion"],
  ["preparation", "templatePreparation"],
];
function TemplateManager({ t, data, setData }: any) {
  const [editing, setEditing] = useState<CareerTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState({ category: "selfPr" as TemplateCategory, title: "", content: "" });
  const beginNew = () => { setEditing(null); setDraft({ category: "selfPr", title: "", content: "" }); setEditorOpen(true); };
  const beginEdit = (template: CareerTemplate) => { setEditing(template); setDraft({ category: template.category, title: template.title, content: template.content }); setEditorOpen(true); };
  const closeEditor = () => { setEditing(null); setEditorOpen(false); setDraft({ category: "selfPr", title: "", content: "" }); };
  const saveTemplate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.content.trim()) return;
    const next: CareerTemplate = { id: editing?.id || id(), category: draft.category, title: draft.title.trim(), content: draft.content, updatedAt: Date.now() };
    setData((current: Data) => ({ ...current, templates: editing ? current.templates.map((item) => item.id === editing.id ? next : item) : [next, ...current.templates] }));
    closeEditor();
  };
  const duplicate = (template: CareerTemplate) => setData((current: Data) => ({ ...current, templates: [{ ...template, id: id(), title: `${template.title} ${t.templateDuplicate}`, updatedAt: Date.now() }, ...current.templates] }));
  const remove = (template: CareerTemplate) => setData((current: Data) => ({ ...current, templates: current.templates.filter((item) => item.id !== template.id) }));
  return <div className={`template-manager${editorOpen ? " is-editing" : ""}`}>
    <div className="settings-section-heading"><div><h4>{editorOpen ? (editing ? t.templateEdit : t.templateNew) : t.templates}</h4><p>{t.templateInsert}</p></div>{!editorOpen && <button type="button" className="settings-secondary-button" onClick={beginNew}><Plus />{t.templateNew}</button>}</div>
    {editorOpen ? <form className="template-editor" onSubmit={saveTemplate}>
      <label><span>{t.templateCategory}</span><select value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value as TemplateCategory }))}>{templateCategoryKeys.map(([value, key]) => <option key={value} value={value}>{t[key]}</option>)}</select></label>
      <label><span>{t.templateTitle}</span><input value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder={t.templateTitle} /></label>
      <label className="wide"><span>{t.templateContent}</span><textarea value={draft.content} onChange={(event) => setDraft((value) => ({ ...value, content: event.target.value }))} rows={5} /></label>
      <div className="template-editor-actions"><button type="submit" className="primary">{t.templateSave}</button><button type="button" onClick={closeEditor}>{t.cancel}</button></div>
    </form> : <div className="template-list">{data.templates.length ? data.templates.map((template: CareerTemplate) => <article className="template-list-item" key={template.id}><div><span className="template-category">{t[templateCategoryKeys.find(([value]) => value === template.category)?.[1] || "templatePreparation"]}</span><h4>{template.title}</h4><p>{template.content}</p><small>{new Date(template.updatedAt).toLocaleDateString()}</small></div><div className="template-item-actions"><button type="button" onClick={() => beginEdit(template)}>{t.templateEdit}</button><button type="button" onClick={() => duplicate(template)}>{t.templateDuplicate}</button><button type="button" className="danger-button" onClick={() => remove(template)}>{t.templateDelete}</button></div></article>) : <p className="settings-muted">{t.templateEmpty}</p>}</div>}
  </div>;
}
function JobHuntSettings({ t, data, updatePreferences }: any) {
  const settings = data.preferences.jobHunt;
  const update = (patch: Partial<AppPreferences["jobHunt"]>) => updatePreferences((current: AppPreferences) => ({ ...current, jobHunt: { ...current.jobHunt, ...patch } }));
  return <section className="settings-section settings-form-section"><h3>{t.jobSettings}</h3>
    <label className="settings-field"><span>{t.homeRegion}</span><select value={settings.homeRegion} onChange={(event) => { update({ homeRegion: event.target.value }); localStorage.setItem("careerflow-home-region", event.target.value); }}><option value="">{t.notSet}</option>{prefectures.map((region) => <option key={region} value={region}>{region}</option>)}</select><small>{t.homeRegionHint}</small></label>
    <label className="settings-field"><span>{t.defaultStage}</span><select value={settings.defaultCompanyStage} onChange={(event) => update({ defaultCompanyStage: event.target.value as Stage })}>{stages.map((stage) => <option key={stage} value={stage}>{t[stage]}</option>)}</select><small>{t.defaultStageHint}</small></label>
    <label className="settings-field"><span>{t.defaultInterest}</span><select value={settings.defaultInterestLevel} onChange={(event) => update({ defaultInterestLevel: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select><small>{t.defaultInterestHint}</small></label>
  </section>;
}
function CustomizeSettings({ t, data, updatePreferences }: any) {
  const settings = data.preferences.customize;
  const summaryLabels: Record<HomeSummaryModule, string> = { active: t.inProgress, deadlines: t.dueWeek, waiting: t.waiting };
  const sectionLabels: Record<HomeSection, string> = { upcoming: t.deadlineNext, progress: t.funnel, month: t.monthSchedule, featured: t.featuredCompanies };
  const update = (patch: Partial<AppPreferences["customize"]>) => updatePreferences((current: AppPreferences) => ({ ...current, customize: { ...current.customize, ...patch } }));
  const toggleSummary = (module: HomeSummaryModule) => update({ homeSummaryVisibility: { ...settings.homeSummaryVisibility, [module]: !settings.homeSummaryVisibility[module] } });
  const toggleSection = (module: HomeSection) => update({ homeSectionVisibility: { ...settings.homeSectionVisibility, [module]: settings.homeSectionVisibility[module] === false } });
  const moveSummary = (index: number, amount: -1 | 1) => { const next = [...settings.homeSummaryOrder]; const target = index + amount; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; update({ homeSummaryOrder: next }); };
  const moveSection = (index: number, amount: -1 | 1) => { const next = [...settings.homeSectionOrder]; const target = index + amount; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; update({ homeSectionOrder: next }); };
  const updateCard = (key: keyof AppPreferences["customize"]["companyCard"]) => update({ companyCard: { ...settings.companyCard, [key]: !settings.companyCard[key] } });
  const sortLabels: Record<CompanySort, string> = { updated: t.sortUpdated, event: t.sortEvent, interest: t.sortInterest, name: t.sortName };
  return <section className="settings-section settings-form-section"><h3>{t.customize}</h3>
    <fieldset className="settings-choice-group"><legend>{t.homeSummary}</legend>{defaultHomeSummary.map((module) => <label key={module}><input type="checkbox" checked={settings.homeSummaryVisibility[module]} onChange={() => toggleSummary(module)} />{summaryLabels[module]}</label>)}</fieldset>
    <div className="settings-order-list"><strong>{t.homeSummaryOrder}</strong>{settings.homeSummaryOrder.map((module: HomeSummaryModule, index: number) => <div key={module}><span>{index + 1}. {summaryLabels[module]}</span><div><button type="button" onClick={() => moveSummary(index, -1)} disabled={index === 0} aria-label={t.moveUp}><ChevronUp /></button><button type="button" onClick={() => moveSummary(index, 1)} disabled={index === settings.homeSummaryOrder.length - 1} aria-label={t.moveDown}><ChevronDown /></button></div></div>)}</div>
    <fieldset className="settings-choice-group"><legend>{t.homeSections}</legend>{defaultHomeSections.map((module) => <label key={module}><input type="checkbox" checked={settings.homeSectionVisibility[module] !== false} onChange={() => toggleSection(module)} />{sectionLabels[module]}</label>)}</fieldset>
    <div className="settings-order-list"><strong>{t.homeSectionsOrder}</strong>{settings.homeSectionOrder.map((module: HomeSection, index: number) => <div key={module}><span>{index + 1}. {sectionLabels[module]}</span><div><button type="button" onClick={() => moveSection(index, -1)} disabled={index === 0} aria-label={t.moveUp}><ChevronUp /></button><button type="button" onClick={() => moveSection(index, 1)} disabled={index === settings.homeSectionOrder.length - 1} aria-label={t.moveDown}><ChevronDown /></button></div></div>)}</div>
    <fieldset className="settings-choice-group"><legend>{t.companyCard}</legend>{(["industry", "position", "stage", "interest", "nextEvent"] as const).map((key) => <label key={key}><input type="checkbox" checked={settings.companyCard[key]} onChange={() => updateCard(key)} />{t[key === "industry" ? "showIndustry" : key === "position" ? "showPosition" : key === "stage" ? "showStage" : key === "interest" ? "showInterest" : "showNextEvent"]}</label>)}</fieldset>
    <label className="settings-field"><span>{t.defaultCompanySort}</span><select value={settings.companySort} onChange={(event) => update({ companySort: event.target.value as CompanySort })}>{(Object.keys(sortLabels) as CompanySort[]).map((key) => <option key={key} value={key}>{sortLabels[key]}</option>)}</select></label>
  </section>;
}
function CalendarSettings({ t, exportCalendar }: any) {
  return <section className="settings-section settings-form-section"><h3>{t.calendarIntegration}</h3><p className="settings-muted calendar-description">{t.calendarDescription}</p><p className="settings-muted">{t.calendarNoSync}</p><button type="button" className="primary settings-wide-action" onClick={() => exportCalendar()}><CalendarDays />{t.calendarExportFuture}</button><div className="calendar-help"><h4>{t.calendarHowTo}</h4>{([[t.calendarIphoneTitle, t.calendarIphone], [t.calendarMacTitle, t.calendarMac]] as Array<[string, string]>).map(([title, steps]) => <section key={title}><strong>{title}</strong><p>{steps}</p></section>)}<p className="calendar-important">{t.calendarNoSync}</p></div></section>;
}
function MobileSettingsDrawer({
  t, page, setPage, close, open, theme, setTheme, locale, setLocale, data, setData, json, download, updatePreferences, exportCalendar,
}: any) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [renderedPage, setRenderedPage] = useState<string | null>(null);
  const [transitionPage, setTransitionPage] = useState<string | null | undefined>(undefined);
  const [contentPhase, setContentPhase] = useState<"idle" | "out" | "in">("idle");
  const label = "Yami";
  const about = locale === "ja"
    ? { title: "Yamiについて", version: "Yami バージョン 1.0", db: `データベースバージョン：v${data.schemaVersion}`, privacy: "プライバシー：データは主にこのデバイスに保存されます。", license: "オープンソースライセンス：MIT License" }
    : locale === "en"
      ? { title: "About Yami", version: "Yami version 1.0", db: `Database version: v${data.schemaVersion}`, privacy: "Privacy: Data is mainly stored on this device.", license: "Open-source license: MIT License" }
      : { title: "关于 Yami", version: "Yami 版本 1.0", db: `数据库版本：v${data.schemaVersion}`, privacy: "隐私说明：数据主要保存在当前设备。", license: "开源许可：MIT License" };
  const dismiss = () => close();
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const previous = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.documentElement.classList.add("drawer-open");
    document.body.classList.add("drawer-open");
    document.body.style.position = "fixed";
    document.body.style.top = `-${y}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.classList.remove("drawer-open");
      document.body.classList.remove("drawer-open");
      document.body.style.position = previous.position;
      document.body.style.top = previous.top;
      document.body.style.width = previous.width;
      document.body.style.overflow = previous.overflow;
      window.scrollTo(0, y);
    };
  }, [open]);
  useEffect(() => {
    if (!open) {
      setRenderedPage(null);
      setTransitionPage(undefined);
      setContentPhase("idle");
      return;
    }
    if (page === renderedPage && transitionPage === undefined) return;
    setTransitionPage(page);
    setContentPhase("out");
    const enterFrame = window.requestAnimationFrame(() => setContentPhase("in"));
    const finishTimer = window.setTimeout(() => {
      setRenderedPage(page);
      setTransitionPage(undefined);
      setContentPhase("idle");
    }, 300);
    return () => {
      window.cancelAnimationFrame(enterFrame);
      window.clearTimeout(finishTimer);
    };
  }, [open, page]);
  useLayoutEffect(() => {
    if (!open) return;
    const layer = layerRef.current;
    if (!layer) return;
    layer.querySelectorAll<HTMLElement>(".mobile-settings-content-layer").forEach((node) => {
      node.scrollTop = 0;
    });
    layer.querySelector<HTMLElement>(".drawer-main")?.scrollTo({ top: 0, behavior: "auto" });
  }, [open, page, transitionPage]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const frame = requestAnimationFrame(() => {
      const layer = layerRef.current;
      if (!layer) return;
      const surface = getComputedStyle(layer, "::before");
      const nav = layer.querySelector<HTMLElement>(".mobile-settings-nav");
      const navStyle = nav ? getComputedStyle(nav) : null;
      const layerStyle = getComputedStyle(layer);
      console.debug("[mobile-menu] computed", {
        open,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        mobileNav: {
          display: layerStyle.display,
          visibility: layerStyle.visibility,
          opacity: layerStyle.opacity,
          clipPath: layerStyle.clipPath,
          position: layerStyle.position,
          top: layerStyle.top,
          bottom: layerStyle.bottom,
          zIndex: layerStyle.zIndex,
        },
        surface: {
          background: surface.background,
          backgroundColor: surface.backgroundColor,
          opacity: surface.opacity,
          clipPath: surface.clipPath,
          transitionProperty: surface.transitionProperty,
          transitionDuration: surface.transitionDuration,
          transitionDelay: surface.transitionDelay,
          transitionTimingFunction: surface.transitionTimingFunction,
          animationDuration: surface.animationDuration,
          animationName: surface.animationName,
        },
        nav: navStyle && {
          visibility: navStyle.visibility,
          opacity: navStyle.opacity,
          transform: navStyle.transform,
          transitionProperty: navStyle.transitionProperty,
          transitionDuration: navStyle.transitionDuration,
          transitionDelay: navStyle.transitionDelay,
          transitionTimingFunction: navStyle.transitionTimingFunction,
          animationDuration: navStyle.animationDuration,
          animationName: navStyle.animationName,
        },
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const layer = layerRef.current;
    if (!layer) return;
    let startedAt: number | null = null;
    const onTransitionStart = (event: TransitionEvent) => {
      if (event.propertyName !== "clip-path") return;
      startedAt = performance.now();
      console.debug("[mobile-menu] transitionstart", {
        property: event.propertyName,
        pseudoElement: event.pseudoElement,
        at: startedAt,
        open,
      });
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "clip-path") return;
      const endedAt = performance.now();
      console.debug("[mobile-menu] transitionend", {
        property: event.propertyName,
        pseudoElement: event.pseudoElement,
        at: endedAt,
        open,
        duration: startedAt === null ? undefined : endedAt - startedAt,
      });
      startedAt = null;
    };
    layer.addEventListener("transitionstart", onTransitionStart);
    layer.addEventListener("transitionend", onTransitionEnd);
    return () => {
      layer.removeEventListener("transitionstart", onTransitionStart);
      layer.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [open]);
  const changePage = (nextPage: string | null) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && layerRef.current?.contains(active)) active.blur();
    setPage(nextPage);
  };
  const renderSettingsContent = (pageValue: string | null) => {
    if (!pageValue) return <nav className="mobile-settings-nav">
      <button type="button" onClick={() => changePage("data")}><Database aria-hidden="true" /><span>{t.data}</span><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={() => changePage("job-settings")}><ClipboardCheck aria-hidden="true" /><span>{t.jobSettings}</span><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={() => changePage("customize")}><PanelsTopLeft aria-hidden="true" /><span>{t.customize}</span><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={() => changePage("templates")}><FileText aria-hidden="true" /><span>{t.templates}</span><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={() => changePage("calendar")}><CalendarSync aria-hidden="true" /><span>{t.calendarIntegration}</span><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={() => changePage("watch")}><Eye aria-hidden="true" /><span>{locale === "ja" ? "企業ウォッチ接続" : "企业监控连接"}</span><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={() => changePage("appearance")}><Palette aria-hidden="true" /><span>{t.appearance}</span><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={() => changePage("language")}><Globe aria-hidden="true" /><span>{t.language}</span><ChevronRight aria-hidden="true" /></button>
      <button type="button" onClick={() => changePage("about")}><Info aria-hidden="true" /><span>{about.title}</span><ChevronRight aria-hidden="true" /></button>
    </nav>;
    const subpageTitle = pageValue === "data" ? t.data : pageValue === "job-settings" ? t.jobSettings : pageValue === "customize" ? t.customize : pageValue === "templates" ? t.templates : pageValue === "calendar" ? t.calendarIntegration : pageValue === "watch" ? (locale === "ja" ? "企業ウォッチ接続" : "企业监控连接") : pageValue === "appearance" ? t.appearance : pageValue === "language" ? t.language : about.title;
    if (pageValue === "data") return <section className="mobile-settings-subpage" aria-labelledby="mobile-settings-subpage-title"><h2 id="mobile-settings-subpage-title">{subpageTitle}</h2><div className="mobile-settings-subpage-list mobile-data-actions"><button type="button" onClick={() => download("yami-backup.json", JSON.stringify(makeBackupSnapshot(data, theme, locale), null, 2), "application/json")}><DatabaseArrowUp aria-hidden="true" /><span>{t.backup}</span></button><button type="button" onClick={() => json.current?.click()}><DatabaseArrowDown aria-hidden="true" /><span>{t.restore}</span></button></div></section>;
    if (pageValue === "job-settings") return <JobHuntSettings t={t} data={data} updatePreferences={updatePreferences} />;
    if (pageValue === "customize") return <CustomizeSettings t={t} data={data} updatePreferences={updatePreferences} />;
    if (pageValue === "templates") return <section className="mobile-settings-subpage"><TemplateManager t={t} data={data} setData={setData} /></section>;
    if (pageValue === "calendar") return <CalendarSettings t={t} data={data} updatePreferences={updatePreferences} exportCalendar={exportCalendar} />;
    if (pageValue === "watch") return <section className="mobile-settings-subpage"><WatchConnectionSettings locale={locale} /></section>;
    if (pageValue === "appearance") return <section className="mobile-settings-subpage" aria-labelledby="mobile-settings-subpage-title"><h2 id="mobile-settings-subpage-title">{subpageTitle}</h2><div className="mobile-settings-subpage-list">{(["light", "dark", "system"] as Theme[]).map((x) => { const Icon = x === "light" ? Sun : x === "dark" ? Moon : Monitor; return <button type="button" className={theme === x ? "selected" : ""} onClick={() => setTheme(x)} key={x}><Icon aria-hidden="true" /><span>{t[x]}</span>{theme === x && <Check aria-hidden="true" />}</button>; })}</div></section>;
    if (pageValue === "language") return <section className="mobile-settings-subpage" aria-labelledby="mobile-settings-subpage-title"><h2 id="mobile-settings-subpage-title">{subpageTitle}</h2><div className="mobile-settings-subpage-list">{(["zh", "ja"] as Locale[]).map((x) => <button type="button" className={locale === x ? "selected" : ""} onClick={() => setLocale(x)} key={x}><span>{x === "zh" ? "中文" : "日本語"}</span>{locale === x && <Check aria-hidden="true" />}</button>)}</div></section>;
    return <section className="mobile-settings-subpage mobile-about" aria-labelledby="mobile-settings-subpage-title"><h2 id="mobile-settings-subpage-title">{subpageTitle}</h2><YamiAboutBrand /><p>{about.version}</p><p>{about.db}</p><p>{about.privacy}</p><p>{about.license}</p></section>;
  };
  const headerPage = transitionPage !== undefined
    ? (transitionPage === null ? renderedPage : transitionPage)
    : renderedPage;
  return <div ref={layerRef} className="mobile-settings-layer" data-mobile-global-nav="true" data-open={open ? "true" : "false"}>
    <button className="mobile-settings-backdrop" onClick={dismiss} aria-label={t.cancel} />
    <aside className="mobile-settings-drawer drawer-shell" role="dialog" aria-modal="true" aria-label={label}>
      <header className={`mobile-navigation-header mobile-header glass-lite${headerPage ? " mobile-settings-subheader" : ""}`}>
        {headerPage ? <button className="mobile-settings-back-button" type="button" onClick={() => changePage(null)} aria-label={locale === "ja" ? "戻る" : "返回"}><ArrowLeft aria-hidden="true" /></button> : <button className="mobile-menu-button" onClick={dismiss} aria-label={t.cancel}><X aria-hidden="true" /></button>}
        <YamiLogoLockup variant="mobile" className="mobile-header-title" />
        {headerPage ? <button className="mobile-settings-close-button" type="button" onClick={dismiss} aria-label={t.cancel}><X aria-hidden="true" /></button> : <span className="mobile-header-action-slot" aria-hidden="true" />}
      </header>
      <div className="drawer-main drawer-scroll"><div className={`mobile-settings-content-switch ${transitionPage !== undefined ? "is-transitioning" : ""}`}>
        <div className={`mobile-settings-content-layer mobile-settings-content-current ${transitionPage !== undefined ? "is-leaving" : ""}`}>{renderSettingsContent(renderedPage)}</div>
        {transitionPage !== undefined && <div className={`mobile-settings-content-layer mobile-settings-content-next ${contentPhase === "in" ? "is-entering" : ""}`}>{renderSettingsContent(transitionPage)}</div>}
      </div></div>
    </aside>
  </div>;
}
function SettingsDrawer({ close, children, title }: { close: () => void; children: ReactNode; title: string }) {
  const [closing, setClosing] = useState(false);
  const startX = useRef<number | null>(null);
  const dismiss = () => { if (closing) return; setClosing(true); window.setTimeout(close, 160); };
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); }; document.addEventListener("keydown", onKey); document.body.classList.add("settings-drawer-open"); return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("settings-drawer-open"); }; }, []);
  return <div className={`settings-drawer-layer ${closing ? "closing" : ""}`}><button className="settings-drawer-backdrop" onClick={dismiss} aria-label="Close settings"/><aside className="settings-drawer-panel" role="dialog" aria-modal="true" aria-label={title} onTouchStart={(e) => { startX.current = e.touches[0].clientX; }} onTouchEnd={(e) => { if (startX.current !== null && e.changedTouches[0].clientX - startX.current > 70) dismiss(); startX.current = null; }}><header><h2>{title}</h2><CloseButton onClick={dismiss} label="Close settings" /></header><div className="settings-drawer-scroll">{children}</div></aside></div>;
}
function SettingsPanel({ t, theme, setTheme, locale, setLocale, close, data, setData, iconRef, json, upload, importJson, updatePreferences, exportCalendar }: any) {
  const [tab, setTab] = useState("general");
  const ja = locale === "ja";
  const ui = locale === "ja"
    ? { general: "一般", appearance: t.appearance, language: t.language, data: "データとバックアップ", about: "Yamiについて", storage: "このデバイスの保存状況", backup: "バックアップ", aboutTitle: "Yamiについて", version: "Yami バージョン 1.0", db: "データベースバージョン", pwa: "PWA ステータス: standalone 対応", icon: "アイコン: Yami ブランドマーク", privacy: "プライバシー: データは主にこのデバイスに保存されます。", license: "オープンソースライセンス: MIT License" }
    : { general: "常规", appearance: t.appearance, language: t.language, data: "数据与备份", about: "关于 Yami", storage: "当前设备存储", backup: "备份", aboutTitle: "关于 Yami", version: "Yami 版本 1.0", db: "数据库版本", pwa: "PWA 状态：支持 standalone", icon: "图标：Yami 品牌标记", privacy: "隐私：数据主要保存在当前设备。", license: "开源许可：MIT License" };
  const tabs = [["general", ui.general, Settings], ["job-settings", t.jobSettings, ClipboardCheck], ["customize", t.customize, PanelsTopLeft], ["templates", t.templates, FileText], ["calendar", t.calendarIntegration, CalendarSync], ["watch", ja ? "企業ウォッチ接続" : "企业监控连接", Eye], ["appearance", ui.appearance, Palette], ["language", ui.language, Globe], ["data", ui.data, Database], ["about", ui.about, Info]] as const;
  return <SettingsDrawer title={t.settings} close={close}><div className="desktop-settings-layout"><nav className="desktop-settings-nav settings-sidebar"><div className="settings-nav-list">{tabs.map(([key, text, Icon]) => <SettingsNavItem key={key} label={text} icon={Icon} active={tab === key} onClick={() => setTab(key)} />)}</div></nav><div className="desktop-settings-content">
    {tab === "general" && <section className="settings-section"><h3>{ui.storage}</h3><div className="settings-stats">{[[ja ? "企業数" : "企业数", data.companies.length], [ja ? "日程数" : "日程数", data.events.length], [ja ? "資料数" : "资料数", data.materials.length], [ja ? "面接記録数" : "面试记录数", data.interviews.length], [ja ? "準備事項数" : "准备事项数", data.preparations.length], [ui.db, "v" + data.schemaVersion]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</div></section>}
    {tab === "job-settings" && <JobHuntSettings t={t} data={data} updatePreferences={updatePreferences} />}
    {tab === "customize" && <CustomizeSettings t={t} data={data} updatePreferences={updatePreferences} />}
    {tab === "templates" && <section className="settings-section"><TemplateManager t={t} data={data} setData={setData} /></section>}
    {tab === "calendar" && <CalendarSettings t={t} data={data} updatePreferences={updatePreferences} exportCalendar={exportCalendar} />}
    {tab === "watch" && <WatchConnectionSettings locale={locale} />}
    {tab === "appearance" && <section className="settings-section"><h3>{ui.appearance}</h3><div className="settings-segmented">{(["light", "dark", "system"] as Theme[]).map((x) => { const Icon = x === "light" ? Sun : x === "dark" ? Moon : Monitor; return <button type="button" aria-pressed={theme === x} className={theme === x ? "active" : ""} onClick={() => setTheme(x)} key={x}><Icon aria-hidden="true" />{t[x]}</button>; })}</div></section>}
    {tab === "language" && <section className="settings-section"><h3>{ui.language}</h3><div className="settings-segmented">{(["zh", "ja"] as Locale[]).map((x) => <button type="button" aria-pressed={locale === x} className={locale === x ? "active" : ""} onClick={() => setLocale(x)} key={x}>{x === "zh" ? "中文" : "日本語"}</button>)}</div></section>}
    {tab === "data" && <section className="settings-section settings-data-section"><h3>{ui.backup}</h3><BackupControls data={data} theme={theme} locale={locale} setData={setData} /></section>}
    {tab === "about" && <section className="settings-section"><h3>{ui.aboutTitle}</h3><YamiAboutBrand /><div className="settings-about-list"><p>{ui.version}</p><p>{ui.db}: v{data.schemaVersion}</p><p>{ui.pwa}</p><p>{ui.icon}</p><p>{ui.privacy}</p><p>{ui.license}</p></div></section>}
  </div></div><input hidden ref={iconRef} type="file" accept="image/*" onChange={upload} /></SettingsDrawer>;
}
function SettingsNavItem({ label, icon: Icon, active, onClick }: { label: string; icon: React.ComponentType<any>; active: boolean; onClick: () => void }) {
  return <button type="button" className={`settings-nav-item ${active ? "active" : ""}`} aria-selected={active} onClick={onClick}><Icon size={19} aria-hidden="true" /><span className="settings-nav-label">{label}</span></button>;
}
