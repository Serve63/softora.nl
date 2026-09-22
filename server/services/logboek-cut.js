const {dateKey,weekday} = require('../../assets/logboek-cut-state');
const {createLogboekCutRepository} = require('../repositories/logboek-cut');
function validDate(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
function projectExercises(plan, date) {
  const day = plan?.days?.[weekday(date)];
  if (!day) throw new Error('Schedule unavailable');
  return (day.orders || []).map(order => {
    const row = day.exercises[order];
    if (!row) throw new Error('Invalid schedule');
    const source = {...row,...plan.exerciseSources?.[row.exerciseKey]};
    return {order:Number(order),title:String(source.title || row.title),kg:String(source.kg || ''),
      reps:String(source.reps || ''),sets:Math.max(0,Math.min(30,parseInt(source.sets,10)||0)),notes:String(source.notes || '')};
  });
}
function createLogboekCutService({repo = createLogboekCutRepository(), now = () => new Date()} = {}) {
  async function get(date = dateKey(now())) {
    const today = dateKey(now());
    if (!validDate(date) || date > today || date < '2020-01-01') throw Object.assign(new Error('Ongeldige trainingsdatum.'),{status:400});
    const plan=await repo.plan();
    const exercises=projectExercises(plan.payload,date);
    const existing = await repo.read(date);
    let session = existing || await repo.open(date,exercises);
    if(existing && date===today && JSON.stringify(existing.exercises)!==JSON.stringify(exercises)) {
      session=await repo.refreshExercises(date,exercises);
    }
    return {ok:true,today,serverNow:now().toISOString(),planUpdatedAt:plan.updatedAt,session};
  }
  async function set(input = {}) {
    if (!validDate(input.date) || !Number.isInteger(input.order) || input.order<0 ||
      !Number.isInteger(input.set) || input.set<0 || input.set>=30 || typeof input.done!=='boolean' ||
      !Number.isInteger(input.version) || input.version<0 || input.version>2147483646 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId || '')) {
      throw Object.assign(new Error('Ongeldige set.'),{status:400});
    }
    const {session} = await get(input.date);
    if (!session.exercises.some(row=>row.order===input.order && input.set<row.sets)) {
      throw Object.assign(new Error('Deze set staat niet in de training.'),{status:400});
    }
    return {ok:true,today:dateKey(now()),serverNow:now().toISOString(),...await repo.set(input)};
  }
  async function note(input = {}) {
    if (!validDate(input.date) || !Number.isInteger(input.order) || input.order<0 ||
      typeof input.text!=='string' || input.text.length>1000 || !Number.isInteger(input.version) ||
      input.version<0 || input.version>2147483646 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId || '')) {
      throw Object.assign(new Error('Ongeldige notitie.'),{status:400});
    }
    const {session} = await get(input.date);
    if (!session.exercises.some(row=>row.order===input.order)) {
      throw Object.assign(new Error('Deze oefening staat niet in de training.'),{status:400});
    }
    return {ok:true,today:dateKey(now()),serverNow:now().toISOString(),...await repo.note(input)};
  }
  return {get,set,note};
}
module.exports = {createLogboekCutService,projectExercises,validDate};
