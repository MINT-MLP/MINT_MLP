import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind.config의 backgroundImage 키(bg-course-*)를 배경 '이미지' 그룹으로 등록한다.
// 등록하지 않으면 twMerge가 bg-course-first를 배경색으로 오인해 bg-white/30 같은 색 클래스와 충돌시켜 조용히 버린다.
// tailwind.config.js backgroundImage에 키를 추가하면 여기도 같이 추가할 것.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'bg-image': [{ 'bg-course': ['first', 'second'] }] } },
});

// className 합치기. clsx가 조건부(falsy 제거·배열·객체)를 정리하고 twMerge가 충돌(p-4 vs p-2)을 뒤에 온 쪽으로 푼다.
// 적용 범위: className prop을 받는 컴포넌트는 반드시 cn(base, className). 조건부 클래스는 새 코드와
// 손대는 파일부터 점진 적용하고, 기존 템플릿 리터럴(2026-09-18 기준 133곳)은 일괄 변환하지 않는다.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
