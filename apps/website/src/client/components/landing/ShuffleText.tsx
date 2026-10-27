import { useEffect, useRef, useState } from "react";

const GLYPHS = "abcdefghijklmnopqrstuvwxyz";
const DURATION_MS = 720;
/** Each character keeps shuffling for this long after the one before it settles. */
const SETTLE_SPREAD = 0.55;
const FRAME_MS = 45;

interface Cell {
  char: string;
  settled: boolean;
}

function settledCells(text: string): Cell[] {
  return [...text].map((char) => ({ char, settled: true }));
}

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)] as string;
}

/**
 * Shuffles from the previous text to `text`: every position cycles through
 * random letters, then settles on its new character, left to right. Spaces
 * and punctuation settle without shuffling so the words keep their shape.
 * With `instant` (reduced motion, applying `?niche=`), it just swaps.
 */
export function ShuffleText({ text, instant }: { text: string; instant: boolean }) {
  const [cells, setCells] = useState<Cell[]>(() => settledCells(text));
  const from = useRef(text);

  useEffect(() => {
    const previous = from.current;
    from.current = text;
    if (instant || previous === text) {
      setCells(settledCells(text));
      return;
    }
    const length = Math.max(previous.length, text.length);
    const start = performance.now();
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      if (now - last >= FRAME_MS || progress === 1) {
        last = now;
        const next: Cell[] = [];
        for (let index = 0; index < length; index += 1) {
          const target = text[index] ?? "";
          const settleAt = (1 - SETTLE_SPREAD) * (index / length) + SETTLE_SPREAD;
          if (progress >= settleAt || !/[a-z]/i.test(target || (previous[index] ?? ""))) {
            if (target) next.push({ char: target, settled: true });
            else if (progress < settleAt) next.push({ char: " ", settled: false });
          } else {
            next.push({ char: randomGlyph(), settled: false });
          }
        }
        setCells(next);
      }
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, instant]);

  return (
    <span aria-hidden="true" className="hark-shuffle">
      {cells.map((cell, index) => (
        <span
          className={cell.settled ? undefined : "hark-shuffle-glyph"}
          // biome-ignore lint/suspicious/noArrayIndexKey: positions are the identity here.
          key={index}
        >
          {cell.char}
        </span>
      ))}
    </span>
  );
}
