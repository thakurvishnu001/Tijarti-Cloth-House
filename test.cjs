const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
const data=fs.mkdtempSync(path.join(__dirname,'data','test-'));const origin='http://127.0.0.1:8799';
const child=cp.spawn(process.execPath,['-e',"const fs=require('node:fs');fs.realpathSync=fs.realpathSync.native;require('node:module').syncBuiltinESMExports();require('./server.cjs')"],{cwd:__dirname,env:{...process.env,PORT:'8799',TIJARTI_DATA:data},stdio:['ignore','pipe','pipe']});
let out='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>{if(!String(b).includes('ExperimentalWarning')) process.stderr.write(b);});
let checks=0;function check(value,message){assert.ok(value,message);checks++;}
async function request(route,method='GET',data,cookie=''){const r=await fetch(origin+route,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:data?JSON.stringify(data):undefined});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
(async()=>{try{
 for(let i=0;i<100&&!out.includes('?setup=');i++)await new Promise(r=>setTimeout(r,50));
 const token=out.match(/\?setup=([a-f0-9]+)/)?.[1];check(token,'server starts with setup token');
 let r=await request('/api/store');check(r.status===200&&r.data.products.length===0,'no automatic dummy inventory');let p;
 r=await request('/api/admin/data');check(r.status===401,'anonymous admin access denied');
 r=await request('/api/setup','POST',{token,password:'short'});check(r.status===400,'minimum password length');
 r=await request('/api/setup','POST',{token,password:'Test-Password-982!'});check(r.status===200,'one-time setup');
 r=await request('/api/setup','POST',{token,password:'Test-Password-982!'});check(r.status===403,'setup cannot be reused');
 r=await request('/api/login','POST',{email:'tijarticlothingindustry@gmail.com',password:'Test-Password-982!'});const admin=r.cookie;check(r.status===200&&admin,'admin login');
 r=await request('/api/admin/products','POST',{name:'Test garment',category:'Kurtas',description:'Fixture',price:699,stock:10,sizes:'S,M,L',image:''},admin);check(r.status===400,'real photo required to publish');
 r=await request('/api/admin/upload','POST',{data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII='},admin);check(r.status===200,'image upload');
 const image=r.data.url;
 r=await request('/api/admin/products','POST',{name:'Test garment',category:'Kurtas',description:'Fixture',price:699,stock:10,sizes:'S,M,L',image},admin);check(r.status===200,'merchant product created');
 r=await request('/api/store');p=r.data.products[0];

 r=await request('/api/register','POST',{name:'Customer',email:'customer@example.com',password:'Customer-982!'});check(r.status===200,'customer registration');
 r=await request('/api/login','POST',{email:'customer@example.com',password:'Customer-982!'});const customer=r.cookie;check(r.status===200,'customer login');
 r=await request('/api/admin/data','GET',null,customer);check(r.status===403,'customer cannot access admin');
 r=await request('/api/admin/settings','POST',{upi:'test@bank',payee:'Test',qr:'',logo:''},admin);check(r.status===200,'payment settings');
 r=await request('/api/admin/products','POST',{...p,price:799,stock:3,sizes:'S,M,L',description:'Test garment'},admin);check(r.status===200,'admin can change price');
 const checkout={name:'Customer',phone:'9999999999',address:'Test house, Test road, Test city',pincode:'400001',items:[{id:p.id,size:'S',quantity:1,price:1}],total:1};
 r=await request('/api/orders','POST',checkout,customer);check(r.status===200&&r.data.total===799,'checkout uses server price, not submitted price');const order=r.data.id;
 r=await request('/api/orders/'+order+'/reference','POST',{reference:'123456789012'},customer);check(r.status===200,'customer submits UTR');
 r=await request('/api/orders','GET',null,customer);check(r.data[0].status==='Payment review','UTR does not mark order paid');
 r=await request('/api/admin/orders/'+order,'PATCH',{status:'Paid'},customer);check(r.status===403,'customer cannot verify own payment');
 r=await request('/api/orders','POST',{...checkout,items:[{id:p.id,size:'S',quantity:2},{id:p.id,size:'M',quantity:2}]},customer);check(r.status===400,'overselling across sizes prevented');
 r=await request('/api/store');check(r.data.products.find(x=>x.id===p.id).stock===2,'failed checkout rolls back all stock');
 r=await request('/api/admin/orders/'+order,'PATCH',{status:'Cancelled'},admin);check(r.status===200,'admin cancellation');
 r=await request('/api/store');check(r.data.products.find(x=>x.id===p.id).stock===3,'cancel restores stock');
 r=await request('/api/admin/orders/'+order,'PATCH',{status:'Cancelled'},admin);check(r.status===400,'repeat cancellation rejected');
 r=await request('/api/admin/upload','POST',{data:Buffer.from('<script>alert(1)</script>').toString('base64')},admin);check(r.status===400,'non-image upload rejected');
 r=await request('/api/contact','POST',{name:'Customer',email:'customer@example.com',message:'Please help with sizing.',phone:''});check(r.status===200,'contact form persists without email provider');
 r=await request('/api/admin/data','GET',null,admin);check(r.data.enquiries.length===1&&r.data.enquiries[0].delivery==='not configured','admin sees enquiry and email status');
 const csrf=await fetch(origin+'/api/logout',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json',Cookie:admin},body:'{}'});check(csrf.status===403,'cross-origin mutation rejected');
 r=await request('/api/admin/products/'+p.id,'DELETE',{},admin);check(r.status===200,'admin removes product');
 r=await request('/api/store');check(!r.data.products.find(x=>x.id===p.id),'removed product hidden');
 console.log('PASS: '+checks+' checks (auth, admin, prices, stock, UPI review, enquiries, upload and CSRF).');
}finally{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(data,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});

