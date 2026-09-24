import Icon from '@/components/icons/Icon';

// 예전 이름(IconCalendar 등)으로 쓰던 화면 호환용. 새 코드는 <Icon name="calendar" />를 쓴다.
export interface IconProps {
  className?: string;
  strokeWidth?: number;
}

export function IconCalendar(p: IconProps) { return <Icon name="calendar" {...p} />; }
export function IconCompass(p: IconProps) { return <Icon name="compass" {...p} />; }
export function IconGift(p: IconProps) { return <Icon name="gift" {...p} />; }
export function IconUserCircle(p: IconProps) { return <Icon name="userCircle" {...p} />; }
export function IconMapPin(p: IconProps) { return <Icon name="pin" {...p} />; }
export function IconUtensils(p: IconProps) { return <Icon name="utensils" {...p} />; }
export function IconCup(p: IconProps) { return <Icon name="cup" {...p} />; }
export function IconTag(p: IconProps) { return <Icon name="tag" {...p} />; }
export function IconClock(p: IconProps) { return <Icon name="clock" {...p} />; }
export function IconUsers(p: IconProps) { return <Icon name="users" {...p} />; }
export function IconSparkle(p: IconProps) { return <Icon name="sparkle" {...p} />; }
export function IconCheck(p: IconProps) { return <Icon name="check" {...p} />; }
export function IconBell(p: IconProps) { return <Icon name="bell" {...p} />; }
export function IconFeedback(p: IconProps) { return <Icon name="feedback" {...p} />; }
export function IconChevronDown(p: IconProps) { return <Icon name="chevronDown" {...p} />; }
