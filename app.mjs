import {parserWorkerSource} from './parser-worker-source.mjs';
import {assessSuitability, buildStory} from './stories.mjs';
import {fictionalDemo} from './demo.mjs';

const $ = id => document.getElementById(id);
const controls = {consent:$('consent'),file:$('gedcom'),read:$('read-tree'),clear:$('clear-tree'),search:$('search'),demo:$('demo')};
const IDLE_MS = 30 * 60 * 1000, HARD_MS = 2 * 60 * 60 * 1000, MAX_BYTES = 5 * 1024 * 1024, PAGE_SIZE = 20;
const standalone = window.self === window.top;
let tree = null, worker = null, workerUrl = null, parsingTimer = null;
let epoch = 0, busy = false, selectedId = null, currentPage = 0, lastActivity = 0, importedAt = 0;
let demoMode = false, currentView = 'story';
const selectedIds = new Set(), stories = new Map(), feedback = new Map(), investigations = new Map(), exportUrls = new Set();
const eventNames = {BIRT:'Birth',DEAT:'Death',CHR:'Christening',BAPM:'Baptism',BURI:'Burial',MARR:'Marriage'};

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}
function status(message, isError = false) {
  $('status').textContent = message;
  $('status').className = isError ? 'error' : '';
}
function stopWorker() {
  if (worker) worker.terminate();
  worker = null;
  if (workerUrl) URL.revokeObjectURL(workerUrl);
  workerUrl = null;
  if (parsingTimer) clearTimeout(parsingTimer);
  parsingTimer = null;
}
function updateControls() {
  controls.file.disabled = !standalone || busy || !controls.consent.checked;
  controls.read.disabled = !standalone || busy || !controls.consent.checked || !controls.file.files.length;
  controls.consent.disabled = !standalone || busy;
  controls.demo.disabled = !standalone || busy;
  controls.clear.disabled = !busy && !tree;
}
function releaseProjection() {
  tree = null;
  selectedId = null;
  currentPage = 0;
  lastActivity = importedAt = 0;
  demoMode = false;
  currentView = 'story';
  selectedIds.clear(); stories.clear(); feedback.clear(); investigations.clear();
  for (const url of exportUrls) URL.revokeObjectURL(url);
  exportUrls.clear();
  controls.search.value = '';
  $('include-names').checked = false;
  for (const id of ['summary','notices','people-list','person-detail','collection','selection-count','people-count','page-number','session-note']) $(id).replaceChildren();
  $('tree-panel').hidden = true;
  $('demo-banner').hidden = true;
  $('feedback-export').hidden = true;
}
function clearTree(message = 'Tree, stories and feedback have been cleared from this preview.') {
  epoch += 1;
  stopWorker();
  releaseProjection();
  busy = false;
  controls.file.value = '';
  controls.consent.checked = false;
  controls.read.textContent = 'Read my tree →';
  status(message);
  updateControls();
}
function expired(now = Date.now()) {
  return tree && (now - importedAt >= HARD_MS || now - lastActivity >= IDLE_MS);
}
function checkExpiry() {
  if (!expired()) return false;
  clearTree('This session expired. Tree, stories and feedback were cleared. You can read your file again.');
  return true;
}
function activity(event) {
  if (checkExpiry()) return;
  if (tree && event.isTrusted) lastActivity = Date.now();
}
function lifespan(person) {
  const birth = person.events.find(e => e.type === 'BIRT');
  const death = person.events.find(e => e.type === 'DEAT');
  return [birth?.date ? 'Birth: ' + birth.date : '', death?.date ? 'Death: ' + death.date : ''].filter(Boolean).join(' · ');
}
function showSummary() {
  $('summary').replaceChildren();
  const suitable = tree.people.filter(p => assessSuitability(p).suitable).length;
  for (const [value,label] of [[suitable,'Story candidates'],[tree.summary.visiblePeople,'People shown'],[tree.summary.withheldPeople,'People withheld']]) {
    const item = node('div',undefined,'summary-item'); item.append(node('strong',value),node('span',label)); $('summary').append(item);
  }
  const list = node('ul');
  for (const warning of [...new Set(tree.warnings)].slice(0,20)) list.append(node('li',warning));
  $('notices').replaceChildren(list);
  $('session-note').textContent = 'Session only · Clears after 30 minutes without activity or two hours total · Downloaded files remain on your device.';
  $('demo-banner').hidden = !demoMode;
}
function showPeople() {
  if (!tree || checkExpiry()) return;
  const query = controls.search.value.trim().toLocaleLowerCase();
  const people = tree.people.filter(p => p.name.toLocaleLowerCase().includes(query));
  const pageCount = Math.max(1,Math.ceil(people.length / PAGE_SIZE));
  currentPage = Math.max(0,Math.min(currentPage,pageCount - 1));
  $('people-list').replaceChildren();
  $('selection-count').textContent = selectedIds.size + ' of 3 selected';
  $('people-count').textContent = people.length + ' historical people' + (query ? ' match your search.' : ' available to browse.');
  for (const person of people.slice(currentPage * PAGE_SIZE,(currentPage + 1) * PAGE_SIZE)) {
    const assessment = assessSuitability(person);
    const card = node('div',undefined,'person-card' + (person.id === selectedId ? ' active' : ''));
    const browse = node('button',undefined,'person-button');
    browse.type = 'button'; browse.setAttribute('aria-current',String(person.id === selectedId));
    browse.append(node('span',person.name),node('small',lifespan(person)));
    browse.addEventListener('click',() => selectPerson(person.id));
    card.append(browse);
    if (assessment.suitable) {
      const label = node('label',undefined,'person-choice');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedIds.has(person.id);
      checkbox.disabled = !checkbox.checked && selectedIds.size >= 3;
      checkbox.setAttribute('aria-label','Choose ' + person.name + ' for a story');
      checkbox.addEventListener('change',() => toggleStory(person.id,checkbox.checked));
      label.append(checkbox,node('span','Include in my three stories')); card.append(label);
      if (assessment.hooks?.length) card.append(node('p',assessment.hooks.join(' · '),'hook'));
    } else card.append(node('p',assessment.reason,'small'));
    $('people-list').append(card);
  }
  if (!people.length) $('people-list').append(node('p','No names match your search.','small'));
  $('previous').disabled = currentPage === 0; $('next').disabled = currentPage >= pageCount - 1;
  $('page-number').textContent = (currentPage + 1) + ' / ' + pageCount;
  $('feedback-export').hidden = !selectedIds.size;
}
function showCollection() {
  $('collection').replaceChildren();
  for (const id of selectedIds) {
    const person = tree.people.find(p => p.id === id);
    const button = node('button',person.name);
    button.setAttribute('aria-current',String(id === selectedId));
    button.addEventListener('click',() => selectPerson(id)); $('collection').append(button);
  }
}
function toggleStory(id, checked) {
  if (!tree || checkExpiry()) return;
  const person = tree.people.find(p => p.id === id);
  if (!person || !assessSuitability(person).suitable) return;
  if (checked) {
    if (selectedIds.size >= 3 && !selectedIds.has(id)) { status('You can choose up to three stories. Remove one selection to choose another.'); showPeople(); return; }
    selectedIds.add(id); stories.set(id,buildStory(person)); currentView = 'story'; selectPerson(id);
  } else {
    selectedIds.delete(id); stories.delete(id); feedback.delete(id); investigations.delete(id);
    if (selectedId === id && selectedIds.size) selectedId = [...selectedIds][0];
    selectPerson(selectedId || id);
  }
  showPeople(); showCollection();
}
function records(person) {
  const section = node('section',undefined,'detail-section'); section.append(node('h3','What the file actually says'));
  section.append(node('p','GEDCOM assertions · Unverified. A citation count does not show that a record is reliable or has been checked.','small'));
  person.events.forEach((event,i) => {
    const row = node('div',undefined,'event'); row.append(node('span',(eventNames[event.type] || 'Event') + ' ' + (i + 1),'event-label'));
    const values = node('div'); values.append(node('p',event.date || 'Date not shown'));
    if (event.place) values.append(node('p',event.place));
    values.append(node('p',event.citationCount + ' imported citation references · Details omitted','small')); row.append(values); section.append(row);
  });
  if (person.relationships.length) {
    section.append(node('h3','Eligible family links'));
    for (const relative of person.relationships) section.append(node('p',relative.name + ' · ' + relative.kind + ' in the file','small'));
    section.append(node('p','These links do not establish biological parentage. Withheld relatives are omitted.','small'));
  }
  return section;
}
function selectPerson(id) {
  if (!tree || checkExpiry()) return;
  const person = tree.people.find(p => p.id === id); if (!person) return;
  selectedId = id;
  const detail = $('person-detail'); detail.replaceChildren();
  const story = stories.get(id);
  if (!story) {
    const header = node('div',undefined,'story-header');
    header.append(node('p','Browse the imported assertions','eyebrow'),node('h2',person.name),node('span','GEDCOM · Unverified','badge'));
    detail.append(header);
    const assessment = assessSuitability(person);
    detail.append(node('p',assessment.suitable ? 'Choose this person to read their story and explore a research question.' : assessment.reason));
    if (assessment.suitable) {
      const choose = node('button','Choose this story →','primary'); choose.disabled = selectedIds.size >= 3;
      choose.addEventListener('click',() => toggleStory(id,true)); detail.append(choose);
    }
    detail.append(records(person));
  } else {
    const header = node('div',undefined,'story-header');
    header.append(node('p',person.name,'eyebrow'),node('span',demoMode ? 'Fictional demo · Unverified GEDCOM assertions' : 'GEDCOM assertions · Unverified','badge'),node('h2',story.title),node('p',story.subtitle,'subtitle'));
    detail.append(header);
    const tabs = node('nav',undefined,'view-tabs'); tabs.setAttribute('aria-label','Story sections');
    for (const [view,label] of [['story','Family story'],['context','Historical context'],['investigation','Investigation'],['feedback','Your feedback']]) {
      const button = node('button',label); button.setAttribute('aria-pressed',String(currentView === view));
      button.addEventListener('click',() => {currentView = view; selectPerson(id);}); tabs.append(button);
    }
    detail.append(tabs);
    if (currentView === 'story') renderStory(detail,story,person);
    else if (currentView === 'context') renderContext(detail,story);
    else if (currentView === 'investigation') renderInvestigation(detail,story,id);
    else renderFeedback(detail,id);
  }
  showPeople(); showCollection();
}
function renderStory(detail,story,person) {
  const reading = node('div',undefined,'reading');
  for (const paragraph of story.paragraphs) {
    reading.append(node('p',paragraph.text));
    if (paragraph.assertionIds.length) reading.append(node('p','Based on imported assertions ' + paragraph.assertionIds.join(', ') + ' · Unverified','support-label'));
  }
  detail.append(reading);
  const sourceDetails = node('details',undefined,'detail-section'); sourceDetails.append(node('summary','Inspect the assertions behind this story'));
  for (const assertion of story.assertions) {
    const row = node('div',undefined,'event'); row.append(node('span',assertion.id,'event-label'));
    const values = node('div'); values.append(node('p',assertion.label),node('p',[assertion.date || 'Date not shown',assertion.place].filter(Boolean).join(' · ')),node('p','Unverified · ' + assertion.citationCount + ' imported citation references','small')); row.append(values); sourceDetails.append(row);
  }
  detail.append(sourceDetails);
  const links = node('details',undefined,'detail-section'); links.append(node('summary','Browse original supported fields & family links'),records(person)); detail.append(links);
  const limits = node('ul',undefined,'small'); story.limitations.forEach(text => limits.append(node('li',text))); detail.append(limits);
}
function renderContext(detail,story) {
  detail.append(node('p','Context describes record-making and research possibilities. It does not establish what this person experienced.','small'));
  for (const context of story.context) {
    const card = node('section',undefined,'context-card'); card.append(node('p',context.label,'eyebrow'),node('p',context.text));
    if (context.sourceUrl && /^https:\/\//.test(context.sourceUrl)) {
      const link = node('a',context.sourceTitle || 'Read context source (opens online)');
      link.href = context.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link,node('p','Optional online reading. No ancestor name or search is included in this link.','small'));
    }
    detail.append(card);
  }
  const fiction = node('details',undefined,'reconstruction');
  fiction.append(node('summary','Optional imagined scene · Fictional, not evidence'),node('span',story.reconstruction.label,'badge fiction'),node('p',story.reconstruction.text));
  detail.append(fiction);
}
function renderInvestigation(detail,story,id) {
  const investigation = story.investigation;
  detail.append(node('p','A question to take to the records','eyebrow'),node('p',investigation.question,'question'),node('p','Consider these interpretations. Choosing one changes the explanation; it does not verify the family history.','small'));
  const options = node('div',undefined,'options'); const response = node('p',undefined,'investigation-response'); response.setAttribute('role','status');
  response.hidden = true;
  const selected = investigations.get(id);
  for (const option of investigation.options) {
    const button = node('button',option.label); button.setAttribute('aria-pressed',String(selected === option.id));
    if (selected === option.id) {response.textContent = option.response; response.hidden = false;}
    button.addEventListener('click',() => {if (checkExpiry()) return; investigations.set(id,option.id); selectPerson(id);}); options.append(button);
  }
  detail.append(options,response,node('h3','How you could investigate'));
  const list = node('ol',undefined,'research-list'); investigation.steps.forEach(step => list.append(node('li',step))); detail.append(list);
  detail.append(node('p','Research suggestions only. No records have been retrieved, no documents invented, and no interpretation is established.','small'));
}
function renderFeedback(detail,id) {
  if (!feedback.has(id)) feedback.set(id,{ratings:{},flags:[],comment:''});
  const entry = feedback.get(id);
  detail.append(node('h3','How does this story feel?'),node('p','Use what you know about the family. “Cannot judge” is useful too. Feedback stays in memory until you download it or clear the preview.','small'));
  const saved = node('p','Changes stay in this session.','feedback-saved'); saved.setAttribute('role','status');
  const note = () => {saved.textContent = 'Feedback updated in this session.';};
  for (const [key,label,help] of [['accuracy','Accuracy','Does it represent the GEDCOM and what you know?'],['realism','Historical realism','Is the context believable, with uncertainty clear?'],['interest','Interest','Would you want to read or investigate more?'],['immersivePotential','Immersive potential','Would exploring this as a historical experience appeal to you?']]) {
    const row = node('div',undefined,'feedback-row'), fieldset = node('fieldset');
    fieldset.append(node('legend',label),node('p',help));
    const options = node('div',undefined,'rating-options');
    for (const value of [1,2,3,4,5,'cannot-judge']) {
      const choice = node('label'), radio = node('input'); radio.type = 'radio'; radio.name = key; radio.value = String(value); radio.checked = entry.ratings[key] === value;
      radio.addEventListener('change',() => {if (checkExpiry()) return; entry.ratings[key] = value; note();});
      choice.append(radio,node('span',value === 'cannot-judge' ? 'Cannot judge' : value)); options.append(choice);
    }
    fieldset.append(options,node('p','1 = Low · 5 = High','small')); row.append(fieldset); detail.append(row);
  }
  const flags = node('div',undefined,'feedback-flags'); flags.append(node('h3','Anything we should improve?'));
  for (const [key,label] of [['inaccuracy','A date, place or relationship seems inaccurate'],['unsupported','The writing seems to imply more than the evidence supports'],['context','The historical context seems inappropriate'],['uninteresting','The story needs a more interesting focus']]) {
    const choice = node('label'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = entry.flags.includes(key);
    checkbox.addEventListener('change',() => {if (checkExpiry()) return; entry.flags = checkbox.checked ? [...new Set([...entry.flags,key])] : entry.flags.filter(x => x !== key); note();});
    choice.append(checkbox,node('span',label)); flags.append(choice);
  }
  detail.append(flags);
  const label = node('label','What should change, or what would you explore next?','feedback-comment'); label.htmlFor = 'feedback-comment';
  const comment = node('textarea'); comment.id = 'feedback-comment'; comment.rows = 4; comment.maxLength = 2000; comment.value = entry.comment;
  comment.addEventListener('input',() => {if (checkExpiry()) return; entry.comment = comment.value; note();});
  detail.append(label,comment,node('p','Avoid details about living people if you plan to share your feedback file.','small'),saved);
}
function downloadFeedback() {
  if (!tree || checkExpiry() || !selectedIds.size) return;
  const includeNames = $('include-names').checked;
  const items = [...selectedIds].map((id,i) => {
    const entry = feedback.get(id) || {ratings:{},flags:[],comment:''};
    return {storyNumber:i+1,...(includeNames ? {name:tree.people.find(p => p.id === id).name} : {}),ratings:{...entry.ratings},flags:[...entry.flags],comment:entry.comment,investigationChoice:investigations.get(id) || null};
  });
  const output = {previewVersion:'0.1.0',fictionalDemo:demoMode,personalClaims:'Unverified GEDCOM assertions; no archive verification',scale:'1 low, 5 high; cannot-judge available',namesIncluded:includeNames,stories:items};
  const url = URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'})); exportUrls.add(url);
  const link = node('a'); link.href = url; link.download = 'genealogy-story-feedback.json'; link.click();
  setTimeout(() => {URL.revokeObjectURL(url); exportUrls.delete(url);},1000);
  status('Feedback download requested. Nothing was sent online. Downloaded files remain until you delete them.');
}
async function readTree(isDemo = false) {
  if (!standalone || busy || (!isDemo && !controls.consent.checked)) return;
  const file = isDemo ? null : controls.file.files[0];
  if (!isDemo && !file) return;
  if (!isDemo && (file.size <= 0 || file.size > MAX_BYTES || !/\.(ged|gedcom)$/i.test(file.name))) {
    status('Choose a nonempty .ged or .gedcom export, GEDCOM 5.5.1 UTF-8, no larger than 5 MiB.',true); controls.file.value = ''; updateControls(); return;
  }
  epoch += 1; const job = epoch;
  stopWorker(); releaseProjection(); busy = true; updateControls();
  status('Reading on your device and applying privacy filters…'); controls.read.textContent = 'Reading…';
  try {
    workerUrl = URL.createObjectURL(new Blob([parserWorkerSource],{type:'text/javascript'})); worker = new Worker(workerUrl);
    const finishError = message => {
      if (job !== epoch) return;
      epoch += 1;
      stopWorker(); busy = false; controls.file.value = ''; controls.read.textContent = 'Read my tree →'; status(message,true); updateControls();
    };
    worker.onerror = () => finishError('The file could not be processed. Try a current browser and a GEDCOM 5.5.1 UTF-8 export.');
    worker.onmessage = ({data}) => {
      if (job !== epoch) return;
      stopWorker(); busy = false; controls.file.value = ''; controls.read.textContent = 'Read my tree →';
      if (!data.ok) {status(data.message,true); updateControls(); return;}
      tree = data.result; demoMode = isDemo; importedAt = lastActivity = Date.now();
      $('tree-panel').hidden = false; showSummary(); showPeople();
      const candidate = tree.people.find(p => assessSuitability(p).suitable) || tree.people[0];
      if (candidate) selectPerson(candidate.id);
      else $('person-detail').append(node('h2','No eligible historical people'),node('p','This file was read, but no person meets the existing privacy rules. People with no qualifying recorded death remain withheld.'));
      status(isDemo ? 'Fictional demo loaded locally. Choose up to three invented people.' : 'Your tree was read locally. Choose up to three story candidates.');
      updateControls(); $('tree-panel').scrollIntoView({behavior:'smooth',block:'start'});
    };
    parsingTimer = setTimeout(() => finishError('Reading took too long and was stopped. Try a smaller GEDCOM export.'),20_000);
    const bytes = isDemo ? new TextEncoder().encode(fictionalDemo).buffer : await file.arrayBuffer();
    if (job !== epoch || !worker) return;
    worker.postMessage({bytes},[bytes]);
  } catch {
    if (job !== epoch) return;
    epoch += 1;
    stopWorker(); busy = false; controls.file.value = ''; controls.read.textContent = 'Read my tree →'; status('The file could not be read on this device. Nothing was uploaded or saved.',true); updateControls();
  }
}
controls.consent.addEventListener('change',() => {
  if (!controls.consent.checked) clearTree('Consent withdrawn. Tree, stories and feedback were cleared.'); else updateControls();
});
controls.file.addEventListener('change',updateControls);
controls.read.addEventListener('click',() => readTree()); controls.demo.addEventListener('click',() => readTree(true));
controls.clear.addEventListener('click',() => clearTree());
controls.search.addEventListener('input',() => {currentPage = 0; showPeople();});
$('previous').addEventListener('click',() => {currentPage -= 1; showPeople();}); $('next').addEventListener('click',() => {currentPage += 1; showPeople();});
$('download-feedback').addEventListener('click',downloadFeedback);
for (const type of ['pointerdown','keydown','input','wheel']) document.addEventListener(type,activity,{passive:true});
document.addEventListener('visibilitychange',checkExpiry); window.addEventListener('focus',checkExpiry); window.addEventListener('pageshow',checkExpiry);
window.addEventListener('pagehide',() => clearTree('No file has been read.')); setInterval(checkExpiry,15_000);
updateControls(); if (!standalone) status('Open this preview directly in its own browser tab before reading a GEDCOM.',true);
