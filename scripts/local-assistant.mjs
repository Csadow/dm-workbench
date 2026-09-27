// Only a loopback Ollama instance can receive campaign text. No cloud fallback.
const LOOPBACK = new Set(['127.0.0.1','localhost','[::1]']);
export function localOllamaUrl(value='http://127.0.0.1:11434') {
  const url=new URL(value);
  if(url.protocol!=='http:'||!LOOPBACK.has(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash) throw new Error('Ollama должен работать по HTTP на этом компьютере.');
  return url.origin;
}
export function validateChat(value) {
  if(!value||typeof value.model!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,119}$/.test(value.model)||/cloud/i.test(value.model)) throw new Error('Выберите установленную локальную модель.');
  if(!Array.isArray(value.messages)||value.messages.length<2||value.messages.length>12||value.messages[0]?.role!=='system'||value.messages.at(-1)?.role!=='user')throw new Error('Неверный формат диалога.');
  let length=0;
  for(const [i,m] of value.messages.entries()) {
    if(!m||!(i===0?m.role==='system':['user','assistant'].includes(m.role))||typeof m.content!=='string'||!m.content.trim()||m.content.length>30000)throw new Error('Неверное сообщение.');
    length+=m.content.length;
  }
  if(length>42000)throw new Error('Слишком большой контекст запроса.');
}
const json=(res,status,data)=>{if(!res.destroyed)res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(data));};
async function readJson(req) {
  if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new Error('Требуется JSON.');
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>150000)throw new Error('Слишком большой запрос.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Не удалось прочитать запрос.');}
}
export function createAssistantHandler({ollamaUrl=process.env.DMW_OLLAMA_URL,fetchImpl=fetch}={}) {
  const endpoint=localOllamaUrl(ollamaUrl);
  async function localJson(path,options={}) {
    const response=await fetchImpl(endpoint+path,{...options,redirect:'error',signal:options.signal||AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error(path==='/api/chat'?'Локальная модель не смогла ответить. Проверьте доступную память и имя модели.':'Ollama недоступен или модель не установлена.');
    return response.json();
  }
  return async function handleAssistant(req,res,path) {
    if(!path.startsWith('/api/ai/'))return false;
    const host=req.headers.host||'',origin=req.headers.origin;
    let hostname; try{hostname=new URL('http://'+host).hostname;}catch{}
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!LOOPBACK.has(hostname)|| (origin && origin!=='http://'+host) || (req.method==='POST' && !origin)) {json(res,403,{error:'Локальный ИИ доступен только со страницы этого приложения на localhost.'});return true;}
    if(path==='/api/ai/status'&&req.method==='GET') {
      try {
        const data=await localJson('/api/tags');
        const models=(data.models||[]).filter(m=>m.details?.format==='gguf'&&m.size>50000000&&!/cloud/i.test(m.name)).map(m=>m.name);
        json(res,200,{models,localOnly:true});
      }catch{json(res,503,{error:'Ollama не запущен. Запустите node scripts/start-local.mjs.',models:[]});}
      return true;
    }
    if(path!=='/api/ai/chat'||req.method!=='POST'){json(res,404,{error:'Неизвестный запрос.'});return true;}
    let payload;
    try{payload=await readJson(req);validateChat(payload);}catch(error){json(res,400,{error:error.message});return true;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
    const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
    try {
      const model=await localJson('/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:payload.model}),signal:controller.signal});
      if(model.remote_host||model.remote_model||model.details?.format!=='gguf'||!model.capabilities?.includes('completion'))throw new Error('Можно использовать только установленную локальную текстовую модель.');
      const result=await localJson('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({model:payload.model,messages:payload.messages,stream:false,...(model.capabilities.includes('thinking')?{think:false}:{}),keep_alive:'5m',options:{num_ctx:16384,num_predict:1800,temperature:0.65}})});
      if(typeof result.message?.content!=='string'||!result.message.content.trim()||result.message.content.length>16000)throw new Error('Модель вернула пустой или слишком большой ответ. Попробуйте более короткий запрос.');
      json(res,200,{text:result.message.content,model:payload.model,truncated:result.done_reason==='length'});
    }catch(error){json(res,controller.signal.aborted?504:503,{error:controller.signal.aborted?'Ответ не получен за 3 минуты. Попробуйте более короткий запрос.':error.message==='fetch failed'?'Ollama недоступен. Проверьте локальный запуск.':error.message});}
    finally{clearTimeout(timer);res.off('close',disconnect);}
    return true;
  };
}
