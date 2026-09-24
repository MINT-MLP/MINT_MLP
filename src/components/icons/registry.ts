import type { ComponentType, SVGProps } from 'react';
import {
  Armchair, Ban, Banknote, Bookmark, Brain, Briefcase, Bug, Building, Building2, Camera, Car, CircleCheck, CircleHelp,
  ChevronRight, ClipboardList, CloudRain, CloudSun, Clover, Coins, Dices, DoorOpen, Drama, ExternalLink, Filter, Flame, Flower2,
  Footprints, Frown, Gem, Heart, HeartHandshake, House, Inbox, Landmark, Leaf, Lightbulb, Link, Lock, Mail, Mailbox,
  Map, Medal, Megaphone, MessageCircle, Moon, Music, PartyPopper, Pause, PawPrint, PencilLine, Play, RefreshCw, Search,
  ShoppingBag, SlidersHorizontal, Smartphone, Smile, Snowflake, Sparkles, Sprout, Star, Sun, Sunset, ThumbsUp, Ticket,
  TrafficCone, TramFront, TriangleAlert, User, UsersRound, Vote, Wallet, Wine, Wrench, X, Zap, Plus,
} from 'lucide-react';
import * as Drawn from '@/components/icons/drawn';

// 앱 아이콘 등록부 — 화면은 이름으로만 쓴다(<Icon name="pin" />). 디자이너 아이콘이 오면 이 파일만 고친다.
// 앱이 처음부터 쓰던 그림(drawn.tsx)을 우선하고, 없는 것만 lucide(같은 선 스타일)로 채운다.
type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>;

export const ICONS = {
  // 목적
  meal: Drawn.Meal, drink: Drawn.Drink, cafe: Drawn.Cafe, target: Drawn.Target, utensils: Drawn.Utensils, cup: Drawn.Cup, wine: Wine,
  // 사람·관계
  user: User, userCircle: Drawn.UserCircle, users: Drawn.Users, family: UsersRound, heart: Heart, briefcase: Briefcase,
  smile: Smile, thanks: HeartHandshake,
  // 위치·이동
  pin: Drawn.MapPin, compass: Drawn.Compass, map: Map, subway: TramFront, walk: Footprints, car: Car, traffic: TrafficCone,
  // 시간·일정
  clock: Drawn.Clock, calendar: Drawn.Calendar, moon: Moon, bell: Drawn.Bell,
  // 돈·혜택
  wallet: Wallet, banknote: Banknote, coins: Coins, gem: Gem, gift: Drawn.Gift, ticket: Ticket, tag: Drawn.Tag, bag: ShoppingBag,
  // 날씨
  rain: CloudRain, cloudSun: CloudSun, sun: Sun, cold: Snowflake,
  // 분위기·취향
  sparkle: Drawn.Sparkle, sparkles: Sparkles, flame: Flame, music: Music, cozy: Armchair, flower: Flower2, city: Building,
  view: Sunset, home: House, bolt: Zap, door: DoorOpen, paw: PawPrint, thumbsUp: ThumbsUp, star: Star, camera: Camera,
  building: Building2, mask: Drama,
  // 브랜드·상태
  clover: Clover, leaf: Leaf, sprout: Sprout, party: PartyPopper, dice: Dices, medal: Medal, landmark: Landmark, mailbox: Mailbox,
  // 동작
  refresh: RefreshCw, search: Search, link: Link, sliders: SlidersHorizontal, edit: PencilLine, external: ExternalLink,
  check: Drawn.Check, checkCircle: CircleCheck, close: X, plus: Plus, chevronRight: ChevronRight, play: Play, pause: Pause, funnel: Filter, chevronDown: Drawn.ChevronDown,
  // 알림·정보
  feedback: Drawn.Feedback, bulb: Lightbulb, alert: TriangleAlert, help: CircleHelp, ban: Ban, lock: Lock, sad: Frown,
  inbox: Inbox, clipboard: ClipboardList, chat: MessageCircle, mail: Mail, megaphone: Megaphone, brain: Brain,
  phone: Smartphone, bug: Bug, vote: Vote, bookmark: Bookmark, wrench: Wrench,
} satisfies Record<string, SvgIcon>;
