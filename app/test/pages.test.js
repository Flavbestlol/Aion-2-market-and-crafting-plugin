'use strict';
/* Every page's own script must at least parse: a single stray quote stops a page before its first line runs, and the
   browser page then shows "Loading prices…" for ever (0.15.0 to 0.16.3: "isn't" inside a quoted string). Each inline
   <script> of every page in app/ui, and every .js the pages load from there, is compiled here (not run). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');

const UI = path.join(__dirname, '..', 'ui');

test('every page script in app/ui parses', () => {
  let n = 0;
  for (const f of fs.readdirSync(UI)) {
    const file = path.join(UI, f);
    if (f.endsWith('.js')) { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: f }); n++; continue; }
    if (!f.endsWith('.html')) continue;
    const html = fs.readFileSync(file, 'utf8');
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m, i = 0;
    while ((m = re.exec(html))) {
      i++;
      assert.doesNotThrow(() => new vm.Script(m[1], { filename: `${f} script ${i}` }), `${f}, inline script ${i}`);
      n++;
    }
  }
  assert.ok(n >= 3, `found ${n} scripts`);
});
