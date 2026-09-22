const {rateLimit} = require('express-rate-limit');
const {createLogboekCutService} = require('../services/logboek-cut');
function registerLogboekCutRoutes(app,{service=createLogboekCutService(),guard,readGuard,writeGuard}={}) {
  const unavailable=(_req,res)=>res.status(503).json({ok:false,error:'Toegang niet beschikbaar.'});
  const readAccess=readGuard || guard || unavailable;
  const writeAccess=writeGuard || guard || unavailable;
  const reads=rateLimit({windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false});
  const writes=rateLimit({windowMs:600000,limit:30,standardHeaders:true,legacyHeaders:false});
  const handle=fn=>async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {const result=await fn(req);return res.status(result.conflict?409:200).json(result);}
    catch(error){return res.status(error.status || 503).json({ok:false,error:error.status?error.message:'Opslag tijdelijk niet bereikbaar. Probeer opnieuw.'});}
  };
  app.get('/api/logboek-cut',reads,readAccess,handle(()=>service.get()));
  app.post('/api/logboek-cut',writes,writeAccess,(req,res,next)=>{
    const origin=req.get('origin');
    if(!origin || (!['https://www.softora.nl','https://softora.nl'].includes(origin) && !(process.env.NODE_ENV!=='production' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)))) {
      return res.status(403).json({ok:false,error:'Ongeldige herkomst.'});
    }
    if(!req.is('application/json'))return res.status(415).json({ok:false,error:'JSON vereist.'});
    return next();
  },handle(req=>req.body?.type==='note' ? service.note(req.body) : service.set(req.body)));
}
module.exports={registerLogboekCutRoutes};
