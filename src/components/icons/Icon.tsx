import type { SVGProps } from 'react';
import { ICONS } from '@/components/icons/registry';
import { cn } from '@/utils/cn';

export type IconName = keyof typeof ICONS;

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** 없으면 1em — 둘러싼 글자 크기(text-lg 등)를 따라간다 */
  size?: number | string;
  /** 있으면 스크린리더가 읽는다. 없으면 장식으로 숨긴다 */
  label?: string;
}

export default function Icon({ name, size = '1em', label, className, strokeWidth = 1.8, ...rest }: Props) {
  const Svg = ICONS[name];
  return (
    <Svg
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={cn('inline-block shrink-0 align-[-0.125em]', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...rest}
    />
  );
}
