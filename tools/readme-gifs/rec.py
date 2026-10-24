"""Records README GIFs of the Dragon Gear overlay: the real shop page (crates/flav-app/ui) over a clean game
screenshot, fed by the demo Dragon Gear app on 127.0.0.1:7317 (made-up character "Sampleton"), with a drawn
cursor and captions. Usage: python3 rec.py <gear|buy|steps|alerts|still> [out-dir]"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
STAGE = 'http://127.0.0.1:8766/index.html'
APP = 'http://127.0.0.1:7317'
VW, VH = 1456, 818
CROP = (816, 40, 640, 778)  # x, y, w, h: the overlay on the right with the caption beside it


def host(method, path, body):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(APP + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json', 'X-Flav': '1', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b'null')


class Rec:
    def __init__(self, pw, name, opts=None, bg='bg1', video=True):
        self.name, self.dir = name, os.path.join(HERE, 'out', name)
        os.makedirs(self.dir, exist_ok=True)
        for f in os.listdir(self.dir):
            if f.endswith(('.webm', '.png', '.txt')) and self.name != 'still': os.remove(os.path.join(self.dir, f))
        self.browser = pw.chromium.launch()
        kw = {'viewport': {'width': VW, 'height': VH}}
        self.ctx = self.browser.new_context(**kw)
        self.page = self.ctx.new_page()
        self.video = video
        self.frames = []  # (timestamp, png path): lossless screencast frames, so the still background stays still
        if video:
            import base64
            self.cdp = self.ctx.new_cdp_session(self.page)
            def got(e):
                p = os.path.join(self.dir, 'f%05d.png' % len(self.frames))
                with open(p, 'wb') as fh: fh.write(base64.b64decode(e['data']))
                self.frames.append((e['metadata']['timestamp'], p))
                try: self.cdp.send('Page.screencastFrameAck', {'sessionId': e['sessionId']})
                except Exception: pass
            self.cdp.on('Page.screencastFrame', got)
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.expose_function('host', host)
        self.page.add_init_script('window.__opts = ' + json.dumps(opts or {}) + ';')
        self.page.add_init_script(path=os.path.join(HERE, 'fake_host.js'))
        self.t0 = time.time()
        self.page.goto(STAGE)
        if bg != 'bg1': self.page.evaluate(f"document.body.classList.add('{bg}')")
        self.page.wait_for_timeout(1200)
        self.f = self.page.frames[1]
        self.f.evaluate("window.__fire('shown', true)")
        self.page.wait_for_timeout(1500)
        self.x, self.y = 1250, 700
        self.start = None

    def mark(self):
        if self.video:
            self.cdp.send('Page.startScreencast', {'format': 'png', 'everyNthFrame': 1, 'maxWidth': VW, 'maxHeight': VH})
            self.page.wait_for_timeout(300)
        self.start = time.time()
    def wait(self, ms): self.page.wait_for_timeout(ms)
    def cap(self, t='', s=''): self.page.evaluate('([t, s]) => window.__cap(t, s)', [t, s])

    def where(self, sel, nth=0, dx=0.5, dy=0.5):
        box = self.f.locator(sel).nth(nth).bounding_box()
        if not box: raise RuntimeError('not on screen: ' + sel)
        return box['x'] + box['width'] * dx, box['y'] + box['height'] * dy

    def move(self, x, y, steps=18):
        self.page.mouse.move(x, y, steps=steps)  # the stage and the overlay both pass it to the drawn cursor
        self.x, self.y = x, y

    def hover(self, sel, nth=0, dx=0.5, dy=0.5): self.move(*self.where(sel, nth, dx, dy))

    def click(self, sel=None, nth=0, dx=0.5, dy=0.5, at=None):
        if at: self.move(*at)
        elif sel: self.hover(sel, nth, dx, dy)
        self.page.mouse.down(); self.page.wait_for_timeout(90); self.page.mouse.up()

    def scroll(self, dy, steps=12):
        for _ in range(steps):
            self.page.mouse.wheel(0, dy / steps); self.page.wait_for_timeout(30)

    def type(self, text, delay=90): self.page.keyboard.type(text, delay=delay)

    def shot(self, path):
        self.page.screenshot(path=path, clip={'x': CROP[0], 'y': CROP[1], 'width': CROP[2], 'height': CROP[3]})

    def finish(self, out_w=640, fps=12, colors=160):
        if self.video:
            self.cdp.send('Page.stopScreencast'); self.page.wait_for_timeout(300)
        self.ctx.close(); self.browser.close()
        if self.errors: print('PAGE ERRORS', self.errors)
        if not self.video or not self.frames: return
        end = time.time() - self.start + self.frames[0][0]  # hold the last frame until the script ended
        lst = os.path.join(self.dir, 'frames.txt')
        with open(lst, 'w') as fh:
            for k, (t, p) in enumerate(self.frames):
                nxt = self.frames[k + 1][0] if k + 1 < len(self.frames) else max(t + 0.5, end)
                fh.write(f"file '{p}'\nduration {max(0.001, nxt - t):.4f}\n")
            fh.write(f"file '{self.frames[-1][1]}'\n")
        out = os.path.join(HERE, 'out', self.name + '.gif')
        x, y, w, h = CROP
        vf = f'crop={w}:{h}:{x}:{y},fps={fps},scale={out_w}:-1:flags=lanczos'
        pal = os.path.join(self.dir, 'palette.png')
        src = ['-f', 'concat', '-safe', '0', '-i', lst]
        subprocess.run(['ffmpeg', '-y', '-v', 'error', *src, '-vf', vf + f',palettegen=max_colors={colors}:stats_mode=full', pal], check=True)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', *src, '-i', pal, '-lavfi', vf + ' [v]; [v][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', out], check=True)
        print(out, round(os.path.getsize(out) / 1e6, 2), 'MB', len(self.frames), 'frames')


def still(pw):
    for view in ['gear', 'buy', 'steps', 'alerts']:
        r = Rec(pw, 'still', {'shop-view': view}, video=False)
        r.shot(os.path.join(r.dir, view + '.png'))
        print(view, 'errors', r.errors, 'calls', r.f.evaluate('window.__calls'))
        r.finish()


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'still'
    with sync_playwright() as pw:
        if what == 'still': still(pw)
        else:
            import scenes
            getattr(scenes, what)(pw, Rec)
