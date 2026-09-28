const MAX_USERS = 1000;

function json(res,status,body){
  res.status(status).setHeader("Content-Type","application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function supa(path, options={}) {
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("Admin server is not configured.");
  const r=await fetch(url+"/rest/v1/"+path,{
    ...options,
    headers:{
      "apikey":key,
      "Authorization":"Bearer "+key,
      "Content-Type":"application/json",
      "Prefer":options.prefer||"return=representation",
      ...(options.headers||{})
    }
  });
  const text=await r.text();
  let data=null;
  try{data=JSON.parse(text)}catch{}
  if(!r.ok) throw new Error(data?.message||data?.error||text||"Supabase request failed.");
  return data;
}

async function verifyAdmin(token){
  const url=process.env.SUPABASE_URL, anon=process.env.SUPABASE_ANON_KEY;
  if(!url||!anon) throw new Error("Authentication is not configured.");
  const r=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:"Bearer "+token}});
  if(!r.ok)return null;
  const u=await r.json();
  const allow=(process.env.FOLIORA_ADMIN_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  return u?.id&&u.email&&allow.includes(u.email.toLowerCase())?u:null;
}

async function authUser(userId){
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r=await fetch(url+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:key,Authorization:"Bearer "+key}});
  const data=await r.json().catch(()=>null);
  if(!r.ok||!data?.id) throw new Error(data?.msg||"Could not load the selected user.");
  return data;
}

async function listAuthUsers(){
  const r=await fetch(process.env.SUPABASE_URL+"/auth/v1/admin/users?per_page="+MAX_USERS+"&page=1",{
    headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+process.env.SUPABASE_SERVICE_ROLE_KEY}
  });
  const data=await r.json();
  if(!r.ok)throw new Error(data?.msg||"Could not load users.");
  return data.users||[];
}

async function ensurePublicUser(user){
  const fullName=String(user.user_metadata?.full_name||user.email?.split("@")[0]||"User").trim()||"User";
  await supa("users?on_conflict=id",{
    method:"POST",
    prefer:"resolution=merge-duplicates,return=representation",
    body:JSON.stringify({
      id:user.id,
      email:user.email||"",
      full_name:fullName
    })
  });
}

async function getUserData(users){
  const ids=users.map(u=>u.id);
  if(!ids.length)return {ents:[],quotas:[],profiles:[]};
  const [ents,quotas,profiles]=await Promise.all([
    supa("entitlements?select=user_id,product_id,source_plan_id,tier,is_active,valid_until,updated_at&user_id=in.("+ids.join(",")+")",{}),
    supa("usage_quotas?select=user_id,product_id,feature_id,billing_cycle_month,used_units,unit_limit,updated_at&user_id=in.("+ids.join(",")+")",{}),
    supa("users?select=id,is_active,updated_at&id=in.("+ids.join(",")+")",{})
  ]);
  return {ents:ents||[],quotas:quotas||[],profiles:profiles||[]};
}

async function findExisting(table, query){
  const rows=await supa(table+"?select=id&"+query,{});
  return Array.isArray(rows)&&rows.length?rows[0]:null;
}

async function saveByKey(table, query, values){
  const existing=await findExisting(table, query);
  if(existing?.id){
    return supa(table+"?id=eq."+encodeURIComponent(existing.id),{
      method:"PATCH",
      body:JSON.stringify(values)
    });
  }
  return supa(table,{
    method:"POST",
    body:JSON.stringify(values)
  });
}

async function logActivity(admin, action, targetUserId, targetEmail, metadata={}){
  try{
    await supa("admin_activity_logs",{
      method:"POST",
      body:JSON.stringify({
        admin_user_id:admin.id,
        action,
        target_user_id:targetUserId||null,
        target_email:targetEmail||null,
        metadata
      })
    });
  }catch(_e){}
}

async function recordHistory(userId, productId, action, values, adminId, note=""){
  try{
    await supa("subscription_history",{
      method:"POST",
      body:JSON.stringify({
        user_id:userId,
        product_id:productId,
        action,
        tier:values.tier||null,
        valid_from:values.valid_from||null,
        valid_until:values.valid_until||null,
        ocr_limit:values.ocr_limit??null,
        changed_by:adminId||null,
        note
      })
    });
  }catch(_e){}
}

async function adminAuthRequest(path, method="GET", body){
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url=process.env.SUPABASE_URL;
  const r=await fetch(url+"/auth/v1/admin/"+path,{
    method,
    headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(data?.msg||data?.message||data?.error_description||"Authentication admin request failed.");
  return data;
}

function pickColumn(row,candidates){
  const keys=Object.keys(row||{});
  return candidates.find(k=>keys.includes(k))||null;
}

async function updatePlanRecord(planId, price, validityDays, name){
  const rows=await supa("plans?id=eq."+encodeURIComponent(planId)+"&limit=1",{});
  const row=rows?.[0];
  if(!row)throw new Error("Plan record not found.");
  const priceCol=pickColumn(row,["price","amount","monthly_price","price_monthly","unit_price","cost"]);
  const validityCol=pickColumn(row,["validity_days","duration_days","days","duration","valid_days","period_days"]);
  const nameCol=pickColumn(row,["name","plan_name","title"]);
  const patch={};
  if(price!==undefined&&priceCol)patch[priceCol]=Number(price);
  if(validityDays!==undefined&&validityCol)patch[validityCol]=Math.max(1,Number(validityDays));
  if(name!==undefined&&nameCol)patch[nameCol]=String(name).trim();
  if(!Object.keys(patch).length)throw new Error("This plan table has no recognized price/validity/name columns.");
  const updated=await supa("plans?id=eq."+encodeURIComponent(planId),{method:"PATCH",body:JSON.stringify(patch)});
  return {updated:updated||[],columns:{price:priceCol,validity:validityCol,name:nameCol}};
}

function month(){return new Date().toISOString().slice(0,7);}

function buildUserRows(users,ents,quotas,profiles=[]){
  return users.map(u=>{
    const mcq=(ents||[]).find(x=>x.user_id===u.id&&x.product_id==="foliora-mcq");
    const ocr=(ents||[]).find(x=>x.user_id===u.id&&x.product_id==="foliora-ocr");
    const q=(quotas||[]).find(x=>x.user_id===u.id&&x.product_id==="foliora-ocr"&&x.billing_cycle_month===month());
    const profile=(profiles||[]).find(x=>x.id===u.id);
    const createdAt=u.created_at||u.confirmed_at||null;
    const lastSignIn=u.last_sign_in_at||null;
    const validUntil=mcq?.valid_until||null;
    const isExpired=!!(validUntil&&new Date(validUntil).getTime()<Date.now());
    return {
      id:u.id,
      email:u.email||"",
      name:u.user_metadata?.full_name||u.email?.split("@")[0]||"",
      created_at:createdAt,
      last_sign_in_at:lastSignIn,
      email_confirmed:!!u.email_confirmed_at,
      account_active:profile?.is_active!==false,
      mcq_active:!!mcq?.is_active&&!isExpired,
      mcq_expired:isExpired,
      mcq_tier:mcq?.tier||null,
      mcq_source_plan:mcq?.source_plan_id||null,
      mcq_expires:validUntil,
      ocr_active:!!ocr?.is_active,
      ocr_used:q?.used_units??0,
      ocr_limit:q?.unit_limit??0,
      ocr_updated_at:q?.updated_at||null,
      updated_at:mcq?.updated_at||ocr?.updated_at||null
    };
  });
}

module.exports=async function(req,res){
  if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});
  try{
    const auth=String(req.headers.authorization||"");
    if(!auth.startsWith("Bearer "))return json(res,401,{error:"Authentication required."});
    const admin=await verifyAdmin(auth.slice(7).trim());
    if(!admin)return json(res,403,{error:"Administrator access denied."});

    const body=req.body&&typeof req.body==="object"?req.body:await new Promise((resolve,reject)=>{
      let s="";
      req.on("data",c=>s+=c);
      req.on("end",()=>{try{resolve(JSON.parse(s||"{}"))}catch(e){reject(e)}});
    });
    const action=body.action;

    if(action==="create_subscriber"){
      const email=String(body.email||"").trim().toLowerCase();
      const password=String(body.password||"");
      const name=String(body.name||"").trim();
      if(!email||!password||!name)return json(res,400,{error:"Email, password and name are required."});
      if(password.length<8)return json(res,400,{error:"Password must be at least 8 characters."});
      const created=await adminAuthRequest("users","POST",{email,password,email_confirm:true,user_metadata:{full_name:name}});
      await ensurePublicUser(created);
      await logActivity(admin,"subscriber_created",created.id,created.email,{name});
      return json(res,200,{ok:true,user:{id:created.id,email:created.email,name}});
    }

    if(action==="update_user"){
      const userId=String(body.userId||"");
      if(!userId)return json(res,400,{error:"Invalid user id."});
      const current=await authUser(userId);
      const email=body.email===undefined?undefined:String(body.email||"").trim().toLowerCase();
      const name=body.name===undefined?undefined:String(body.name||"").trim();
      const password=body.password===undefined?undefined:String(body.password||"");
      if(password!==undefined&&password&&password.length<8)return json(res,400,{error:"New password must be at least 8 characters."});
      const patch={};
      if(email!==undefined)patch.email=email;
      if(name!==undefined)patch.user_metadata={...(current.user_metadata||{}),full_name:name};
      if(password)patch.password=password;
      if(email!==undefined)patch.email_confirm=true;
      const updated=Object.keys(patch).length?await adminAuthRequest("users/"+encodeURIComponent(userId),"PUT",patch):current;
      await ensurePublicUser(updated);
      const publicPatch={};
      if(email!==undefined)publicPatch.email=email;
      if(name!==undefined)publicPatch.full_name=name;
      if(Object.keys(publicPatch).length)await supa("users?id=eq."+encodeURIComponent(userId),{method:"PATCH",body:JSON.stringify({...publicPatch,updated_at:new Date().toISOString()})});
      await logActivity(admin,"subscriber_updated",userId,updated.email,{emailChanged:email!==undefined,nameChanged:name!==undefined,passwordChanged:!!password});
      return json(res,200,{ok:true,user:{id:updated.id,email:updated.email,name:updated.user_metadata?.full_name||name||""}});
    }

    if(action==="list_users"){
      const users=await listAuthUsers();
      await Promise.all(users.map(ensurePublicUser));
      const {ents,quotas,profiles}=await getUserData(users);
      return json(res,200,{users:buildUserRows(users,ents,quotas,profiles)});
    }

    if(action==="dashboard"){
      const users=await listAuthUsers();
      await Promise.all(users.map(ensurePublicUser));
      const {ents,quotas,profiles}=await getUserData(users);
      const rows=buildUserRows(users,ents,quotas,profiles);
      const total=rows.length;
      const activeMcq=rows.filter(u=>u.mcq_active).length;
      const ocrEnabled=rows.filter(u=>u.ocr_active).length;
      const pro=rows.filter(u=>u.mcq_active&&u.mcq_tier==="pro").length;
      const free=Math.max(0,total-activeMcq);
      const monthlyOcrUsed=rows.reduce((s,u)=>s+(Number(u.ocr_used)||0),0);
      const monthlyOcrLimit=rows.reduce((s,u)=>s+(Number(u.ocr_limit)||0),0);
      const recent=[...rows].sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime()).slice(0,5);
      return json(res,200,{
        summary:{total,activeMcq,ocrEnabled,pro,free,monthlyOcrUsed,monthlyOcrLimit},
        recent
      });
    }

    if(action==="set_subscription"){
      const userId=String(body.userId||"");
      const plan=body.plan==="free"?"free":"pro";
      const days=Math.min(3650,Math.max(1,Number(body.days||30)));
      const ocrLimit=Math.min(100000,Math.max(0,Number(body.ocrLimit||0)));
      if(!/^[0-9a-f-]{20,}$/i.test(userId))return json(res,400,{error:"Invalid user id."});

      const user=await authUser(userId);
      await ensurePublicUser(user);

      const validUntil=new Date(Date.now()+days*86400000).toISOString();
      const now=new Date().toISOString();
      await saveByKey(
        "entitlements",
        "user_id=eq."+encodeURIComponent(userId)+"&product_id=eq.foliora-mcq",
        {user_id:userId,product_id:"foliora-mcq",tier:plan,is_active:plan==="pro",valid_until:validUntil,updated_at:now}
      );
      await saveByKey(
        "entitlements",
        "user_id=eq."+encodeURIComponent(userId)+"&product_id=eq.foliora-ocr",
        {user_id:userId,product_id:"foliora-ocr",tier:"free",is_active:true,valid_until:validUntil,updated_at:now}
      );
      await saveByKey(
        "usage_quotas",
        "user_id=eq."+encodeURIComponent(userId)+"&product_id=eq.foliora-ocr&billing_cycle_month=eq."+encodeURIComponent(month()),
        {user_id:userId,product_id:"foliora-ocr",feature_id:"ocr_gemini_vision",used_units:0,unit_limit:ocrLimit,billing_cycle_month:month(),updated_at:now}
      );
      await recordHistory(userId,"foliora-mcq","subscription_updated",{tier:plan,valid_from:now,valid_until:validUntil,ocr_limit:ocrLimit},admin.id,"Admin updated subscription");
      await logActivity(admin,"subscription_updated",userId,user.email,{plan,days,ocrLimit,validUntil});
      return json(res,200,{ok:true});
    }

    if(action==="revoke_subscription"){
      const userId=String(body.userId||"");
      if(!userId)return json(res,400,{error:"Invalid user id."});
      await supa("entitlements?user_id=eq."+encodeURIComponent(userId)+"&product_id=eq.foliora-mcq",{method:"PATCH",body:JSON.stringify({is_active:false,updated_at:new Date().toISOString()})});
      const user=await authUser(userId);
      await recordHistory(userId,"foliora-mcq","revoked",{tier:null,valid_from:null,valid_until:null},admin.id,"Admin revoked MCQ subscription");
      await logActivity(admin,"subscription_revoked",userId,user.email,{product:"foliora-mcq"});
      return json(res,200,{ok:true});
    }

    if(action==="reset_ocr"){
      const userId=String(body.userId||"");
      if(!userId)return json(res,400,{error:"Invalid user id."});
      await supa("usage_quotas?user_id=eq."+encodeURIComponent(userId)+"&product_id=eq.foliora-ocr&billing_cycle_month=eq."+month(),{method:"PATCH",body:JSON.stringify({used_units:0,updated_at:new Date().toISOString()})});
      const user=await authUser(userId);
      await recordHistory(userId,"foliora-ocr","usage_reset",{tier:null,valid_from:null,valid_until:null},admin.id,"Admin reset OCR usage");
      await logActivity(admin,"ocr_usage_reset",userId,user.email,{product:"foliora-ocr",billingCycle:month()});
      return json(res,200,{ok:true});
    }

    if(action==="set_account_status"){
      const userId=String(body.userId||"");
      const active=body.active!==false;
      if(!userId)return json(res,400,{error:"Invalid user id."});
      const user=await authUser(userId);
      await ensurePublicUser(user);
      await supa("users?id=eq."+encodeURIComponent(userId),{method:"PATCH",body:JSON.stringify({is_active:active,updated_at:new Date().toISOString()})});
      await logActivity(admin,active?"account_enabled":"account_disabled",userId,user.email,{active});
      return json(res,200,{ok:true,active});
    }

    if(action==="get_subscription_history"){
      const userId=String(body.userId||"");
      if(!userId)return json(res,400,{error:"Invalid user id."});
      const rows=await supa("subscription_history?select=id,product_id,action,tier,valid_from,valid_until,ocr_limit,changed_by,note,created_at&user_id=eq."+encodeURIComponent(userId)+"&order=created_at.desc&limit=100",{});
      return json(res,200,{history:rows||[]});
    }

    if(action==="get_activity_log"){
      const limit=Math.min(200,Math.max(1,Number(body.limit||50)));
      const rows=await supa("admin_activity_logs?select=id,admin_user_id,action,target_user_id,target_email,metadata,created_at&order=created_at.desc&limit="+limit,{});
      return json(res,200,{activities:rows||[]});
    }

    if(action==="update_plan"){
      const planId=String(body.planId||"");
      if(!planId)return json(res,400,{error:"Invalid plan id."});
      const result=await updatePlanRecord(planId,body.price,body.validityDays,body.name);
      await logActivity(admin,"plan_updated",null,null,{planId,price:body.price,validityDays:body.validityDays,name:body.name,columns:result.columns});
      return json(res,200,{ok:true,...result});
    }

    if(action==="catalog"){
      const [products,plans,features,planQuotas]=await Promise.all([
        supa("products?select=*",{}),
        supa("plans?select=*",{}),
        supa("features?select=*",{}),
        supa("plan_feature_quotas?select=*",{})
      ]);
      return json(res,200,{products:products||[],plans:plans||[],features:features||[],plan_feature_quotas:planQuotas||[]});
    }

    if(action==="get_user_detail"){
      const userId=String(body.userId||"");
      if(!userId)return json(res,400,{error:"Invalid user id."});
      const user=await authUser(userId);
      await ensurePublicUser(user);
      const [ents,quotas,profiles]=await Promise.all([
        supa("entitlements?select=id,product_id,source_plan_id,tier,is_active,valid_until,updated_at&user_id=eq."+encodeURIComponent(userId)+"&order=updated_at.desc",{}),
        supa("usage_quotas?select=id,product_id,feature_id,billing_cycle_month,used_units,unit_limit,updated_at&user_id=eq."+encodeURIComponent(userId)+"&order=updated_at.desc",{}),
        supa("users?select=id,is_active,updated_at&id=eq."+encodeURIComponent(userId),{})
      ]);
      const profile=profiles?.[0];
      return json(res,200,{
        user:{
          id:user.id,email:user.email||"",name:user.user_metadata?.full_name||user.email?.split("@")[0]||"",
          created_at:user.created_at||null,last_sign_in_at:user.last_sign_in_at||null,
          email_confirmed:!!user.email_confirmed_at, account_active:profile?.is_active!==false
        },
        entitlements:ents||[],
        quotas:quotas||[]
      });
    }

    return json(res,400,{error:"Unknown admin action."});
  }catch(e){
    return json(res,500,{error:e.message||"Admin server error."});
  }
};