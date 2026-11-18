export function recoverySnapshot(storage:Record<string,string>,createdAt=Date.now()){
  const data=JSON.parse(storage['career-flow-data-v5']||'{"companies":[]}');
  if(!data||!Array.isArray(data.companies))throw new Error('INVALID_DRAFT');
  return {schemaVersion:5,createdAt,companies:data.companies,schedules:data.events||[],resources:data.materials||[],interviews:data.interviews||[],preparations:data.preparations||[],selectionRecords:[],settings:{theme:storage['careerflow-theme']||'system',locale:storage['careerflow-locale']||'zh',preferences:data.preferences,templates:data.templates||[]}};
}
