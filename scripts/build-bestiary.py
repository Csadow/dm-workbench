#!/usr/bin/env python3
"""Rebuild the bundled catalogue from the official SRD 5.2.1 PDF (requires pdftotext).
Usage: python scripts/build-bestiary.py /path/to/SRD_CC_v5.2.1.pdf
The runtime application does not need Python, the PDF, or an Internet connection.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

SOURCE = 'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf'
ATTRIBUTION = 'This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.'
pdf = Path(sys.argv[1])
raw = subprocess.check_output(['pdftotext', '-raw', str(pdf), '-'], text=True)
raw = raw[raw.index('Monsters A–Z\nAboleth', raw.index('Recharge after a Short or Long Rest.')):]
lines, page = [], 258
for line in raw.replace('\f', '\n').splitlines():
    match = re.match(r'(\d+) System Reference Document 5.2.1', line)
    if match:
        page = int(match[1])
    elif line.strip():
        lines.append((line.strip().replace('−', '-').replace('\u00ad', ''), page))
starts = []
for i, (line, _) in enumerate(lines):
    if re.match(r'AC \d', line):
        size = next(j for j in range(i-1, max(i-5,0), -1) if re.match(r'^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b', lines[j][0]))
        starts.append(size-1)
assert len(starts) == 330, 'Source layout or catalogue count changed; review the extraction.'
monsters = []
for index, start in enumerate(starts):
    end = starts[index + 1] if index + 1 < len(starts) else len(lines)
    block = [line for line, _ in lines[start:end]]
    # The PDF prints a section heading before some stat blocks. Exclude it from
    # the preceding creature; action/spell lines contain punctuation or digits.
    if re.fullmatch(r'[A-Z][A-Za-z ’–-]+', block[-1]):
        block.pop()
    name = block[0]
    ac_index = next(i for i, line in enumerate(block) if line.startswith('AC '))
    description = ' '.join(block[1:ac_index])
    text = '\n'.join(block)
    ac, initiative = re.search(r'AC (\d+)\s+Initiative ([+-]\d+)', text).groups()
    hp = re.search(r'^HP (\d+)', text, re.M)[1]
    speed = re.search(r'^Speed (.+)', text, re.M)[1]
    cr = re.search(r'^CR (\d+(?:/\d+)?) ', text, re.M)[1]
    creature_type = re.search(r'\b(Aberration|Beast|Celestial|Construct|Dragon|Elemental|Fey|Fiend|Giant|Humanoid|Monstrosity|Ooze|Plant|Undead)s?\b', description)[1]
    # Preserve complete stat blocks in English; only repair extraction line wraps.
    text = re.sub(r'(?<=[a-z])-\n(?=[a-z])', '', text)
    text = re.sub(r'\b(Str|Dex|Con|Int|Wis|Cha)(\d)', r'\1 \2', text)
    monsters.append(dict(id=re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'), name=name,
                         description=description, type=creature_type, cr=cr, ac=int(ac),
                         hp=int(hp), initiativeBonus=int(initiative), speed=speed,
                         page=lines[start][1], text=text))
assert len({m['id'] for m in monsters}) == len(monsters)
assert all(len(m['text']) > 150 for m in monsters)
assert [m['name'] for m in monsters if 'Actions\n' not in m['text']] == ['Shrieker Fungus']
output = dict(version='5.2.1', source=SOURCE, sourceSha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),
              license='CC-BY-4.0', attribution=ATTRIBUTION,
              changes='Stat blocks extracted to JSON; PDF line wrapping and spacing normalized. No game statistics changed.',
              monsters=monsters)
target = Path(__file__).resolve().parents[1] / 'assets' / 'srd-monsters.json'
target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
print(f'{len(monsters)} monsters → {target} ({target.stat().st_size:,} bytes)')
