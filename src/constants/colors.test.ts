/// <reference types="node" />
// tsconfig.app.json은 브라우저 타입만 켜 두므로 이 테스트 파일에서만 node 타입을 참조한다
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MINT_HEX } from './colors';

// MINT_HEX는 src/index.css :root의 --mint-* 사본이다(카카오 지도 SDK가 CSS 변수를 못 읽어서).
// 원천이 둘이라 어긋날 수 있으니 여기서 잠근다. 실패하면 둘 중 하나를 고쳐 맞출 것.
const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

function rootMintHex(step: string): string {
  const m = css.match(new RegExp(`--mint-${step}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
  if (!m) throw new Error(`index.css :root에 --mint-${step}가 없다`);
  return '#' + m.slice(1, 4).map((n: string) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

describe('MINT_HEX는 index.css :root의 --mint-*와 같아야 한다', () => {
  for (const [step, hex] of Object.entries(MINT_HEX)) {
    it(`--mint-${step} = ${hex}`, () => {
      expect(rootMintHex(step)).toBe(hex);
    });
  }
});
