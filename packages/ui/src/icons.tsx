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
  Trash2,
  PanelLeft,
  PanelRight,
  Video,
  Pencil,
  Undo2,
  Redo2,
  type LucideIcon
} from 'lucide-react'

const ICON = { size: 15, strokeWidth: 1.8, absoluteStrokeWidth: true }

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
export const IconDots = wrap(MoreHorizontal)
export const IconPlus = wrap(Plus)
export const IconImport = wrap(FolderDown)
export const IconTrash = wrap(Trash2)
export const IconSidebarLeft = wrap(PanelLeft)
export const IconSidebarRight = wrap(PanelRight)
export const IconCamera = wrap(Video)
export const IconEdit = wrap(Pencil)
export const IconUndo = wrap(Undo2)
export const IconRedo = wrap(Redo2)
