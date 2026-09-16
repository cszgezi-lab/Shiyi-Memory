import { foldName, personaIdentity } from '../src/persona-identity.js';
import { currentPersonaProfiles } from '../src/dynamic-persona.js';
import { characterKeepsakes } from '../src/character-journal.js';
import { characterRecordSubjects, explicitSubjectNames, factKey } from '../src/product-person-profiles.js';
import { sourceLabel, recordTitle, epistemicLabel } from '../src/product-narrative.js';
import { esc } from '../src/product-settings-ui.js';

const PAGE_SIZE = 6;
const nameKey = name => foldName(name).trim();
const namesOf = value => explicitSubjectNames(value).filter(n => !/^(我|你|他|她|它|我们|你们|他们|她们|i|you|he|she|they)$/i.test(n));
const preview = (value, limit = 280) => {
  const text = String(value ?? '');
  return esc(text.length > limit ? `${text.slice(0, limit)}…` : text);
};

/** A disposable reading projection. No writes, identity merges or new records. */
export function peopleGroups(snapshot = {}) {
  const cards = (snapshot.cards ?? []).filter(c => !['retracted', 'superseded'].includes(c.lifecycleState));
  const profiles = (snapshot.dynamicPersona?.profiles ?? []).filter(p => !p.deleted);
  const dictionary = snapshot.dictionary ?? { entries: [] };
  const settings = snapshot.settings ?? {};
  const keepsakes = characterKeepsakes(cards, { withExpected: false });
  const terms = [...(dictionary.entries ?? []), ...cards.flatMap(c => c.entities ?? [])];
  const nonPeople = new Set(terms.filter(t => ['地点', '组织', '物品'].includes(t?.kind)).map(t => nameKey(t.name)));
  const definitePeople = new Set([
    ...profiles.map(p => p.name),
    ...terms.filter(t => t?.kind === '人物').map(t => t.name),
    ...cards.filter(c => c.category !== 'entityFactChanges').flatMap(characterRecordSubjects),
    ...keepsakes.diaries.flatMap(r => namesOf(r.subject)),
    ...keepsakes.dialogues.flatMap(r => [...namesOf(r.subject), ...namesOf(r.target)]),
  ].map(nameKey));
  const person = name => !nonPeople.has(nameKey(name)) || definitePeople.has(nameKey(name));
  const recordNames = card => characterRecordSubjects(card).filter(person);
  const seedDictionary = { ...dictionary, entries: (dictionary.entries ?? []).filter(t => person(t.name)) };
  const base = personaIdentity({ previous: profiles, dictionary: seedDictionary, aliases: settings.aliases ?? '' });
  // Do not promote a shared nickname to a new canonical identity during seeding.
  const claimed = new Set(base.people.flatMap(p => [p.name, ...p.aliases]).map(nameKey));
  const rawNames = [...new Set([
    ...cards.flatMap(recordNames),
    ...keepsakes.diaries.flatMap(r => namesOf(r.subject)),
    ...keepsakes.dialogues.flatMap(r => [...namesOf(r.subject), ...namesOf(r.target)]),
  ])];
  const identity = personaIdentity({
    previous: [...profiles, ...rawNames.filter(n => !claimed.has(nameKey(n))).map(name => ({ name, aliases: [], aliasPolicy: 'manual' }))],
    dictionary: seedDictionary, aliases: settings.aliases ?? '',
  });
  const owners = new Map();
  for (const p of identity.people) for (const n of [p.name, ...p.aliases]) {
    const key = nameKey(n);
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(p.key);
  }
  const groups = new Map();
  const groupFor = name => {
    const resolved = identity.resolve(name), folded = nameKey(name);
    const ambiguous = !resolved && (owners.get(folded)?.size ?? 0) > 1;
    const key = resolved?.key ?? `unresolved:${folded}`;
    if (!groups.has(key)) groups.set(key, {
      key, name: resolved?.name ?? name, ambiguous,
      aliases: [...(resolved?.visibleAliases ?? [])].filter(a => identity.resolve(a)?.key === resolved.key),
      profiles: [], diaries: [], dialogues: [], facts: [], records: [],
    });
    return groups.get(key);
  };
  const attach = (names, field, row) => {
    for (const group of new Set(names.map(groupFor))) if (!group[field].includes(row)) group[field].push(row);
  };
  for (const p of profiles) attach(namesOf(p.name), 'profiles', p);
  for (const card of cards) {
    const names = recordNames(card);
    attach(names, 'records', card);
    if (card.category === 'entityFactChanges' && !card.customModuleId) attach(names, 'facts', card);
  }
  for (const row of keepsakes.diaries) {
    const names = namesOf(row.subject); // An inner-life target does not own this private account.
    attach(names, 'diaries', row);
    attach(names, 'records', row.record);
  }
  for (const row of keepsakes.dialogues) {
    const names = [...namesOf(row.subject), ...namesOf(row.target)];
    attach(names, 'dialogues', row);
    attach(names, 'records', row.record);
  }
  return [...groups.values()].map(group => ({
    ...group,
    profiles: currentPersonaProfiles(group.profiles, settings.dynamicPersonaMvuMode),
    fieldCount: new Set(group.facts.map(factKey).filter(k => k != null)).size,
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export function peopleHTML() {
  return `<section data-view="people" hidden class="sy-people">
    <div class="sy-top"><h3>人物</h3><span data-people-count class="sy-help" role="status"></span></div>
    <nav class="sy-people-links" aria-label="全部人物记录">
      <button type="button" data-people-all="dynamic-persona">全部档案</button>
      <button type="button" data-people-all="diary">全部心迹</button>
      <button type="button" data-people-all="dialogue">全部台词</button>
    </nav>
    <div class="sy-people-layout">
      <details data-people-directory class="sy-people-directory">
        <summary><span class="sy-people-switch"><strong data-people-current>选择人物</strong><span class="sy-people-switch-hint">切换人物 · <span data-people-total>0</span> 位</span></span></summary>
        <label class="sy-people-search">查找人物<input type="search" data-people-search placeholder="姓名或别称" autocomplete="off"></label>
        <div data-people-list class="sy-people-list"></div>
        <div class="sy-people-pagination"><button type="button" data-people-prev aria-label="人物上一页">上一页</button><span data-people-page role="status"></span><button type="button" data-people-next aria-label="人物下一页">下一页</button></div>
      </details>
      <article data-people-detail class="sy-people-reading" aria-label="人物阅读区"></article>
    </div>
    <details class="sy-people-settings"><summary>API 与更新设置</summary><div class="sy-people-links"><button type="button" data-people-page-link="api">API 与模型</button><button type="button" data-people-page-link="dynamic-persona">人设更新设置</button></div></details>
  </section>`;
}

const openButton = (group, kind, label, profileId = '') => `<button type="button" data-people-open="${kind}" data-people-profile="${esc(profileId)}"${group.ambiguous && !profileId ? ' disabled' : ''}>${label}</button>`;
const sourceText = record => record.sourceRefs?.length || record.sourceFloors?.length || Number.isInteger(record.floorIndex) || record.documentName
  ? sourceLabel(record) : '来源未注明';
const phase = row => row.data.disabled ? '不再注入' : row.record.innerLifeHistorical || row.data.status === 'historical'
  ? '过去阶段' : row.kind === 'dialogue' ? '仍重要' : '按记录情境适用';

const peopleMergeHTML = profiles => {
  if (profiles.length < 2) return '';
  const ordered = [...profiles].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name, 'zh-CN'));
  const source = ordered[0], target = [...ordered].sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, 'zh-CN'))[0];
  const options = rows => rows.map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.bindings?.length ? ' · 已关联原书' : ''}</option>`).join('');
  return `<details class="sy-people-merge" data-people-merge>
    <summary>合并重复人物档案</summary>
    <p class="sy-help">适合“濑名紫阳花／紫阳花”这类重复档案。选择要并入的档案和要保留正式姓名的档案；内容、动态属性、心迹、台词、来源与别称会合并，不调用模型，原档案可恢复。</p>
    <label>并入档案<select data-people-merge-source-select aria-label="要并入的人物档案">${options(ordered)}</select></label>
    <label>保留档案<select data-people-merge-target-select aria-label="要保留的人物档案">${options(ordered.filter(p => p.id !== source.id))}</select></label>
    <button type="button" data-people-merge-commit>确认合并档案</button>
  </details>`;
};

export function peopleDetailHTML(group, allProfiles = group?.profiles ?? []) {
  if (!group) return '<p class="sy-empty">暂无人物记录。已有档案、心迹、台词和人物属性会汇集在这里。</p>';
  const profileId = group.profiles[0]?.id ?? '';
  const profileRows = group.profiles.slice(0, 2).map(p => `<div class="sy-people-entry"><p class="sy-help">${p.locked ? '已锁定 · ' : ''}${Number.isInteger(p.through) ? `依据至 #${p.through}` : '已保存档案'}${group.profiles.length > 1 ? ` · ${esc(p.stage ?? '未注明阶段')}` : ''}</p><p class="sy-people-prose">${preview(p.text, 480)}</p>${openButton(group, 'dynamic-persona', '查看档案与来源', p.id)}</div>`).join('');
  const diaryRows = group.diaries.slice(0, 2).map(r => `<div class="sy-people-entry"><h6>${esc(r.data.stage ?? '未注明阶段')}</h6><p class="sy-help">${phase(r)} · ${esc(epistemicLabel(r.data.basis) ?? '依据未注明')}${r.data.origin === 'stage_observation' ? ' · 阶段观察，非逐字心声' : ''}</p><p class="sy-people-prose">${preview(r.data.text)}</p><p class="sy-help">${esc(sourceText(r.record))}</p></div>`).join('');
  const dialogueRows = group.dialogues.slice(0, 2).map(r => `<div class="sy-people-entry"><p class="sy-help">${esc(r.subject)}${r.target ? ` → ${esc(r.target)}` : ''} · ${phase(r)}${r.data.provenance === 'user_authored' ? ' · 用户编写，非核对原话' : ''}</p><blockquote>${preview(r.data.text)}</blockquote>${r.data.context ? `<p>${preview(r.data.context, 160)}</p>` : ''}<p class="sy-help">${esc(sourceText(r.record))}</p></div>`).join('');
  const sources = [...new Map(group.records.map(r => [r.id, r])).values()];
  return `<h4 data-people-title tabindex="-1">${esc(group.name)}</h4>
    ${group.aliases.length ? `<p class="sy-help">别称：${esc(group.aliases.join('、'))}</p>` : ''}
    ${group.ambiguous ? '<p class="sy-help" role="status">此称呼对应多人，暂不归入任何人的档案。请从全部记录核对姓名或在召回字典中确认别称。</p>' : ''}
    <dl class="sy-people-stats"><div><dt>档案</dt><dd>${group.profiles.length}</dd></div><div><dt>心迹</dt><dd>${group.diaries.length}</dd></div><div><dt>台词</dt><dd>${group.dialogues.length}</dd></div><div><dt>属性</dt><dd>${group.fieldCount}</dd></div></dl>
    <section class="sy-people-section"><h5>动态档案</h5>${profileRows || `<p class="sy-help">尚无动态档案</p>${openButton(group, 'dynamic-persona', '查看或补建档案')}`}${group.profiles.length > 2 ? openButton(group, 'dynamic-persona', `查看全部 ${group.profiles.length} 份档案`) : ''}</section>
    ${peopleMergeHTML(allProfiles)}
    <section class="sy-people-section"><h5>角色心迹 <small>${group.diaries.length}</small></h5>${diaryRows || '<p class="sy-help">尚无心迹</p>'}${group.diaries.length ? '<p class="sy-help">私密演绎参考，不赋予他人知情。</p>' : ''}${openButton(group, 'diary', '查看心迹与来源', profileId)}</section>
    <section class="sy-people-section"><h5>关键台词 <small>${group.dialogues.length}</small></h5>${dialogueRows || '<p class="sy-help">尚无关键台词</p>'}${openButton(group, 'dialogue', '查看台词与来源', profileId)}</section>
    <section class="sy-people-section"><h5>人物属性</h5><p class="sy-help">${group.fieldCount} 项属性 · ${group.facts.length} 条记录，含不同时间与情境的取值。</p>${openButton(group, 'facts', '查看属性与来源', profileId)}</section>
    <details class="sy-people-sources"><summary>来源与关联记忆 · ${sources.length} 条</summary>
      ${group.profiles.slice(0, 2).map(p => `<div class="sy-people-entry"><p>${esc(p.name)} · ${esc(sourceText(p))}</p>${[...new Map((p.bindings ?? []).map(b => [JSON.stringify([b.book, b.uid]), b])).values()].slice(0, 6).map(b => `<p class="sy-help">${esc(b.book)} · ${esc(b.originalName ?? b.name)}（原书只读）</p>`).join('')}${openButton(group, 'dynamic-persona', '查看完整档案来源', p.id)}</div>`).join('')}
      ${sources.slice(0, 6).map(r => `<p>${preview(recordTitle(r), 72)}<small class="sy-help">${esc(sourceText(r))}</small></p>`).join('') || '<p class="sy-help">暂无关联记忆</p>'}
      ${sources.length > 6 ? '<p class="sy-help">此处展示前 6 条来源；完整来源见对应档案、心迹、台词或属性页。</p>' : ''}
    </details>`;
}

/** onSelect owns filtered navigation; an empty name clears that page's filter. */
export function mountPeopleView({ panel, app, run, host, setPage, onSelect }) {
  const root = panel.querySelector('[data-view="people"]');
  const $ = selector => root.querySelector(selector);
  let scope, stamp = '', rendered = '', groups = [], page = 1, selected = '';
  const filter = () => {
    const query = nameKey($('[data-people-search]').value);
    return groups.filter(g => [g.name, ...g.aliases].some(n => nameKey(n).includes(query)));
  };
  function draw() {
    const visible = filter(), pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
    page = Math.max(1, Math.min(page, pages));
    const rows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!rows.some(g => g.key === selected)) selected = rows[0]?.key ?? '';
    const group = rows.find(g => g.key === selected);
    $('[data-people-count]').textContent = `${groups.length} 位人物`;
    $('[data-people-current]').textContent = group?.name ?? (groups.length ? '没有匹配的人物' : '暂无人物');
    $('[data-people-total]').textContent = String(groups.length);
    $('[data-people-page]').textContent = `${page} / ${pages}`;
    $('[data-people-prev]').disabled = page === 1;
    $('[data-people-next]').disabled = page === pages;
    $('[data-people-list]').innerHTML = rows.map(g => `<button type="button" data-people-key="${esc(g.key)}" aria-pressed="${g.key === selected}"><strong>${esc(g.name)}</strong><small>${g.ambiguous ? '称呼待确认' : `${g.profiles.length} 档案 · ${g.diaries.length} 心迹 · ${g.dialogues.length} 台词 · ${g.fieldCount} 属性`}</small></button>`).join('') || '<p class="sy-empty">没有匹配的人物</p>';
    const allProfiles = groups.flatMap(g => g.profiles);
    const detail = !group && groups.length ? '<p class="sy-empty">没有匹配的人物，试试其他姓名或别称。</p>' : peopleDetailHTML(group, allProfiles);
    if (detail !== rendered) { $('[data-people-detail]').innerHTML = detail; rendered = detail; }
  }
  function paint(snapshot) {
    if (root.hidden) return;
    const nextScope = JSON.stringify(snapshot.scope ?? snapshot.core?.scope ?? app?.core?.state?.scope ?? null);
    if (scope !== nextScope) {
      scope = nextScope; page = 1; selected = ''; stamp = ''; rendered = '';
      $('[data-people-search]').value = '';
      $('[data-people-directory]').open = false;
    }
    const revision = snapshot.peopleRevision;
    const nextStamp = revision != null ? `revision:${revision}`
      : `legacy:${JSON.stringify([snapshot.cardRevision ?? snapshot.cards, snapshot.dynamicPersona?.profiles, snapshot.dictionary, snapshot.settings?.aliases, snapshot.settings?.dynamicPersonaMvuMode])}`;
    if (stamp === nextStamp) return;
    groups = peopleGroups(snapshot); stamp = nextStamp; draw();
  }
  $('[data-people-search]').addEventListener('input', () => { page = 1; draw(); });
  root.addEventListener('change', event => {
    const select = event.target.closest('[data-people-merge-source-select]');
    if (!select) return;
    const target = root.querySelector('[data-people-merge-target-select]');
    if (!target) return;
    const allProfiles = groups.flatMap(g => g.profiles);
    target.innerHTML = allProfiles.filter(p => p.id !== select.value).sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name, 'zh-CN')).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.bindings?.length ? ' · 已关联原书' : ''}</option>`).join('');
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-people-key')) {
      selected = button.dataset.peopleKey; draw();
      $('[data-people-directory]').open = false;
      const title = $('[data-people-title]');
      title?.focus({ preventScroll: true });
      title?.scrollIntoView({ block: 'start', behavior: 'instant' });
      return;
    }
    if (button.hasAttribute('data-people-prev') || button.hasAttribute('data-people-next')) {
      page += button.hasAttribute('data-people-prev') ? -1 : 1; draw();
      $('[data-people-list] button')?.focus(); return;
    }
    if (button.dataset.peoplePageLink) { setPage?.(button.dataset.peoplePageLink); return; }
    if (button.dataset.peopleAll) { onSelect?.({ name: '', profileId: null, kind: button.dataset.peopleAll }); return; }
    if (button.hasAttribute('data-people-merge-commit')) {
      const source = root.querySelector('[data-people-merge-source-select]')?.value;
      const target = root.querySelector('[data-people-merge-target-select]')?.value;
      const profiles = groups.flatMap(g => g.profiles), sourceProfile = profiles.find(p => p.id === source), targetProfile = profiles.find(p => p.id === target);
      if (!sourceProfile || !targetProfile || source === target) return;
      void run(async () => {
        if (await host.confirm?.(`将“${sourceProfile.name}”并入“${targetProfile.name}”？原档案会保留在可恢复版本中。`) !== true) return;
        selected = groups.find(g => g.profiles.some(p => p.id === target))?.key ?? selected;
        return app.mergeDynamicPersona(source, target);
      }, { name: 'dynamic-persona', button });
      return;
    }
    if (button.dataset.peopleOpen) {
      const group = groups.find(g => g.key === selected);
      // A profile-specific link is safe even when another unresolved record
      // shares its nickname; only broad record navigation stays disabled.
      if (group && (!group.ambiguous || button.dataset.peopleProfile)) onSelect?.({ name: group.name, profileId: button.dataset.peopleProfile || null, kind: button.dataset.peopleOpen });
    }
  });
  return { paint };
}
