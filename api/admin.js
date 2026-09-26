const MAX_USERS = 1000;
function json(res,status,body){res.status(status).setHeader("Content-Type","application/json; charset=utf-8");res.end(JSON.stringify(body));}
async function supa(path, options={}) {
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("Admin server is not configured.");
  const r=await fetch(url+"/rest/v1/"+path,{...options,headers:{"apikey":key,"Authorization":"Bearer "+key,"Content-Type":"application/json","Prefer":options.prefer||"return=representation",...(options.headers||{})}});
  const text=await r.text(); let data=null; try{data=JSON.parse(text)}catch{}
  if(!r.ok) throw new Error(data?.message||data?.error||text||"Supabase request failed.");
  return data;
}
async function verifyAdmin(token){
  const url=process.env.SUPABASE_URL, anon=process.env.SUPABASE_ANON_KEY;
  if(!url||!anon) throw new Error("Authentication is not configured.");
  const r=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:"Bearer "+token}});
  if(!r.ok)return null; const u=await r.json();
  const allow=(process.env.FOLIORA_ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  return u?.id&&u.email&&allow.includes(u.email.toLowerCase())?u:null;
}
function month(){return new Date().toISOString().slice(0,7);}
module.exports=async function(req,res){
  if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
  try{
    const auth=String(req.headers.authorization||""); if(!auth.startsWith("Bearer "))return json(res,401,{error:"Authentication required."});
    const admin=await verifyAdmin(auth.slice(7).trim()); if(!admin)return json(res,403,{error:"Administrator access denied."});
    const body=req.body&&typeof req.body==="object"?req.body:await new Promise((resolve,reject)=>{let s="";req.on("data",c=>s+=c);req.on("end",()=>{try{resolve(JSON.parse(s||"{}"))}catch(e){reject(e)}})});
    const action=body.action;
    if(action==="list_users"){
      const r=await fetch(process.env.SUPABASE_URL+"/auth/v1/admin/users?per_page="+MAX_USERS,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+process.env.SUPABASE_SERVICE_ROLE_KEY}});
      const authData=await r.json(); if(!r.ok)throw new Error(authData?.msg||"Could not load users.");
      const users=authData.users||[];
      const ids=users.map(u=>u.id);
      let ents=[], quotas=[];
      if(ids.length){
        ents=await supa("entitlements?select=user_id,product_id,tier,is_active,expires_at&user_id=in.("+ids.join(",")+")",{});
        quotas=await supa("usage_quotas?select=user_id,product_id,used_units,unit_limit,billing_cycle_month&product_id=eq.foliora-ocr&billing_cycle_month=eq."+month()+"&user_id=in.("+ids.join(",")+")",{});
      }
      const result=users.map(u=>{
        const e=(ents||[]).find(x=>x.user_id===u.id&&x.product_id==="foliora-mcq");
        const q=(quotas||[]).find(x=>x.user_id===u.id);
        return {id:u.id,email:u.email||"",name:u.user_metadata?.full_name||u.email?.split("@")[0]||"",mcq_active:!!e?.is_active,mcq_tier:e?.tier||null,mcq_expires:e?.expires_at||null,ocr_active:!!(ents||[]).find(x=>x.user_id===u.id&&x.product_id==="foliora-ocr"&&x.is_active),ocr_used:q?.used_units??0,ocr_limit:q?.unit_limit??0};
      });
      return json(res,200,{users:result});
    }
    if(action==="set_subscription"){
      const userId=String(body.userId||""); const plan=body.plan==="free"?"free":"pro"; const days=Math.min(3650,Math.max(1,Number(body.days||30))); const ocrLimit=Math.min(100000,Math.max(0,Number(body.ocrLimit||0)));
      if(!/^[0-9a-f-]{20,}$/i.test(userId))return json(res,400,{error:"Invalid user id."});
      const expires=new Date(Date.now()+days*86400000).toISOString();
      await supa("entitlements?on_conflict=user_id,product_id",{method:"POST",prefer:"resolution=merge-duplicates,return=representation",body:JSON.stringify({user_id:userId,product_id:"foliora-mcq",tier:plan,is_active:plan==="pro",expires_at:expires})});
      await supa("entitlements?on_conflict=user_id,product_id",{method:"POST",prefer:"resolution=merge-duplicates,return=representation",body:JSON.stringify({user_id:userId,product_id:"foliora-ocr",tier:"free",is_active:true,expires_at:expires})});
      await supa("usage_quotas?on_conflict=user_id,product_id,billing_cycle_month",{method:"POST",prefer:"resolution=merge-duplicates,return=representation",body:JSON.stringify({user_id:userId,product_id:"foliora-ocr",used_units:0,unit_limit:ocrLimit,billing_cycle_month:month()})});
      return json(res,200,{ok:true});
    }
    if(action==="revoke_subscription"){
      const userId=String(body.userId||""); if(!userId)return json(res,400,{error:"Invalid user id."});
      await supa("entitlements?user_id=eq."+encodeURIComponent(userId)+"&product_id=eq.foliora-mcq",{method:"PATCH",body:JSON.stringify({is_active:false})});
      return json(res,200,{ok:true});
    }
    if(action==="reset_ocr"){
      const userId=String(body.userId||""); if(!userId)return json(res,400,{error:"Invalid user id."});
      await supa("usage_quotas?user_id=eq."+encodeURIComponent(userId)+"&product_id=eq.foliora-ocr&billing_cycle_month=eq."+month(),{method:"PATCH",body:JSON.stringify({used_units:0})});
      return json(res,200,{ok:true});
    }
    return json(res,400,{error:"Unknown admin action."});
  }catch(e){return json(res,500,{error:e.message||"Admin server error."});}
};