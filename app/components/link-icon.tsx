import { Globe, Link2, Code2, Camera, BriefcaseBusiness, MessageCircle, Video, Music, Headphones, Mic, PenLine, BookOpen, Mail, CalendarDays, ShoppingBag, Heart, Coffee, FileText, Download, Rocket, Gamepad2, Users, Star, Palette } from 'lucide-react';
import { linkPresets, type LinkIconId, type Platform } from '@/lib/link-options';
const icons = {globe:Globe,link:Link2,code:Code2,camera:Camera,briefcase:BriefcaseBusiness,chat:MessageCircle,video:Video,music:Music,headphones:Headphones,mic:Mic,pen:PenLine,book:BookOpen,mail:Mail,calendar:CalendarDays,'shopping-bag':ShoppingBag,heart:Heart,coffee:Coffee,file:FileText,download:Download,rocket:Rocket,gamepad:Gamepad2,users:Users,star:Star,palette:Palette};
export function LinkIcon({icon,platform='custom',size=20}:{icon?:LinkIconId;platform?:Platform;size?:number}) {
  const Icon = icons[icon ?? linkPresets[platform]?.icon] ?? Link2;
  return <Icon size={size} strokeWidth={2} aria-hidden="true"/>;
}
