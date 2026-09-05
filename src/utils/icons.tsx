// =============================================================================
// ANISYNC ICON SHIM
// -----------------------------------------------------------------------------
// Re-exports Phosphor Icons under the Lucide-react names already used across
// the codebase, with weight="bold" as the default. This means:
//   import { Trophy, Flame, Music } from '@/utils/icons'
// becomes
//   import { Trophy, Flame, Music } from '@/utils/icons'
// and the SAME JSX (`<Trophy className="w-4 h-4" />`) renders a chunky
// Phosphor bold icon instead of the thin-line Lucide default.
//
// Phosphor bold is visually distinct from Lucide (filled shapes, no thin
// strokes), which kills the "Lucide icons everywhere" AI tell.
//
// To override the weight per-icon: <Trophy weight="duotone" /> still works
// because IconProps is spread through.
//
// MIGRATION: sed-replace `from '@/utils/icons'` → `from '@/utils/icons'`
// across all files; no JSX changes required.
// =============================================================================

import {
  Pulse as PhActivity,
  AirplaneTilt as PhAirplaneTilt,
  Alien as PhAlien,
  Aperture as PhAperture,
  Archive as PhArchive,
  ArrowCounterClockwise as PhArrowCounterClockwise,
  ArrowDown as PhArrowDown,
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  ArrowsDownUp as PhArrowsDownUp,
  ArrowUp as PhArrowUp,
  ArrowUpRight as PhArrowUpRight,
  ArrowsClockwise as PhArrowsClockwise,
  Bell as PhBell,
  Binoculars as PhBinoculars,
  BookOpen as PhBookOpen,
  BookmarkSimple as PhBookmarkSimple,
  Cube as PhBox,
  Broadcast as PhBroadcast,
  Calendar as PhCalendar,
  Camera as PhCamera,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  CaretUp as PhCaretUp,
  ChartBar as PhChartBar,
  ChartPieSlice as PhChartPieSlice,
  ChatCircle as PhChatCircle,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  CircleNotch as PhCircleNotch,
  Clipboard as PhClipboard,
  Clock as PhClock,
  ClockClockwise as PhClockClockwise,
  Code as PhCode,
  Compass as PhCompass,
  Copy as PhCopy,
  Crown as PhCrown,
  Database as PhDatabase,
  DeviceMobile as PhDeviceMobile,
  Disc as PhDisc,
  DotsSixVertical as PhDotsSixVertical,
  DotsThreeVertical as PhDotsThreeVertical,
  DownloadSimple as PhDownloadSimple,
  Eraser as PhEraser,
  Eye as PhEye,
  Fingerprint as PhFingerprint,
  FileText as PhFileText,
  FilmReel as PhFilmReel,
  Fire as PhFire,
  FloppyDisk as PhFloppyDisk,
  FrameCorners as PhFrameCorners,
  Funnel as PhFunnel,
  Gauge as PhGauge,
  Gear as PhGear,
  GitMerge as PhGitMerge,
  Globe as PhGlobe,
  HardDrive as PhHardDrive,
  Heart as PhHeart,
  House as PhHouse,
  Image as PhImage,
  Info as PhInfo,
  InstagramLogo as PhInstagramLogo,
  Key as PhKey,
  Lightning as PhLightning,
  Link as PhLink,
  List as PhList,
  ListChecks as PhListChecks,
  Playlist as PhListMusic,
  Lock as PhLock,
  LockSimple as PhLockSimple,
  MagnifyingGlass as PhMagnifyingGlass,
  MagnifyingGlassPlus as PhMagnifyingGlassPlus,
  Medal as PhMedal,
  Microphone as PhMicrophone,
  MicrophoneStage as PhMicrophoneStage,
  Minus as PhMinus,
  Monitor as PhMonitor,
  MonitorPlay as PhMonitorPlay,
  Mouse as PhMouse,
  MusicNote as PhMusicNote,
  MusicNotes as PhMusicNotes,
  Pause as PhPause,
  Pencil as PhPencil,
  PencilSimple as PhPencilSimple,
  PencilSimpleLine as PhPencilSimpleLine,
  Phone as PhPhone,
  Play as PhPlay,
  Plus as PhPlus,
  PlusCircle as PhPlusCircle,
  Printer as PhPrinter,
  Question as PhQuestion,
  Repeat as PhRepeat,
  Robot as PhRobot,
  Rocket as PhRocket,
  Seal as PhSeal,
  SealCheck as PhSealCheck,
  ShareNetwork as PhShareNetwork,
  Shield as PhShield,
  ShieldWarning as PhShieldWarning,
  ShieldCheck as PhShieldCheck,
  Shuffle as PhShuffle,
  SignOut as PhSignOut,
  SkipBack as PhSkipBack,
  SkipForward as PhSkipForward,
  Sliders as PhSliders,
  SlidersHorizontal as PhSlidersHorizontal,
  Smiley as PhSmile,
  Snowflake as PhSnowflake,
  Sparkle as PhSparkle,
  SpeakerHigh as PhSpeakerHigh,
  SpeakerSlash as PhSpeakerSlash,
  SquaresFour as PhSquaresFour,
  Stack as PhStack,
  Star as PhStar,
  Stamp as PhStamp,
  Table as PhTable,
  Tag as PhTag,
  Television as PhTelevision,
  ArrowsCounterClockwise as PhListRestart,
  Scales as PhScale,
  ThumbsUp as PhThumbsUp,
  Trash as PhTrash,
  TrendDown as PhTrendDown,
  TrendUp as PhTrendUp,
  Trophy as PhTrophy,
  TwitterLogo as PhTwitterLogo,
  User as PhUser,
  UserCircle as PhUserCircle,
  UserCirclePlus as PhUserCirclePlus,
  Users as PhUsers,
  Video as PhVideo,
  VideoCamera as PhVideoCamera,
  Warning as PhWarning,
  WarningCircle as PhWarningCircle,
  MagicWand as PhWand,
  X as PhX,
  XCircle as PhXCircle,
  YoutubeLogo as PhYoutubeLogo,
} from '@phosphor-icons/react'

import { forwardRef, type ComponentProps, type ReactElement } from 'react'

type IconWeight = 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
type PhosphorIconType = React.NamedExoticComponent<ComponentProps<any>>
type LucideCompatProps = {
  className?: string
  size?: number | string
  color?: string
  strokeWidth?: number | string
  weight?: IconWeight
  // Allow arbitrary other props (aria-label, onClick, etc.)
  [key: string]: unknown
}

// withBold wraps a Phosphor icon component and sets weight="bold" by default
// while still allowing per-use override via the `weight` prop.
function withBold(PhIcon: PhosphorIconType) {
  const Wrapped = forwardRef<SVGSVGElement, LucideCompatProps>(
    ({ weight, ...rest }, ref) => {
      return <PhIcon ref={ref as any} weight={(weight as IconWeight) || 'bold'} {...rest} />
    },
  )
  Wrapped.displayName = `Bold(${PhIcon.displayName || 'Icon'})`
  return Wrapped
}

// =============================================================================
// LUCIDE-NAME → PHOSPHOR MAPPINGS
// =============================================================================
// Each Lucide name used in the codebase maps to a Phosphor equivalent wrapped
// in withBold() so it renders chunky bold by default.

export const Activity = withBold(PhActivity)
export const AlertCircle = withBold(PhWarningCircle)
export const AlertTriangle = withBold(PhWarning)
export const Archive = withBold(PhArchive)
export const ArrowDown = withBold(PhArrowDown)
export const ArrowLeft = withBold(PhArrowLeft)
export const ArrowRight = withBold(PhArrowRight)
export const ArrowUp = withBold(PhArrowUp)
export const ArrowUpDown = withBold(PhArrowsDownUp)
export const Award = withBold(PhMedal)
export const BarChart3 = withBold(PhChartBar)
export const BookOpen = withBold(PhBookOpen)
export const Bookmark = withBold(PhBookmarkSimple)
export const BookmarkPlus = withBold(PhBookmarkSimple)
export const Box = withBold(PhBox)
export const Calendar = withBold(PhCalendar)
export const Camera = withBold(PhCamera)
export const Check = withBold(PhCheck)
export const CheckCircle = withBold(PhCheckCircle)
export const CheckCircle2 = withBold(PhCheckCircle)
export const ChevronDown = withBold(PhCaretDown)
export const ChevronLeft = withBold(PhCaretLeft)
export const ChevronRight = withBold(PhCaretRight)
export const ChevronUp = withBold(PhCaretUp)
export const Clipboard = withBold(PhClipboard)
export const Clock = withBold(PhClock)
export const Code = withBold(PhCode)
export const Compass = withBold(PhCompass)
export const Copy = withBold(PhCopy)
export const Crown = withBold(PhCrown)
export const Database = withBold(PhDatabase)
export const Disc = withBold(PhDisc)
export const Download = withBold(PhDownloadSimple)
export const Edit = withBold(PhPencilSimple)
export const Edit3 = withBold(PhPencilSimpleLine)
export const Eraser = withBold(PhEraser)
export const ExternalLink = withBold(PhArrowUpRight)
export const Eye = withBold(PhEye)
export const FileText = withBold(PhFileText)
export const Film = withBold(PhFilmReel)
export const Filter = withBold(PhFunnel)
export const Flame = withBold(PhFire)
export const Globe = withBold(PhGlobe)
export const GripVertical = withBold(PhDotsSixVertical)
export const Heart = withBold(PhHeart)
export const HelpCircle = withBold(PhQuestion)
export const History = withBold(PhClockClockwise)
export const Home = withBold(PhHouse)
export const Image = withBold(PhImage)
export const ImageIcon = withBold(PhImage)
export const Info = withBold(PhInfo)
export const Instagram = withBold(PhInstagramLogo)
export const Key = withBold(PhKey)
export const Layers = withBold(PhStack)
export const LayoutTemplate = withBold(PhSquaresFour)
export const Link = withBold(PhLink)
export const Link2 = withBold(PhLink)
export const LinkIcon = withBold(PhLink)
export const LinkOut = withBold(PhArrowUpRight)
export const ListFilter = withBold(PhFunnel)
export const ListMusic = withBold(PhListMusic)
export const Loader2 = withBold(PhCircleNotch)
export const Lock = withBold(PhLock)
export const LogOut = withBold(PhSignOut)
export const Maximize2 = withBold(PhFrameCorners)
export const MessageSquare = withBold(PhChatCircle)
export const Mic = withBold(PhMicrophone)
export const Minimize2 = withBold(PhFrameCorners)
export const Minus = withBold(PhMinus)
export const Monitor = withBold(PhMonitor)
export const MonitorPlay = withBold(PhMonitorPlay)
export const MoreVertical = withBold(PhDotsThreeVertical)
export const MousePointer2 = withBold(PhMouse)
export const MoveRight = withBold(PhArrowRight)
export const Music = withBold(PhMusicNote)
export const Music2 = withBold(PhMusicNotes)
export const Music4 = withBold(PhMusicNote)
export const Pause = withBold(PhPause)
export const Pencil = withBold(PhPencil)
export const PieChartIcon = withBold(PhChartPieSlice)
export const Play = withBold(PhPlay)
export const Plus = withBold(PhPlus)
export const Radio = withBold(PhBroadcast)
export const RefreshCw = withBold(PhArrowsClockwise)
export const Repeat = withBold(PhRepeat)
export const RotateCcw = withBold(PhArrowCounterClockwise)
export const Save = withBold(PhFloppyDisk)
export const ScanEye = withBold(PhEye)
export const Search = withBold(PhMagnifyingGlass)
export const Send = withBold(PhStamp)
export const Share2 = withBold(PhShareNetwork)
export const Shield = withBold(PhShield)
export const ShieldAlert = withBold(PhShieldWarning)
export const Shuffle = withBold(PhShuffle)
export const SkipBack = withBold(PhSkipBack)
export const SkipForward = withBold(PhSkipForward)
export const Sliders = withBold(PhSliders)
export const SlidersHorizontal = withBold(PhSlidersHorizontal)
export const Smartphone = withBold(PhDeviceMobile)
export const Snowflake = withBold(PhSnowflake)
export const Sparkles = withBold(PhSparkle)
export const Star = withBold(PhStar)
export const Swords = withBold(PhStamp)
export const Table = withBold(PhTable)
export const Tag = withBold(PhTag)
export const Fingerprint = withBold(PhFingerprint)
export const Merge = withBold(PhGitMerge)
export const ListRestart = withBold(PhListRestart)
export const Scale = withBold(PhScale)
export const Settings = withBold(PhGear)
export const ShieldCheck = withBold(PhShieldCheck)
export const Smile = withBold(PhSmile)
export const ThumbsUp = withBold(PhThumbsUp)
export const Trash2 = withBold(PhTrash)
export const TrendingDown = withBold(PhTrendDown)
export const TrendingUp = withBold(PhTrendUp)
export const Trophy = withBold(PhTrophy)
export const Tv = withBold(PhTelevision)
export const Twitter = withBold(PhTwitterLogo)
export const User = withBold(PhUser)
export const UserCircle = withBold(PhUserCircle)
export const UserPlus = withBold(PhUserCirclePlus)
export const UserSearch = withBold(PhMagnifyingGlassPlus)
export const Users = withBold(PhUsers)
export const Video = withBold(PhVideo)
export const Volume2 = withBold(PhSpeakerHigh)
export const VolumeX = withBold(PhSpeakerSlash)
export const Vote = withBold(PhSealCheck)
export const Wand2 = withBold(PhWand)
export const X = withBold(PhX)
export const XCircle = withBold(PhXCircle)
export const Youtube = withBold(PhYoutubeLogo)
export const Zap = withBold(PhLightning)

// Extra exports NOT used in JSX but commonly imported alongside — leave
// unaliased so future imports resolve gracefully.
export {
  PhActivity,
  PhAirplaneTilt,
  PhAlien,
  PhAperture,
  PhArchive,
  PhArrowCounterClockwise,
  PhArrowDown,
  PhArrowLeft,
  PhArrowRight,
  PhArrowsDownUp,
  PhArrowUp,
  PhArrowUpRight,
  PhArrowsClockwise,
  PhBell,
  PhBinoculars,
  PhBookOpen,
  PhBookmarkSimple,
  PhBox,
  PhBroadcast,
  PhCalendar,
  PhCamera,
  PhCaretDown,
  PhCaretLeft,
  PhCaretRight,
  PhCaretUp,
  PhChartBar,
  PhChartPieSlice,
  PhChatCircle,
  PhCheck,
  PhCheckCircle,
  PhCircleNotch,
  PhClipboard,
  PhClock,
  PhClockClockwise,
  PhCode,
  PhCompass,
  PhCopy,
  PhCrown,
  PhDatabase,
  PhDeviceMobile,
  PhDisc,
  PhDotsSixVertical,
  PhDotsThreeVertical,
  PhDownloadSimple,
  PhEraser,
  PhEye,
  PhFileText,
  PhFilmReel,
  PhFire,
  PhFloppyDisk,
  PhFrameCorners,
  PhFunnel,
  PhGauge,
  PhGlobe,
  PhHardDrive,
  PhHeart,
  PhHouse,
  PhImage,
  PhInfo,
  PhInstagramLogo,
  PhKey,
  PhLightning,
  PhLink,
  PhList,
  PhListChecks,
  PhListMusic,
  PhLock,
  PhLockSimple,
  PhMagnifyingGlass,
  PhMagnifyingGlassPlus,
  PhMedal,
  PhMicrophone,
  PhMicrophoneStage,
  PhMinus,
  PhMonitor,
  PhMonitorPlay,
  PhMouse,
  PhMusicNote,
  PhMusicNotes,
  PhPause,
  PhPencil,
  PhPencilSimple,
  PhPencilSimpleLine,
  PhPhone,
  PhPlay,
  PhPlus,
  PhPlusCircle,
  PhPrinter,
  PhQuestion,
  PhRepeat,
  PhRobot,
  PhRocket,
  PhSeal,
  PhSealCheck,
  PhShareNetwork,
  PhShield,
  PhShieldWarning,
  PhShuffle,
  PhSignOut,
  PhSkipBack,
  PhSkipForward,
  PhSliders,
  PhSlidersHorizontal,
  PhSnowflake,
  PhSparkle,
  PhSpeakerHigh,
  PhSpeakerSlash,
  PhSquaresFour,
  PhStack,
  PhStar,
  PhStamp,
  PhTable,
  PhTag,
  PhTelevision,
  PhTrash,
  PhTrendDown,
  PhTrendUp,
  PhTrophy,
  PhTwitterLogo,
  PhUser,
  PhUserCircle,
  PhUserCirclePlus,
  PhUsers,
  PhVideo,
  PhVideoCamera,
  PhWarning,
  PhWarningCircle,
  PhWand,
  PhX,
  PhXCircle,
  PhYoutubeLogo,
}
