const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ROOT = process.env.TIJARTI_ROOT || __dirname;
const DATA = process.env.TIJARTI_DATA || path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'store.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,hash TEXT NOT NULL,role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,price INTEGER NOT NULL,stock INTEGER NOT NULL,sizes TEXT NOT NULL,image TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,customer TEXT NOT NULL,items TEXT NOT NULL,total INTEGER NOT NULL,status TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS enquiries(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,message TEXT NOT NULL,created TEXT NOT NULL,delivery TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
const adminEmail='tijarticlothingindustry@gmail.com';
const getSetting=k=>db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';
const setSetting=(k,v)=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,String(v));
// Never seed merchant inventory with demonstration products.
if(!getSetting('demo_retired')){
 db.prepare("UPDATE products SET active=0 WHERE image LIKE '/placeholder-%' AND description LIKE 'Sample product.%'").run();
 setSetting('demo_retired','1');
}
let setupToken=crypto.randomBytes(32).toString('hex');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function hashPassword(p){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(p,salt,64).toString('hex');}
function checkPassword(p,h){const [salt,digest]=h.split(':');return crypto.timingSafeEqual(Buffer.from(digest,'hex'),crypto.scryptSync(p,salt,64));}
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function str(v,max=1000){return typeof v==='string'?v.trim().slice(0,max):'';}
function email(v){const x=str(v,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))fail('Enter a valid email address.');return x;}
function password(v){if(typeof v!=='string'||v.length<8||v.length>128)fail('Password must contain 8 to 128 characters.');return v;}
function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)fail('Invalid '+label+'.');return v;}
function session(req){const token=(req.headers.cookie||'').match(/(?:^|;\s*)tijarti_session=([^;]+)/)?.[1];if(!token)return null;return db.prepare('SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE token=? AND expires>?').get(sha(token),Date.now())||null;}
function auth(req,admin=false){const u=session(req);if(!u)fail('Please sign in to continue.',401);if(admin&&u.role!=='admin')fail('Admin access is required.',403);return u;}
const attempts=new Map();
function throttle(key,max=10){const now=Date.now();if(attempts.size>10000){for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);}const v=attempts.get(key)||{count:0,until:now+900000};if(v.until<now){v.count=0;v.until=now+900000;}v.count++;attempts.set(key,v);if(v.count>max)fail('Too many attempts. Please try again in 15 minutes.',429);}
async function body(req){let data='',size=0;for await(const part of req){size+=part.length;if(size>7500000)fail('Upload is too large.',413);data+=part;}try{return JSON.parse(data||'{}');}catch{fail('Invalid request.');}}
function reply(res,value,status=200,headers={}){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(value));}
function publicSettings(){return{upi:getSetting('upi'),payee:getSetting('payee'),qr:getSetting('qr'),logo:getSetting('logo'),email:adminEmail,phone:'7078924954'};}
async function notify(subject,text){if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM)return 'not configured';try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[adminEmail],subject,text}),signal:AbortSignal.timeout(8000)});return r.ok?'sent':'failed';}catch{return 'failed';}}
function product(row){return{...row,price:row.price/100,sizes:row.sizes.split(',')};}
function decodeOrder(row){return{...row,total:row.total/100,customer:JSON.parse(row.customer),items:JSON.parse(row.items)};}
async function handler(req,res){try{
 const url=new URL(req.url,'http://'+req.headers.host);const p=url.pathname;const method=req.method;
 if(['POST','PUT','DELETE','PATCH'].includes(method)){
  const expected=process.env.PUBLIC_ORIGIN||'http://'+req.headers.host;
  if(req.headers.origin!==expected)fail('Request origin is not allowed.',403);
  if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('JSON content is required.',415);
 }
 if(p==='/api/store'&&method==='GET')return reply(res,{products:db.prepare('SELECT * FROM products WHERE active=1 ORDER BY rowid').all().map(product),settings:publicSettings(),user:session(req),adminConfigured:!!db.prepare("SELECT id FROM users WHERE role='admin'").get()});
 if(p==='/api/setup'&&method==='POST'){
  throttle('setup:'+req.socket.remoteAddress,5);const b=await body(req);
  if(db.prepare("SELECT id FROM users WHERE role='admin'").get()||!setupToken||b.token!==setupToken)fail('This setup link is invalid or has already been used.',403);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(crypto.randomUUID(),adminEmail,'Tijarti Admin',hashPassword(password(b.password)),'admin');setupToken=null;return reply(res,{ok:true});
 }
 if(p==='/api/register'&&method==='POST'){
  throttle('register:'+req.socket.remoteAddress,10);const b=await body(req);const e=email(b.email);if(e===adminEmail)fail('Use admin sign-in for this address.');const n=str(b.name,80);if(!n)fail('Enter your name.');const h=hashPassword(password(b.password));
  if(db.prepare('SELECT id FROM users WHERE email=?').get(e))fail('An account with this email already exists.');db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(crypto.randomUUID(),e,n,h,'customer');return reply(res,{ok:true});
 }
 if(p==='/api/login'&&method==='POST'){
  throttle('login:'+req.socket.remoteAddress,20);const b=await body(req);const e=email(b.email);const pw=password(b.password);const user=db.prepare('SELECT * FROM users WHERE email=?').get(e);
  const dummy='00000000000000000000000000000000:'+ '00'.repeat(64);const valid=checkPassword(pw,user?.hash||dummy);if(!user||!valid)fail('Email or password is incorrect.',401);
  const token=crypto.randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token),user.id,Date.now()+86400000);
  return reply(res,{user:{id:user.id,email:user.email,name:user.name,role:user.role}},200,{'Set-Cookie':`tijarti_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.PUBLIC_ORIGIN?.startsWith('https:')?'; Secure':''}`});
 }
 if(p==='/api/logout'&&method==='POST'){const t=(req.headers.cookie||'').match(/tijarti_session=([^;]+)/)?.[1];if(t)db.prepare('DELETE FROM sessions WHERE token=?').run(sha(t));return reply(res,{ok:true},200,{'Set-Cookie':'tijarti_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
 if(p==='/api/contact'&&method==='POST'){
  throttle('contact:'+req.socket.remoteAddress,6);const b=await body(req);const n=str(b.name,80),e=email(b.email),phone=str(b.phone,20),m=str(b.message,3000);if(!n||m.length<5)fail('Please add your name and a message of at least 5 characters.');
  const id=crypto.randomUUID();db.prepare('INSERT INTO enquiries VALUES(?,?,?,?,?,?,?)').run(id,n,e,phone,m,new Date().toISOString(),'pending');
  const delivery=await notify('New Tijarti enquiry',`Name: ${n}\nEmail: ${e}\nPhone: ${phone}\n\n${m}`);db.prepare('UPDATE enquiries SET delivery=? WHERE id=?').run(delivery,id);return reply(res,{ok:true,delivery});
 }
 if(p==='/api/orders'&&method==='GET'){const u=auth(req);return reply(res,db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC').all(u.id).map(decodeOrder));}
 if(p==='/api/orders'&&method==='POST'){
  const u=auth(req);throttle('order:'+u.id,15);const b=await body(req);if(!getSetting('upi')&&!getSetting('qr'))fail('Payments are not configured yet. Please contact the store.');
  const c={name:str(b.name,80),phone:str(b.phone,20),address:str(b.address,700),pincode:str(b.pincode,6),email:u.email};if(!c.name||!/^\d{10}$/.test(c.phone)||c.address.length<10||!/^\d{6}$/.test(c.pincode))fail('Enter your name, 10-digit mobile number, full address and 6-digit PIN code.');
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)fail('Your bag is empty or too large.');
  const grouped=new Map();for(const x of b.items){const size=str(x.size,10);const id=str(x.id,100);const quantity=integer(x.quantity,1,10,'quantity');const k=id+'|'+size;const old=grouped.get(k);grouped.set(k,{id,size,quantity:(old?.quantity||0)+quantity});}
  let total=0;const items=[];let committed=false;db.exec('BEGIN IMMEDIATE');try{
   for(const x of grouped.values()){integer(x.quantity,1,10,'quantity');const row=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(x.id);if(!row||!row.sizes.split(',').includes(x.size))fail('A product or size is no longer available.');if(row.stock<x.quantity)fail(row.name+' does not have enough stock.');total+=row.price*x.quantity;items.push({id:row.id,name:row.name,size:x.size,quantity:x.quantity,price:row.price/100});db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(x.quantity,row.id);}
   const id='TJ-'+crypto.randomBytes(6).toString('hex').toUpperCase();db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?)').run(id,u.id,JSON.stringify(c),JSON.stringify(items),total,'Awaiting payment','',new Date().toISOString());db.exec('COMMIT');committed=true;
   const settings=publicSettings();const upiUrl=settings.upi?'upi://pay?'+new URLSearchParams({pa:settings.upi,pn:settings.payee||'Tijarti Clothing Industry',am:(total/100).toFixed(2),cu:'INR',tn:id}).toString():'';
   await notify('New Tijarti order '+id,JSON.stringify({id,customer:c,items,total:total/100},null,2));return reply(res,{id,total:total/100,upiUrl,settings});
  }catch(e){if(!committed)db.exec('ROLLBACK');throw e;}
 }
 if(/^\/api\/orders\/[^/]+\/reference$/.test(p)&&method==='POST'){const u=auth(req),id=p.split('/')[3],b=await body(req);const reference=str(b.reference,40);if(!/^[A-Za-z0-9-]{6,40}$/.test(reference))fail('Enter a valid payment reference or UTR.');const result=db.prepare("UPDATE orders SET reference=?,status='Payment review' WHERE id=? AND user_id=? AND status IN ('Awaiting payment','Payment review')").run(reference,id,u.id);if(!result.changes)fail('Order cannot be updated.',404);return reply(res,{ok:true});}
 if(p.startsWith('/api/admin/')){
  auth(req,true);
  if(p==='/api/admin/data'&&method==='GET')return reply(res,{products:db.prepare('SELECT * FROM products WHERE active=1 ORDER BY rowid').all().map(product),orders:db.prepare('SELECT * FROM orders ORDER BY created DESC').all().map(decodeOrder),enquiries:db.prepare('SELECT * FROM enquiries ORDER BY created DESC').all(),settings:publicSettings(),emailConfigured:!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM)});
  if(p==='/api/admin/products'&&method==='POST'){
   const b=await body(req),id=str(b.id,100)||crypto.randomUUID(),name=str(b.name,120),category=str(b.category,60),description=str(b.description,2000),image=str(b.image,300);if(!name||!category)fail('Name and category are required.');const price=integer(Math.round(Number(b.price)*100),100,100000000,'price');const stock=integer(Number(b.stock),0,100000,'stock');const sizes=str(b.sizes,100).split(',').map(s=>s.trim()).filter(Boolean);if(!sizes.length||sizes.some(s=>! /^[a-zA-Z0-9 -]{1,12}$/.test(s)))fail('Enter sizes separated by commas.');if(image&&!/^\/(uploads\/[a-f0-9-]+\.(png|jpg|webp)|placeholder-(rose|sage|gold)\.svg)$/.test(image))fail('Please upload an image using the image selector.');
   if(!image||!/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(image)||!fs.existsSync(path.join(DATA,'uploads',path.basename(image))))fail('Upload a real product photo before publishing.');
   db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,description=excluded.description,price=excluded.price,stock=excluded.stock,sizes=excluded.sizes,image=excluded.image,active=1').run(id,name,category,description,price,stock,sizes.join(','),image);return reply(res,{ok:true});
  }
  if(p.startsWith('/api/admin/products/')&&method==='DELETE'){db.prepare('UPDATE products SET active=0 WHERE id=?').run(p.split('/').pop());return reply(res,{ok:true});}
  if(p==='/api/admin/upload'&&method==='POST'){
   const b=await body(req);if(typeof b.data!=='string')fail('Select an image.');const bytes=Buffer.from(b.data,'base64');if(bytes.length>5*1024*1024)fail('Images must be under 5 MB.');let ext='';if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')ext='webp';if(!ext)fail('Use a PNG, JPEG or WebP image.');const name=crypto.randomUUID()+'.'+ext;fs.writeFileSync(path.join(DATA,'uploads',name),bytes);return reply(res,{url:'/uploads/'+name});
  }
  if(p==='/api/admin/settings'&&method==='POST'){
   const b=await body(req),upi=str(b.upi,100);if(upi&&!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(upi))fail('Enter a valid UPI ID.');for(const k of ['logo','qr']){const v=str(b[k],300);if(v&&!/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(v))fail('Upload a valid '+k+' image.');setSetting(k,v);}setSetting('upi',upi);setSetting('payee',str(b.payee,120));return reply(res,{ok:true});
  }
  if(p.startsWith('/api/admin/orders/')&&method==='PATCH'){
   const id=p.split('/').pop(),b=await body(req),status=b.status;const transitions={'Awaiting payment':['Payment review','Paid','Cancelled'],'Payment review':['Paid','Cancelled'],Paid:['Processing','Cancelled'],Processing:['Shipped','Cancelled'],Shipped:['Delivered'],Delivered:[],Cancelled:[]};db.exec('BEGIN IMMEDIATE');try{const order=db.prepare('SELECT * FROM orders WHERE id=?').get(id);if(!order)fail('Order not found.',404);if(!transitions[order.status]?.includes(status))fail('That status change is not allowed.');if(status==='Cancelled')for(const x of JSON.parse(order.items))db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(x.quantity,x.id);db.prepare('UPDATE orders SET status=? WHERE id=?').run(status,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return reply(res,{ok:true});
  }
 }
 if(p.startsWith('/api/'))fail('Not found.',404);
 if(method!=='GET'&&method!=='HEAD')fail('Method not allowed.',405);
 const normalized=decodeURIComponent(p);const base=p.startsWith('/uploads/')?path.join(DATA,'uploads'):path.join(ROOT,'public');const file=path.resolve(base,p.startsWith('/uploads/')?normalized.slice(9):'.'+(normalized==='/'?'/index.html':normalized));if(!file.startsWith(path.resolve(base)+path.sep))fail('Not found.',404);
 if(!fs.existsSync(file)||!fs.statSync(file).isFile())fail('Not found.',404);
 const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
 res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",'Cache-Control':'no-cache'});if(method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
}catch(e){if(!res.headersSent)reply(res,{error:e.status?e.message:'Something went wrong. Please try again.'},e.status||500);else res.end();if(!e.status)console.error(e.message);}}
const port=Number(process.env.PORT)||8788;
http.createServer(handler).listen(port,process.env.HOST||'127.0.0.1',()=>{
 console.log('Tijarti Clothing Industry: http://127.0.0.1:'+port);
 if(!db.prepare("SELECT id FROM users WHERE role='admin'").get())console.log('One-time admin setup: http://127.0.0.1:'+port+'/?setup='+setupToken);
});


