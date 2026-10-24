"""The four README GIFs, one feature each. Each starts from the same demo state (reset.sh)."""
import os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


def reset():
    subprocess.run([os.path.join(HERE, 'reset.sh')], check=True, stdout=subprocess.DEVNULL)


def scroll_to(r, sel, nth=0, pad=8):
    """Smooth-scrolls the overlay's list so that element is near the top."""
    r.f.evaluate("""([sel, nth, pad]) => { const l = document.getElementById('list'); const e = document.querySelectorAll(sel)[nth];
        if (e) l.scrollTo({ top: e.getBoundingClientRect().top - l.getBoundingClientRect().top + l.scrollTop - pad, behavior: 'smooth' }); }""", [sel, nth, pad])
    r.wait(900)


def scroll_top(r):
    r.f.evaluate("document.getElementById('list').scrollTo({ top: 0, behavior: 'smooth' })"); r.wait(800)


def gear(pw, Rec):
    reset()
    r = Rec(pw, 'gear', {'shop-view': 'gear'})
    r.move(*r.where('#list', dx=0.55, dy=0.75), steps=1)
    r.mark()
    r.cap('Your gear, read from the game', 'Each slot shows the tier you wear, its enchant, and what the tiers ahead cost.')
    r.wait(2600)
    r.hover('.gear .bars i', nth=4)  # the Bow's T5: what it costs
    r.wait(2200)
    r.cap('Click a bar to set what you own', 'For a piece you have but don\'t wear. The plan and its cost follow at once.')
    r.wait(800)
    r.click('.gear .bars i', nth=12)  # Helm: T1 owned
    r.wait(700)
    r.move(r.x + 200, r.y + 70)
    r.wait(1700)
    r.cap('Every slot, and the market\'s mood', 'Weapons, armor, accessories: cheap now, normal or pricey against the usual price.')
    scroll_to(r, '.group', 2)
    r.wait(2600)
    scroll_top(r)
    r.cap('Click a piece to shop for it', 'It opens the shopping list for that piece.')
    r.wait(900)
    r.click('.gear .pic', nth=3)  # Pauldrons: its picture opens its list
    r.wait(2600)
    r.cap(); r.wait(900)
    r.finish()


def buy(pw, Rec):
    reset()
    r = Rec(pw, 'buy', {'shop-view': 'buy'})
    r.move(1446, 640, steps=1)
    r.mark()
    r.cap('The shopping list', 'Everything the pieces you pick still need, priced from the Market as the game shows it to you.')
    r.wait(2600)
    r.cap('How to get the Kina', 'How many Quna packs to buy, then which Kina Chests, at or under these prices.')
    r.move(*r.where('text=START'))
    r.wait(3000)
    r.move(1446, 600)
    scroll_to(r, '.row', 0)
    r.cap('Exact buys', 'Whole listings, cheapest first, and the most to pay for each.')
    r.wait(3000)
    scroll_to(r, '.row.owned', 0, pad=160)
    r.cap('What you already have', 'Your bag and storage cover these lines: nothing to buy.')
    r.wait(3000)
    scroll_top(r)
    r.cap('Pick more pieces', 'Ctrl+click adds a piece; "All" plans the whole set.')
    r.wait(700)
    r.page.keyboard.down('Control')
    r.click('.chips .chip:has-text("Helm")')
    r.page.keyboard.up('Control')
    r.wait(2600)
    r.cap(); r.wait(900)
    r.finish()


def steps(pw, Rec):
    reset()
    r = Rec(pw, 'steps', {'shop-view': 'steps'})
    r.move(1446, 640, steps=1)
    r.mark()
    r.cap('Step by step', 'Get the Kina, then each craft in order, with its cost.')
    r.wait(2800)
    r.cap('Tick as you go', 'Click the circle when a step is done. The ticks stay until you change the plan.')
    r.wait(700)
    r.click('.step .tickbox', nth=0)
    r.wait(2000)
    r.move(1446, 600)
    scroll_to(r, '.step', 1, pad=4)
    r.cap('Buy some, craft the rest', 'When the Market beats crafting, the step says how many to buy and the most to pay.')
    r.wait(3400)
    r.cap('Click a name to copy it', 'Then paste it in the Exchange search.')
    r.click('.step', nth=1, dx=0.45, dy=0.08)  # open its details
    r.wait(900)
    scroll_to(r, '.step.open .det', 0, pad=10)
    r.click('.step.open .det .cp-name', nth=0)
    r.wait(2400)
    r.cap('Done: tick it', 'Done steps dim, so the next one stands out.')
    scroll_to(r, '.step.open', 0, pad=4)
    r.click('.step.open .tickbox')
    r.wait(2000)
    r.cap(); r.wait(900)
    r.finish()


def alerts(pw, Rec):
    reset()
    r = Rec(pw, 'alerts', {'shop-view': 'alerts'})
    r.f.wait_for_selector('.aform input[type=text]')  # the form draws once the list has loaded
    r.wait(800)
    r.move(*r.where('#list', dx=0.6, dy=0.8), steps=1)
    r.mark()
    r.cap('Price alerts', 'Tell it what to watch on the Market.')
    r.wait(2200)
    r.click('.aform input[type=text]')
    r.wait(300)
    r.type('wrathful mind', 100)
    r.wait(1100)
    r.click('.ares .ar', nth=0)
    r.wait(1000)
    r.cap('Buy at or under a price', 'It suggests 10 % under the price now.')
    r.wait(1800)
    r.click('.aval input', dx=0.5)
    r.page.keyboard.press('Control+A')
    r.type('2200000', 70)
    r.wait(600)
    r.click('.aval .sbtn')
    r.wait(400)
    r.move(1446, 690)
    r.wait(1800)
    r.cap('The price drops in game', 'The alert turns to "now", and Flav\u2011Toolkit shows you a note.')
    subprocess.run(['python3', os.path.join(HERE, 'feed.py'), 'cheap', '2140000'], check=True, stdout=subprocess.DEVNULL)
    r.f.evaluate("window.__fire('hotkey', 'refresh')")
    r.wait(3400)
    r.cap(); r.wait(900)
    r.finish()
