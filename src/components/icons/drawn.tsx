import type { SVGProps } from 'react';

// 직접 그린 아이콘. 24 그리드, stroke currentColor, 둥근 끝. 굵기·크기는 Icon이 넘긴다.
type P = SVGProps<SVGSVGElement>;
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

// 입력 첫 단계의 목적 4종
export const Meal = (p: P) => <svg {...base} {...p}><path d="M4 11h16" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M9 7c0-2 1-3 1-3" /><path d="M14 7c0-2 1-3 1-3" /></svg>;
export const Drink = (p: P) => <svg {...base} {...p}><path d="M7 3h10l-1 9a4 4 0 0 1-8 0z" /><path d="M12 16v5" /><path d="M8 21h8" /></svg>;
export const Cafe = (p: P) => <svg {...base} {...p}><path d="M4 8h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z" /><path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3v2" /><path d="M12 3v2" /></svg>;
export const Target = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" /></svg>;

// 앱 초기부터 쓰던 헤더·기능 아이콘(탭바와 같은 그림)
export const Calendar = (p: P) => <svg {...base} {...p}><rect x="3.5" y="5" width="17" height="15" rx="2.4" /><path d="M8 3.2v3.6M16 3.2v3.6" /><path d="M3.5 10h17" /></svg>;
export const Compass = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="8.6" /><path d="M15.4 8.6 13.5 13.7 8.4 15.6 10.3 10.5Z" /></svg>;
export const Gift = (p: P) => <svg {...base} {...p}><rect x="3.5" y="8.5" width="17" height="4" rx="1.1" /><path d="M12 8.5V21" /><path d="M19 12.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6.5" /><path d="M8.2 8.5a2.6 2.6 0 1 1 0-5.2c2.7 0 3.8 5.2 3.8 5.2" /><path d="M15.8 8.5a2.6 2.6 0 1 0 0-5.2c-2.7 0-3.8 5.2-3.8 5.2" /></svg>;
export const UserCircle = (p: P) => <svg {...base} {...p}><circle cx="12" cy="8.1" r="3.6" /><path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0" /></svg>;
export const MapPin = (p: P) => <svg {...base} {...p}><path d="M12 21C12 21 6 15.8 6 10.6a6 6 0 1 1 12 0C18 15.8 12 21 12 21Z" /><circle cx="12" cy="10.6" r="2.1" /></svg>;
export const Utensils = (p: P) => <svg {...base} {...p}><path d="M8 3v5.5M10.2 3v5.5" /><path d="M9.1 8.5V21" /><path d="M15.8 3c-1.6 0-2.5 2.2-2.5 5s1 4.3 2.5 4.3V21" /></svg>;
export const Cup = (p: P) => <svg {...base} {...p}><path d="M6 9h11l-1 8.5a2 2 0 0 1-2 1.8H9a2 2 0 0 1-2-1.8L6 9Z" /><path d="M17 10.5c2 .2 3 1.6 3 3s-1 2.8-3 3" /><path d="M9.5 6.5c0-1 1-1 1-2" /></svg>;
export const Tag = (p: P) => <svg {...base} {...p}><path d="M11 3.5H20V12.5L12.5 20a1.5 1.5 0 0 1-2.1 0L3.5 13a1.5 1.5 0 0 1 0-2.1Z" /><circle cx="15" cy="7.5" r="1.4" /></svg>;
export const Clock = (p: P) => <svg {...base} {...p}><circle cx="12" cy="12" r="8.6" /><path d="M12 7.5V12l3.4 2.2" /></svg>;
export const Users = (p: P) => <svg {...base} {...p}><circle cx="9" cy="8" r="2.6" /><path d="M3.8 20a5.4 5.4 0 0 1 10.4 0" /><circle cx="16.5" cy="9" r="2" /><path d="M13.5 20a5 5 0 0 1 8.6-3.3" /></svg>;
export const Sparkle = (p: P) => <svg {...base} {...p}><path d="M12 3 13.2 9 19 10.3 13.2 11.6 12 17.6 10.8 11.6 5 10.3 10.8 9Z" /></svg>;
export const Check = (p: P) => <svg {...base} {...p}><path d="M4.5 12.5 9.5 17.5 19.5 6.5" /></svg>;
export const Bell = (p: P) => <svg {...base} {...p}><path d="M6 10.5a6 6 0 0 1 12 0v3.2l1.4 2.3H4.6L6 13.7Z" /><path d="M10.3 18.5a1.9 1.9 0 0 0 3.4 0" /></svg>;
export const Feedback = (p: P) => <svg {...base} {...p}><path d="M7 4.5h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-6L7.2 19.6V16.5H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Z" /><path d="M12 7.3 12.8 9.7 15.2 10.5 12.8 11.3 12 13.7 11.2 11.3 8.8 10.5 11.2 9.7Z" /></svg>;
export const ChevronDown = (p: P) => <svg {...base} {...p}><path d="M6 9 12 15 18 9" /></svg>;
