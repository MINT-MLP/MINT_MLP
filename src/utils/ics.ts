// 오늘 날짜 all-day 일정(.ics) 다운로드 — 모임 시각은 데이터에 없어 시간 없는 종일 일정으로.
export function downloadMeetingIcs(placeName: string, address: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MINT//KO', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${Date.now()}@mint`, `DTSTAMP:${day}T000000Z`,
    `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${day}`,
    `SUMMARY:${esc(`🍀 MINT 모임 · ${placeName}`)}`,
    `LOCATION:${esc(address)}`, `DESCRIPTION:${esc('MINT에서 다같이 정한 모임 장소예요.')}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mint-모임.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
