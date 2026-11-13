import json, re, sys
sys.path.insert(0, __import__('os').path.dirname(__file__))
from selection_requests import REQUESTS

SRC = r'D:\POLARIS\desktop\host\core\src\p03\specialists'
ORDER = ['software','web-mobile','data-ai','security','infrastructure','finance','business','marketing-sales','legal','health','education','writing','design-media','research','engineering','science-math','people-operations','product-project','languages','everyday']
agents = []
for d in ORDER:
    f = json.load(open(f'{SRC}\\{d}.json', encoding='utf-8'))
    for s in f['specialists']:
        agents.append({'id': f'{d}.{s["slug"]}', 'domain': d, 'slug': s['slug'], 'text': ' '.join([s['name_en'], s['summary_en'], ' '.join(k for k in s['keywords'] if k.isascii()), ' '.join(s['checks'])])})
assert len(agents) == 300 and len(REQUESTS) == 300, (len(agents), len(REQUESTS))

def arabic(t):
    return any('\u0600' <= c <= '\u06ff' for c in t)

problems = []
for i, (a, r) in enumerate(zip(agents, REQUESTS)):
    low = r.lower()
    if a['slug'] in low or ('agent.' + a['id']) in low or 'outputs/agents' in low:
        problems.append(f'{i} {a["id"]}: names the agent')
ar = sum(1 for r in REQUESTS if arabic(r))
if not 120 <= ar <= 180:
    problems.append(f'language balance: {ar} Arabic of 300')
if problems:
    print('\n'.join(problems)); sys.exit(1)

STOP = set('the and for with from that this your into about have what when which they will each such than them their there also only other then these those would could should every without within before after under over more most less very'.split())
def toks(t):
    return {w for w in re.findall(r'[a-z]+', t.lower()) if len(w) >= 4 and w not in STOP}
sets = [toks(a['text']) for a in agents]
def jac(x, y):
    return len(x & y) / len(x | y) if x | y else 0.0

from deictic import material

# eval/2.1: مادة اصطناعية لكل طلب يشير إلى ما عند المستخدم (القاعدة الآلية في deictic.py)، بلغة الطلب.
def attachment(kind, ar):
    nl = chr(10)
    if kind == 'data':
        rows = ['month,region,value'] + [f'2026-{m:02d},{r},{(m * 137 + len(r) * 53) % 900 + 300}' for m in range(1, 7) for r in ('Riyadh', 'Jeddah')]
        return 'data.csv', nl.join(['Nakheel Labs (synthetic)'] + rows) + nl
    if kind == 'financials':
        rows = ['item,2023,2024,2025', 'revenue,4200000,5100000,5900000', 'cost_of_sales,2500000,2950000,3300000', 'operating_expenses,1100000,1300000,1500000', 'net_income,450000,640000,820000', 'current_assets,1800000,2100000,2600000', 'current_liabilities,1200000,1250000,1400000', 'total_equity,3000000,3500000,4100000']
        return 'financial_statements.csv', nl.join(['Nakheel Labs (synthetic) financial statements, SAR'] + rows) + nl
    if kind == 'survey':
        rows = ['respondent,group,satisfaction_1_to_5,would_recommend'] + [f'r{i:02d},{"A" if i % 2 else "B"},{(i * 7) % 5 + 1},{"yes" if (i * 3) % 4 else "no"}' for i in range(1, 21)]
        return 'survey_results.csv', nl.join(['Nakheel Labs (synthetic) customer survey results'] + rows) + nl
    if kind == 'logs':
        lines = [f'2026-10-0{d}T0{h}:1{d}:00Z auth {"FAIL" if (d + h) % 3 else "OK"} user=u{d}{h} src=10.0.{d}.{h}' for d in range(1, 5) for h in range(1, 4)]
        return 'events.log', nl.join(lines) + nl
    if kind == 'contract':
        if ar:
            clauses = ['عقد اصطناعي لشركة نخيل لابز.', 'البند 1: مدة العقد سنة تتجدد تلقائيًا.', 'البند 2: يدفع الطرف الثاني غرامة 20% عن أي تأخير.', 'البند 3: يحق للطرف الأول الإنهاء دون إشعار.', 'البند 4: النزاعات تُحال إلى محكمة يختارها الطرف الأول.']
        else:
            clauses = ['Synthetic agreement for Nakheel Labs.', 'Clause 1: The term is one year and renews automatically.', 'Clause 2: The second party pays a 20% penalty for any delay.', 'Clause 3: The first party may terminate without notice.', 'Clause 4: Disputes go to a court chosen by the first party.']
        return 'contract.txt', nl.join(clauses) + nl
    if kind == 'code':
        code = ['# Synthetic code for Nakheel Labs', 'import sqlite3', '', 'def find_user(conn, name):', "    query = \"SELECT * FROM users WHERE name = '\" + name + \"'\"",'    return conn.execute(query).fetchall()', '', 'def total(items):', '    t = 0', '    for i in range(len(items)):', '        t = t + items[i]["price"] * items[i]["qty"]', '    return t']
        return 'code.py', nl.join(code) + nl
    if ar:
        return 'text.txt', 'نص اصطناعي من شركة نخيل لابز. نحن شركه ناشئه تعمل في مجال التقنيه الزراعيه منذ عام 2024، ونقدم حلول ري ذكيه للمزارع الصغيره. نريد التوسع في المنطقه الشرقيه خلال العام القادم مع الحفاظ على جوده الخدمه.' + nl
    return 'text.txt', 'Synthetic text from Nakheel Labs. We are a young company working in agricultural technology since 2024, and we offer smart irrigation for small farms. We want to expand to the Eastern Province next year while keeping service quality high.' + nl

out = []
for i, a in enumerate(agents):
    sims = sorted(((jac(sets[i], sets[j]), j) for j in range(300) if j != i), reverse=True)
    acceptable = ['agent.' + a['id'], 'agent.' + agents[sims[0][1]]['id']]
    if sims[1][0] >= 0.12:
        acceptable.append('agent.' + agents[sims[1][1]]['id'])
    request = REQUESTS[i]
    entry = {'agent_id': 'agent.' + a['id'], 'language': 'ar' if arabic(request) else 'en', 'request': request, 'acceptable': acceptable}
    kind = material(request)
    if kind:
        name, content = attachment(kind, arabic(request))
        path = f'inputs/attachments/{name}'
        entry['request'] = request + (f' الملف مرفق في {path}.' if arabic(request) else f' The file is attached at {path}.')
        entry['attachment'] = {'path': path, 'content': content, 'material': kind}
    out.append(entry)

doc = {
    'suite': 'agents-300-eval/2.2/selection',
    'note': 'Synthetic natural requests, one per agent, written from each agent\'s responsibility without its id, slug or deliverable path. The first acceptable agent is the expected one; the others are the closest agents by Jaccard similarity of their definitions (name, summary, English keywords, checks), computed before any run. Frozen with the suite digest. 2.1: requests that point at material the user has (rule in deictic.py, applied to all 300) carry a synthetic attachment named in the request; 2.2: financial statements and survey results get matching attachments.',
    'cases': out,
}
open(r'D:\POLARIS\desktop\host\core\src\p03\agents\eval2_selection.json', 'w', encoding='utf-8', newline='\n').write(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
sizes = {}
for c in out:
    sizes[len(c['acceptable'])] = sizes.get(len(c['acceptable']), 0) + 1
print('ok', sizes, 'attachments', sum(1 for c in out if 'attachment' in c))
for c in out[:4] + out[120:122]:
    print(c['agent_id'], c['acceptable'][1:])
