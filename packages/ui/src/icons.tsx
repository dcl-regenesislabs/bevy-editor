// Icon set: lucide-react, one size and stroke everywhere.
import {
  MousePointer2,
  Move,
  RotateCw,
  Scaling,
  Play,
  Pause,
  StepForward,
  Square,
  MoreHorizontal,
  Plus,
  FolderDown,
  FolderOpen,
  FolderPlus,
  Ghost,
  FolderUp,
  Trash2,
  PanelLeft,
  PanelRight,
  Video,
  Pencil,
  Undo2,
  Redo2,
  Code2,
  RefreshCw,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Grid3x3,
  Volume2,
  VolumeOff,
  Box,
  CodeXml,
  Lightbulb,
  MonitorPlay,
  Type,
  PersonStanding,
  Table2,
  Bot,
  AppWindow,
  Boxes,
  SquareDashed,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Settings,
  Monitor,
  Smartphone,
  type LucideIcon
} from 'lucide-react'

// Both numbers are chosen for the pixel grid, not for taste. `absoluteStrokeWidth`
// makes strokeWidth a CSS-pixel measure, so 2 lands on whole pixels where 1.8 was
// smeared across two on any 1x display. lucide draws on a 24-unit viewBox, so the
// box size decides where the paths themselves land: at 16 a unit is 2/3 px and the
// centre lines (x=12) resolve exactly, where 15 put them on 7.5px. Only a size of
// 24 aligns every coordinate, which is far too big here — 16/2 is the crispest
// this gets at editor scale.
const ICON = { size: 16, strokeWidth: 2, absoluteStrokeWidth: true }

const wrap = (C: LucideIcon) => {
  const Icon = (): JSX.Element => <C {...ICON} />
  return Icon
}

export const IconSelect = wrap(MousePointer2)
export const IconMove = wrap(Move)
export const IconRotate = wrap(RotateCw)
export const IconScale = wrap(Scaling)
export const IconPlay = wrap(Play)
export const IconPause = wrap(Pause)
export const IconStep = wrap(StepForward)
export const IconStop = wrap(Square)
// VolumeOff is the speaker with the diagonal bar through it (VolumeX is the
// speaker with a ✕, which reads as "no audio device" rather than "muted").
export const IconSound = wrap(Volume2)
export const IconSoundMuted = wrap(VolumeOff)
export const IconDots = wrap(MoreHorizontal)
export const IconPlus = wrap(Plus)
export const IconImport = wrap(FolderDown)
export const IconExport = wrap(FolderUp)
export const IconTrash = wrap(Trash2)
export const IconDesktop = wrap(Monitor)
export const IconMobile = wrap(Smartphone)
export const IconSidebarLeft = wrap(PanelLeft)
export const IconSidebarRight = wrap(PanelRight)
export const IconCamera = wrap(Video)
export const IconEdit = wrap(Pencil)
export const IconUndo = wrap(Undo2)
export const IconRedo = wrap(Redo2)
export const IconCode = wrap(Code2)
export const IconBot = wrap(Bot)
export const IconSceneUi = wrap(AppWindow)
export const IconLock = wrap(Lock)
export const IconUnlock = wrap(Unlock)
export const IconEye = wrap(Eye)
export const IconEyeOff = wrap(EyeOff)
export const IconGrid = wrap(Grid3x3)
export const IconTable = wrap(Table2)
export const IconRefresh = wrap(RefreshCw)
export const IconFolder = wrap(FolderOpen)
export const IconFolderPlus = wrap(FolderPlus)
export const IconGhost = wrap(Ghost)
export const IconPrefab = wrap(Boxes)
export const IconWarn = wrap(AlertTriangle)
export const IconZone = wrap(SquareDashed)

// Hierarchy row kinds (entityIcon in @scene/entity-kind). One glyph per bucket,
// and the fallback is deliberately the emptiest shape in the set: an unknown row
// should read as "not one of the above", not as a thing of its own.
export const KIND_ICONS = {
  model: wrap(Box),
  sound: wrap(Volume2),
  // MonitorPlay, not Video: the toolbar's camera button is already the camcorder,
  // and a screen playing something is what a VideoPlayer actually is in a scene
  video: wrap(MonitorPlay),
  text: wrap(Type),
  // PersonStanding reads as a figure in the world; User reads as an account
  avatar: wrap(PersonStanding),
  script: wrap(CodeXml),
  light: wrap(Lightbulb),
  other: wrap(SquareDashed)
} as const
export const IconArrowUp = wrap(ArrowUp)
export const IconArrowDown = wrap(ArrowDown)
export const IconChevron = wrap(ChevronDown)
export const IconGear = wrap(Settings)
