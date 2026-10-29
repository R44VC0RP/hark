"""Frame helpers for Live Activity captures (needs Pillow).

  frame.py grab <mjpeg-url> <out.png>
      Save the next complete frame of serve-sim's MJPEG stream as PNG.

  frame.py stack <lock.png> <island-min.png> <island-expanded.png> <out.png>
      Crop the three 1206x2622 iPhone 17 Pro frames and stack them vertically:
      Lock Screen y=1812..2272, the top 8.0472921% for the minimized island and
      the top 21% (enough for the expanded island's 160pt maximum). 1206x1222.
"""

import io
import sys
import urllib.request

from PIL import Image


def grab(url: str, out: str) -> None:
    buf = b""
    with urllib.request.urlopen(url, timeout=15) as stream:
        while True:
            chunk = stream.read(65536)
            if not chunk:
                raise SystemExit("stream ended before a full frame")
            buf += chunk
            start = buf.find(b"\xff\xd8")
            end = buf.find(b"\xff\xd9", start + 2) if start >= 0 else -1
            if start >= 0 and end > start:
                Image.open(io.BytesIO(buf[start : end + 2])).convert("RGB").save(out)
                return


def stack(lock: str, island_min: str, island_expanded: str, out: str) -> None:
    frames = [Image.open(p).convert("RGB") for p in (lock, island_min, island_expanded)]
    w, h = frames[0].size
    crops = [
        frames[0].crop((0, round(h * 0.691075515), w, round(h * 0.691075515) + round(h * 0.175438596))),
        frames[1].crop((0, 0, w, round(h * 0.080472921))),
        frames[2].crop((0, 0, w, round(h * 0.21))),
    ]
    sheet = Image.new("RGB", (w, sum(c.size[1] for c in crops)))
    y = 0
    for c in crops:
        sheet.paste(c, (0, y))
        y += c.size[1]
    sheet.save(out)


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    {"grab": grab, "stack": stack}[cmd](*args)
