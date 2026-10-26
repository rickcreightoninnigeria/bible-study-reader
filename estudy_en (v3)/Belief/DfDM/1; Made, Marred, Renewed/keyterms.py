#!/usr/bin/env python3
"""keyTerms for the Part I study, and a test of each sample answer against them.

keyTerms are the ideas a good answer contains: one string per idea, alternatives separated by "|".
The matcher below is MY READING of the documented rules (STUDY-FORMAT.md section 7 and 8, and the
tutorial), not the app's own answer-match.js, which I cannot see:
  - text is lower-cased, accents removed, punctuation turned into spaces;
  - an alternative matches if a word in the answer starts with it (a stem), or, for a phrase, if
    the phrase starts at a word boundary; "term$" means the whole word; "*term" means anywhere inside;
  - tiers: none matched = "different direction"; at least half (never fewer than two when there are
    two or more terms) = "well done"; otherwise "partial".
"""
import re, unicodedata, math

KEYTERMS = {
    # ---- Chapter 1
    'ch01-el09': ['dead|sleeper', 'shine', 'darkness|deeds', 'expos|visible', 'pleases'],
    'ch01-el13': ['practi|obey', 'wise|foolish', 'rain|storm|flood|wind|stream', 'sand|rock|built|foundation'],
    'ch01-el15': ['godl', 'grace', 'say no|ungodl|worldly|self-control', 'wait|appearing|hope', 'redeem|purify|eager'],
    'ch01-el18': ['useless|futile|vain', 'sins', 'false witness', 'perish|lost', 'pitied|pity'],
    'ch01-el20': ['adam', 'christ', 'firstfruit|harvest', 'perishable|imperishable|natural|spiritual', 'image|bear'],
    'ch01-el24': ['groan|labour|decay', 'redemption|bodies', 'home|dwell|among', 'tear|death|mourning|pain', 'new|renew'],
    'ch01-el27': ['hope', 'rose|rise|resurrect', 'asleep|dead in christ', 'caught up|still alive', 'encourage|for ever|forever'],
    # ---- Chapter 2
    'ch02-el08': ['speak|spoke|word', 'hover', 'rival|tool|struggl', 'from the beginning|already there'],
    'ch02-el10': ['word|spoke|commanded', 'breath|mouth', 'fear|revere', 'sea|waters|deep|storehouse'],
    'ch02-el12': ['through', 'word|one lord', 'invisible|image of', 'hold together', 'together|father son and spirit'],
    'ch02-el15': ['six|verses', 'very good|all that he had made', 'bless|holy', 'complet|finished', 'mistake|trap'],
    'ch02-el19': ['life|breath', 'need|not served', 'depend|every moment', 'sustain|powerful word', 'foundation|laid'],
    'ch02-el22': ['declare|proclaim', 'no words|use no|day after day|night after night', 'worthy', 'honour|power', 'will|exist'],
    'ch02-el25': ['belong', 'founded|seas|waters', 'crown|glory|honour|lower than the angels', 'rule|steward', 'owner|accountable'],
    # ---- Chapter 3
    'ch03-el07': ['plural|relationship', 'image|likeness', 'male and female', 'rule|subdue|fruitful'],
    'ch03-el09': ['likeness', 'own image|his own', 'parent|child|resembl', 'derive|original', 'reflect'],
    'ch03-el13': ['alone|aloneness|isolation', 'not good', 'name|naming|named', 'helper|suitable|companion'],
    'ch03-el14': ['bone|flesh', 'same kind|own kind|like him', 'leave|united', 'one flesh|become one', 'marriage|friendship|family|community'],
    'ch03-el17': ['heaven|moon|star', 'mindful|why', 'crown|glory|honour', 'rule|rulers', 'worth|matter|regard'],
    'ch03-el20': ['by nature', 'heart', 'conscience', 'accuse|defend', 'moral|assess'],
    'ch03-el23': ['image|likeness', 'blood|sheds', 'curse|tongue|praise', 'every|all', 'earn|ability|respect'],
    # ---- Chapter 4
    'ch04-el07': ['really say|doubt|question', 'like god|holding back|contradict', 'pleasing|good for food|desirable', 'naked|eyes'],
    'ch04-el08': ['hide|hid', 'afraid|fear', 'blame', 'looking|calls|asks|comes'],
    'ch04-el10': ['snake|serpent', 'enmity|crush|heel|offspring', 'garment|skin|clothe', 'promise|provide'],
    'ch04-el13': ['against god|god only|only', 'mercy', 'wash|cleanse|blot', 'pure heart|create', 'restore|joy|presence|holy spirit'],
    'ch04-el16': ['greed|idolatr', 'anger|rage|slander|malice|lying', 'compassion|kindness|humility|gentle|patien', 'love', 'ordinary|every part'],
    'ch04-el19': ['all have sinned|fall short|glory of god', 'redemption', 'all the more', 'reign', 'eternal life|never greater'],
    'ch04-el23': ['beelzebul|prince of demons|possessed', 'divided|cannot stand|satan', 'strong man|tie|plunder', 'forgiv', 'holy spirit|blasphem'],
    'ch04-el24': ['impure spirit|unclean spirit', 'satan|devil|demon', 'settled|stray thought', 'work|power|spirit'],
    # ---- Chapter 5
    'ch05-el07': ['harm', 'save|saving|lives|many', 'place of god|not god', 'kind|reassure', 'wrongs|revenge|pay them back'],
    'ch05-el11': ['wicked|conspir', 'plan|decided|foreknowledge', 'raised|resurrect', 'death', 'explain|holds|both'],
    'ch05-el14': ['pilate|galileans|siloam|tower', 'worse|guilty', 'repent', 'perish', 'verdict|punish|refuse'],
    'ch05-el17': ['help|listen|save', 'violence|injustice|wrongdoing', 'everlasting|holy|rock', 'pure|eyes', 'tolerate|silent'],
    'ch05-el18': ['fig|vine|olive|sheep|flock|fields', 'yet|rejoice|joyful', 'saviour|lord', 'strength|deer|heights'],
    'ch05-el21': ['flesh and blood|human', 'power of the devil|break the power|holds the power', 'slavery', 'priest|merciful|faithful', 'tempted|help those'],
    'ch05-el23': ['conqueror', 'separate', 'love', 'son|spare|gave', 'death|life|angels|powers|creation'],
}


def norm(t):
    t = unicodedata.normalize('NFKD', t.lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[\u2018\u2019']", '', t)               # apostrophes join, so "lord's" is "lords"
    t = re.sub(r'[^a-z0-9]+', ' ', t)
    return ' ' + t.strip() + ' '


def alt_matches(alt, text):
    alt = alt.strip()
    if not alt:
        return False
    if alt.startswith('*'):
        return norm(alt[1:]).strip() in text
    whole = alt.endswith('$')
    a = norm(alt.rstrip('$')).strip()
    return (' ' + a + ' ') in text if whole else (' ' + a) in text


def term_matches(term, text):
    return any(alt_matches(a, text) for a in term.split('|'))


def tier(terms, answer):
    text = norm(answer)
    hits = [t for t in terms if term_matches(t, text)]
    n = len(terms)
    need = 1 if n < 2 else max(2, math.ceil(n / 2))
    if not hits:
        return 'different direction', hits, need
    return ('well done' if len(hits) >= need else 'partial'), hits, need


def test_study(study):
    """Returns a list of (elementId, problem) and a table of results."""
    problems, rows = [], []
    for ch in study['chapters']:
        for e in ch['elements']:
            if e['type'] != 'question' or e['subtype'] != 'standard':
                continue
            eid, terms = e['elementId'], e.get('keyTerms')
            if not terms:
                problems.append((eid, 'no keyTerms')); continue
            if len(terms) > 12 or not all(isinstance(t, str) and t.strip() for t in terms):
                problems.append((eid, 'keyTerms not 1-12 non-empty strings'))
            sample, _, need = tier(terms, e['sampleAnswer'])[0], None, None
            res, hits, need = tier(terms, e['sampleAnswer'])
            q_res, q_hits, _ = tier(terms, re.sub(r'<[^>]+>', ' ', e['question']))
            nonsense, _, _ = tier(terms, 'I am not sure what to say about this at the moment.')
            rows.append((eid, len(terms), need, len(hits), res, q_res, nonsense,
                         [t for t in terms if t not in hits]))
            if res != 'well done':
                problems.append((eid, 'sample answer only reaches "%s" (%d of %d terms, needs %d)' % (res, len(hits), len(terms), need)))
            if q_res == 'well done':
                problems.append((eid, 'the question text alone would reach "well done"'))
            if nonsense == 'well done':
                problems.append((eid, 'a non-answer reaches "well done"'))
    return problems, rows
