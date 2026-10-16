// Deterministic, offline narration. Only the existing parser's privacy-filtered
// projection belongs here. This module never accepts raw GEDCOM, calls an API,
// opens a citation, stores data, or guesses facts missing from that projection.
import {parseDate} from './gedcom.mjs';

const EVENT_LABELS = Object.freeze({BIRT: 'Birth', DEAT: 'Death', CHR: 'Christening', BAPM: 'Baptism', BURI: 'Burial', MARR: 'Marriage'});
const CUTOFF = 1926;
const GRO_URL = 'https://www.gov.uk/research-family-history';
const PARISH_URL = 'https://www.nationalarchives.gov.uk/help-with-your-research/research-guides/birth-marriage-death-england-and-wales/';
const CENSUS_URL = 'https://www.nationalarchives.gov.uk/help-with-your-research/research-guides/census-records/';
const MANCHESTER_URL = 'https://www.manchester.gov.uk/parks-leisure-and-the-arts/parks-playgrounds-allotments-and-open-spaces/conservation-areas/introduction10/history';
const MONTH_NAMES = Object.freeze({JAN: 'January', FEB: 'February', MAR: 'March', APR: 'April', MAY: 'May', JUN: 'June', JUL: 'July', AUG: 'August', SEP: 'September', OCT: 'October', NOV: 'November', DEC: 'December'});
const unique = values => [...new Set(values.filter(Boolean))];

function projectedEvents(person) {
  return Array.isArray(person?.events) ? person.events.filter(event => event && Object.hasOwn(EVENT_LABELS, event.type)) : [];
}
function visibleName(person) {
  const name = typeof person?.name === 'string' ? person.name.trim() : '';
  return name.length > 0 && name.length <= 200 && name.toLowerCase() !== 'name withheld' &&
    /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .,'’()\-]*$/u.test(name) ? name : '';
}
function groups(events) {
  return Object.fromEntries(Object.keys(EVENT_LABELS).map(type => [type, events.filter(event => event.type === type)]));
}
function competingGroups(byType) {
  // Multiple alternatives can be compatible (e.g. a year and a full date).
  // Detect them without asserting that they conflict or picking a winner.
  return Object.keys(EVENT_LABELS).filter(type => unique(byType[type].map(event => event.date)).length > 1);
}
function placeHook(byType) {
  const birthPlaces = unique(byType.BIRT.map(event => event.place));
  const deathPlaces = unique(byType.DEAT.map(event => event.place));
  return birthPlaces.length && deathPlaces.length &&
    birthPlaces.some(birth => deathPlaces.some(death => birth !== death));
}

export function assessSuitability(person) {
  if (!visibleName(person)) return {suitable: false, reason: 'A safe, visible name is needed for a story.', hooks: []};
  const events = projectedEvents(person), byType = groups(events);
  if (!byType.BIRT.some(event => event.date || event.place)) {
    return {suitable: false, reason: 'A birth date or birthplace is needed to anchor a story.', hooks: []};
  }
  if (!byType.DEAT.length || byType.DEAT.some(event => {
    if (!event.date) return true;
    const parsed = parseDate(event.date);
    return !Number.isInteger(parsed.max_year) || parsed.max_year >= CUTOFF;
  })) {
    return {suitable: false, reason: 'Every displayed death assertion must have an unambiguous latest year before 1926.', hooks: []};
  }
  const hooks = [];
  if (competingGroups(byType).length) hooks.push('Alternative date assertions to investigate');
  if (placeHook(byType)) hooks.push('Different places recorded at birth and death');
  if (events.length <= 2) hooks.push('A life with chapters still missing');
  if (events.some(event => !event.date || !event.place)) hooks.push('Missing details to research');
  if (!hooks.length) hooks.push('An outline of a life to investigate');
  return {suitable: true, reason: 'A visible name, birth anchor and historical death are available in the privacy-filtered file.', hooks};
}

function compactValues(values) {
  const all = unique(values);
  if (!all.length) return '';
  const shown = all.slice(0, 4);
  const joined = shown.length === 1 ? shown[0] : shown.slice(0, -1).join(', ') + ' and ' + shown.at(-1);
  return joined + (all.length > shown.length ? `, with ${all.length - shown.length} more alternatives preserved in the assertion list` : '');
}
function readableDate(raw) {
  const value = raw.replace(/^@#DGREGORIAN@ /, '').replace(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/g, month => MONTH_NAMES[month]);
  const qualifiers = {ABT: 'around', CAL: 'calculated as', EST: 'estimated as', BEF: 'before', AFT: 'after', INT: 'interpreted as', BET: 'between', FROM: 'from', TO: 'up to'};
  const qualified = value.match(/^(ABT|CAL|EST|BEF|AFT|INT|BET|FROM|TO) (.*)$/);
  if (qualified) return qualifiers[qualified[1]] + ' ' + qualified[2].replace(/\bAND\b/g, 'and').replace(/\bTO\b/g, 'to');
  return value;
}
function describeEntries(entries) {
  const dates = unique(entries.map(event => event.date));
  const places = unique(entries.map(event => event.place));
  let dateText = 'without a displayed date';
  if (dates.length === 1) {
    const date = dates[0], qualified = parseDate(date).qualifier;
    dateText = (qualified ? '' : parseDate(date).precision === 'day' ? 'on ' : 'in ') + readableDate(date);
  } else if (dates.length > 1) {
    dateText = 'with alternative date assertions of ' + compactValues(dates.map(readableDate));
  }
  // Dates and places are not paired across separate assertions here. Their
  // exact associations remain in the full assertion list below the story.
  return dateText + (places.length ? `, associated with ${places.length > 1 ? 'the recorded places ' : ''}${compactValues(places)}` : ', without a displayed place');
}
function explicitEnglandOrWales(place) {
  if (typeof place !== 'string') return false;
  const pieces = place.split(',').map(part => part.trim().toLowerCase());
  const last = pieces.at(-1);
  return ['england', 'wales'].includes(last) ||
    (['united kingdom', 'uk', 'great britain'].includes(last) && ['england', 'wales'].includes(pieces.at(-2)));
}
function unqualifiedYear(event) {
  if (!event.date || !explicitEnglandOrWales(event.place)) return null;
  const parsed = parseDate(event.date);
  return !parsed.qualifier && Number.isInteger(parsed.min_year) && parsed.min_year === parsed.max_year ? parsed.min_year : null;
}
function contextFor(events) {
  const result = [{
    label: 'General context — the wider setting',
    text: 'To picture the world around these entries, start with historical maps and local-history guides for the recorded places and period. Establish which parish, district or settlement each place name meant, then ask what housing, work and transport were like there. These are research questions; this preview has not established anyone’s occupation, home, beliefs or daily life.'
  }];
  const datedEvents = events.map(event => ({event, year: unqualifiedYear(event)})).filter(item => item.year !== null);
  if (datedEvents.some(({event, year}) =>
    year >= 1850 && year <= 1914 && event.place.split(',')[0].trim().toLowerCase() === 'manchester' &&
    event.place.split(',').map(part => part.trim().toLowerCase()).includes('england'))) {
    result.push({
      label: 'Researched context — Manchester’s textile landscape, 1850–1914',
      text: 'Manchester’s textile trade shaped the city’s streets: cotton mills in Ancoats and large warehouses nearer the centre, with office fronts and storage behind. Canal connections carried coal and goods, and elaborate warehouse architecture continued into the early twentieth century. This source-backed setting offers things to look for on a period map. It does not establish this person’s occupation, address, working conditions or experience of those streets.',
      sourceTitle: 'Manchester City Council — Whitworth Street Conservation Area history',
      sourceUrl: MANCHESTER_URL
    });
  }
  const vitalEvents = datedEvents.filter(({event}) => ['BIRT', 'MARR', 'DEAT'].includes(event.type));
  // Year-only 1837 assertions are deliberately excluded from both sides of the
  // July 1837 boundary. Uncertain dates and guessed geographic matches never
  // trigger researched context.
  if (vitalEvents.some(({year}) => year >= 1838 && year < CUTOFF)) {
    result.push({
      label: 'Researched context — England and Wales: civil registration',
      text: 'In England and Wales, civil registration records held by the General Register Office begin in July 1837. The file contains an explicitly labelled English or Welsh event after that boundary, so this is a relevant route for research. It does not establish that a matching registration has been found or that an imported date is correct.',
      sourceTitle: 'GOV.UK — Research your family history using the General Register Office',
      sourceUrl: GRO_URL
    });
  }
  if (vitalEvents.some(({year}) => year <= 1836)) {
    result.push({
      label: 'Researched context — England and Wales: earlier records',
      text: 'For English or Welsh births, marriages and deaths before July 1837, The National Archives directs researchers to parish registers in local archives. An earlier event in this file makes those registers a possible research route. A register’s survival, coverage and a match to this person still need to be checked.',
      sourceTitle: 'The National Archives — Births, marriages and deaths in England and Wales',
      sourceUrl: PARISH_URL
    });
  }
  if (datedEvents.some(({year}) => year >= 1841 && year <= 1921)) {
    result.push({
      label: 'Researched context — England and Wales: household snapshots',
      text: 'The 1841 census was the first to list individual names; later returns offer household snapshots for researchers. For 1841–1901, household forms were copied into enumeration books, while the 1911 and 1921 household schedules were retained. This is context about how records were made. No census entry for this person has been found by this preview, and the file does not establish residence on a census night.',
      sourceTitle: 'The National Archives — Census records',
      sourceUrl: CENSUS_URL
    });
  }
  return result;
}

function investigationFor(byType) {
  const alternatives = competingGroups(byType);
  if (alternatives.length) {
    const type = alternatives[0];
    const label = EVENT_LABELS[type].toLowerCase();
    const dates = compactValues(byType[type].map(event => event.date));
    return {
      kind: 'competing-dates',
      question: `The file gives alternative ${label} dates: ${dates}. What can we conclude about the correct date?`,
      options: [
        {id: 'first', label: 'Use the first date in the file', response: 'File order supplies no reason to trust one assertion more than another. Keep every alternative while checking the records behind them.'},
        {id: 'citations', label: 'Use whichever date has more citation pointers', response: 'A pointer count does not show whether records are independent, relevant or accurate. No cited record has been opened or verified here.'},
        {id: 'undetermined', label: 'We cannot conclude from the GEDCOM alone', response: 'That is the supported conclusion. Alternative dates remain unresolved, even if they might be compatible. Check original records and document why any interpretation is better supported.'}
      ],
      steps: [
        `Copy all displayed ${label} assertions into your research notes, preserving qualifiers and dates exactly.`,
        'Locate the records behind any source pointers in your own genealogy software. This preview does not retrieve them.',
        'Compare each record’s event type, wording, identity details and relationship to the event. A baptism date, for example, must not silently replace a birth date.',
        'Record remaining uncertainty and the reasons for any preferred interpretation. Leave the question open if the evidence does not settle it.'
      ]
    };
  }
  if (placeHook(byType)) {
    return {
      kind: 'recorded-places',
      question: 'The file associates birth and death with different place names. What does that establish about a journey between them?',
      options: [
        {id: 'journey', label: 'The file proves a permanent move', response: 'Different event places do not establish a continuous residence history, a route or a permanent move. Check identities, place meanings and intermediate records.'},
        {id: 'motive', label: 'The person travelled for work', response: 'The displayed assertions provide no evidence of a motive or occupation. Work is a question to research, not a fact to add to the story.'},
        {id: 'undetermined', label: 'We cannot conclude from the GEDCOM alone', response: 'That is the supported conclusion. The change in recorded place is a promising research hook. It does not yet establish a migration, its timing or its cause.'}
      ],
      steps: [
        'Check the original records behind the birth and death assertions and confirm whether they identify the same person.',
        'Resolve each place name on a map appropriate to the period. Do not assume different spellings always mean different locations.',
        'Look for dated intermediate evidence of residence, if it exists, and preserve gaps instead of filling them with a journey.',
        'Test possible explanations against evidence. Record both what is supported and what remains unknown.'
      ]
    };
  }
  return {
    kind: 'missing-chapters',
    question: 'The file gives a few landmarks in this life. What can we conclude about the years between them?',
    options: [
      {id: 'same-place', label: 'The person stayed in one place throughout', response: 'Even matching event places do not establish continuous residence. The years between those entries remain unaccounted for.'},
      {id: 'nothing', label: 'Nothing significant happened in those years', response: 'A gap in a family file is a gap in the displayed information. It does not tell us what happened, what mattered or which records have survived.'},
      {id: 'undetermined', label: 'We cannot conclude from the GEDCOM alone', response: 'That is the supported conclusion. A sparse outline can guide research, but it cannot supply the missing years, experiences or relationships.'}
    ],
    steps: [
      'Make a timeline from every displayed assertion, keeping approximate dates and missing fields visible.',
      'Choose one gap or missing detail to investigate rather than writing a complete biography immediately.',
      'Consult a research guide for the relevant place and period, then look for original records through your own chosen archive or provider.',
      'Add new material only with a record reference, an identity check and a clear account of uncertainty.'
    ]
  };
}

export function buildStory(person) {
  const suitability = assessSuitability(person);
  if (!suitability.suitable) throw new TypeError(suitability.reason);
  const name = visibleName(person), events = projectedEvents(person), byType = groups(events);
  const assertions = events.map((event, index) => ({
    id: `a${index + 1}`,
    label: `${EVENT_LABELS[event.type]} — unverified GEDCOM assertion`,
    date: event.date || '', place: event.place || '',
    citationCount: Number.isInteger(event.citationCount) && event.citationCount >= 0 ? event.citationCount : 0
  }));
  const idsFor = types => assertions.filter((assertion, index) => types.includes(events[index].type)).map(assertion => assertion.id);
  const alternatives = competingGroups(byType), changingPlaces = placeHook(byType);
  const theme = alternatives.length ? 'the dates that stay open' : changingPlaces ? 'a life between recorded places' : 'the chapters still missing';
  const opening = alternatives.length
    ? `${name}’s story, as outlined in the GEDCOM, begins with a question that stays open: which interpretation can the underlying records support? The alternative entries give this investigation its first thread.`
    : changingPlaces
      ? `${name}’s story, as outlined in the GEDCOM, opens with one recorded place and closes with another. The space between those landmarks is where the most interesting questions begin.`
      : `${name} appears in the GEDCOM through the landmarks someone chose to preserve. The spaces between them invite a closer look: what could a real record add to the outline of this life?`;
  const paragraphs = [{
    text: opening + ' Every personal detail below is an unverified assertion from the imported file.',
    assertionIds: []
  }, {
    text: `The file records a birth ${describeEntries(byType.BIRT)}. It records a death ${describeEntries(byType.DEAT)}. Those are anchors for your research, with every date and place assertion preserved individually below. No original record has been checked to confirm the identity or these details.`,
    assertionIds: idsFor(['BIRT', 'DEAT'])
  }];
  if (alternatives.length) {
    paragraphs.push({
      text: `The date alternatives for ${alternatives.map(type => EVENT_LABELS[type].toLowerCase()).join(', ')} remain unresolved. Could they be compatible descriptions, or does the underlying evidence point in different directions? The file cannot settle that question. A date’s position in the file, or the number of attached citation pointers, cannot decide which interpretation deserves trust. The next chapter of this story is the comparison itself: finding the records, checking what they say and keeping track of what remains open.`,
      assertionIds: idsFor(alternatives)
    });
  }
  if (changingPlaces) {
    paragraphs.push({
      text: 'Place the birth and death entries beside one another on a map, and a question appears between them: what evidence, if any, connects these recorded places? An address or another dated event could give the investigation a new foothold. The file alone cannot establish a migration, its route or its motive. Until those connections are supported, the space between the landmarks remains an invitation to investigate.',
      assertionIds: idsFor(['BIRT', 'DEAT'])
    });
  }
  const otherTypes = Object.keys(EVENT_LABELS).filter(type => !['BIRT', 'DEAT'].includes(type) && byType[type].length);
  if (otherTypes.length) {
    paragraphs.push({
      text: `Other landmarks add detail to the file’s outline: ${otherTypes.map(type => `${EVENT_LABELS[type].toLowerCase()} ${describeEntries(byType[type])}`).join('; ')}. Each is an unverified GEDCOM assertion and a possible starting point for another record search. None supplies the person’s thoughts or the texture of daily life; those remain questions to approach with evidence.`,
      assertionIds: idsFor(otherTypes)
    });
  } else {
    paragraphs.push({
      text: 'Between the birth and death entries, this displayed file leaves the everyday chapters unwritten. There is room for a compelling story here, but its next scene should come from research: a household, an address, a relationship or another dated event whose evidence you can examine. The absence of those details here does not tell us whether such records exist.',
      assertionIds: []
    });
  }
  paragraphs.push({
    text: events.some(event => event.citationCount > 0)
      ? 'Some entries contain citation pointers. Only their counts are available in this privacy-filtered preview; a pointer is not a checked record. The most useful next step is to inspect the underlying material in your own research and decide what it actually supports.'
      : 'No citation pointers are visible on these displayed events. That does not prove that no supporting material exists elsewhere. The next step is to look for it and keep a record of what each source actually supports.',
    assertionIds: []
  });
  return {
    title: `${name}: ${theme}`,
    subtitle: 'A reading of unverified GEDCOM assertions. No archive records have been checked.',
    paragraphs,
    assertions,
    context: contextFor(events),
    reconstruction: {
      label: 'Fictional reconstruction — optional imagined scene',
      text: 'An imagined scene: a researcher spreads a map on a table beside an empty timeline. One place name is marked, then another. The spaces between them remain blank. A hand pauses over the first question: what would a real record let us add? This is a fictional, generic scene for exploring atmosphere. It does not depict this person, their surroundings or an event in their life.'
    },
    investigation: investigationFor(byType),
    limitations: [
      'All personal details are unverified GEDCOM assertions; importing them is not independent confirmation.',
      'Alternative dates and repeated entries are retained. This preview does not select a correct date or resolve identity conflicts.',
      'Citation counts are pointer counts, not evidence quality, independent sources or archive verification.',
      'The story uses only the existing viewer’s privacy-filtered names, events and places. Notes, occupations, media, source text and private or living people are outside this preview.',
      'General context is research guidance. Researched context describes source-backed record systems or a carefully matched wider setting; it does not establish personal experience.',
      'No relationship to the importer or biological lineage is inferred. Recorded places do not establish continuous residence or migration.',
      'The optional imagined scene is fictional and must remain separate from the family story.',
      'Narration is a deterministic offline template. No archive search or external AI service is used.'
    ]
  };
}
