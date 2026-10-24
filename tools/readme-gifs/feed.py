"""Made-up game data for the README GIFs, posted to a demo Dragon Gear app the way Flav-Toolkit hands it over.
Character: Sampleton, a Ranger on Fregion (EU). Nothing here comes from a real session."""
import json, sys, time, urllib.request

BASE = 'http://127.0.0.1:7317'
SRV = 11307  # the Kina Exchange's market id for the made-up server


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'X-Flav': '1', 'Host': '127.0.0.1:7317'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b'{}')


def me():
    now = int(time.time() * 1000)
    post('/api/me', {'type': 'my_profile', 'at_ms': now, 'name': 'Sampleton', 'class': 'Ranger', 'level': 45})
    post('/api/me', {'type': 'my_server', 'at_ms': now, 'server': 1307})


def inventory():
    s = lambda item, count, container, slot, **kw: {'item': item, 'count': count, 'container': container, 'slot': slot, **kw}
    post('/api/inventory', {'type': 'inventory', 'kind': 'list', 'at': int(time.time()), 'stacks': [
        s(930100031, 21_450_000, 'bag', 1),          # Kina
        s(610530001, 230, 'bag', 12),                # Refining Stone: covers the 159 needed
        s(610710001, 80, 'bag', 13),                 # Orichalcum Ingot: covers it
        s(610610013, 34, 'bag', 14),                 # Odyle: part of 80
        s(610610014, 20, 'storage', 40),             # Fine Odyle: part of 56
        s(110430097, 1, 'equipped', 216, worn='main-hand', level=12),
        s(115030093, 1, 'equipped', 13, worn='sub-hand', level=10),
        s(310130015, 1, 'equipped', 365, worn='necklace', level=8),
        s(310330113, 1, 'equipped', 335, worn='ring-1', level=11),
    ]})


def listing(i, item, qty, unit):
    return {'id': f'demo-{item}-{i}', 'item': item, 'quantity': qty, 'unit_price': unit, 'sale_price': qty * unit,
            'currency': 'kina', 'expires': '2026-11-01T00:00:00Z', 'is_set_item': False, 'conditions': [], 'details': None}


LADDERS = {
    610720011: [(40, 9_800), (60, 10_100), (80, 10_400), (100, 11_200)],            # Strong Leather
    610530005: [(10, 79_000), (20, 82_000), (15, 88_000), (30, 96_000)],            # Expert's Refining Stone
    610530008: [(3, 365_000), (5, 380_000), (4, 410_000)],                          # Artisan's Refining Stone
    210550014: [(4, 61_000), (3, 68_000), (2, 74_000), (5, 125_000), (6, 131_000)],  # Splendent Orichalcum Gloves
}
SUMMARY = {
    610511013: (2_380_000, 41), 610530008: (365_000, 12), 610530005: (79_000, 75), 610720011: (9_800, 280),
    610610016: (430_000, 18), 610710009: (76_000, 64), 610620016: (168_000, 22), 610530010: (124_000, 30),
    610620015: (21_000, 140), 610610015: (21_500, 160), 610530001: (1_040, 900), 610610013: (1_690, 610),
    610610014: (1_930, 450), 610710001: (980, 700), 210550014: (61_000, 20), 210540012: (690_000, 3),
}


def exchange(wrathful=None):
    rows = [{'item': k, 'min_unit_price': v[0], 'sale_count': v[1]} for k, v in SUMMARY.items()]
    if wrathful:
        rows = [r if r['item'] != 610511013 else {**r, 'min_unit_price': wrathful} for r in rows]
    post('/api/market', {'type': 'market-summary', 'at': int(time.time()), 'server': SRV, 'rows': rows})
    for item, lad in LADDERS.items():
        post('/api/market', {'type': 'market-listings', 'at': int(time.time()), 'server': SRV, 'items': [item],
                             'sort': 'UnitPrice ASC', 'page': 1, 'has_next_page': False,
                             'listings': [listing(i, item, q, u) for i, (q, u) in enumerate(lad)]})


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('all', 'me'): me()
    if what in ('all', 'inv'): inventory()
    if what in ('all', 'ex'): exchange()
    if what == 'cheap': exchange(wrathful=int(sys.argv[2]))
    print('fed', what)
