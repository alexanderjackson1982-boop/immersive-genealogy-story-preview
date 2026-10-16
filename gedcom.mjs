// Browser-only import and deliberately small public projection. No network or storage.
export const LIMITS = Object.freeze({bytes: 5 * 1024 * 1024, nodes: 50_000, depth: 32, lineLength: 65_536,
  events: 20_000, relationships: 20_000, personEvents: 1000, personRelationships: 1000});
const CUTOFF = 1926;
const EVENT_TYPES = new Set(['BIRT', 'DEAT', 'CHR', 'BAPM', 'BURI', 'MARR']);
const MONTHS = new Map('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').map((m, i) => [m, i + 1]));
const POINTER = /^@[^@\s]+@$/;
const FALSE = new Set(['N', 'NO', 'FALSE', '0']);
const NOTICES = Object.freeze({
  omissions: 'Notes, contacts, media and source transcriptions are omitted. No archive records are retrieved.',
  review: 'Automatic filtering cannot guarantee anonymity in every name or place. Check displayed details before sharing screenshots.',
  hidden: 'Living people and people without an unambiguous death before 1926 are withheld.',
  restricted: 'Records with privacy, living or other restriction flags are withheld.',
  fields: 'Some names, dates or places were withheld because they contain unsupported or potentially private text.',
  tags: 'Some imported fields are not displayed in this limited beta.',
  pointers: 'Some family or source references are unresolved or have an unexpected record type.',
  dates: 'Some dates are uncertain or unsupported; no historical conclusion is inferred.',
  links: 'Family links are imported assertions; they do not establish biological relationships.',
  duplicate: 'Repeated fields are retained where supported; no assertion is selected as the correct one.'
});

export class GedcomImportError extends Error {
  constructor(code, message) { super(message); this.name = 'GedcomImportError'; this.code = code; }
}
function fail(code, message) { throw new GedcomImportError(code, message); }
const fields = (node, tag) => node.children.filter(n => n.tag === tag);
function text(node) {
  let value = node.value;
  for (const child of node.children) {
    if (child.tag === 'CONT') value += '\n' + text(child);
    else if (child.tag === 'CONC') value += text(child);
  }
  return value;
}
const normalized = value => String(value).trim().toUpperCase();
function atom(value) {
  const p = value.split(' ');
  let year, month, day, precision;
  if (p.length === 1 && /^\d{1,4}$/.test(p[0])) {
    year = Number(p[0]); month = 1; day = 1; precision = 'year';
  } else if (p.length === 2 && MONTHS.has(p[0]) && /^\d{1,4}$/.test(p[1])) {
    month = MONTHS.get(p[0]); year = Number(p[1]); day = 1; precision = 'month';
  } else if (p.length === 3 && /^\d{1,2}$/.test(p[0]) && MONTHS.has(p[1]) && /^\d{1,4}$/.test(p[2])) {
    day = Number(p[0]); month = MONTHS.get(p[1]); year = Number(p[2]); precision = 'day';
  } else return null;
  if (year < 1 || year > 9999) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLength = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > monthLength) return null;
  return {year, precision, earliest: [year, month, day], latest: [year, precision === 'year' ? 12 : month, precision === 'year' ? 31 : precision === 'month' ? monthLength : day]};
}
const beforeOrSame = (a, b) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])));

// Date bounds mirror v0.6's conservative Gregorian interpretation. This API can
// preserve raw text; parseGedcom only exposes dates accepted by safeDate below.
export function parseDate(raw) {
  if (typeof raw !== 'string') fail('DATE_TYPE', 'A GEDCOM date must be text.');
  const result = {raw, qualifier: null, min_year: null, max_year: null, precision: 'unknown', warnings: []};
  let value = raw.toUpperCase().trim().replace(/\s+/g, ' ');
  if (!value) return result;
  if (value.length > 1024) { result.warnings.push('Date is too long to interpret; preserved as text'); return result; }
  const calendar = value.match(/^@#D([^@]+)@\s*(.*)$/);
  if (calendar) {
    result.calendar = calendar[1]; value = calendar[2];
    if (calendar[1] !== 'GREGORIAN') { result.warnings.push('Unsupported calendar; no conversion or year bounds assumed'); return result; }
  }
  const qualified = value.match(/^(ABT|CAL|EST|BEF|AFT|BET|FROM|TO|INT)(?:\s+|$)(.*)$/);
  if (qualified) {
    const [, q, body] = qualified; result.qualifier = q;
    if ((q === 'BET' || q === 'FROM') && (body.includes(' AND ') || body.includes(' TO '))) {
      const parts = body.split(q === 'BET' ? ' AND ' : ' TO ');
      const start = parts.length === 2 ? atom(parts[0]) : null;
      const end = parts.length === 2 ? atom(parts[1]) : null;
      if (start && end && beforeOrSame(start.earliest, end.latest)) {
        Object.assign(result, {min_year: start.year, max_year: end.year, precision: 'range'}); return result;
      }
      result.warnings.push('Invalid date range; preserved without year bounds'); return result;
    }
    if (q === 'BET') { result.warnings.push('BET date is missing AND; no bounds assumed'); return result; }
    const a = atom(q === 'INT' ? body.replace(/\s*\(.*\)\s*$/, '') : body);
    if (!a) { result.warnings.push('Unrecognised or invalid qualified date; no bounds assumed'); return result; }
    Object.assign(result, {precision: a.precision, nominal_year: a.year});
    if (q === 'BEF') result.max_year = a.precision === 'year' ? a.year - 1 : a.year;
    else if (q === 'AFT') result.min_year = a.precision === 'year' ? a.year + 1 : a.year;
    else if (q === 'FROM') Object.assign(result, {min_year: a.year, precision: 'range'});
    else if (q === 'TO') Object.assign(result, {max_year: a.year, precision: 'range'});
    else result.warnings.push('Uncertain date has no finite year bounds');
    return result;
  }
  const a = atom(value);
  if (a) Object.assign(result, {min_year: a.year, max_year: a.year, precision: a.precision, nominal_year: a.year});
  else result.warnings.push('Unrecognised or invalid date; preserved without year bounds');
  return result;
}

function safeDate(raw) {
  // INT's explanatory prose, unknown calendars and arbitrary date prose never leave the parser.
  const value = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!value || value.length > 128 || /[\r\n\x00-\x1f\x7f]/.test(raw)) return '';
  if (!/^(?:@#DGREGORIAN@ )?(?:(?:ABT|CAL|EST|BEF|AFT|BET|FROM|TO|INT) )?[0-9A-Z ]+$/.test(value)) return '';
  return parseDate(value).precision === 'unknown' ? '' : value;
}

function parseRecords(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  if (!(bytes instanceof Uint8Array)) fail('INPUT_TYPE', 'Choose a GEDCOM file.');
  if (!bytes.byteLength || bytes.byteLength > LIMITS.bytes) fail('SIZE', 'Choose a nonempty GEDCOM file no larger than 5 MiB.');
  let content;
  try { content = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { fail('ENCODING', 'This beta requires a UTF-8 export. Re-export the file as GEDCOM 5.5.1 with UTF-8 encoding.'); }
  if (content.includes('\0')) fail('NUL', 'The file contains unsupported characters. Re-export as UTF-8 GEDCOM.');
  if (/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(content)) {
    fail('CONTROL_CHARACTERS', 'The file contains unsupported control characters. Re-export as UTF-8 GEDCOM.');
  }
  const records = [], nodes = [], stack = [], byId = new Map();
  for (const line of content.split(/\r\n|\n|\r/)) {
    if (!line.trim()) continue;
    if (line.length > LIMITS.lineLength) fail('LINE_LENGTH', 'A field exceeds this beta’s size limit.');
    const match = line.match(/^(\d{1,3})\s+(?:(@[^@\s]+@)\s+)?([A-Za-z0-9_]+)(?:[ \t]+(.*))?$/);
    if (!match) fail('SYNTAX', 'The file has unsupported GEDCOM syntax. Re-export as GEDCOM 5.5.1.');
    const [, levelText, id, tag, value = ''] = match;
    const level = Number(levelText);
    if (level > LIMITS.depth) fail('DEPTH', 'The file exceeds this beta’s nesting limit.');
    if (level && (!stack.length || level > stack.at(-1).level + 1)) fail('HIERARCHY', 'The GEDCOM field hierarchy is invalid.');
    if (id && level !== 0) fail('NESTED_ID', 'The file contains an unsupported nested record identifier.');
    if (id && byId.has(id)) fail('DUPLICATE_ID', 'The file contains duplicate record identifiers.');
    while (stack.length && stack.at(-1).level >= level) stack.pop();
    const node = {level, id, tag: tag.toUpperCase(), value, children: []};
    if (level) stack.at(-1).children.push(node); else records.push(node);
    if (id) byId.set(id, node);
    nodes.push(node);
    if (nodes.length > LIMITS.nodes) fail('NODES', 'The file exceeds this beta’s 50,000-field limit.');
    stack.push(node);
  }
  if (records[0]?.tag !== 'HEAD' || records.at(-1)?.tag !== 'TRLR' ||
      records.filter(n => n.tag === 'HEAD').length !== 1 || records.filter(n => n.tag === 'TRLR').length !== 1 ||
      records[0].id || records.at(-1).id || records.at(-1).children.length) {
    fail('STRUCTURE', 'The file must contain one HEAD record first and one TRLR record last.');
  }
  const head = records[0], gedc = fields(head, 'GEDC'), char = fields(head, 'CHAR');
  if (gedc.length !== 1 || fields(gedc[0], 'VERS').length !== 1 || normalized(text(fields(gedc[0], 'VERS')[0])) !== '5.5.1') {
    fail('VERSION', 'This beta supports GEDCOM 5.5.1 only. Choose that version when exporting.');
  }
  if (char.length !== 1 || normalized(text(char[0])) !== 'UTF-8') fail('CHARSET', 'This beta requires a GEDCOM export declaring UTF-8 encoding.');
  return {records, nodes, byId};
}

function restricted(record) {
  const stack = [record];
  while (stack.length) {
    const n = stack.pop(), value = normalized(text(n));
    if (n.tag === 'RESN' ||
        (['_PRIV', '_PRIVATE', '_CONFIDENTIAL', '_LIVING', '_ALIVE', '_LVG'].includes(n.tag) && !FALSE.has(value))) return true;
    stack.push(...n.children);
  }
  return false;
}

function restrictedSourceClosure(records) {
  const sources = records.filter(n => n.tag === 'SOUR' && n.id);
  const blocked = new Set(sources.filter(restricted).map(n => n.id));
  const reverse = new Map();
  for (const source of sources) {
    const stack = [...source.children];
    while (stack.length) {
      const node = stack.pop(), reference = node.value.trim();
      if (node.tag === 'SOUR' && POINTER.test(reference)) {
        if (!reverse.has(reference)) reverse.set(reference, new Set());
        reverse.get(reference).add(source.id);
      }
      stack.push(...node.children);
    }
  }
  const queue = [...blocked];
  for (let i = 0; i < queue.length; i++) {
    for (const user of reverse.get(queue[i]) || []) {
      if (!blocked.has(user)) { blocked.add(user); queue.push(user); }
    }
  }
  return blocked;
}

function restrictedSourceReference(record, restrictedSources) {
  const stack = [record];
  while (stack.length) {
    const node = stack.pop();
    if (node.tag === 'SOUR' && restrictedSources.has(node.value.trim())) return true;
    stack.push(...node.children);
  }
  return false;
}

function historical(record, restrictedSources) {
  if (restricted(record) || restrictedSourceReference(record, restrictedSources)) return false;
  const deaths = fields(record, 'DEAT');
  if (!deaths.length) return false;
  let latestDeath = -Infinity;
  for (const death of deaths) {
    if (FALSE.has(normalized(text(death)))) return false;
    const dates = fields(death, 'DATE');
    if (!dates.length) return false;
    for (const node of dates) {
      const date = parseDate(text(node));
      if (!Number.isInteger(date.max_year) || date.max_year >= CUTOFF) return false;
      latestDeath = Math.max(latestDeath, date.max_year);
    }
  }
  for (const birth of fields(record, 'BIRT')) {
    for (const node of fields(birth, 'DATE')) {
      const date = parseDate(text(node));
      if (date.precision === 'unknown') return false;
      if (Number.isInteger(date.min_year) && date.min_year > latestDeath) return false;
      if (Number.isInteger(date.nominal_year) && date.nominal_year > latestDeath) return false;
    }
  }
  return true;
}

// Token trie avoids scanning every excluded name for every exported field.
function tokens(value) { return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []; }
function privacyIndex(excluded) {
  const root = new Map();
  const add = value => {
    const parts = tokens(value);
    if (!parts.length || value.length > 500) return;
    let node = root;
    for (const part of parts) { if (!node.has(part)) node.set(part, new Map()); node = node.get(part); }
    node.end = true;
  };
  for (const record of excluded) {
    const stack = [...record.children];
    while (stack.length) {
      const node = stack.pop();
      if (node.tag === 'NAME' || node.tag === 'NICK') add(text(node));
      stack.push(...node.children);
    }
  }
  return value => {
    const parts = tokens(value);
    for (let start = 0; start < parts.length; start++) {
      let node = root;
      for (let i = start; i < parts.length && node.has(parts[i]); i++) { node = node.get(parts[i]); if (node.end) return true; }
    }
    return false;
  };
}

function obviousContact(value) {
  return /(?:@|https?:|www\.|mailto:|tel:|\b(?:email|e-mail|phone|telephone|mobile|contact|password|social security|national insurance)\b)/i.test(value) ||
    /(?:\+?\d[\d\s().-]{5,}\d)/.test(value) || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value);
}
function safeText(raw, kind, mentionsPrivate) {
  const value = raw.replace(/\//g, kind === 'name' ? ' ' : '/').trim().replace(/\s+/g, ' ');
  if (!value || value.length > (kind === 'name' ? 200 : 250) || obviousContact(raw) || mentionsPrivate(value)) return '';
  const pattern = kind === 'name' ? /^[\p{L}\p{M}][\p{L}\p{M}\p{N} .,'’()\-]*$/u : /^[\p{L}\p{M}\p{N} .,'’()/\-]*$/u;
  return pattern.test(value) ? value : '';
}

export function parseGedcom(bytes) {
  const {records, nodes, byId} = parseRecords(bytes);
  const notices = new Set([NOTICES.omissions, NOTICES.review]);
  const individuals = records.filter(n => n.tag === 'INDI' && n.id);
  if (!individuals.length) fail('NO_PEOPLE', 'No individuals were found in this GEDCOM export.');
  const restrictedSources = restrictedSourceClosure(records);
  const eligible = new Set(individuals.filter(n => historical(n, restrictedSources)).map(n => n.id));
  const mentionsPrivate = privacyIndex(individuals.filter(n => !eligible.has(n.id)));
  const ids = new Map(), names = new Map();
  if (eligible.size < individuals.length) notices.add(NOTICES.hidden);
  if (records.some(restricted)) notices.add(NOTICES.restricted);
  let sequence = 0;
  for (const record of individuals) {
    if (!eligible.has(record.id)) continue;
    ids.set(record.id, `p${++sequence}`);
    const nameFields = fields(record, 'NAME');
    if (nameFields.length > 1) notices.add(NOTICES.duplicate);
    const name = nameFields.length ? safeText(text(nameFields[0]), 'name', mentionsPrivate) : '';
    if (!name) notices.add(NOTICES.fields);
    names.set(record.id, name || 'Name withheld');
  }
  const familyRecords = records.filter(n => n.tag === 'FAM' && n.id);
  const families = new Map(familyRecords.map(record => [record.id, {record, partners: new Set(), children: new Set(), blocked: restricted(record) || restrictedSourceReference(record, restrictedSources)}]));
  const pointer = (node, expected) => {
    const id = text(node).trim();
    if (!POINTER.test(id) || byId.get(id)?.tag !== expected) { notices.add(NOTICES.pointers); return null; }
    return id;
  };
  for (const family of families.values()) {
    for (const node of family.record.children) {
      if (node.tag === 'HUSB' || node.tag === 'WIFE') { const id = pointer(node, 'INDI'); if (id) family.partners.add(id); }
      if (node.tag === 'CHIL') { const id = pointer(node, 'INDI'); if (id) family.children.add(id); }
    }
  }
  for (const record of individuals) {
    for (const node of record.children) {
      if (node.tag !== 'FAMC' && node.tag !== 'FAMS') continue;
      const id = pointer(node, 'FAM');
      if (id && families.has(id)) families.get(id)[node.tag === 'FAMC' ? 'children' : 'partners'].add(record.id);
    }
  }
  for (const family of families.values()) {
    if (fields(family.record, 'HUSB').length > 1 || fields(family.record, 'WIFE').length > 1 || family.partners.size > 2) {
      fail('FAMILY_PARTNERS', 'A family contains inconsistent partner links. Review the export before importing.');
    }
  }
  let projectedEvents = 0;
  function events(record, allowed = EVENT_TYPES) {
    const result = [];
    for (const node of record.children) {
      if (!allowed.has(node.tag) || restricted(node)) continue;
      const dates = fields(node, 'DATE'), places = fields(node, 'PLAC');
      if (dates.length > 1 || places.length > 1) notices.add(NOTICES.duplicate);
      const rawPlace = places.length === 1 ? text(places[0]) : '';
      const place = safeText(rawPlace, 'place', mentionsPrivate);
      if (rawPlace && !place) notices.add(NOTICES.fields);
      for (const source of fields(node, 'SOUR')) {
        if (POINTER.test(source.value.trim()) && byId.get(source.value.trim())?.tag !== 'SOUR') notices.add(NOTICES.pointers);
      }
      // Keep every DATE in one event as a separate visible assertion. A field
      // with no date still appears, but its unstructured event prose is omitted.
      for (const dateNode of dates.length ? dates : [null]) {
        const rawDate = dateNode ? text(dateNode) : '';
        const date = safeDate(rawDate);
        if (rawDate && !date) notices.add(NOTICES.fields);
        if (date && parseDate(date).qualifier) notices.add(NOTICES.dates);
        if (++projectedEvents > LIMITS.events || result.length >= LIMITS.personEvents) {
          fail('OUTPUT_LIMIT', 'The displayed events exceed this beta’s size limit. Export a smaller family branch.');
        }
        result.push({type: node.tag, date, place, citationCount: fields(node, 'SOUR').length});
      }
    }
    return result;
  }
  const publicPeople = new Map(individuals.filter(n => eligible.has(n.id)).map(record => [record.id,
    {id: ids.get(record.id), name: names.get(record.id), events: events(record), relationships: []}]));
  const relationshipKeys = new Map([...publicPeople.keys()].map(id => [id, new Set()]));
  let projectedRelationships = 0;
  const link = (from, to, kind) => {
    if (from === to || !publicPeople.has(from) || !publicPeople.has(to)) return;
    const key = `${ids.get(to)}:${kind}`;
    if (relationshipKeys.get(from).has(key)) return;
    if (++projectedRelationships > LIMITS.relationships || publicPeople.get(from).relationships.length >= LIMITS.personRelationships) {
      fail('OUTPUT_LIMIT', 'The displayed family links exceed this beta’s size limit. Export a smaller family branch.');
    }
    relationshipKeys.get(from).add(key);
    publicPeople.get(from).relationships.push({id: ids.get(to), name: names.get(to), kind});
  };
  for (const family of families.values()) {
    if (family.blocked) continue;
    for (const parent of family.partners) {
      for (const child of family.children) { link(parent, child, 'child'); link(child, parent, 'parent'); }
      for (const partner of family.partners) link(parent, partner, 'family partner');
    }
    if (family.partners.size > 1 && [...family.partners].every(id => eligible.has(id))) {
      const marriageEvents = events(family.record, new Set(['MARR']));
      projectedEvents += marriageEvents.length * (family.partners.size - 1);
      if (projectedEvents > LIMITS.events) fail('OUTPUT_LIMIT', 'The displayed events exceed this beta’s size limit. Export a smaller family branch.');
      for (const id of family.partners) {
        if (publicPeople.get(id).events.length + marriageEvents.length > LIMITS.personEvents) {
          fail('OUTPUT_LIMIT', 'The displayed events exceed this beta’s size limit. Export a smaller family branch.');
        }
        publicPeople.get(id).events.push(...marriageEvents.map(e => ({...e})));
      }
    }
  }
  // Only generic notices reach the UI, never input paths, references or prose.
  const displayTags = new Set(['HEAD', 'GEDC', 'VERS', 'FORM', 'CHAR', 'TRLR', 'INDI', 'FAM', 'NAME', 'SEX', 'FAMC', 'FAMS', 'HUSB', 'WIFE', 'CHIL', 'DATE', 'PLAC', 'SOUR', 'PAGE', 'DATA', 'TEXT', 'QUAY', 'TITL', 'AUTH', 'PUBL', 'NOTE', 'OBJE', 'FILE', 'CONT', 'CONC', 'RESN', '_PRIV', '_LIVING', '_ALIVE', ...EVENT_TYPES]);
  if (nodes.some(n => !displayTags.has(n.tag))) notices.add(NOTICES.tags);
  const people = [...publicPeople.values()];
  if (people.some(p => p.relationships.length)) notices.add(NOTICES.links);
  return {
    people,
    summary: {importedPeople: individuals.length, visiblePeople: people.length, withheldPeople: individuals.length - people.length,
      families: familyRecords.length, sources: records.filter(n => n.tag === 'SOUR' && n.id).length,
      displayedEvents: people.reduce((n, p) => n + p.events.length, 0),
      displayedRelationships: people.reduce((n, p) => n + p.relationships.length, 0), gedcomVersion: '5.5.1', encoding: 'UTF-8'},
    warnings: [...notices]
  };
}
