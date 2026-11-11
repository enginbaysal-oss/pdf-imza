
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { PDFDocument, degrees } from "npm:pdf-lib@1.17.1";

const base=Deno.env.get("SUPABASE_URL")!;
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db=createClient(base,secret,{auth:{autoRefreshToken:false,persistSession:false}});
const bucket="pdf-multi-private";
const cors={"Access-Control-Allow-Origin":"https://enginbaysal-oss.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json;charset=utf-8"}});
const fail=(message:string,status=400)=>respond({error:message},status);
const uuid=()=>crypto.randomUUID();
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");
async function digest(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,"0")).join("")}
function b64Bytes(raw:string):Uint8Array{
 const str=atob(raw);const b=new Uint8Array(str.length);for(let i=0;i<str.length;i++)b[i]=str.charCodeAt(i);return b;
}
async function admin(req:Request){
 const t=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!t)throw Error("Yönetici girişi gerekli.");
 const {data,error}=await db.auth.getUser(t);
 if(error||!data?.user)throw Error("Oturum geçersiz. Yeniden giriş yap.");
 const uid=data.user.id;
 const {data:superAdmin,error:adminError}=await db.from("emlakcrm_super_admins").select("user_id").eq("user_id",uid).maybeSingle();
 if(adminError)throw Error("Yönetici yetkisi kontrol edilemedi.");
 if(superAdmin)return data.user;
 const now=new Date().toISOString();
 const {data:active,error:subscriptionError}=await db.from("emlakcrm_subscriptions").select("id").eq("user_id",uid).eq("status","active").lte("starts_at",now).gt("expires_at",now).limit(1);
 if(subscriptionError)throw Error("Abonelik durumu kontrol edilemedi.");
 if(!active?.length)throw Error("Aktif EmlakCRM aboneliği gerekli.");
 return data.user;
}
async function ownerDoc(id:string,owner:string){
 const {data,error}=await db.from("pdf_multi_documents").select("*").eq("id",id).eq("owner_id",owner).single();
 if(error||!data)throw Error("Belge bulunamadı veya erişim yok.");
 return data;
}
async function signerByToken(raw:string){
 if(!/^[0-9a-f]{64}$/.test(raw||""))throw Error("Geçersiz imza bağlantısı.");
 const hash=await digest(raw);
 const {data,error}=await db.from("pdf_multi_signers").select("id,document_id,slot,name,page_num,x,y,placements,status,signature_path,signed_at").eq("token_hash",hash).single();
 if(error||!data)throw Error("İmza bağlantısı geçersiz.");
 const {data:doc}=await db.from("pdf_multi_documents").select("id,title,original_path,status").eq("id",data.document_id).single();
 if(!doc)throw Error("İmzalanacak belge bulunamadı.");
 return {signer:data,doc};
}
async function signedUrl(path:string){
 const {data,error}=await db.storage.from(bucket).createSignedUrl(path,1200);
 if(error||!data?.signedUrl)throw Error("Belge görüntülenemedi.");
 return data.signedUrl;
}
async function finalize(id:string){
 const {data:claimed,error:claimError}=await db.from("pdf_multi_documents")
  .update({status:"finalizing"}).eq("id",id).eq("status","pending").select("*").maybeSingle();
 if(claimError)throw Error("PDF birleştirme başlatılamadı.");
 if(!claimed)return false;
 try{
  const {data:slots,error:slotError}=await db.from("pdf_multi_signers").select("*").eq("document_id",id).order("slot");
  if(slotError||!slots||slots.length<1||slots.length>30||slots.some((s:any)=>s.status!=="signed"||!s.signature_path))
   throw Error("Tüm imzacılar tamamlanmadan PDF oluşturulamaz.");
  const {data:original,error:downloadError}=await db.storage.from(bucket).download(claimed.original_path);
  if(downloadError||!original)throw Error("Orijinal PDF okunamadı.");
  const pdf=await PDFDocument.load(await original.arrayBuffer());
  const pages=pdf.getPages();
  for(const s of slots){
   const positions=Array.isArray(s.placements)&&s.placements.length?
     s.placements:[{page:s.page_num,x:s.x,y:s.y}];
   const assets=Array.isArray(s.signature_assets)&&s.signature_assets.length?s.signature_assets:null;
   if(assets && (assets.length!==positions.length||new Set(assets.map((a:any)=>Number(a.page))).size!==positions.length))
     throw Error("Sayfalara ait bağımsız imzalar eksik.");
   for(const loc of positions){
    const src=assets?assets.find((a:any)=>Number(a.page)===Number(loc.page))?.path:s.signature_path;
    if(!src)throw Error("Sayfa "+loc.page+" imzası bulunamadı.");
    const {data:png,error:pngError}=await db.storage.from(bucket).download(src);
    if(pngError||!png)throw Error("Sayfa "+loc.page+" imzası okunamadı.");
    const img=await pdf.embedPng(await png.arrayBuffer());
    const page=pages[Number(loc.page)-1];
    if(!page)throw Error("İmza için geçersiz sayfa.");
    const {width:W,height:H}=page.getSize();
    const rot=((page.getRotation().angle % 360)+360)%360;
    if(![0,90,180,270].includes(rot))throw Error("PDF sayfa yönü desteklenmiyor.");
    const vw=rot%180===0?W:H, vh=rot%180===0?H:W;
    const boxW=Number(loc.w??0.27),boxH=Number(loc.h??0.09);
    if(!Number.isFinite(boxW)||!Number.isFinite(boxH)||boxW<0.08||boxW>0.60||boxH<0.025||boxH>0.22)throw Error("İmza alanının boyutu geçersiz.");
    const left=vw*Number(loc.x),bottom=(Number(loc.y)+boxH)*vh;
    const iw=vw*boxW,ih=vh*boxH;
    const placement=rot===0?{x:left,y:H-bottom}:
      rot===90?{x:bottom,y:left}:
      rot===180?{x:W-left,y:bottom}:
      {x:W-bottom,y:H-left};
    page.drawImage(img,{...placement,width:iw,height:ih,rotate:degrees(rot)});
   }
  }
  const merged=await pdf.save();
  const path=claimed.owner_id+"/"+claimed.id+"/imzali.pdf";
  const {error:uploadError}=await db.storage.from(bucket).upload(path,merged,{contentType:"application/pdf",upsert:true});
  if(uploadError)throw Error("Birleştirilmiş PDF kaydedilemedi.");
  const {error:updateError}=await db.from("pdf_multi_documents").update({status:"complete",final_path:path,completed_at:new Date().toISOString()}).eq("id",id);
  if(updateError)throw Error("PDF tamamlandı bilgisi kaydedilemedi.");
  return true;
 }catch(e){
  await db.from("pdf_multi_documents").update({status:"pending"}).eq("id",id).eq("status","finalizing");
  throw e;
 }
}
async function partialPdf(doc:any){
 const claimed=doc;
  const {data:slots,error:slotError}=await db.from("pdf_multi_signers").select("*").eq("document_id",claimed.id).order("slot");
  if(slotError||!slots||slots.length<1||slots.length>30||slots.filter((s:any)=>s.status==="signed"&&s.signature_path).length<1)
   throw Error("Henüz alınmış ve dosyası kaydedilmiş imza yok.");
  const {data:original,error:downloadError}=await db.storage.from(bucket).download(claimed.original_path);
  if(downloadError||!original)throw Error("Orijinal PDF okunamadı.");
  const pdf=await PDFDocument.load(await original.arrayBuffer());
  const pages=pdf.getPages();
  for(const s of slots.filter((s:any)=>s.status==="signed"&&s.signature_path)){
   const positions=Array.isArray(s.placements)&&s.placements.length?
     s.placements:[{page:s.page_num,x:s.x,y:s.y}];
   const assets=Array.isArray(s.signature_assets)&&s.signature_assets.length?s.signature_assets:null;
   if(assets && (assets.length!==positions.length||new Set(assets.map((a:any)=>Number(a.page))).size!==positions.length))
     throw Error("Sayfalara ait bağımsız imzalar eksik.");
   for(const loc of positions){
    const src=assets?assets.find((a:any)=>Number(a.page)===Number(loc.page))?.path:s.signature_path;
    if(!src)throw Error("Sayfa "+loc.page+" imzası bulunamadı.");
    const {data:png,error:pngError}=await db.storage.from(bucket).download(src);
    if(pngError||!png)throw Error("Sayfa "+loc.page+" imzası okunamadı.");
    const img=await pdf.embedPng(await png.arrayBuffer());
    const page=pages[Number(loc.page)-1];
    if(!page)throw Error("İmza için geçersiz sayfa.");
    const {width:W,height:H}=page.getSize();
    const rot=((page.getRotation().angle % 360)+360)%360;
    if(![0,90,180,270].includes(rot))throw Error("PDF sayfa yönü desteklenmiyor.");
    const vw=rot%180===0?W:H, vh=rot%180===0?H:W;
    const boxW=Number(loc.w??0.27),boxH=Number(loc.h??0.09);
    if(!Number.isFinite(boxW)||!Number.isFinite(boxH)||boxW<0.08||boxW>0.60||boxH<0.025||boxH>0.22)throw Error("İmza alanının boyutu geçersiz.");
    const left=vw*Number(loc.x),bottom=(Number(loc.y)+boxH)*vh;
    const iw=vw*boxW,ih=vh*boxH;
    const placement=rot===0?{x:left,y:H-bottom}:
      rot===90?{x:bottom,y:left}:
      rot===180?{x:W-left,y:bottom}:
      {x:W-bottom,y:H-left};
    page.drawImage(img,{...placement,width:iw,height:ih,rotate:degrees(rot)});
   }
  }
 const merged=await pdf.save();
 const path=claimed.owner_id+"/"+claimed.id+"/kismi-imzali.pdf";
 const {error}=await db.storage.from(bucket).upload(path,merged,{contentType:"application/pdf",upsert:true});
 if(error)throw Error("Kısmi imzalı PDF kaydedilemedi: "+error.message);
 return signedUrl(path);
}

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return fail("Yalnızca POST isteği kabul edilir.",405);
 try{
  const body=await req.json();
  const action=String(body.action||"");
  if(action==="uploadInit"){
   const user=await admin(req);
   const size=Number(body.fileSize);
   if(!Number.isInteger(size)||size<80||size>20*1024*1024)
    return fail("PDF 20 MB sınırını aşamaz.");
   const {count,error:countErr}=await db.from("pdf_multi_upload_intents")
    .select("id",{count:"exact",head:true}).eq("owner_id",user.id)
    .gte("created_at",new Date(Date.now()-60*60*1000).toISOString());
   if(countErr||count===null)throw Error("Yükleme sınırı doğrulanamadı.");
   if(count>=15)return fail("Çok fazla yükleme denemesi. Daha sonra tekrar deneyin.",429);
   const id=uuid(),path=user.id+"/incoming/"+id+"/orijinal.pdf";
   const {error:ins}=await db.from("pdf_multi_upload_intents")
    .insert({id,owner_id:user.id,object_path:path});
   if(ins)throw Error("Güvenli yükleme kaydı oluşturulamadı.");
   const {data:signed,error:signErr}=await db.storage.from(bucket).createSignedUploadUrl(path);
   if(signErr||!signed?.signedUrl)throw Error("Güvenli yükleme bağlantısı oluşturulamadı.");
   return respond({uploadIntentId:id,signedUrl:signed.signedUrl});
  }
  if(action==="create"){
   const user=await admin(req);
   const title=String(body.title||"").trim().slice(0,180);
   if(!title) return fail("Belge adı gerekli.");
   const uploadId=String(body.uploadIntentId||"");
   let bytes:Uint8Array;
   let uploadedPath="";
   if(uploadId){
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(uploadId))return fail("Yükleme kimliği geçersiz.");
    const {data:intent,error:intentErr}=await db.from("pdf_multi_upload_intents")
     .select("id,owner_id,object_path,created_at,consumed_at")
     .eq("id",uploadId).eq("owner_id",user.id).is("consumed_at",null).maybeSingle();
    if(intentErr||!intent) return fail("Yükleme kaydı bulunamadı veya kullanılmış.");
    if(Date.now()-Date.parse(intent.created_at)>2*60*60*1000)
     return fail("Yükleme süresi dolmuş. Dosyayı yeniden seçin.");
    const expectedPath=user.id+"/incoming/"+uploadId+"/orijinal.pdf";
    if(intent.object_path!==expectedPath)return fail("Yükleme yolu doğrulanamadı.");
    const {data:stored,error:storageErr}=await db.storage.from(bucket).download(expectedPath);
    if(storageErr||!stored)return fail("PDF henüz yüklenmemiş.");
    bytes=new Uint8Array(await stored.arrayBuffer());
    uploadedPath=expectedPath;
    if(bytes.length<80||bytes.length>20*1024*1024)
     return fail("PDF 20 MB sınırını aşamaz.");
   }else{
    const raw=String(body.pdf||"");
    if(raw.length>9500000)return fail("PDF çok büyük (üst sınır 6 MB).");
    bytes=b64Bytes(raw);
    if(bytes.length<80||bytes.length>6*1024*1024)return fail("Geçerli, en fazla 6 MB PDF seç.");
   }
   if(new TextDecoder().decode(bytes.slice(0,8)).indexOf("%PDF-")<0)
    return fail("Geçerli bir PDF seçin.");
   const input=await PDFDocument.load(bytes);
   const pageCount=input.getPageCount();
   if(!pageCount||pageCount>100)return fail("PDF 1 ile 100 sayfa arasında olmalı.");
   const rotations=body.rotations;
   if(rotations!==undefined && (!Array.isArray(rotations)||rotations.length!==pageCount||
       rotations.some((r:unknown)=>!Number.isInteger(r)||![0,90,180,270].includes(Number(r)))))
     return fail("Sayfa yönleri geçersiz.");
   if(Array.isArray(rotations))input.getPages().forEach((page,i)=>page.setRotation(degrees(rotations[i])));
   const adjustedBytes=Array.isArray(rotations)?await input.save():bytes;
   const slots=Array.isArray(body.signers)?body.signers:[];
   if(slots.length<1||slots.length>30)return fail("1 ile 30 arasında imzacı belirle.");
   const safePositions=(x:any)=>{
    const positions=Array.isArray(x.placements)?x.placements:[{page:x.page,x:x.x,y:x.y}];
    if(positions.length<1||positions.length>30)return null;
    const pageSet=new Set<number>();
    for(const position of positions){
     const n=Number(position.page),px=Number(position.x),py=Number(position.y),pw=Number(position.w??0.27),ph=Number(position.h??0.09);
     if(!Number.isInteger(n)||n<1||n>pageCount||pageSet.has(n)||!Number.isFinite(px)||px<0||
       !Number.isFinite(py)||py<0||!Number.isFinite(pw)||pw<0.08||pw>0.60||
       !Number.isFinite(ph)||ph<0.025||ph>0.22||px+pw>1.00001||py+ph>1.00001)return null;
     pageSet.add(n);
    }
    return positions.map((p:any)=>({page:Number(p.page),x:Number(p.x),y:Number(p.y),w:Number(p.w??0.27),h:Number(p.h??0.09)}));
   };
   const placeGroups=[];
   for(const x of slots){
    const positions=safePositions(x);
    if(!String(x.name||"").trim()||String(x.name).length>100||!positions)
      return fail("Her imzacının adını, imza alanını ve ölçülerini kontrol et.");
    placeGroups.push(positions);
   }
   // Claim only after all layout checks; one upload intent can create one document.
   if(uploadId){
    const {data:claimed,error:claimErr}=await db.from("pdf_multi_upload_intents")
     .update({consumed_at:new Date().toISOString()}).eq("id",uploadId)
     .eq("owner_id",user.id).is("consumed_at",null).select("id").maybeSingle();
    if(claimErr||!claimed) return fail("Bu PDF yüklemesi zaten kullanıldı.");
   }
   const id=uuid(),path=uploadedPath||user.id+"/"+id+"/orijinal.pdf";
   if(!uploadedPath){
    const {error:up}=await db.storage.from(bucket).upload(path,adjustedBytes,{contentType:"application/pdf",upsert:false});
    if(up)throw Error("PDF özel depoya yüklenemedi: "+up.message);
   }else if(Array.isArray(rotations)){
    // For signed uploads preserve page rotation adjustments in a separate private path.
    const rotatedPath=user.id+"/"+id+"/orijinal.pdf";
    const {error:rotErr}=await db.storage.from(bucket).upload(rotatedPath,adjustedBytes,{contentType:"application/pdf",upsert:false});
    if(rotErr)throw Error("Döndürülmüş PDF saklanamadı.");
    uploadedPath=rotatedPath;
   }
   const {error:ins}=await db.from("pdf_multi_documents").insert({id,owner_id:user.id,title,original_path:uploadedPath||path});
   if(ins){if(!uploadId)await db.storage.from(bucket).remove([path]);throw Error("Belge kaydedilemedi: "+ins.message)}
   const links=[];const records=[];
   for(let i=0;i<slots.length;i++){
    const t=token();links.push({name:String(slots[i].name).trim(),slot:i+1,token:t});
    records.push({document_id:id,slot:i+1,name:String(slots[i].name).trim(),token_hash:await digest(t),
     page_num:placeGroups[i][0].page,x:placeGroups[i][0].x,y:placeGroups[i][0].y,placements:placeGroups[i]});
   }
   const {error:signErr}=await db.from("pdf_multi_signers").insert(records);
   if(signErr){await db.from("pdf_multi_documents").delete().eq("id",id);if(!uploadId)await db.storage.from(bucket).remove([path]);throw Error("İmzacı bağlantıları oluşturulamadı.");}
   return respond({id,title,links});
  }
  if(action==="list"){
   const user=await admin(req);
   const {data:docs,error}=await db.from("pdf_multi_documents").select("id,title,status,created_at,completed_at").eq("owner_id",user.id).neq("status","archived").order("created_at",{ascending:false}).limit(50);
   if(error)throw Error("Belgeler alınamadı.");
   const ids=(docs||[]).map((d:any)=>d.id);
   let signers:any[]=[];
   if(ids.length){const got=await db.from("pdf_multi_signers").select("document_id,slot,name,status,signed_at,placements,page_num").in("document_id",ids).order("slot");
   if(got.error)throw Error("İmza durumları alınamadı.");
   signers=(got.data||[]).map((s:any)=>({
     document_id:s.document_id,slot:s.slot,name:s.name,status:s.status,signed_at:s.signed_at,
     page_count:Array.isArray(s.placements)&&s.placements.length?s.placements.length:1
   }))}
   return respond({documents:(docs||[]).map((d:any)=>({...d,signers:signers.filter(s=>s.document_id===d.id)}))});
  }
  if(action==="cancel"||action==="archive"){
   const user=await admin(req);
   const doc=await ownerDoc(String(body.id||""),user.id);
   if(action==="cancel"){
    if(doc.status==="finalizing")return fail("PDF şu anda birleştiriliyor. Biraz sonra tekrar deneyin.");
    if(doc.status!=="pending")return fail("Yalnızca devam eden imza süreçleri durdurulabilir.");
    const {data:changed,error}=await db.from("pdf_multi_documents").update({status:"cancelled"})
      .eq("id",doc.id).eq("owner_id",user.id).eq("status","pending").select("id").maybeSingle();
    if(error||!changed)return fail("İşlem durdurulamadı; belge durumunu yenileyin.");
    return respond({cancelled:true});
   }
   if(doc.status==="finalizing")return fail("PDF birleştirilirken listeden kaldırılamaz.");
   if(doc.status==="archived")return respond({archived:true});
   // Veri ve imzalar korunur; gizlenen belge artık yeni imza kabul etmez.
   const {data:changed,error}=await db.from("pdf_multi_documents").update({status:"archived"})
     .eq("id",doc.id).eq("owner_id",user.id).eq("status",doc.status).select("id").maybeSingle();
   if(error||!changed)return fail("Belge listeden kaldırılamadı; tekrar deneyin.");
   return respond({archived:true});
  }
  if(action==="partialPdf"){
   const user=await admin(req);
   const doc=await ownerDoc(String(body.id||""),user.id);
   if(doc.status!=="cancelled"&&doc.status!=="pending")return fail("Kısmi PDF yalnızca bekleyen veya durdurulan belgeler için hazırlanabilir.");
   return respond({url:await partialPdf(doc),title:doc.title});
  }
  if(action==="adminPdf"){
   const user=await admin(req);
   const doc=await ownerDoc(String(body.id||""),user.id);
   const type=String(body.type||"final");
   if(type==="final"&&doc.status!=="complete")return fail("Tüm imzalar henüz tamamlanmadı.");
   return respond({url:await signedUrl(type==="original"?doc.original_path:doc.final_path),title:doc.title});
  }
  if(action==="finalize"){
   const user=await admin(req);
   const doc=await ownerDoc(String(body.id||""),user.id);
   if(doc.status==="complete")return respond({complete:true});
   if(doc.status!=="pending")return fail("Bu belgenin imza süreci kapalı.");
   const {data:slots}=await db.from("pdf_multi_signers").select("status").eq("document_id",doc.id);
   if(!slots||slots.length<1||slots.length>30||slots.some((s:any)=>s.status!=="signed"))return fail("Tüm imzalar tamamlanmadı.");
   await finalize(doc.id);
   return respond({complete:true});
  }
  if(action==="open"){
   const {signer,doc}=await signerByToken(String(body.token||""));
   const {data:other}=await db.from("pdf_multi_signers").select("status").eq("document_id",doc.id);
   if(doc.status==="cancelled"||doc.status==="archived")return fail("Bu belgenin imza süreci yönetici tarafından kapatıldı.");
   return respond({document:doc.title,name:signer.name,slot:signer.slot,alreadySigned:signer.status==="signed",complete:doc.status==="complete",signedCount:(other||[]).filter((x:any)=>x.status==="signed").length,totalSigners:(other||[]).length,originalUrl:await signedUrl(doc.original_path),page:signer.page_num,x:Number(signer.x),y:Number(signer.y),
    pages:(Array.isArray(signer.placements)&&signer.placements.length?signer.placements:[{page:signer.page_num,x:signer.x,y:signer.y}]).map((p:any)=>Number(p.page)).sort((a:number,b:number)=>a-b),
    placements:(Array.isArray(signer.placements)&&signer.placements.length?signer.placements:[{page:signer.page_num,x:signer.x,y:signer.y}]).map((p:any)=>({page:Number(p.page),x:Number(p.x),y:Number(p.y),w:Number(p.w??0.27),h:Number(p.h??0.09)}))});
  }
  if(action==="sign"){
   const {signer,doc}=await signerByToken(String(body.token||""));
   if(signer.status==="signed")return fail("Bu bağlantıyla imzalar zaten kaydedilmiş.");
   if(doc.status!=="pending")return fail("Bu belge artık imzaya kapalı.");
   const required=Array.isArray(signer.placements)&&signer.placements.length?
     signer.placements:[{page:signer.page_num,x:signer.x,y:signer.y}];
   const inputs=Array.isArray(body.signatures)?body.signatures:
     required.length===1&&typeof body.png==="string"?[{page:required[0].page,png:body.png}]:null;
   if(!inputs||inputs.length!==required.length)return fail("Her sayfa için ayrı imza gerekli.");
   const wanted=new Set(required.map((p:any)=>Number(p.page)));
   const found=new Map<number,Uint8Array>();
   for(const sig of inputs){
    const page=Number(sig.page),raw=String(sig.png||"");
    if(!Number.isInteger(page)||!wanted.has(page)||found.has(page))return fail("İmza sayfaları eşleşmiyor.");
    if(raw.length>1600000)return fail("Sayfa "+page+" imzası çok büyük.");
    const bytes=b64Bytes(raw);
    if(bytes.length<500||bytes.length>1100000||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)
      return fail("Sayfa "+page+" imzası geçersiz.");
    found.set(page,bytes);
   }
   if(found.size!==wanted.size)return fail("Eksik imza sayfası bulunuyor.");
   const uploaded:{page:number,path:string}[]=[];
   try{
    for(const loc of required){
     const page=Number(loc.page),path=doc.id+"/"+signer.id+"/sayfa-"+page+".png";
     const {error}=await db.storage.from(bucket).upload(path,found.get(page)!,{contentType:"image/png",upsert:false});
     if(error)throw Error("Sayfa "+page+" imzası kaydedilemedi: "+error.message);
     uploaded.push({page,path});
    }
    const {data:saved,error:savedErr}=await db.from("pdf_multi_signers")
     .update({status:"signed",signature_path:uploaded[0].path,signature_assets:uploaded,signed_at:new Date().toISOString()})
     .eq("id",signer.id).eq("status","pending").select("id").maybeSingle();
    if(savedErr||!saved)throw Error("İmza önceden kaydedilmiş veya işleme alınamamış.");
   }catch(e){
    if(uploaded.length)await db.storage.from(bucket).remove(uploaded.map(a=>a.path));
    throw e;
   }
   const {data:all}=await db.from("pdf_multi_signers").select("status").eq("document_id",doc.id);
   let finalError="";
   if(all?.length&&all.length<=30&&all.every((x:any)=>x.status==="signed")){
    try{await finalize(doc.id)}catch(e){finalError=e instanceof Error?e.message:"PDF birleştirilemedi."}
   }
   return respond({signed:true,completed:!!all?.length&&all.length<=30&&all.every((x:any)=>x.status==="signed")&&!finalError,finalError});
  }
  return fail("Geçersiz işlem.",400);
 }catch(error){
  console.error("pdf-multi:",error instanceof Error?error.message:String(error));
  return fail(error instanceof Error?error.message:"Bilinmeyen sunucu hatası",400);
 }
});
