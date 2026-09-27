export const ABILITIES = {str:'СИЛ',dex:'ЛОВ',con:'ТЕЛ',int:'ИНТ',wis:'МДР',cha:'ХАР'};
export const CONDITIONS = {
  'Ослеплён':'Атаки с помехой; атаки по существу с преимуществом.',
  'Очарован':'Нельзя атаковать очаровавшего.',
  'Оглох':'Не слышит.',
  'Испуган':'Проверки и атаки с помехой, пока виден источник страха.',
  'Схвачен':'Скорость 0; атаки по другим целям с помехой.',
  'Недееспособен':'Нет действий, бонусных действий и реакций; концентрация заканчивается.',
  'Невидим':'Обычно преимущество атак; атаки по существу с помехой.',
  'Парализован':'Недееспособен; провал спасбросков СИЛ и ЛОВ.',
  'Окаменел':'Недееспособен; сопротивление всему урону.',
  'Отравлен':'Атаки и проверки характеристик с помехой.',
  'Сбит с ног':'Собственные атаки с помехой; вставание стоит половины скорости.',
  'Опутан':'Скорость 0; атаки и спасброски ЛОВ с помехой.',
  'Ошеломлён':'Недееспособен; провал спасбросков СИЛ и ЛОВ.',
  'Без сознания':'Недееспособен; провал спасбросков СИЛ и ЛОВ.',
  'Истощение':'На каждом уровне: −2 к тестам d20, −5 футов скорости.',
};
export const defaultCombat = () => ({abilities:Object.fromEntries(Object.keys(ABILITIES).map(k=>[k,{score:null,save:null}])),skills:'',defenses:'',actions:[]});
export const newAttack = () => ({id:crypto.randomUUID(),name:'',bonus:null,damage:'',range:'',saveDc:null,saveAbility:'dex',notes:''});
export const signed = n => n === null ? '—' : n >= 0 ? `+${n}` : String(n);
export const abilityBonus = score => score === null ? null : Math.floor((score-10)/2);
export const saveBonus = ability => ability.save ?? abilityBonus(ability.score);

export function parseDice(formula) {
  const source=String(formula).toLowerCase().replace(/\s/g,'');
  if(!source || source.length>100 || !/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/.test(source))throw new Error('Формула: например 2d6 + 3 или 1d8 + 1d6 + 4.');
  let count=0;
  const terms=source.match(/[+-]?[^+-]+/g).map(term=>{
    const sign=term[0]==='-'?-1:1, body=term.replace(/^[+-]/,'');
    if(!body.includes('d')){const value=Number(body);if(value>100000)throw new Error('Слишком большой модификатор.');return {sign,value};}
    const [n,s]=body.split('d'), dice=Number(n||1), sides=Number(s);count+=dice;
    if(dice<1||sides<2||sides>1000||count>100)throw new Error('До 100 костей, от d2 до d1000.');
    return {sign,dice,sides};
  });
  return terms;
}
export function rollDie(sides) {
  const limit=Math.floor(4294967296/sides)*sides, values=new Uint32Array(1);
  do{crypto.getRandomValues(values);}while(values[0]>=limit);
  return values[0]%sides+1;
}
export function rollDamage(formula,{critical=false,die=rollDie}={}) {
  const terms=parseDice(formula), parts=[];let total=0;
  for(const t of terms){
    const rolls=t.dice?Array.from({length:t.dice*(critical?2:1)},()=>die(t.sides)):[];
    const value=t.dice?rolls.reduce((a,b)=>a+b,0):t.value;
    total+=t.sign*value;parts.push(`${t.sign<0?'−':'+'}${t.dice?`[${rolls.join(', ')}]`:value}`);
  }
  return {total:Math.max(0,total),detail:parts.join(' ').replace(/^\+/,''),formula:String(formula)};
}
export function rollCheck(bonus,{mode='normal',manual='',extra=0,die=rollDie}={}) {
  if(!Number.isInteger(bonus)||bonus < -100||bonus>100||!Number.isInteger(extra)||Math.abs(extra)>100)throw new Error('Укажите целый бонус от −100 до 100.');
  if(!['normal','advantage','disadvantage'].includes(mode))throw new Error('Неизвестный режим броска.');
  const count=mode==='normal'?1:2;
  const rolls=manual.trim()?manual.trim().split(/[\s,;]+/).map(Number):Array.from({length:count},()=>die(20));
  if(rolls.length!==count||rolls.some(n=>!Number.isInteger(n)||n<1||n>20))throw new Error(`Введите ${count===1?'одно число':'два числа'} от 1 до 20 — значения на костях.`);
  const natural=mode==='advantage'?Math.max(...rolls):mode==='disadvantage'?Math.min(...rolls):rolls[0];
  return {total:natural+bonus+extra,natural,detail:`d20 [${rolls.join(', ')}] ${signed(bonus)}${extra?` ${signed(extra)}`:''}`,formula:'d20',mode};
}

// Only extract values printed in the local SRD. Ambiguous damage stays in the
// source text: conditional extra dice must never silently become unconditional.
function legacyCombatFromSRD(text) {
  const result=defaultCombat(), flat=text.replace(/\n/g,' ');
  for(const [key] of Object.entries(ABILITIES)){
    const name=key[0].toUpperCase()+key.slice(1), m=flat.match(new RegExp(`\\b${name} (\\d+) ([+−-]\\d+) ([+−-]\\d+)`));
    if(m)result.abilities[key]={score:Number(m[1]),save:Number(m[3].replace('−','-'))};
  }
  result.skills=text.match(/^Skills (.+(?:\n(?![A-Z][a-z]+ |CR |Traits|Actions).+)*)/m)?.[1].replace(/\n/g,' ')||'';
  result.defenses=['Resistances','Immunities','Vulnerabilities'].map(label=>text.match(new RegExp(`^${label} (.+)$`,'m'))?.[0]).filter(Boolean).join('\n');
  const section=text.split(/\nActions\n/)[1];if(!section)return result;
  const blocks=section.split(/\n(?=[A-Z][A-Za-z0-9 ’',()\/–-]{0,100}\. )/);
  for(const raw of blocks){
    const block=raw.split(/\n(?:Bonus Actions|Reactions|Legendary Actions)(?:\n|$)/)[0].replace(/\n/g,' ');
    const m=block.match(/^([A-Z][A-Za-z0-9 ’',()\/–-]{0,100})\. (.*)$/);if(!m)continue;
    const action=newAttack();action.name=m[1];action.notes=m[2];
    const attack=m[2].match(/Attack Roll: ([+-]\d+)/);if(attack)action.bonus=Number(attack[1]);
    action.range=m[2].match(/(?:reach|range) [\d/]+ ft\./)?.[0]||'';
    const save=m[2].match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw: DC (\d+)/);
    if(save){action.saveDc=Number(save[2]);action.saveAbility=({Strength:'str',Dexterity:'dex',Constitution:'con',Intelligence:'int',Wisdom:'wis',Charisma:'cha'})[save[1]];}
    const dice=[...m[2].matchAll(/\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)/g)];
    if(dice.length===1 && /(?:Hit|Failure): \d+ \(\d+d\d+/.test(m[2]))action.damage=dice[0][1].replace(/\s/g,'');
    result.actions.push(action);
    if(result.actions.length===20)break;
  }
  return result;
}

// A capitalized continuation ("Slashing damage ...") is not an action title.
function actionHeading(name) {
  const words=name.replace(/\([^)]*\)/g,'').trim().split(/\s+/);
  return !['Hit','Failure','Success','Failure or Success'].includes(name) && words.every(w=>/^[A-Z][A-Za-z’'–-]*$/.test(w)||/^(?:of|the|and|or|a|an|to|in|with)$/.test(w));
}
export function combatFromSRD(text) {
  const result=legacyCombatFromSRD(text);result.actions=[];
  const section=text.split(/\nActions\n/)[1]?.split(/\n\nИсточник:/)[0].replace(/\n(?:Bonus Actions|Reactions|Legendary Actions)(?:\n|$)/g,'\n\n');
  if(!section)return result;
  const headings=[];
  // Lookahead allows a rejected continuation to overlap the next valid title.
  for(const m of section.matchAll(/^(?=([A-Z][A-Za-z0-9 ’',()\/–\-\n]{0,100})\. )/gm)){
    const name=m[1].replace(/\s+/g,' ').trim();if(actionHeading(name))headings.push({index:m.index,length:m[1].length+2,name});
  }
  for(let i=0;i<headings.length && result.actions.length<20;i++){
    const h=headings[i], notes=section.slice(h.index+h.length,headings[i+1]?.index).replace(/\s+/g,' ').trim();
    const action={...newAttack(),name:h.name,notes};
    const attack=notes.match(/Attack Roll: ([+−-]\d+)/);if(attack)action.bonus=Number(attack[1].replace('−','-'));
    action.range=notes.match(/(?:reach|range) [\d/]+ ft\./)?.[0]||'';
    const save=notes.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw: DC (\d+)/);
    if(save){action.saveDc=Number(save[2]);action.saveAbility=({Strength:'str',Dexterity:'dex',Constitution:'con',Intelligence:'int',Wisdom:'wis',Charisma:'cha'})[save[1]];}
    // Keep source-derived damage dynamic, including separately labelled extras.
    result.actions.push(action);
  }
  return result;
}

const damageTerm=/(\d+)(?:\s*\((\d+d\d+(?:\s*[+-]\s*\d+)?)\))?\s+(Acid|Bludgeoning|Cold|Fire|Force|Lightning|Necrotic|Piercing|Poison|Psychic|Radiant|Slashing|Thunder) damage/i;
const damageTypes={acid:'кислота',bludgeoning:'дробящий',cold:'холод',fire:'огонь',force:'силовой',lightning:'молния',necrotic:'некротический',piercing:'колющий',poison:'яд',psychic:'психический',radiant:'излучение',slashing:'рубящий',thunder:'звук'};
export function damageOptions(action) {
  if(action.damage)return [{formula:action.damage,label:'Урон',note:'',extra:false}];
  const clause=action.notes.replace(/\s+/g,' ').match(/(?:Hit|Failure): ([^.]+)/)?.[1];
  if(!clause)return [];
  const matches=[...clause.matchAll(new RegExp(damageTerm.source,'gi'))],base=[],types=[],extras=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i],before=clause.slice(i?matches[i-1].index+matches[i-1][0].length:0,m.index);
    if(i===0?before.trim()!=='':!/^\s*,?\s*(?:plus|and)\s*$/i.test(before))break;
    const tail=clause.slice(m.index+m[0].length,matches[i+1]?.index),formula=(m[2]||m[1]).replace(/\s/g,''),type=damageTypes[m[3].toLowerCase()];
    if(/\b(?:if|while|when|against|for each|or)\b/i.test(tail))extras.push({formula,label:`Доп. урон (${type})`,note:(m[0]+tail).trim(),extra:true});
    else {base.push(formula);types.push(type);}
  }
  return [...(base.length?[{formula:base.join('+'),label:'Урон',note:[...new Set(types)].join(' + '),extra:false}]:[]),...extras];
}

const profileSignature=p=>JSON.stringify({...p,actions:p.actions.map(({id,...a})=>a)});
export function upgradeSRDCombat(profile,text,ownerId) {
  if(!text.includes('Источник: SRD 5.2.1') || !text.includes('MOD SAVE'))return profile;
  // Preserve edits to homebrew or imported cards. Only replace the exact output
  // of the 0.7 parser, including its truncated actions, and preserve action IDs.
  const old=legacyCombatFromSRD(text);
  if(profileSignature(profile)!==profileSignature(old))return profile;
  const fresh=combatFromSRD(text);
  fresh.actions=fresh.actions.map((a,i)=>({...a,id:profile.actions.find(x=>x.name===a.name)?.id||`${ownerId}_srd_${i}`}));
  return fresh;
}

export function combatRollSpec(p,kind,key='',part='') {
  const action=p.combat.actions.find(a=>a.id===key),ability=p.combat.abilities[key];
  if(key==='' && kind==='attack')return {label:'Бросок попадания',bonus:null};
  if(key==='' && kind==='damage')return {label:'Урон',formula:''};
  if(kind==='initiative')return {label:'Инициатива',bonus:p.initiativeBonus};
  if(kind==='save' && ability)return {label:`Спасбросок ${ABILITIES[key]}`,bonus:saveBonus(ability)};
  if(kind==='ability' && ability)return {label:`Проверка ${ABILITIES[key]}`,bonus:abilityBonus(ability.score)};
  if(kind==='attack' && action)return {label:action.name,bonus:action.bonus,notes:action.notes};
  if(kind==='damage' && action){const options=damageOptions(action),damage=part===''?options.find(o=>!o.extra):options[Number(part)];return {label:action.name+(damage?.extra?' · дополнительный урон':''),formula:damage?.formula||'',notes:action.notes,condition:damage?.extra?damage.note:''};}
  throw new Error('Действие больше не существует.');
}
