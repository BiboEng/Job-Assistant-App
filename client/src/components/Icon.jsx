import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Briefcase,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  ClipboardList,
  Clock,
  Download,
  FileText,
  Filter,
  House,
  Lock,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Maximize2,
  MessageSquare,
  Mic,
  Minimize2,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  SkipForward,
  Sparkles,
  Square,
  Sun,
  Target,
  Trash2,
  TrendingUp,
  Undo2,
  Upload,
  Video,
  VideoOff,
  X,
} from "lucide-react";

/**
 * The app's icon set: lucide-react, behind one name → component map.
 *
 * Every icon renders at 16px with a 1.5 stroke, whatever the call site asks
 * for — one size and one weight is what makes a set read as a set. `size` is
 * still accepted so existing call sites don't need touching, but it's ignored.
 * Icons are decorative by default (`aria-hidden`); pass `title` only when the
 * icon is the *only* content of a control with no other accessible name.
 *
 * No emoji anywhere in the chrome: they render at a different weight, size and
 * colour on every platform.
 */

const SIZE = 16;
const STROKE = 1.5;

// lucide 1.x dropped brand marks, so GitHub is the one hand-drawn path. It
// uses the same 24-unit grid and stroke so it sits in the set.
function Github(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

const ICONS = {
  mic: Mic,
  video: Video,
  videoOff: VideoOff,
  trash: Trash2,
  clock: Clock,
  check: Check,
  x: X,
  plus: Plus,
  arrowLeft: ArrowLeft,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  arrowUpRight: ArrowUpRight,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronsUpDown: ChevronsUpDown,
  download: Download,
  upload: Upload,
  expand: Maximize2,
  collapse: Minimize2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  home: House,
  messageSquare: MessageSquare,
  briefcase: Briefcase,
  fileText: FileText,
  clipboard: ClipboardList,
  sparkles: Sparkles,
  trendingUp: TrendingUp,
  target: Target,
  alert: CircleAlert,
  refresh: RefreshCw,
  undo: Undo2,
  printer: Printer,
  stop: Square,
  send: Send,
  skipForward: SkipForward,
  mapPin: MapPin,
  filter: Filter,
  search: Search,
  logIn: LogIn,
  logOut: LogOut,
  mail: Mail,
  github: Github,
  play: Play,
  lock: Lock,
  panelClose: PanelLeftClose,
  panelOpen: PanelLeftOpen,
};

export const ICON_NAMES = Object.keys(ICONS);

// eslint-disable-next-line no-unused-vars
export default function Icon({ name, size, title, className = "" }) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;

  return (
    <Glyph
      className={className}
      width={SIZE}
      height={SIZE}
      strokeWidth={STROKE}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
      style={{ flexShrink: 0, display: "block" }}
    >
      {title && <title>{title}</title>}
    </Glyph>
  );
}
