import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// bg-course-*는 tailwind.config backgroundImage 키 — 등록하지 않으면 twMerge가 배경색으로 오인해 bg-white/30과 충돌시켜 버린다.
// backgroundImage에 키를 추가하면 여기도 같이.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'bg-image': [{ 'bg-course': ['first', 'second'] }] } },
});

// className prop을 받는 컴포넌트는 cn(base, className). 조건부 클래스는 새 코드부터 점진 적용.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
